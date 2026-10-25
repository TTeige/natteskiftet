# Runbook: sok

Sist oppdatert: 2026-06-27 (Team Spåkula, etter INC-2026-031)

## Treg responstid om natta

Den nattlige reindeksen starter kl 03:00. Den skal gå inkrementelt. Hvis den starter som fullindeks, blir sok-node-2 presset på minne.

Tegn: `nattlig-reindeks startet ... (fullindeks ...)`, deretter GC-pauser og stigende p95.

1. Pause reindeksen: `sokctl reindeks pause produkter-v7`
2. Vent 2-3 minutter og sjekk at p95 er under 1 s igjen.
3. Ikke start den på nytt i natt. Legg en lapp til Team Spåkula, de kjører den inkrementelt neste natt.

## Hvem vekkes

Ingen trenger å vekkes hvis pausen virker. Ellers vakt i Team Spåkula.
