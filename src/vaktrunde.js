// Felles for vakt.js og dashbordet: finn neste alarm som trenger agenten, og
// kjør agenten på den.
//
// Én feil gir ofte flere alarmer (kunde-db gir fem). Agenten ser alle alarmer
// med hent_alarmer, så alarmer som gikk mens den jobbet, regnes som samme
// hendelse og får ikke egen runde. Alarmer som er løst før vi rakk dem, hoppes over.
import fs from 'node:fs';
import path from 'node:path';
import { kjørAgent } from './agent.js';
import { klokke } from './tid.js';
import { system, verktøy } from './verktoy.js';

const lesJsonl = (fil) => (fs.existsSync(fil) ? fs.readFileSync(fil, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

export const simulertNå = (mappe) => Date.parse(JSON.parse(fs.readFileSync(path.join(mappe, 'meta.json'), 'utf8')).nå);

export function nesteAlarm(mappe) {
  const rapporter = path.join(mappe, 'rapporter');
  const alle = lesJsonl(path.join(mappe, 'alarmer.jsonl'));
  const løst = new Set(alle.filter((a) => a.status === 'løst').map((a) => a.id));
  const ventende = alle.filter((a) => a.status === 'utløst' && !fs.existsSync(path.join(rapporter, `${a.id}.md`)));
  for (const a of ventende.filter((a) => løst.has(a.id))) {
    skrivRapport(mappe, a, { hoppetOver: 'Alarmen var løst før agenten rakk den.' });
  }
  return ventende.find((a) => !løst.has(a.id)) ?? null;
}

function skrivRapport(mappe, alarm, { tekst, hoppetOver, startet, ferdig, verktøykall, sammeHendelse = [] }) {
  fs.mkdirSync(path.join(mappe, 'rapporter'), { recursive: true });
  const linjer = [`# ${alarm.id}: ${alarm.tittel}`, '', `- Alarm: ${alarm.tekst}`, `- Utløst: ${alarm.tid}`];
  if (hoppetOver) linjer.push(`- Ikke behandlet: ${hoppetOver}`);
  else {
    linjer.push(`- Agent startet (simulert tid): ${klokke(startet)}, ferdig: ${klokke(ferdig)}`, `- Verktøykall: ${verktøykall}`);
    if (sammeHendelse.length) linjer.push(`- Samme hendelse: ${sammeHendelse.join(', ')}`);
    linjer.push('', tekst);
  }
  fs.writeFileSync(path.join(mappe, 'rapporter', `${alarm.id}.md`), linjer.join('\n') + '\n');
}

export async function taAlarm(mappe, alarm, påHendelse = () => {}) {
  const startet = simulertNå(mappe);
  const oppgave = `ALARM ${alarm.id} kl ${klokke(Date.parse(alarm.tid))} (${alarm.alvorlighet}): ${alarm.tittel}. ${alarm.tekst} ` +
    `Klokka er nå ${klokke(startet)}.`;
  console.log(`\n🎃 ${oppgave}\n`);
  påHendelse({ type: 'start', alarm, oppgave });

  let verktøykall = 0;
  const svar = await kjørAgent({
    system, oppgave, verktøy,
    påHendelse: (h) => {
      if (h.type === 'verktøy') verktøykall++;
      påHendelse({ ...h, alarm: alarm.id });
    },
  });
  const tekst = svar?.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim() || '(Ingen rapport, agenten ble ikke ferdig.)';
  const ferdig = simulertNå(mappe);

  // Alarmer som gikk mens agenten jobbet, hører til samme hendelse.
  const sammeHendelse = [];
  for (let a = nesteAlarm(mappe); a && Date.parse(a.tid) <= ferdig; a = nesteAlarm(mappe)) {
    skrivRapport(mappe, a, { hoppetOver: `Gikk mens agenten jobbet med ${alarm.id}, regnet som samme hendelse.` });
    sammeHendelse.push(a.id);
  }
  skrivRapport(mappe, alarm, { tekst, startet, ferdig, verktøykall, sammeHendelse });
  påHendelse({ type: 'avsluttet', alarm: alarm.id, tekst, verktøykall, sammeHendelse });
  return { tekst, verktøykall };
}
