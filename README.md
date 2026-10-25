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

Agenten har bare ett verktøy fra start (`sok_i_logger`). Resten er stubber dere fyller inn.

## Hva ligger her

```
src/index.js           startpunktet, leser spørsmålet fra kommandolinja
src/agent.js           agentløkka: spør modellen, kjør verktøy, gjenta
src/verktoy.js         system-prompt, eksempelalarm og verktøyene
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
