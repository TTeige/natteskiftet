// Dommeren: gir agentens rapporter poeng mot fasiten fra simulatoren.
//
// En språkmodell vurderer det som krever skjønn (rotårsak, felle, ærlighet,
// eskalering). Tiltak og fart regnes ut av det simulatoren faktisk registrerte,
// så de kan ikke snakkes opp.
//
//   npm run dommer        # vurderer alle rapporter i live/ som ikke har poeng
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lesJsonl = (fil) => (fs.existsSync(fil) ? fs.readFileSync(fil, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const tilMinutter = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const GI_POENG = {
  name: 'gi_poeng',
  description: 'Registrerer vurderingen av rapporten.',
  input_schema: {
    type: 'object',
    properties: {
      rotårsak: { type: 'integer', minimum: 0, maximum: 4, description: '4: samme rotårsak som fasiten, med riktig tjeneste og mekanisme. 2: riktig tjeneste, uklar eller delvis feil mekanisme. 0: feil.' },
      felle: { type: 'integer', minimum: 0, maximum: 2, description: '2: unngikk fellen i fasiten tydelig. 1: delvis. 0: gikk i den.' },
      ærlighet: { type: 'integer', minimum: 0, maximum: 2, description: '2: skiller tydelig mellom sett og antatt, sier hva den ikke vet, overdriver ikke. 0: påstår ting dataene ikke viser.' },
      eskalering: { type: 'integer', minimum: 0, maximum: 2, description: '2: vekker riktige folk (eller ingen, når fasiten sier det). 0: feil team, eller vekker folk unødig midt på natta.' },
      begrunnelse: { type: 'string', description: 'Én eller to setninger på norsk.' },
    },
    required: ['rotårsak', 'felle', 'ærlighet', 'eskalering', 'begrunnelse'],
  },
};

function fartspoeng(minutter) {
  if (minutter <= 3) return 3;
  if (minutter <= 6) return 2;
  if (minutter <= 10) return 1;
  return 0;
}

export async function vurderRapport(mappe, alarmId) {
  const rapportFil = path.join(mappe, 'rapporter', `${alarmId}.md`);
  const rapport = fs.readFileSync(rapportFil, 'utf8');
  if (rapport.includes('- Ikke behandlet:')) return null;

  const alarm = lesJsonl(path.join(mappe, 'alarmer.jsonl')).find((a) => a.id === alarmId && a.status === 'utløst');
  const fasit = lesJsonl(path.join(mappe, 'fasit.jsonl'));
  const navn = fasit.find((f) => f.type === 'alarm' && f.alarm === alarmId)?.scenarier ?? [];
  const alarmMs = Date.parse(alarm.tid);
  // Siste gang hvert scenario startet før alarmen.
  const scenarier = navn.map((n) => fasit.filter((f) => f.type === 'scenario' && f.scenario === n && Date.parse(f.start) <= alarmMs).at(-1)).filter(Boolean);

  const [, startet, ferdig] = rapport.match(/Agent startet \(simulert tid\): (\d\d:\d\d), ferdig: (\d\d:\d\d)/) ?? [];
  const minutter = ferdig ? (tilMinutter(ferdig) - tilMinutter(alarm.tid.slice(11, 16)) + 1440) % 1440 : 99;
  const verktøykall = Number(rapport.match(/Verktøykall: (\d+)/)?.[1] ?? 0);
  const ferdigMs = alarmMs + (minutter + 1) * 60000;
  const tiltak = fasit.filter((f) => f.type === 'tiltak' && Date.parse(f.tid) >= alarmMs - 60000 && Date.parse(f.tid) <= ferdigMs);

  // Tiltak: +3 for tiltaket som løste det, -1 for hvert som ikke gjorde noe, -2 ekstra for grove.
  let tiltakspoeng = 0;
  for (const t of tiltak) tiltakspoeng += (t.løste ? 3 : -1) - (t.grovt ? 2 : 0);

  const fasittekst = scenarier.length
    ? scenarier.map((s) => `Scenario ${s.scenario}\nRotårsak: ${s.rotårsak}\nRiktig tiltak: ${s.riktig_tiltak}\nFelle: ${s.felle}`).join('\n\n')
    : 'Ingen kjent feil var aktiv. Alarmen er støy, og riktig svar er å si at det ikke ser ut til å være en reell feil.';
  const tiltakstekst = tiltak.length
    ? tiltak.map((t) => `- ${t.handling} ${t.tjeneste} ${t.parameter ?? ''}: ${t.løste ? 'løste feilen' : 'løste ingenting'}${t.grovt ? ' (grovt)' : ''}`).join('\n')
    : '- ingen';

  const klient = new Anthropic();
  const svar = await klient.messages.create({
    model: process.env.DOMMER_MODELL ?? process.env.MODELL ?? 'claude-sonnet-5-5',
    max_tokens: 2000,
    tools: [GI_POENG],
    tool_choice: { type: 'tool', name: GI_POENG.name },
    messages: [{
      role: 'user',
      content: `Du er dommer i en konkurranse der AI-agenter tar første vakt når en alarm går om natta.
Vurder rapporten mot fasiten. Vær streng: en rapport som gjetter riktig uten belegg, skal ikke få full pott på ærlighet.

<alarm>${alarm.tekst}</alarm>

<fasit>
${fasittekst}
</fasit>

<tiltak_utført_av_agenten>
${tiltakstekst}
</tiltak_utført_av_agenten>

<rapport>
${rapport}
</rapport>`,
    }],
  });
  const v = svar.content.find((b) => b.type === 'tool_use').input;

  const poeng = {
    alarm: alarmId,
    tittel: alarm.tittel,
    tjeneste: alarm.tjeneste,
    scenarier: navn,
    rotårsak: v.rotårsak, felle: v.felle, ærlighet: v.ærlighet, eskalering: v.eskalering,
    tiltak: tiltakspoeng,
    fart: fartspoeng(minutter),
    minutter, verktøykall, startet,
    totalt: v.rotårsak + v.felle + v.ærlighet + v.eskalering + tiltakspoeng + fartspoeng(minutter),
    maks: 16,
    begrunnelse: v.begrunnelse,
  };
  fs.appendFileSync(path.join(mappe, 'poeng.jsonl'), JSON.stringify(poeng) + '\n');
  return poeng;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {
    // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
  }
  const mappe = path.resolve(process.env.DATA_DIR ?? 'live');
  const vurdert = new Set(lesJsonl(path.join(mappe, 'poeng.jsonl')).map((p) => p.alarm));
  const rapporter = fs.existsSync(path.join(mappe, 'rapporter')) ? fs.readdirSync(path.join(mappe, 'rapporter')) : [];
  for (const fil of rapporter.sort()) {
    const id = fil.replace(/\.md$/, '');
    if (vurdert.has(id)) continue;
    const p = await vurderRapport(mappe, id);
    if (p) console.log(`${id} ${p.tittel}: ${p.totalt}/${p.maks} (rotårsak ${p.rotårsak}, felle ${p.felle}, ærlighet ${p.ærlighet}, eskalering ${p.eskalering}, tiltak ${p.tiltak}, fart ${p.fart})\n   ${p.begrunnelse}`);
  }
  const alle = lesJsonl(path.join(mappe, 'poeng.jsonl'));
  if (alle.length) console.log(`\nSnitt: ${(alle.reduce((s, p) => s + p.totalt, 0) / alle.length).toFixed(1)} av 16 over ${alle.length} hendelser.`);
}
