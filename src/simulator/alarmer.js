// Alarmreglene. Vurderes hvert minutt. En alarm går én gang og meldes løst
// når den har vært under terskel i tre minutter på rad.
import { iso } from '../tid.js';
import { p95 } from './maalinger.js';

const sum = (vindu, tj, felt) => vindu.reduce((s, min) => s + min[tj][felt], 0);
const pst = (andel) => `${(100 * andel).toFixed(1)} %`;

function mestBerørt(vindu, tj) {
  const perSti = {};
  for (const min of vindu) for (const [sti, n] of Object.entries(min[tj].feilPerSti)) perSti[sti] = (perSti[sti] ?? 0) + n;
  const topp = Object.entries(perSti).sort((a, b) => b[1] - a[1])[0];
  return topp ? ` Mest berørt: ${topp[0]}.` : '';
}

function feilrate(tjeneste, alvorlighet) {
  return {
    nøkkel: `5xx-${tjeneste}`, tjeneste, alvorlighet, tittel: 'Feilrate 5xx over terskel', vindu: 5,
    sjekk: (v) => {
      const antall = sum(v, tjeneste, 'antall');
      const feil = sum(v, tjeneste, 'feil');
      return antall >= 30 && feil / antall > 0.05 &&
        `${tjeneste}: andel 5xx-svar siste 5 min er ${pst(feil / antall)} (terskel 5 %).${mestBerørt(v, tjeneste)}`;
    },
  };
}

function responstid(tjeneste, terskelMs) {
  return {
    nøkkel: `p95-${tjeneste}`, tjeneste, alvorlighet: 'høy', tittel: 'Treg responstid', vindu: 5,
    sjekk: (v) => {
      const ms = p95(v.flatMap((min) => min[tjeneste].latenser));
      return ms > terskelMs && `${tjeneste}: p95 responstid ${(ms / 1000).toFixed(1)} s (terskel ${terskelMs / 1000} s).`;
    },
  };
}

const REGLER = [
  {
    nøkkel: '504-api-gateway', tjeneste: 'api-gateway', alvorlighet: 'kritisk', tittel: 'Mange 504 Gateway Timeout', vindu: 5,
    sjekk: (v) => {
      const antall = sum(v, 'api-gateway', 'antall');
      const s504 = sum(v, 'api-gateway', 's504');
      return antall >= 50 && s504 / antall > 0.05 &&
        `api-gateway: ${pst(s504 / antall)} av kallene siste 5 min ender i 504 (terskel 5 %).${mestBerørt(v, 'api-gateway')}`;
    },
  },
  feilrate('betaling', 'kritisk'),
  feilrate('innlogging', 'kritisk'),
  feilrate('sok', 'høy'),
  responstid('sok', 2000),
  responstid('betaling', 4000),
  {
    nøkkel: 'sms-levering', tjeneste: 'varsling', alvorlighet: 'høy', tittel: 'SMS-leveringsrate lav', vindu: 10,
    sjekk: (v, måler) => {
      const sendt = sum(v, 'varsling', 'smsSendt');
      const levert = sum(v, 'varsling', 'smsLevert');
      return sendt >= 15 && levert / sendt < 0.9 &&
        `varsling: bare ${Math.round((100 * levert) / sendt)} % av SMS-er levert siste 10 min (terskel 90 %). Kø sms-utgående: ${måler.kø}.`;
    },
  },
  {
    nøkkel: 'db-tilkoblinger', tjeneste: 'kunde-db', alvorlighet: 'kritisk', tittel: 'Tilkoblinger nesten brukt opp', vindu: 1,
    sjekk: (_, måler) => måler.tilkoblinger > 180 &&
      `kunde-db: ${Math.round(måler.tilkoblinger)} av 200 tilkoblinger i bruk (terskel 180).`,
  },
  ...['innlogging-01', 'innlogging-02'].map((vert) => ({
    nøkkel: `disk-${vert}`, tjeneste: 'innlogging', alvorlighet: 'advarsel', tittel: 'Diskbruk høy', vindu: 1,
    sjekk: (_, måler) => måler.disk[vert] > 90 && `${vert}: /var er ${Math.round(måler.disk[vert])} % full (terskel 90 %).`,
  })),
];

export class Alarmer {
  aktive = new Map(); // nøkkel -> { alarm, rolig }
  løpenummer = 0;

  vurder(t, målinger, måler) {
    const hendelser = [];
    for (const regel of REGLER) {
      const tekst = regel.sjekk(målinger.vindu(regel.vindu), måler);
      const aktiv = this.aktive.get(regel.nøkkel);
      if (tekst && !aktiv) {
        const alarm = {
          id: `ALARM-${String(++this.løpenummer).padStart(4, '0')}`, tid: iso(t), tjeneste: regel.tjeneste,
          alvorlighet: regel.alvorlighet, tittel: regel.tittel, tekst, status: 'utløst',
        };
        this.aktive.set(regel.nøkkel, { alarm, rolig: 0 });
        hendelser.push(alarm);
      } else if (aktiv) {
        aktiv.rolig = tekst ? 0 : aktiv.rolig + 1;
        if (aktiv.rolig >= 3) {
          this.aktive.delete(regel.nøkkel);
          hendelser.push({ ...aktiv.alarm, tid: iso(t), status: 'løst', tekst: `${aktiv.alarm.tittel}: under terskel igjen.` });
        }
      }
    }
    return hendelser;
  }
}
