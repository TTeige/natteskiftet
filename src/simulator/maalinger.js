// Teller forespørsler per tjeneste per minutt. Det er dette alarmene ser på,
// ikke loggene (som bare har et utvalg av de vellykkede kallene).
import { iso } from '../tid.js';
import { TJENESTER } from './modell.js';

const tomBøtte = () => ({ antall: 0, feil: 0, s504: 0, latenser: [], feilPerSti: {}, smsSendt: 0, smsLevert: 0 });

export function p95(latenser) {
  if (latenser.length === 0) return 0;
  const sortert = [...latenser].sort((a, b) => a - b);
  return sortert[Math.min(sortert.length - 1, Math.floor(sortert.length * 0.95))];
}

export class Målinger {
  minutter = new Map();
  historikk = []; // ferdige minutter, nyest sist

  bøtte(t, tjeneste) {
    const m = Math.floor(t / 60000) * 60000;
    if (!this.minutter.has(m)) this.minutter.set(m, {});
    return (this.minutter.get(m)[tjeneste] ??= tomBøtte());
  }

  forespørsel(tjeneste, t, status, ms, sti) {
    const b = this.bøtte(t, tjeneste);
    b.antall++;
    b.latenser.push(ms);
    if (status >= 500) {
      b.feil++;
      b.feilPerSti[sti] = (b.feilPerSti[sti] ?? 0) + 1;
    }
    if (status === 504) b.s504++;
  }

  sms(t, levert) {
    const b = this.bøtte(t, 'varsling');
    b.smsSendt++;
    if (levert) b.smsLevert++;
  }

  // Lukker minuttet m0 og gir tilbake metrikklinjene for det.
  avslutt(m0, måler) {
    const min = this.minutter.get(m0) ?? {};
    this.minutter.delete(m0);
    for (const tj of TJENESTER) min[tj] ??= tomBøtte();
    this.historikk.push(min);
    if (this.historikk.length > 15) this.historikk.shift();

    return TJENESTER.map((tj) => {
      const b = min[tj];
      const linje = { tid: iso(m0), tjeneste: tj };
      if (tj === 'kunde-db') return { ...linje, tilkoblinger: Math.round(måler.tilkoblinger), maks_tilkoblinger: 200 };
      Object.assign(linje, {
        rps: Number((b.antall / 60).toFixed(2)),
        feilrate_5xx_pst: b.antall ? Number(((100 * b.feil) / b.antall).toFixed(1)) : 0,
        p95_ms: p95(b.latenser),
      });
      if (tj === 'varsling') Object.assign(linje, { sms_sendt: b.smsSendt, sms_levert: b.smsLevert, kø_sms: måler.kø });
      if (tj === 'innlogging') linje.disk_pst = Object.fromEntries(Object.entries(måler.disk).map(([v, p]) => [v, Math.round(p)]));
      return linje;
    });
  }

  vindu(minutter) {
    return this.historikk.slice(-minutter);
  }
}
