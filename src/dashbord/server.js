// Dashbordet: én kommando for hele demoen. Starter simulatoren, følger med på
// live/, kjører agenten på nye hendelser og lar et menneske godkjenne tiltak i
// nettleseren. Ingen avhengigheter utover Node.
//
//   npm run demo          # så åpne http://localhost:3000
import { fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { vurderRapport } from '../dommer.js';
import { nesteAlarm, simulertNå, taAlarm } from '../vaktrunde.js';
import { settGodkjenner } from '../verktoy.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

process.env.DATA_DIR ??= 'live';
const MAPPE = path.resolve(process.env.DATA_DIR);
const PORT = Number(process.env.DASHBORD_PORT ?? 3000);
const MAKS = Number(process.env.VAKT_MAKS ?? 20);
const HAR_NØKKEL = !!process.env.ANTHROPIC_API_KEY;
const sov = (ms) => new Promise((r) => setTimeout(r, ms));

const innstillinger = {
  agent: HAR_NØKKEL && process.env.DASHBORD_AGENT !== '0',
  autoGodkjenn: process.env.TILTAK_GODKJENNING === 'auto',
  dommer: HAR_NØKKEL && process.env.DASHBORD_DOMMER !== '0',
};
let runder = 0;

// Det nettleseren trenger for å tegne alt på nytt etter en refresh.
const tilstand = { metrikker: [], alarmer: [], logger: [], agent: [], poeng: [], meta: null, godkjenning: null };
const klienter = new Set();

function send(type, data) {
  for (const res of klienter) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
const husk = (liste, ting, maks) => {
  liste.push(ting);
  if (liste.length > maks) liste.splice(0, liste.length - maks);
};

// --- Simulatoren --------------------------------------------------------------

const startet = Date.now();
if (process.env.DASHBORD_SIMULATOR !== '0') {
  const sim = fork(path.join(import.meta.dirname, '..', 'simulator', 'index.js'), { env: process.env, stdio: 'inherit' });
  process.on('exit', () => sim.kill());
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
}
// Vent på en meta.json fra denne natta, ikke en gammel fra forrige kjøring.
const metaFil = path.join(MAPPE, 'meta.json');
while (!fs.existsSync(metaFil) || (process.env.DASHBORD_SIMULATOR !== '0' && fs.statSync(metaFil).mtimeMs < startet)) await sov(200);

// --- Følg filene simulatoren skriver -------------------------------------------

const posisjoner = new Map();
function nyeLinjer(fil) {
  const full = path.join(MAPPE, fil);
  if (!fs.existsSync(full)) return [];
  const størrelse = fs.statSync(full).size;
  let fra = posisjoner.get(fil) ?? 0;
  if (størrelse < fra) fra = 0;
  if (størrelse === fra) return [];
  const fd = fs.openSync(full, 'r');
  const buffer = Buffer.alloc(størrelse - fra);
  fs.readSync(fd, buffer, 0, buffer.length, fra);
  fs.closeSync(fd);
  // Ta bare hele linjer; resten kommer neste gang.
  const tekst = buffer.toString('utf8');
  const slutt = tekst.lastIndexOf('\n') + 1;
  posisjoner.set(fil, fra + Buffer.byteLength(tekst.slice(0, slutt)));
  return tekst.slice(0, slutt).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

setInterval(() => {
  for (const m of nyeLinjer('metrikker.jsonl')) {
    husk(tilstand.metrikker, m, 6 * 45);
    send('metrikk', m);
  }
  for (const a of nyeLinjer('alarmer.jsonl')) {
    husk(tilstand.alarmer, a, 100);
    send('alarm', a);
  }
  for (const l of nyeLinjer('logger.jsonl')) {
    if (l.nivå === 'INFO') continue;
    husk(tilstand.logger, l, 80);
    send('logg', l);
  }
  try {
    tilstand.meta = JSON.parse(fs.readFileSync(path.join(MAPPE, 'meta.json'), 'utf8'));
    send('meta', { ...tilstand.meta, innstillinger, runder, maks: MAKS, harNøkkel: HAR_NØKKEL });
  } catch {
    // Simulatoren skriver meta.json akkurat nå. Neste sekund går det.
  }
}, 1000);

// --- Godkjenning av tiltak i nettleseren --------------------------------------

const ventende = new Map();
settGodkjenner(async (forslag) => {
  if (innstillinger.autoGodkjenn) return { godkjent: true };
  const id = Math.random().toString(36).slice(2, 10);
  tilstand.godkjenning = { id, ...forslag };
  send('godkjenning', tilstand.godkjenning);
  const svar = await Promise.race([
    new Promise((resolve) => ventende.set(id, resolve)),
    sov(5 * 60000).then(() => ({ godkjent: false, grunn: 'ingen svarte innen 5 min' })),
  ]);
  ventende.delete(id);
  tilstand.godkjenning = null;
  send('godkjenning', null);
  return svar;
});

// --- Agenten på vakt ------------------------------------------------------------

function agentHendelse(h) {
  husk(tilstand.agent, h, 300);
  send('agent', h);
}

async function vakt() {
  for (;;) {
    const alarm = innstillinger.agent && runder < MAKS ? nesteAlarm(MAPPE) : null;
    if (!alarm) {
      await sov(2000);
      continue;
    }
    runder++;
    const startet = simulertNå(MAPPE);
    try {
      await taAlarm(MAPPE, alarm, agentHendelse);
      if (innstillinger.dommer) {
        const poeng = await vurderRapport(MAPPE, alarm.id, { startet });
        husk(tilstand.poeng, poeng, 50);
        send('poeng', poeng);
      }
    } catch (e) {
      console.error(e);
      agentHendelse({ type: 'feil', alarm: alarm.id, tekst: e.message });
    }
  }
}
vakt();

// --- HTTP --------------------------------------------------------------------------

async function lesBody(req) {
  let body = '';
  for await (const bit of req) body += bit;
  return body ? JSON.parse(body) : {};
}

const HTML = path.join(import.meta.dirname, 'index.html');

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(HTML));
    }
    if (req.method === 'GET' && req.url === '/hendelser') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: tilstand\ndata: ${JSON.stringify(tilstand)}\n\n`);
      klienter.add(res);
      return req.on('close', () => klienter.delete(res));
    }
    if (req.method === 'POST' && req.url === '/godkjenn') {
      const { id, godkjent } = await lesBody(req);
      ventende.get(id)?.(godkjent ? { godkjent: true } : { godkjent: false, grunn: 'avvist av vakthavende' });
      return res.end('ok');
    }
    if (req.method === 'POST' && req.url === '/innstillinger') {
      const ny = await lesBody(req);
      for (const nøkkel of Object.keys(innstillinger)) if (typeof ny[nøkkel] === 'boolean') innstillinger[nøkkel] = ny[nøkkel];
      if (!HAR_NØKKEL) innstillinger.agent = innstillinger.dommer = false;
      return res.end('ok');
    }
    if (req.method === 'POST' && req.url === '/scenario') {
      const { navn } = await lesBody(req);
      const id = Math.random().toString(36).slice(2, 10);
      fs.appendFileSync(path.join(MAPPE, 'kommandoer.jsonl'), JSON.stringify({ id, handling: 'start_scenario', parameter: navn }) + '\n');
      return res.end('ok');
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(PORT, () => {
  console.log(`\n🎃 Dashbord: http://localhost:${PORT}${HAR_NØKKEL ? '' : '  (ingen ANTHROPIC_API_KEY: agenten er av)'}\n`);
});
