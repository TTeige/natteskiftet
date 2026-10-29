// Vakta: følger med på alarmene fra simulatoren og setter agenten på hver ny
// hendelse, én om gangen. Rapportene havner i live/rapporter/.
//
// Hver hendelse koster et agentkall, så vakta stopper etter VAKT_MAKS runder.
import fs from 'node:fs';
import path from 'node:path';
import { nesteAlarm, taAlarm } from './vaktrunde.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

process.env.DATA_DIR ??= 'live';
const MAPPE = path.resolve(process.env.DATA_DIR);
const MAKS = Number(process.env.VAKT_MAKS ?? 5);
const sov = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(MAPPE, 'meta.json'))) {
  console.error(`Finner ingen simulator i ${MAPPE}. Start den først: npm run simulator`);
  process.exit(1);
}
console.log(`👀 Vakta følger med på ${MAPPE}. Tar inntil ${MAKS} hendelser (VAKT_MAKS).\n`);

for (let runder = 0; runder < MAKS;) {
  const alarm = nesteAlarm(MAPPE);
  if (!alarm) {
    await sov(3000);
    continue;
  }
  runder++;
  await taAlarm(MAPPE, alarm);
}

console.log(`\nVakta har tatt ${MAKS} hendelser og går av. Øk VAKT_MAKS for flere.`);
