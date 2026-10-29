# Natteskiftet 🐺

![Megakart over oppgaven](kart.jpg)

Bygg en agent som tar første vakt når en alarm går kl 03, graver i logger og historikk, og sier ærlig hva den vet og ikke vet.

## Kom i gang

```bash
npm install
cp .env.example .env        # lim inn ANTHROPIC_API_KEY
npm start                   # kjører eksempelalarmen (betaling kl 03:12)
npm start -- "ALARM kl 03:40: api-gateway gir 17 % 504"
```

Agenten har åtte verktøy: `sok_i_logger`, `hent_runbook`, `sjekk_deploy_historikk`, `finn_lignende_hendelser`, `hent_tjenesteinfo`, `hent_metrikker`, `hent_alarmer` og `utfor_tiltak`.

## Demo-dashbord

```bash
npm run demo                # simulator + agent + dashbord på http://localhost:3000
npm run dommer              # gi poeng til rapporter som ikke er vurdert ennå
```

Dashbordet viser tjenestekartet live, agentens verktøykall mens den jobber, alarmer, logger og poengtavle. Agenten kan foreslå tiltak (`utfor_tiltak`: rollback, avbryte en databaseprosess, pause reindeks, pause en varslingsmal, restart). Hvert tiltak må godkjennes i nettleseren, og tiltaket virker faktisk i simulatoren. Feil tiltak løser ingenting og gir minuspoeng.

`npm run demo` starter i spilleder-modus (`SIM_AUTO=0`, 20x fart): ingen feil før du trykker **💀 Slipp løs**, og feil som har et tiltak går ikke over av seg selv. Se [DEMO.md](DEMO.md) for et manus på 3 minutter.

Dommeren gir 0-16 poeng: rotårsak (4), felle (2), ærlighet (2) og eskalering (2) vurderes av en språkmodell mot fasiten; tiltak (+3 for riktig, -1 for unødvendig, -2 for grovt) og fart (3) regnes ut av det simulatoren registrerte.

## Live-simulator

I stedet for de faste filene i `data/` kan dere kjøre en simulert natt som lager trafikk, logger, metrikker, utrullinger og alarmer fortløpende:

```bash
npm run simulator           # terminal 1: simulerer natta fra 02:30 i 10x fart, skriver til live/
npm run vakt                # terminal 2: setter agenten på hver ny alarm, rapporter i live/rapporter/
DATA_DIR=live npm start -- "ALARM kl 03:12: ..."   # eller kjør agenten manuelt mot live-data
```

Simulatoren setter i gang ett feilscenario om gangen med pauser imellom: feil utrulling i betaling, vedlikeholdsjobb som låser kunde-db, SmsBud nede, fullindeks i sok, disk full under loggrotasjon (ufarlig) og treg Kortnett. Feilene forplanter seg gjennom avhengighetene, så alarmen går ofte et annet sted enn feilen sitter.

`live/fasit.jsonl` har fasiten per scenario og alarm (rotårsak, riktig tiltak, felle) for poengtelling. Agenten skal aldri lese den.

| Variabel | Standard | |
|---|---|---|
| `SIM_FART` | `10` | Simulerte sekunder per ekte sekund |
| `SIM_START` | `02:30` | Når natta starter (i dag) |
| `SIM_SCENARIO` | alle | Kommaseparert liste, f.eks. `kunde-db-vedlikehold` |
| `SIM_FORSTE` / `SIM_PAUSE_MIN` / `SIM_PAUSE_MAKS` | `5` / `5` / `15` | Minutter før første scenario og mellom dem |
| `SIM_OVERLAPP` | av | `1` lar scenarier gå samtidig |
| `SIM_LOGG_UTVALG` | `0.05` | Andel vellykkede kall som logges |
| `SIM_AUTO` | på | `0` = spilleder-modus: feil startes bare fra dashbordet |
| `VAKT_MAKS` | `5` (`20` i demo) | Antall hendelser agenten tar før den går av (hver koster et agentkall) |
| `TILTAK_GODKJENNING` | `spør` | `auto` godkjenner alle tiltak, `aldri` avviser alle |
| `DASHBORD_PORT` | `3000` | |

Simulatoren sletter `live/` og starter på nytt hver gang.

## Hva ligger her

```
src/index.js           startpunktet, leser spørsmålet fra kommandolinja
src/agent.js           agentløkka: spør modellen, kjør verktøy, gjenta
src/verktoy.js         system-prompt, eksempelalarm og verktøyene
src/vakt.js            kjører agenten på nye alarmer fra simulatoren
src/vaktrunde.js       felles for vakt og dashbord: én agentrunde per hendelse
src/dommer.js          poeng mot fasiten
src/dashbord/          demo-dashbordet
src/simulator/         simulatoren: trafikk, scenarier, alarmregler
data/alarmer.json      fem alarmer fra natt til 29. oktober
data/logger.json       ca 250 logglinjer fra 02:30 til 03:50
data/runbooks/*.md     runbooks per tjeneste (ikke alle er like ferske)
data/deploy-historikk.json   utrullinger og konfigendringer
data/hendelser.json    tidligere hendelser med post-mortem
data/tjenester.json    eier-team, vaktpersoner og avhengigheter
```

Alt er oppdiktet. Alarmene er ikke like. Noen er enkle, noen er det ikke.

## Legg til et verktøy

Finn en stub i `src/verktoy.js` og bytt ut `kjør: null` med en funksjon. Den får input fra modellen og returnerer tekst eller et objekt:

```js
// hent_runbook
kjør: async ({ tjeneste }) => {
  const fil = path.join(DATA, 'runbooks', `${tjeneste}.md`);
  if (!fs.existsSync(fil)) throw new Error(`Ingen runbook for «${tjeneste}».`);
  return fs.readFileSync(fil, 'utf8');
},
```

Så snart `kjør` er satt, sender agent.js verktøyet til modellen. Kaster funksjonen en feil, får modellen feilmeldingen tilbake og kan prøve noe annet.

Beskrivelsen er prompten. Skriv den som til en ny kollega: når skal verktøyet brukes, og hva bør man passe seg for. Verktøynavn må være ASCII (`sok_i_logger`, ikke `søk_i_logger`).

## Hvis du ikke bruker JavaScript

Dataene er ren JSON og markdown. Bruk dem fra Python, C#, Go eller hva dere vil. Agentløkka i `src/agent.js` er ca 80 linjer og lett å oversette.

## Tips

- MVP er to verktøy og én løkke. Få `sok_i_logger` og ett verktøy til å virke før dere bygger noe rundt.
- Vis verktøykallene i demoen. Det er de som viser at agenten tenker selv, ikke svaret alene.
- `MAX_ITERASJONER` i `.env` (standard 10) stopper en agent som går i ring.
- `.env` committes aldri. Den står i `.gitignore`, la den bli der.
