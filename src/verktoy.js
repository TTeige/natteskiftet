// Verktøyene til natteskift-agenten. Et verktøy er en definisjon (det modellen
// ser) og en kjør-funksjon (det som faktisk skjer). kjør: null betyr stub: den
// sendes ikke til modellen før dere implementerer den.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { iso } from './tid.js';

// data/ er det faste eksempelet. Med DATA_DIR=live leser verktøyene det
// simulatoren skriver. Leses ved hvert kall, ikke ved import (se agent.js).
const dataDir = () => path.resolve(process.env.DATA_DIR ?? path.join(import.meta.dirname, '..', 'data'));
const lesJson = (fil) => JSON.parse(fs.readFileSync(path.join(dataDir(), fil), 'utf8'));

// Simulatoren skriver én JSON-linje per hendelse (navn.jsonl), data/ har vanlige lister (navn.json).
function lesListe(navn) {
  const jsonl = path.join(dataDir(), `${navn}.jsonl`);
  if (fs.existsSync(jsonl)) return fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (fs.existsSync(path.join(dataDir(), `${navn}.json`))) return lesJson(`${navn}.json`);
  return [];
}

// Simulatorens klokke, hvis vi leser fra en simulator.
function simulertNå() {
  const meta = path.join(dataDir(), 'meta.json');
  return fs.existsSync(meta) ? Date.parse(JSON.parse(fs.readFileSync(meta, 'utf8')).nå) : null;
}

export const system = `Du tar første vakt når en alarm går om natta, før et menneske rekker å åpne laptopen.
Grav i loggene og de andre kildene til du har en hypotese om hva som skjer og hvorfor.
Skill mellom det du har sett i dataene og det du antar. Si eksplisitt hva du ikke vet.
En agent som gjetter på et produksjonsproblem er verre enn ingen agent.
Du kan foreslå tiltak med utfor_tiltak. Et menneske godkjenner hvert tiltak. Foreslå bare tiltak du har belegg for i dataene;
ofte er det riktige å ikke gjøre noe, eller å vekke rett person. Har du utført et tiltak, sjekk metrikkene etterpå og si om det virket.
Avslutt med en kort situasjonsrapport på norsk: alvorlighet, berørt tjeneste, sannsynlig årsak, hva du ikke vet, og foreslått neste steg.`;

export const eksempelOppgave =
  'ALARM kl 03:12 natt til 29. oktober: betaling: andel 5xx-svar siste 5 min er 9.4 % (terskel 5 %). Gjelder POST /betaling/trekk.';

// Godtar full ISO-tid eller bare "03:10". Med simulatoren betyr "03:10" siste
// gang klokka var 03:10, ellers natt til 29. okt 2026, norsk tid.
function tilMs(tid) {
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(tid)) {
    const nå = simulertNå();
    if (nå === null) {
      tid = `2026-10-29T${tid.padStart(5, '0')}+01:00`;
    } else {
      const iDag = Date.parse(`${iso(nå).slice(0, 10)}T${tid.padStart(5, '0')}${iso(nå).slice(19)}`);
      return iDag > nå ? iDag - 86400000 : iDag;
    }
  }
  const ms = Date.parse(tid);
  if (Number.isNaN(ms)) throw new Error(`Skjønner ikke tidspunktet «${tid}». Bruk f.eks. "03:10" eller "2026-10-29T03:10:00+01:00".`);
  return ms;
}

function sokILogger({ tjeneste, niva, fra, til, tekst, maks = 50 } = {}) {
  const fraMs = fra ? tilMs(fra) : -Infinity;
  const tilMsVerdi = til ? tilMs(til) : Infinity;
  const logger = lesListe('logger');
  const kjente = [...new Set(logger.map((l) => l.tjeneste))];
  if (tjeneste && !kjente.includes(tjeneste)) throw new Error(`Ukjent tjeneste «${tjeneste}». Gyldige: ${kjente.join(', ')}`);
  const treff = logger.filter((l) =>
    (!tjeneste || l.tjeneste === tjeneste) &&
    (!niva || l.nivå === niva.toUpperCase()) &&
    (!tekst || l.melding.toLowerCase().includes(tekst.toLowerCase())) &&
    Date.parse(l.tid) >= fraMs && Date.parse(l.tid) <= tilMsVerdi);

  const grense = Math.min(Math.max(Number(maks) || 50, 1), 200);
  if (treff.length === 0) return 'Ingen logglinjer matchet filteret. Prøv et bredere søk.';
  treff.sort((a, b) => Date.parse(a.tid) - Date.parse(b.tid));
  // Er det for mange, er de nyeste mest interessante.
  const linjer = treff.slice(-grense).map((l) => `${l.tid} ${l.tjeneste}${l.vert ? ` [${l.vert}]` : ''} ${l.nivå} ${l.melding}`);
  if (treff.length > grense) linjer.unshift(`... ${treff.length - grense} eldre linjer utelatt. Snevre inn søket (f.eks. med til) eller øk maks.`);
  return linjer.join('\n');
}

