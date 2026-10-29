// Det som logges hvert minutt uansett trafikk: databasestatus, køer, klynger
// og litt vanlig nattestøy (trege spørringer, GC-pauser, gjenoppkoblinger).
import { heltall, sjanse, velg } from './tilfeldig.js';

const TREGE_SPØRRINGER = [
  'SELECT * FROM ordrer WHERE kunde_id = $1 ORDER BY opprettet DESC LIMIT 50',
  'UPDATE sesjoner SET sist_sett = now() WHERE token = $1',
  'SELECT count(*) FROM transaksjoner WHERE status = \'venter\'',
];

export function bakgrunn(m0, ctx) {
  const når = () => m0 + heltall(0, 59999);
  const { måler } = ctx;

  const aktive = Math.round(måler.tilkoblinger);
  ctx.logg(m0 + 30000, 'kunde-db', aktive > 180 ? 'WARN' : 'INFO', `tilkoblinger aktive=${aktive}/200 ventende=${Math.max(0, aktive - 190) * heltall(2, 5)}`);
  if (new Date(m0).getMinutes() % 5 === 0) {
    ctx.logg(når(), 'kunde-db', 'INFO', `checkpoint complete: wrote ${heltall(800, 4200)} buffers (${heltall(1, 6)}.${heltall(0, 9)}%); write=${heltall(20, 90)}.${heltall(100, 999)} s`);
    ctx.logg(når(), 'sok', 'INFO', `klynge status=green noder=3/3 shards=48/48`, 'sok-node-1');
  }
  if (sjanse(0.08)) ctx.logg(når(), 'kunde-db', 'WARN', `duration: ${heltall(1000, 2600)}.${heltall(100, 999)} ms  statement: ${velg(TREGE_SPØRRINGER)}`);
  if (sjanse(0.04)) ctx.logg(når(), 'kunde-db', 'INFO', `automatic vacuum of table "kunde.public.${velg(['ordrer', 'transaksjoner', 'varsler'])}": index scans: 1`);

  ctx.logg(m0 + 45000, 'varsling', måler.kø > 200 ? 'WARN' : 'INFO', `kø sms-utgående lengde=${måler.kø}`);

  if (sjanse(0.03)) ctx.logg(når(), 'api-gateway', 'WARN', `upstream ${velg(['innlogging', 'sok', 'betaling'])}: tilkobling lukket av motpart, prøver på nytt (1/2)`);
  if (sjanse(0.04)) ctx.logg(når(), 'api-gateway', 'INFO', `GET /api/sok 499 klient lukket tilkoblingen etter ${heltall(800, 4000)}ms`);
  for (const tj of ['innlogging', 'betaling', 'varsling']) {
    if (sjanse(0.02)) ctx.logg(når(), tj, 'WARN', `event loop-forsinkelse ${heltall(200, 650)}ms`);
  }
}
