# Runbook: kunde-db

Sist oppdatert: 2025-11-04 (Team Grunnmur)

## For mange tilkoblinger / timeout

Alle tjenester kobler til kunde-db via pgbouncer på db-proxy-01.

1. Logg inn på db-proxy-01 og sjekk `SHOW POOLS;` i pgbouncer.
2. Hvis pgbouncer henger: `systemctl restart pgbouncer`. Det tar ca 10 sekunder og løser det i de fleste tilfeller.
3. Hvis det ikke hjelper: bytt til lesereplika kunde-db-replika-2 med `dbctl failover replika-2`.

## Ukentlig vedlikehold

Kjøres søndag kl 04:00 (VACUUM og REINDEX). Ingen påvirkning på trafikk på den tiden.

## Hvem vekkes

Vakt i Team Grunnmur.
