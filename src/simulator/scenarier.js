// Feilene simulatoren setter i gang. Hvert scenario får varigheten sin i
// minutter og gir tilbake fasiten fra start(): det agenten burde finne ut.
// påvirk() kalles hver tick og skrur på tilstanden, bakgrunn() hvert minutt.
// enGangPerNatt er for nattlige jobber som ikke gir mening å kjøre to ganger.
// harTiltak: det finnes et tiltak som løser det. I spilleder-modus går slike
// feil ikke over av seg selv, så det er agentens tiltak som redder natta.
// tiltak() får tiltak fra agenten. Returnerer den noe, har scenariet tatt det;
// med løser: true er scenariet over etter etterMs. Ellers skjer det generiske i tiltak.js.
import { klokke } from '../tid.js';
import { dagerFør } from './historikk.js';
import { heltall, sjanse, tilfeldig, velg } from './tilfeldig.js';

const UKEDAGER = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const rampe = (min, over) => Math.min(1, Math.max(0, min / over));

const BETALINGSFEIL = [
  {
    endring: 'Ny gebyrberegning for utenlandske kort. Valuta hentes nå fra kortinfo-objektet i stedet for fra transaksjonen.',
    rotårsak: 'gebyrberegningen leser valuta fra kortinfo-objektet, som mangler for utenlandske kort',
    gjelder: 'bare trekk med utenlandske kort',
    treffer: (ep, req) => ep.sti.endsWith('/trekk') && req.kort === 'utenlandsk',
    melding: (req) => `TypeError: Cannot read properties of undefined (reading 'valuta') i beregnGebyr (gebyr.js:88) id=${req.id} kort=utenlandsk`,
  },
  {
    endring: 'Støtte for nettverkstokens fra Kortnett i trekk og refusjon.',
    rotårsak: 'ny kode antar at alle lagrede kort har et nettverkstoken, men kort lagret før 2024 har det ikke',
    gjelder: 'bare kort lagret før 2024 (ca 15 % av kallene)',
    treffer: (ep, req) => ep.tjeneste === 'betaling' && req.gammeltKort,
    melding: (req) => `TypeError: Cannot read properties of null (reading 'token') i hentNettverkstoken (kort.js:142) id=${req.id} kort=${req.kort}`,
  },
];

