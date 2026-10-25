# Runbook: betaling

Sist oppdatert: 2026-08-20 (Team Myntkammer)

## Høy feilrate (5xx)

1. Sjekk om det er rullet ut en ny versjon den siste timen. Release-toget ruller ut automatisk om natta.
2. Se etter `TypeError` eller `ReferenceError` i loggene. Det peker nesten alltid på ny kode.
3. Hvis feilene startet rett etter en utrulling: rull tilbake med `deploy rollback betaling` til forrige versjon. Det tar ca 2 minutter.
4. Hvis det ikke er en ny versjon: sjekk svartiden fra Kortnett. Treghet der gir timeout, ikke 5xx.

## Hvem vekkes

Vakt i Team Myntkammer. Rollback kan gjøres av hvem som helst med vakt, men si fra i #betaling-drift.
