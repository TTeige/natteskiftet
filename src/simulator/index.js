// Simulatoren: later som et lite nettsted midt på natta. Genererer trafikk,
// logger, metrikker og utrullinger, og setter i gang feil med jevne mellomrom.
// Alt skrives til live/, der agentens verktøy leser det (se src/vakt.js).
//
// live/fasit.jsonl er fasiten per scenario og alarm. Den er for poengtelling
// og skal aldri leses av agenten.
import fs from 'node:fs';
import path from 'node:path';
import { iso, klokke } from '../tid.js';
import { Alarmer } from './alarmer.js';
import { bakgrunn } from './bakgrunn.js';
import { kanskjeStøyendring, seedHistorikk } from './historikk.js';
import { Målinger } from './maalinger.js';
import { STARTVERSJONER, VERTER, grunntilstand } from './modell.js';
import { SCENARIER } from './scenarier.js';
import { heltall, tilfeldig, velg } from './tilfeldig.js';
import { generiskTiltak } from './tiltak.js';
import { genererTrafikk } from './trafikk.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env, det går fint. Simulatoren trenger ingen nøkler.
}

const MAPPE = path.resolve(process.env.DATA_DIR ?? 'live');
const FART = Number(process.env.SIM_FART ?? 10); // simulerte sekunder per ekte sekund
const TICK_MS = 1000;
const FØRSTE_MIN = Number(process.env.SIM_FORSTE ?? 5);
const PAUSE_MIN = [Number(process.env.SIM_PAUSE_MIN ?? 5), Number(process.env.SIM_PAUSE_MAKS ?? 15)];
// Uten overlapp venter neste scenario til det forrige er ferdig (pausen regnes fra slutten).
const OVERLAPP = process.env.SIM_OVERLAPP === '1';
// SIM_AUTO=0: ingen feil av seg selv, bare de som startes fra dashbordet (spilleder-modus).
const AUTO = process.env.SIM_AUTO !== '0';
const VALGTE = process.env.SIM_SCENARIO?.split(',').map((s) => s.trim());

if (VALGTE?.some((navn) => !SCENARIER.some((s) => s.navn === navn))) {
  console.error(`Ukjent scenario i SIM_SCENARIO. Gyldige: ${SCENARIER.map((s) => s.navn).join(', ')}`);
  process.exit(1);
}

