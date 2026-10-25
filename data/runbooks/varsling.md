# Runbook: varsling

Sist oppdatert: 2026-04-05 (Team Ugla)

## SMS leveres ikke

SMS går via ekstern leverandør SmsBud. E-post og push går en annen vei og er sjelden rammet samtidig.

1. Sjekk SmsBud sin statusside. Den oppdateres ofte sent, så «ingen avvik» betyr ikke at alt er bra.
2. Se på feiltypen i loggene:
   - Bare timeout: sannsynligvis SmsBud.
   - HTTP 429: vi sender for mye. Sjekk om noe hos oss sender i løkke.
3. Engangskoder for innlogging er viktigst. Hvis køen vokser over 1000, vurder å pause leveringsvarsler med `varslingctl pause mal=leveringsvarsel`.
4. Ring SmsBud døgnvakt hvis feilen varer over 30 min (nummer i passordhvelvet).

## Hvem vekkes

Vakt i Team Ugla. Si også fra til Team Nøkkelknippe hvis engangskoder er rammet.