function hentRunbook(tjeneste) {
  const fil = path.join(dataDir(), 'runbooks', `${tjeneste}.md`);
  if (!/^[a-z-]+$/.test(tjeneste ?? '') || !fs.existsSync(fil)) {
    const finnes = fs.readdirSync(path.join(dataDir(), 'runbooks')).map((f) => f.replace(/\.md$/, ''));
    throw new Error(`Ingen runbook for «${tjeneste}». Runbooks som finnes: ${finnes.join(', ')}`);
  }
  return fs.readFileSync(fil, 'utf8');
}

function sjekkDeployHistorikk({ tjeneste, siden } = {}) {
  const sidenMs = siden ? tilMs(siden) : -Infinity;
  const treff = lesListe('deploy-historikk')
    .filter((d) => (!tjeneste || d.tjeneste === tjeneste) && Date.parse(d.tid) >= sidenMs)
    .sort((a, b) => Date.parse(b.tid) - Date.parse(a.tid));
  if (treff.length === 0) return 'Ingen endringer matchet filteret. Prøv uten tjeneste eller med et tidligere tidspunkt.';
  return treff.map((d) => `${d.tid} ${d.tjeneste} ${d.versjon} (${d.av}): ${d.endring}`).join('\n');
}

function finnLignendeHendelser({ tjeneste, tekst } = {}) {
  const ord = tekst?.toLowerCase();
  const treff = lesJson('hendelser.json').filter((h) =>
    (!tjeneste || h.tjeneste === tjeneste) &&
    (!ord || [h.tittel, h.sammendrag, h.rotårsak].join(' ').toLowerCase().includes(ord)));
  if (treff.length === 0) return 'Ingen tidligere hendelser matchet. Prøv et annet søkeord eller uten tjeneste.';
  return treff;
}

function hentTjenesteinfo({ tjeneste } = {}) {
  const tjenester = lesJson('tjenester.json');
  if (!tjeneste) return tjenester;
  const t = tjenester.find((x) => x.navn === tjeneste);
  if (!t) throw new Error(`Ukjent tjeneste «${tjeneste}». Gyldige: ${tjenester.map((x) => x.navn).join(', ')}`);
  const brukesAv = tjenester.filter((x) => x.avhengigheter?.includes(tjeneste)).map((x) => x.navn);
  return { ...t, brukes_av: brukesAv };
}

function hentMetrikker({ tjeneste, fra, til } = {}) {
  const alle = lesListe('metrikker');
  if (alle.length === 0) return 'Ingen metrikker i denne datakilden. Bruk loggene.';
  const sist = Date.parse(alle.at(-1).tid);
  const fraMs = fra ? tilMs(fra) : sist - 29 * 60000;
  const tilMsVerdi = til ? tilMs(til) : Infinity;
  const treff = alle.filter((m) => (!tjeneste || m.tjeneste === tjeneste) && Date.parse(m.tid) >= fraMs && Date.parse(m.tid) <= tilMsVerdi);
  if (treff.length === 0) return 'Ingen metrikker matchet filteret.';
  const linjer = treff.slice(-120).map(({ tid, tjeneste: tj, ...verdier }) =>
    `${tid} ${tj} ${Object.entries(verdier).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`);
  if (treff.length > 120) linjer.unshift(`... ${treff.length - 120} eldre linjer utelatt.`);
  return linjer.join('\n');
}

// Hvem som godkjenner tiltak. Standard er å spørre i terminalen. Et dashbord
// kan bytte den ut med settGodkjenner. TILTAK_GODKJENNING=auto godkjenner alt,
// =aldri avviser alt.
let godkjenner = spørITerminalen;
export const settGodkjenner = (fn) => { godkjenner = fn; };

