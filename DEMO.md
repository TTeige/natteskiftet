# Demo: 3 minutter

```bash
npm run demo        # åpne http://localhost:3000 i fullskjerm
```

Spilleder-modus er standard: ingenting går galt før dere trykker **💀 Slipp løs**. 20x fart.
Tidene under er målt på en prøvekjøring.

| Tid | Hva skjer | Hva dere sier |
|---|---|---|
| 0:00 | Dashbordet, alt grønt, klokka går 02:30 | «Klokka er tre om natta. Alarmen går. Før et menneske har åpnet laptopen …» |
| 0:15 | Velg `kunde-db-vedlikehold`, trykk **Slipp løs** | «… har vi sluppet løs en ekte vanskelig feil.» |
| 0:21 | innlogging blir rød, så api-gateway. Agenten starter | «Legg merke til: alarmen går på innlogging. Feilen sitter et helt annet sted.» |
| 0:30 | Agenten graver: logger, deploy-historikk, runbook | «Runbooken sier restart pgbouncer. Den finnes ikke lenger. Agenten oppdager det.» |
| 0:35 | **Godkjenningsboksen**: `avbryt_db_prosess kunde-db (pid)` | «Den har funnet prosessen som holder låsen. Den vil avbryte den. Men den spør først.» Trykk **Godkjenn** (eller `j`). |
| 0:50 | Kartet går fra rødt til grønt, tilkoblingene faller | «Agenten sjekker selv at det virket.» |
| 1:10 | Rapporten og poengene kommer | «En uavhengig dommer gir poeng mot fasiten: rotårsak, felle, ærlighet, eskalering, tiltak, fart.» |
| 1:40 | Valgfritt akt 2: `disk-loggrotasjon` | «Like viktig: å vite når man *ikke* skal gjøre noe. Dette er en kjent falsk alarm. Den vekker ingen.» |
| 2:30 | Poengtavla | «Agenten vet hva som er galt, vet hva den ikke vet, og ber om lov før den fikser det.» |

## Før dere går på scenen

- Kjør gjennom én gang samme dag. Agenten er ikke deterministisk.
- Ta opp skjermen under prøvekjøringen. Svikter nettet eller API-et, viser dere opptaket.
- Ha **Godkjenn tiltak automatisk** av. Klikket er poenget.
- Start `npm run demo` på nytt mellom kjøringer, så starter natta blankt.
