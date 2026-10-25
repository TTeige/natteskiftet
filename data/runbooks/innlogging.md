# Runbook: innlogging

Sist oppdatert: 2026-05-20 (Team Nøkkelknippe)

## Diskbruk over 90 % på innlogging-01/-02

Loggrotasjonen kjører kl 03:00 og pakker loggene før de gamle slettes. Disken blir midlertidig nesten full. Det er kjent og ufarlig.

1. Se etter `loggrotasjon fullført` i loggene. Den kommer normalt innen 10 minutter.
2. Hvis den er fullført og disken er under 70 %: ingenting å gjøre.
3. Hvis disken fortsatt er over 90 % etter 03:20: slett gamle arkiver i `/var/log/innlogging/arkiv` som er eldre enn 7 dager.

## Trege innlogginger / timeout mot databasen

Innlogging har ikke egen database. Treghet mot kunde-db skyldes nesten alltid noe på databasesiden. Se runbook kunde-db.md.