export const SCENARIER = [
  {
    navn: 'betaling-utrulling',
    harTiltak: true,
    varighet: [25, 40],
    lag() {
      let feil, forrige, ny, løst = false;
      return {
        start(t, ctx) {
          feil = velg(BETALINGSFEIL);
          forrige = ctx.versjon('betaling');
          ny = ctx.nyVersjon('betaling', 'minor');
          ctx.deploy({ tid: t, tjeneste: 'betaling', versjon: ny, av: `Release-tog natt-${klokke(t).replace(':', '')}`, endring: feil.endring });
          ctx.logg(t + 4000, 'betaling', 'INFO', `starter betaling versjon=${ny} node=v22.11.0`, 'betaling-01');
          ctx.logg(t + 47000, 'betaling', 'INFO', `starter betaling versjon=${ny} node=v22.11.0`, 'betaling-02');
          return {
            rotårsak: `Kodefeil i betaling ${ny}: ${feil.rotårsak}. Gjelder ${feil.gjelder}.`,
            riktig_tiltak: `Rull tilbake betaling til ${forrige} (deploy rollback betaling), si fra i #betaling-drift og vekk Team Myntkammer.`,
            felle: 'Feilen gjelder bare en del av trafikken, så de fleste trekk går fint.',
            berørt: ['betaling', 'api-gateway'],
          };
        },
        påvirk(tilstand, min) {
          if (min < 0.8) return;
          tilstand.betaling.feil = { andel: (ep, req) => (feil.treffer(ep, req) ? 1 : 0), melding: (ep, req) => feil.melding(req) };
        },
        tiltak(k, t, ctx) {
          if (k.handling !== 'rollback' || k.tjeneste !== 'betaling') return;
          løst = true;
          ctx.settVersjon('betaling', forrige);
          ctx.deploy({ tid: t, tjeneste: 'betaling', versjon: forrige, av: 'natteskift-agent (godkjent av vakt)', endring: `Rollback fra ${ny} til ${forrige}.` });
          ctx.logg(t + 20000, 'betaling', 'INFO', `starter betaling versjon=${forrige} node=v22.11.0`, 'betaling-01');
          ctx.logg(t + 70000, 'betaling', 'INFO', `starter betaling versjon=${forrige} node=v22.11.0`, 'betaling-02');
          return { løser: true, etterMs: 90000, melding: `Rullet tilbake betaling fra ${ny} til ${forrige}. Instansene byttes i løpet av ca 90 s.` };
        },
        slutt(t, ctx) {
          if (løst) return;
          ctx.settVersjon('betaling', forrige);
          ctx.deploy({ tid: t, tjeneste: 'betaling', versjon: forrige, av: 'Sigrid Gravlund', endring: `Rollback fra ${ny} til ${forrige} etter feilrate på trekk.` });
        },
      };
    },
  },

  {
    navn: 'kunde-db-vedlikehold',
    harTiltak: true,
    varighet: [18, 30],
    enGangPerNatt: true,
    lag() {
      let pid, start, løst = false;
      return {
        start(t, ctx) {
          pid = heltall(20000, 39999);
          start = t;
          ctx.deploy({
            tid: dagerFør(t, heltall(4, 7)), tjeneste: 'kunde-db', versjon: `cron-konfig r${heltall(41, 49)}`, av: 'Even Gravdal',
            endring: `Flyttet ukentlig-vedlikehold fra søndag 04:00 til ${UKEDAGER[new Date(t).getDay()]} ${klokke(t)} for å unngå kollisjon med søndagsbackup.`,
          });
          ctx.logg(t, 'kunde-db', 'INFO', `cron: starter ukentlig-vedlikehold.sh (VACUUM FULL sesjoner; REINDEX TABLE ordrer) pid=${pid}`);
          ctx.logg(t + 1400, 'kunde-db', 'INFO', `prosess ${pid} fikk AccessExclusiveLock på relasjon "sesjoner"`);
          return {
            rotårsak: 'Ukentlig vedlikehold på kunde-db er flyttet til natt til i dag. VACUUM FULL tar AccessExclusiveLock på "sesjoner", innlogging blir hengende, og tilkoblingene hoper seg opp mot grensen på 200.',
            riktig_tiltak: `Avbryt vedlikeholdsjobben (SELECT pg_cancel_backend(${pid})), vekk Team Grunnmur og flytt cron-jobben til et tidspunkt uten trafikk.`,
            felle: 'Det er api-gateway og innlogging som alarmerer, men feilen sitter i kunde-db. Runbooken for kunde-db er utdatert: den sier restart pgbouncer, men pgbouncer ble fjernet i mars.',
            berørt: ['kunde-db', 'innlogging', 'betaling', 'api-gateway'],
          };
        },
        påvirk(tilstand, min) {
          const r = rampe(min, 7);
          tilstand['kunde-db'].tilkoblingerMål = 40 + 170 * r;
          tilstand.innlogging.latensFaktor = 1 + 8 * r;
          tilstand.innlogging.timeoutAndel = 0.05 + 0.5 * r;
          tilstand.innlogging.timeoutMelding = (ep, req) => (r > 0.85
            ? `kunne ikke hente databasetilkobling: too many connections (kunde-db) bruker=${req.bruker}`
            : `spørring mot "sesjoner" avbrutt etter 30000ms (statement_timeout) bruker=${req.bruker}`);
          tilstand.betaling.timeoutAndel = 0.15 * r;
          tilstand.betaling.timeoutMelding = (ep, req) => `kunne ikke hente databasetilkobling innen 30000ms (kunde-db) id=${req.id}`;
        },
        bakgrunn(m0, min, ctx) {
          for (let i = 1 + Math.round(rampe(min, 7) * 6); i > 0; i--) {
            ctx.logg(m0 + heltall(0, 59999), 'kunde-db', 'WARN',
              `prosess ${heltall(40000, 49999)} venter fortsatt på RowExclusiveLock på relasjon "sesjoner" etter 5000 ms (bruker=${velg(['innlogging', 'innlogging', 'betaling'])}). Prosess som holder låsen: ${pid}.`);
          }
          if (ctx.måler.tilkoblinger > 195) {
            for (let i = heltall(2, 6); i > 0; i--) {
              ctx.logg(m0 + heltall(0, 59999), 'kunde-db', 'ERROR', 'FATAL: remaining connection slots are reserved for non-replication superuser connections');
            }
          }
        },
        tiltak(k, t, ctx) {
          if (k.handling === 'avbryt_db_prosess' && String(k.parameter).trim() === String(pid)) {
            løst = true;
            ctx.logg(t, 'kunde-db', 'ERROR', `canceling statement due to user request (prosess ${pid}: VACUUM FULL sesjoner)`);
            ctx.logg(t + 800, 'kunde-db', 'WARN', `cron: ukentlig-vedlikehold.sh avsluttet med kode 1 etter ${Math.round((t - start) / 60000)} min pid=${pid}`);
            return { løser: true, etterMs: 30000, melding: `pg_cancel_backend(${pid}) = t. VACUUM FULL avbrutt, låsen på "sesjoner" er sluppet.` };
          }
          if (k.handling === 'restart_tjeneste' && k.tjeneste === 'kunde-db') {
            løst = true;
            ctx.logg(t, 'kunde-db', 'WARN', 'received fast shutdown request, aborting any active transactions');
            ctx.logg(t + 1000, 'kunde-db', 'ERROR', `FATAL: terminating connection due to administrator command (${Math.round(ctx.måler.tilkoblinger)} tilkoblinger brutt)`);
            ctx.logg(t + 14000, 'kunde-db', 'INFO', 'database system is ready to accept connections');
            return { løser: true, grovt: true, etterMs: 15000, melding: `kunde-db restartet. Alle ${Math.round(ctx.måler.tilkoblinger)} tilkoblinger og pågående transaksjoner ble brutt, også vedlikeholdsjobben.` };
          }
        },
        slutt(t, ctx) {
          if (løst) return;
          ctx.logg(t, 'kunde-db', 'INFO', `cron: ukentlig-vedlikehold.sh ferdig pid=${pid} varighet=${Math.round((t - start) / 60000)} min`);
        },
      };
    },
  },

  {
    navn: 'smsbud-nede',
    varighet: [20, 35],
    lag() {
      return {
        start() {
          return {
            rotårsak: 'SmsBud (ekstern) svarer ikke. Retry-policyen fra varsling 1.22.0 (5 raske forsøk) gjør det verre: SmsBud begynner å svare 429, og køen vokser.',
            riktig_tiltak: 'Sjekk SmsBud-status og ring døgnvakten deres hvis det varer. Pause leveringsvarsler (varslingctl pause mal=leveringsvarsel) så engangskoder prioriteres. Vekk Team Ugla, si fra til Team Nøkkelknippe.',
            felle: 'Innlogging merker det (engangskoder kommer ikke fram), men feilen er ikke i innlogging. 429 kan se ut som at vi sender i løkke, men det er retry-ene våre mot en treg leverandør.',
            berørt: ['varsling', 'innlogging'],
          };
        },
        påvirk(tilstand, min) {
          const r = rampe(min, 4);
          tilstand.varsling.smsFeil = 0.01 + 0.85 * r;
          tilstand.varsling.smsFeilMelding = (forsøk, mal) => (forsøk >= 3 && sjanse(0.6)
            ? `SmsBud: HTTP 429 Too Many Requests (forsøk ${forsøk} av 5) mal=${mal}`
            : `SmsBud: timeout etter 10000ms (forsøk ${forsøk} av 5) mal=${mal}`);
        },
        bakgrunn(m0, min, ctx) {
          for (let i = Math.round(rampe(min, 4) * heltall(1, 4)); i > 0; i--) {
            ctx.logg(m0 + heltall(0, 59999), 'innlogging', 'INFO', `engangskode ikke bekreftet innen 300 s bruker=${heltall(100000, 999999)}, ny kode bedt om`);
          }
        },
        slutt(t, ctx) {
          ctx.logg(t, 'varsling', 'INFO', `SmsBud: svartider normale igjen (p95 ${heltall(500, 900)}ms)`);
        },
      };
    },
  },

  {
    navn: 'sok-fullindeks',
    harTiltak: true,
    varighet: [15, 25],
    enGangPerNatt: true,
    lag(varighet) {
      let start, løst = false;
      return {
        start(t, ctx) {
          start = t;
          const versjon = ctx.nyVersjon('sok');
          ctx.deploy({ tid: t - heltall(60000, 180000), tjeneste: 'sok', versjon, av: 'Mina Spøkelsesen', endring: 'Ny synonymliste for vinterkampanjen.' });
          ctx.logg(t, 'sok', 'INFO', 'nattlig-reindeks startet indeks=produkter-v7 (fullindeks: synonymliste endret) dokumenter=2.1M', 'sok-node-1');
          return {
            rotårsak: `Synonymliste-utrullingen (sok ${versjon}) gjorde at reindeksen startet som fullindeks i stedet for inkrementelt. sok-node-2 blir presset på minne, med GC-pauser og høy p95.`,
            riktig_tiltak: 'Pause reindeksen (sokctl reindeks pause produkter-v7) og sjekk at p95 faller. Ingen trenger å vekkes hvis pausen virker; legg en lapp til Team Spåkula.',
            felle: 'Ikke en kodefeil. Rollback av sok hjelper ikke når fullindeksen allerede går.',
            berørt: ['sok', 'api-gateway'],
          };
        },
        påvirk(tilstand, min) {
          const r = rampe(min, 3);
          tilstand.sok.latensFaktor = 1 + 26 * r;
          tilstand.sok.timeoutAndel = 0.03 * r;
          tilstand.sok.timeoutMelding = () => 'søk avbrutt etter 30000ms node=sok-node-2';
        },
        bakgrunn(m0, min, ctx) {
          const andel = rampe(min, varighet);
          ctx.logg(m0 + 15000, 'sok', 'INFO', `nattlig-reindeks: ${Math.round(100 * andel)}% ferdig (${(2.1 * andel).toFixed(2)}M av 2.1M)`, 'sok-node-1');
          if (min > 1) ctx.logg(m0 + heltall(0, 59999), 'sok', 'WARN', `GC-pause ${heltall(1800, 6500)}ms (old gen ${heltall(91, 98)}%)`, 'sok-node-2');
          if (min > 1 && new Date(m0).getMinutes() % 5 === 0) ctx.logg(m0 + 1000, 'sok', 'WARN', 'klynge status=yellow noder=3/3 shards=44/48 (4 flytter)', 'sok-node-1');
        },
        tiltak(k, t, ctx) {
          if (k.handling !== 'pause_reindeks') return;
          løst = true;
          const andel = rampe((t - start) / 60000, varighet);
          ctx.logg(t, 'sok', 'INFO', `nattlig-reindeks pauset ved ${Math.round(100 * andel)}% indeks=produkter-v7 (sokctl)`, 'sok-node-1');
          return { løser: true, etterMs: 120000, melding: `Reindeks for produkter-v7 pauset ved ${Math.round(100 * andel)} %. Minnet på sok-node-2 frigjøres i løpet av 2-3 min.` };
        },
        slutt(t, ctx) {
          if (løst) return;
          ctx.logg(t, 'sok', 'INFO', `nattlig-reindeks ferdig på ${Math.round((t - start) / 60000)} min, alias produkter -> produkter-v7`, 'sok-node-1');
        },
      };
    },
  },

  {
    navn: 'disk-loggrotasjon',
    varighet: [6, 9],
    enGangPerNatt: true,
    lag(varighet) {
      let vert, topp;
      return {
        start(t, ctx) {
          vert = velg(['innlogging-01', 'innlogging-02']);
          topp = tilfeldig(91.5, 95);
          ctx.logg(t, 'innlogging', 'INFO', `loggrotasjon startet: komprimerer /var/log/innlogging/app.log.1 (${tilfeldig(3.2, 4.8).toFixed(1)}G)`, vert);
          return {
            rotårsak: `Loggrotasjonen på ${vert} pakker loggene før de gamle slettes, så disken blir midlertidig nesten full. Kjent og ufarlig.`,
            riktig_tiltak: 'Ingen handling. Bekreft at «loggrotasjon fullført» kommer og at disken faller. Ingen trenger å vekkes. Foreslå å dempe alarmen under rotasjon.',
            felle: 'Ser ut som en reell diskfeil, men er kjent fra INC-2026-004 og INC-2026-026.',
            berørt: ['innlogging'],
          };
        },
        påvirk(tilstand, min) {
          if (min < varighet - 1) tilstand.disk[vert] = topp;
        },
        slutt(t, ctx) {
          ctx.logg(t, 'innlogging', 'INFO', `loggrotasjon fullført: slettet ${heltall(4, 8)} gamle arkiver`, vert);
        },
      };
    },
  },

  {
    navn: 'kortnett-treg',
    varighet: [15, 30],
    lag() {
      return {
        start(t, ctx) {
          ctx.deploy({ tid: t - heltall(4, 12) * 60000, tjeneste: 'betaling', versjon: `feature-flagg r${heltall(30, 60)}`, av: 'Ola Benkvist', endring: 'Skrudd på gavekort-v2 for 5 % av brukerne.' });
          return {
            rotårsak: 'Kortleverandøren Kortnett (ekstern) svarer tregt. Betaling venter på Kortnett, så responstiden stiger og noen trekk går i timeout.',
            riktig_tiltak: 'Sjekk Kortnett sin status og kontakt leverandøren. Ingen rollback. Vekk Team Myntkammer hvis det varer eller timeoutene øker.',
            felle: 'Feature-flagget for gavekort ble skrudd på like før, men har ingenting med saken å gjøre.',
            berørt: ['betaling', 'api-gateway'],
          };
        },
        påvirk(tilstand, min) {
          const r = rampe(min, 3);
          tilstand.betaling.kortnettMedian = 180 + 5800 * r;
          tilstand.betaling.timeoutAndel = 0.015 * r;
          tilstand.betaling.timeoutMelding = (ep, req) => `Kortnett: ingen svar innen 30000ms, avbryter trekk id=${req.id}`;
        },
        bakgrunn(m0, min, ctx) {
          if (min > 1 && sjanse(0.5)) ctx.logg(m0 + heltall(0, 59999), 'betaling', 'WARN', `Kortnett: HTTP 503 Service Unavailable, prøver på nytt id=b-${heltall(100000, 999999)}`);
        },
      };
    },
  },
];