function startTid() {
  const s = process.env.SIM_START ?? '02:30';
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const d = new Date();
    d.setHours(...s.split(':').map(Number), 0, 0);
    return d.getTime();
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Skjønner ikke SIM_START «${s}». Bruk "02:30" eller full ISO-tid.`);
  return ms;
}

// Starter med blanke ark hver gang. Mappa slettes bare hvis det er en
// simulatormappe fra før (har meta.json).
function klargjørMappe() {
  if (fs.existsSync(MAPPE) && fs.readdirSync(MAPPE).length) {
    if (!fs.existsSync(path.join(MAPPE, 'meta.json'))) {
      console.error(`${MAPPE} finnes og ser ikke ut som en simulatormappe. Velg en annen DATA_DIR.`);
      process.exit(1);
    }
    fs.rmSync(MAPPE, { recursive: true });
  }
  fs.mkdirSync(MAPPE, { recursive: true });
  // Inventaret som ikke endrer seg i løpet av natta: tjenester, runbooks og gamle hendelser.
  const kilde = path.join(import.meta.dirname, '..', '..', 'data');
  for (const fil of ['tjenester.json', 'hendelser.json']) fs.copyFileSync(path.join(kilde, fil), path.join(MAPPE, fil));
  fs.cpSync(path.join(kilde, 'runbooks'), path.join(MAPPE, 'runbooks'), { recursive: true });
}

const skriv = (fil, obj) => fs.appendFileSync(path.join(MAPPE, fil), JSON.stringify(obj) + '\n');

klargjørMappe();

const start = startTid();
let nå = start;
let loggbuffer = [];
const versjoner = { ...STARTVERSJONER };
const tidligereVersjoner = {}; // tjeneste -> versjonene før den nåværende, eldst først
let kommandoerLest = 0;
const målinger = new Målinger();
const alarmer = new Alarmer();
const aktive = [];
const nylig = []; // scenarier som sluttet de siste minuttene, for å knytte sene alarmer til riktig scenario
let nesteScenario = start + FØRSTE_MIN * 60000;
let forrigeScenario = null;
const kjørt = new Set();

const ctx = {
  måler: { tilkoblinger: 38, kø: 0, disk: { 'innlogging-01': 54, 'innlogging-02': 61 } },
  logg(t, tjeneste, nivå, melding, vert = velg(VERTER[tjeneste])) {
    loggbuffer.push({ t: Math.round(t), tjeneste, vert, nivå, melding });
  },
  måling: (...a) => målinger.forespørsel(...a),
  sms: (...a) => målinger.sms(...a),
  deploy: ({ tid, tjeneste, versjon, av, endring }) => skriv('deploy-historikk.jsonl', { tid: iso(tid), tjeneste, versjon, av, endring }),
  pausetMaler: new Set(),
  versjon: (tjeneste) => versjoner[tjeneste],
  forrigeVersjon: (tjeneste) => tidligereVersjoner[tjeneste]?.at(-1),
  // Brukes ved rollback: går ett hakk tilbake i historikken.
  settVersjon(tjeneste, v) {
    if (tidligereVersjoner[tjeneste]?.at(-1) === v) tidligereVersjoner[tjeneste].pop();
    versjoner[tjeneste] = v;
  },
  nyVersjon(tjeneste, del = 'patch') {
    (tidligereVersjoner[tjeneste] ??= []).push(versjoner[tjeneste]);
    const [a, b, c] = versjoner[tjeneste].split('.').map(Number);
    versjoner[tjeneste] = del === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
    return versjoner[tjeneste];
  },
};

seedHistorikk(ctx, start);

function styrScenarier(t) {
  for (const s of [...aktive]) {
    if (t < s.sluttTid) continue;
    s.slutt?.(t, ctx);
    aktive.splice(aktive.indexOf(s), 1);
    nylig.push({ navn: s.navn, slutt: t });
    skriv('fasit.jsonl', { type: 'slutt', scenario: s.navn, tid: iso(t) });
    console.log(`✅ ${klokke(t)} scenario ferdig: ${s.navn}`);
    if (!OVERLAPP && aktive.length === 0) nesteScenario = t + tilfeldig(...PAUSE_MIN) * 60000;
  }
  while (nylig.length && t - nylig[0].slutt > 10 * 60000) nylig.shift();

  if (!AUTO || t < nesteScenario || (!OVERLAPP && aktive.length)) return;
  nesteScenario = t + tilfeldig(...PAUSE_MIN) * 60000;
  const kandidater = SCENARIER.filter((S) => (!VALGTE || VALGTE.includes(S.navn)) &&
    !aktive.some((a) => a.navn === S.navn) && !(S.enGangPerNatt && kjørt.has(S.navn)) &&
    (S.navn !== forrigeScenario || VALGTE?.length === 1));
  if (kandidater.length > 0) startScenario(velg(kandidater), t);
}

function startScenario(S, t) {
  const varighet = heltall(...S.varighet);
  const s = { ...S.lag(varighet), navn: S.navn, startTid: t, sluttTid: t + varighet * 60000 };
  const fasit = s.start(t, ctx);
  aktive.push(s);
  forrigeScenario = S.navn;
  kjørt.add(S.navn);
  skriv('fasit.jsonl', { type: 'scenario', scenario: S.navn, start: iso(t), planlagt_slutt: iso(s.sluttTid), ...fasit });
  console.log(`🎭 ${klokke(t)} scenario startet: ${S.navn} (ca ${varighet} min)`);
}

// Tiltak fra agenten (via utfor_tiltak) kommer inn som linjer i kommandoer.jsonl.
// Et aktivt scenario kan ta tiltaket og løse seg selv; ellers skjer det generiske.
function behandleKommandoer(t) {
  const fil = path.join(MAPPE, 'kommandoer.jsonl');
  if (!fs.existsSync(fil)) return;
  const linjer = fs.readFileSync(fil, 'utf8').split('\n').filter(Boolean);
  for (const linje of linjer.slice(kommandoerLest)) {
    const k = JSON.parse(linje);
    // Fra spillederen, ikke fra agenten (utfor_tiltak har ikke denne handlingen).
    if (k.handling === 'start_scenario') {
      const S = SCENARIER.find((x) => x.navn === k.parameter);
      const ok = S && !aktive.some((a) => a.navn === S.navn);
      if (ok) startScenario(S, t);
      skriv('kommando-svar.jsonl', { id: k.id, tid: iso(t), ok: !!ok, melding: ok ? `Startet ${S.navn}.` : `Kan ikke starte «${k.parameter}».` });
      continue;
    }
    let svar = null;
    for (const s of aktive) {
      const r = s.tiltak?.(k, t, ctx);
      if (!r) continue;
      if (r.løser) s.sluttTid = Math.min(s.sluttTid, t + (r.etterMs ?? 0));
      svar = { ok: true, melding: r.melding, løste: r.løser ? s.navn : null, grovt: r.grovt ?? false };
      break;
    }
    svar ??= generiskTiltak(k, t, ctx);
    skriv('kommando-svar.jsonl', { id: k.id, tid: iso(t), ok: svar.ok, melding: svar.melding });
    skriv('fasit.jsonl', {
      type: 'tiltak', tid: iso(t), handling: k.handling, tjeneste: k.tjeneste, parameter: k.parameter ?? null,
      begrunnelse: k.begrunnelse, aktive_scenarier: aktive.map((s) => s.navn), løste: svar.løste ?? null, grovt: svar.grovt ?? false,
    });
    console.log(`🛠️  ${klokke(t)} tiltak ${k.handling} ${k.tjeneste} ${k.parameter ?? ''}: ${svar.melding}`);
  }
  kommandoerLest = linjer.length;
}

function oppdaterMåler(tilstand, m0) {
  const { måler } = ctx;
  måler.tilkoblinger += (tilstand['kunde-db'].tilkoblingerMål - måler.tilkoblinger) * 0.45 + tilfeldig(-3, 3);
  måler.tilkoblinger = Math.min(200, Math.max(5, måler.tilkoblinger));
  for (const vert of Object.keys(måler.disk)) {
    const mål = tilstand.disk[vert] ?? (vert === 'innlogging-01' ? 54 : 61);
    måler.disk[vert] += (mål - måler.disk[vert]) * 0.6 + tilfeldig(-0.3, 0.3);
  }
  const sms = målinger.bøtte(m0, 'varsling');
  måler.kø = Math.max(0, Math.round(måler.kø * 0.6 + (sms.smsSendt - sms.smsLevert) * 4 + heltall(0, 3)));
}

function minuttFerdig(m0, tilstand) {
  oppdaterMåler(tilstand, m0);
  bakgrunn(m0, ctx);
  for (const s of aktive) s.bakgrunn?.(m0, (m0 - s.startTid) / 60000, ctx);
  kanskjeStøyendring(m0, ctx);
  for (const linje of målinger.avslutt(m0, ctx.måler)) skriv('metrikker.jsonl', linje);

  for (const a of alarmer.vurder(m0 + 60000, målinger, ctx.måler)) {
    skriv('alarmer.jsonl', a);
    if (a.status === 'utløst') {
      const scenarier = [...aktive.map((s) => s.navn), ...nylig.map((s) => s.navn)];
      skriv('fasit.jsonl', { type: 'alarm', alarm: a.id, tid: a.tid, scenarier: [...new Set(scenarier)] });
      console.log(`🚨 ${klokke(m0 + 60000)} ${a.id} ${a.alvorlighet}: ${a.tekst}`);
    } else {
      console.log(`   ${klokke(m0 + 60000)} ${a.id} løst`);
    }
  }
}

// Ett steg er maks 10 simulerte sekunder, så høy SIM_FART gir samme forløp, bare raskere.
function steg(til) {
  behandleKommandoer(nå);
  styrScenarier(nå);
  const tilstand = grunntilstand();
  for (const s of aktive) s.påvirk(tilstand, (nå - s.startTid) / 60000, ctx);
  genererTrafikk(nå, til, tilstand, ctx);
  for (let m = Math.floor(nå / 60000) * 60000 + 60000; m <= til; m += 60000) minuttFerdig(m - 60000, tilstand);
  nå = til;
}

function tick() {
  const slutt = nå + TICK_MS * FART;
  while (nå < slutt) steg(Math.min(slutt, nå + 10000));

  loggbuffer.sort((a, b) => a.t - b.t);
  const linjer = loggbuffer.map(({ t, ...l }) => JSON.stringify({ tid: iso(t), ...l })).join('\n');
  if (linjer) fs.appendFileSync(path.join(MAPPE, 'logger.jsonl'), linjer + '\n');
  loggbuffer = [];

  fs.writeFileSync(path.join(MAPPE, 'meta.json'), JSON.stringify({
    start: iso(start), nå: iso(nå), fart: FART, auto: AUTO, scenarier: SCENARIER.map((s) => s.navn), aktive: aktive.map((s) => s.navn),
  }, null, 2));
}

console.log(`🌙 Simulerer natta fra ${klokke(start)} i ${FART}x fart. Skriver til ${MAPPE}`);
console.log(AUTO ? `   Første scenario om ca ${FØRSTE_MIN} simulerte minutter. Ctrl+C for å stoppe.\n` : '   Spilleder-modus (SIM_AUTO=0): feil startes fra dashbordet.\n');
tick();
setInterval(tick, TICK_MS);
