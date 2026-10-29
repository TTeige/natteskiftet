// Utrullinger og konfigendringer: en uke med historikk før natta starter, og
// en og annen harmløs endring underveis så ikke alle endringer er spor.
import { heltall, sjanse, velg } from './tilfeldig.js';

const HISTORIKK = [
  { tjeneste: 'innlogging', av: 'Hedda Uglevik', endring: 'Passkey som innloggingsmetode for alle brukere.', del: 'minor' },
  { tjeneste: 'betaling', av: 'Release-tog', endring: 'Oppdatert avhengigheter, ingen funksjonelle endringer.' },
  { tjeneste: 'sok', av: 'Mina Spøkelsesen', endring: 'Ny rangering av treff (mer vekt på lagerstatus).', del: 'minor' },
  { tjeneste: 'kunde-db', av: 'Rune Skjelbred', versjon: 'postgresql.conf r12', endring: 'Økt work_mem fra 8MB til 16MB.' },
  {
    tjeneste: 'varsling', av: 'Jonas Kistesen', del: 'minor', dager: [2, 4],
    endring: 'Oppgradert SmsBud-klient fra 3.1 til 3.2. Ny retry-policy: 5 forsøk med kort pause (før: 3 forsøk med eksponentiell pause).',
  },
  { tjeneste: 'sok', av: 'Arne Lyktemann', endring: 'Ny synonymliste for høstkampanjen.' },
  { tjeneste: 'innlogging', av: 'Hedda Uglevik', endring: 'Rettet feil der passkey-registrering feilet på eldre Android-enheter.' },
  {
    tjeneste: 'api-gateway', av: 'Trond Benrangel', versjon: 'konfig timeouts.yaml r17',
    endring: 'Økt timeout for /api/rapport fra 30 s til 60 s. Andre ruter uendret (30 s).',
  },
  { tjeneste: 'betaling', av: 'Sigrid Gravlund', endring: 'Ny kvitteringsmal for refusjon.' },
];

const NATTSTØY = [
  { tjeneste: 'api-gateway', av: 'cert-manager', versjon: 'sertifikat', endring: 'Fornyet TLS-sertifikat for api.natteskiftet.no (gyldig 90 dager).' },
  { tjeneste: 'api-gateway', av: 'Ida Nattmo', versjon: () => `konfig rate-limits.yaml r${heltall(9, 30)}`, endring: 'Hevet grensen for intern klient lagerstatus fra 50 til 80 rps.' },
  { tjeneste: 'innlogging', av: 'flaggbot', versjon: () => `feature-flagg r${heltall(100, 200)}`, endring: 'passkey-påminnelse skrudd på for 50 % av brukerne.' },
  { tjeneste: 'varsling', av: 'Live Huldersen', versjon: () => `maler r${heltall(20, 60)}`, endring: 'Ny tekst i push-mal for leveringsvarsel.' },
  { tjeneste: 'sok', av: 'Arne Lyktemann', versjon: () => `rangering.yaml r${heltall(30, 80)}`, endring: 'Justert boost for lagerstatus fra 1.4 til 1.5.' },
];

// Dagtid, noen dager før t.
export function dagerFør(t, dager) {
  const d = new Date(t - dager * 86400000);
  d.setHours(heltall(9, 15), heltall(0, 59), 0, 0);
  return d.getTime();
}

export function seedHistorikk(ctx, nå) {
  const endringer = HISTORIKK
    .map((h) => ({ ...h, tid: dagerFør(nå, h.dager ? heltall(...h.dager) : heltall(1, 7)) }))
    .sort((a, b) => a.tid - b.tid);
  for (const e of endringer) {
    ctx.deploy({ tid: e.tid, tjeneste: e.tjeneste, versjon: e.versjon ?? ctx.nyVersjon(e.tjeneste, e.del), av: e.av, endring: e.endring });
  }
}

// Kalles hvert minutt.
export function kanskjeStøyendring(t, ctx) {
  if (!sjanse(0.012)) return;
  const e = velg(NATTSTØY);
  ctx.deploy({ tid: t, tjeneste: e.tjeneste, versjon: typeof e.versjon === 'function' ? e.versjon() : e.versjon, av: e.av, endring: e.endring });
}