async function spørITerminalen({ handling, tjeneste, parameter, begrunnelse }) {
  const modus = process.env.TILTAK_GODKJENNING ?? 'spør';
  if (modus === 'auto') return { godkjent: true };
  if (modus === 'aldri') return { godkjent: false, grunn: 'TILTAK_GODKJENNING=aldri' };
  if (!process.stdin.isTTY) return { godkjent: false, grunn: 'ingen vakthavende ved terminalen' };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const svar = await rl.question(
      `\n\x1b[1;33m⚠️  Agenten vil: ${handling} ${tjeneste}${parameter ? ` (${parameter})` : ''}\x1b[0m\n` +
      `   Begrunnelse: ${begrunnelse}\n   Godkjenn? [j/N] `);
    return /^(j|ja|y|yes)$/i.test(svar.trim()) ? { godkjent: true } : { godkjent: false, grunn: 'avvist av vakthavende' };
  } finally {
    rl.close();
  }
}

async function utførTiltak({ handling, tjeneste, parameter, begrunnelse }) {
  if (simulertNå() === null) return 'Tiltak er bare tilgjengelige mot simulatoren (DATA_DIR=live). Ingenting ble gjort.';
  const svar = await godkjenner({ handling, tjeneste, parameter, begrunnelse });
  if (!svar.godkjent) return `Tiltaket ble IKKE utført (${svar.grunn}). Foreslå det i rapporten i stedet.`;

  const id = Math.random().toString(36).slice(2, 10);
  fs.appendFileSync(path.join(dataDir(), 'kommandoer.jsonl'), JSON.stringify({ id, handling, tjeneste, parameter, begrunnelse }) + '\n');
  // Simulatoren plukker opp kommandoen innen et sekund og skriver svaret.
  for (let forsøk = 0; forsøk < 20; forsøk++) {
    await new Promise((r) => setTimeout(r, 500));
    const resultat = lesListe('kommando-svar').find((s) => s.id === id);
    if (resultat) return `${resultat.ok ? 'Utført' : 'Feilet'} (${resultat.tid}): ${resultat.melding}\nSjekk metrikkene om et par minutter for å se om det virket.`;
  }
  return 'Fikk ikke svar fra systemet innen 10 s. Vet ikke om tiltaket ble utført.';
}

function hentAlarmer({ siden } = {}) {
  const sidenMs = siden ? tilMs(siden) : -Infinity;
  const alarmer = lesListe('alarmer').filter((a) => Date.parse(a.tid) >= sidenMs);
  if (alarmer.length === 0) return 'Ingen alarmer i perioden.';
  return alarmer.map((a) => `${a.tid} ${a.id} ${a.status ?? 'utløst'} ${a.tjeneste} (${a.alvorlighet}): ${a.tekst}`).join('\n');
}

export const verktøy = [
  {
    definisjon: {
      name: 'sok_i_logger',
      description:
        'Søker i loggene. Alle filtre er valgfrie og kan kombineres. Er det mange treff, får du de nyeste. ' +
        'Tjenester: api-gateway, innlogging, betaling, sok, varsling, kunde-db. ' +
        'Start gjerne bredt (én tjeneste, et tidsvindu rundt alarmen) og snevre inn med tekst når du ser noe interessant. ' +
        'Husk at feilen ofte sitter i en annen tjeneste enn den som alarmerer.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "betaling".' },
          niva: { type: 'string', enum: ['INFO', 'WARN', 'ERROR'], description: 'Bare linjer med dette nivået.' },
          fra: { type: 'string', description: 'Fra og med tidspunkt, "03:00" eller full ISO-tid.' },
          til: { type: 'string', description: 'Til og med tidspunkt, "03:15" eller full ISO-tid.' },
          tekst: { type: 'string', description: 'Tekst som må finnes i meldingen (ikke skille på store/små bokstaver).' },
          maks: { type: 'number', description: 'Maks antall linjer tilbake. Standard 50, høyst 200.' },
        },
      },
    },
    kjør: async (input) => sokILogger(input),
  },
  {
    definisjon: {
      name: 'hent_runbook',
      description:
        'Henter runbooken for en tjeneste: hva teamet anbefaler å gjøre ved kjente feil, og hvem som skal vekkes. ' +
        'Sjekk datoen øverst. En gammel runbook kan beskrive oppsett som ikke finnes lenger, så sammenlign med det du ser i loggene.',
      input_schema: {
        type: 'object',
        properties: { tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "sok".' } },
        required: ['tjeneste'],
      },
    },
    kjør: async ({ tjeneste }) => hentRunbook(tjeneste),
  },
  {
    definisjon: {
      name: 'sjekk_deploy_historikk',
      description:
        'Viser utrullinger og konfigendringer, nyest først. Bruk den for å finne ut om noe ble endret rett før problemene startet. ' +
        'Husk at konfig- og cron-endringer også teller, og at en endring for flere dager siden kan slå inn først nå.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Bare endringer for denne tjenesten. Utelat for alle.' },
          siden: { type: 'string', description: 'Bare endringer etter dette tidspunktet (ISO-tid).' },
        },
      },
    },
    kjør: async (input) => sjekkDeployHistorikk(input),
  },
  {
    definisjon: {
      name: 'finn_lignende_hendelser',
      description:
        'Søker i tidligere hendelser med post-mortem: hva skjedde, rotårsak, hva som ble gjort og hvor lenge det varte. ' +
        'Nyttig for å se om dette har skjedd før. Vær nøye med forskjellene: en hendelse som ligner, er ikke nødvendigvis samme feil.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Bare hendelser for denne tjenesten.' },
          tekst: { type: 'string', description: 'Søkeord, f.eks. "disk" eller "timeout".' },
        },
      },
    },
    kjør: async (input) => finnLignendeHendelser(input),
  },
  {
    definisjon: {
      name: 'hent_tjenesteinfo',
      description:
        'Viser beskrivelse, eier-team, vaktpersoner og avhengigheter for en tjeneste, og hvilke tjenester som er avhengige av den. ' +
        'Bruk den for å følge feilen nedover i avhengighetene og for å finne ut hvem som skal vekkes. Utelat tjeneste for alle.',
      input_schema: {
        type: 'object',
        properties: { tjeneste: { type: 'string', description: 'Tjenestenavn, f.eks. "betaling".' } },
      },
    },
    kjør: async (input) => hentTjenesteinfo(input),
  },
  {
    definisjon: {
      name: 'hent_metrikker',
      description:
        'Metrikker per tjeneste per minutt: rps, feilrate_5xx_pst, p95_ms, og for enkelte tjenester databasetilkoblinger, SMS sendt/levert, kølengde og diskbruk. ' +
        'Tallene er eksakte, mens loggene bare har et utvalg av de vellykkede kallene. Uten fra gir den siste 30 minutter.',
      input_schema: {
        type: 'object',
        properties: {
          tjeneste: { type: 'string', description: 'Bare denne tjenesten. Utelat for alle.' },
          fra: { type: 'string', description: 'Fra og med tidspunkt, "03:00" eller full ISO-tid.' },
          til: { type: 'string', description: 'Til og med tidspunkt.' },
        },
      },
    },
    kjør: async (input) => hentMetrikker(input),
  },
  {
    definisjon: {
      name: 'hent_alarmer',
      description:
        'Viser alarmer som har gått og blitt løst. Nyttig for å se om flere tjenester alarmerer samtidig, og hvilken som startet først.',
      input_schema: {
        type: 'object',
        properties: { siden: { type: 'string', description: 'Bare alarmer etter dette tidspunktet.' } },
      },
    },
    kjør: async (input) => hentAlarmer(input),
  },
  {
    definisjon: {
      name: 'utfor_tiltak',
      description:
        'Utfører et tiltak i produksjon. Et menneske må godkjenne hvert tiltak og kan avvise det. ' +
        'Bruk det bare når dataene viser at tiltaket vil hjelpe, og skriv i begrunnelse hva du har sett. Feil tiltak kan gjøre vondt verre. ' +
        'Handlinger: rollback (forrige versjon av tjenesten), avbryt_db_prosess (pg_cancel_backend på kunde-db, parameter = pid), ' +
        'pause_reindeks (sok, parameter = indeksnavn), pause_varslingsmal (varsling, parameter = malnavn), restart_tjeneste (alle instanser).',
      input_schema: {
        type: 'object',
        properties: {
          handling: { type: 'string', enum: ['rollback', 'avbryt_db_prosess', 'pause_reindeks', 'pause_varslingsmal', 'restart_tjeneste'] },
          tjeneste: { type: 'string', enum: ['api-gateway', 'innlogging', 'betaling', 'sok', 'varsling', 'kunde-db'] },
          parameter: { type: 'string', description: 'pid, indeksnavn eller malnavn, avhengig av handling.' },
          begrunnelse: { type: 'string', description: 'Hva du har sett i dataene som gjør at du tror dette hjelper. Vises til den som godkjenner.' },
        },
        required: ['handling', 'tjeneste', 'begrunnelse'],
      },
    },
    kjør: async (input) => utførTiltak(input),
  },
];
