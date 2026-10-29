// Tiltak som ikke treffer noe aktivt scenario. De gjør det de sier, men løser
// ingenting. Et unødvendig tiltak skal synes i loggene, slik det ville gjort i prod.
import { VERTER } from './modell.js';
import { heltall } from './tilfeldig.js';

export const HANDLINGER = ['rollback', 'avbryt_db_prosess', 'pause_reindeks', 'pause_varslingsmal', 'restart_tjeneste'];
const AV = 'natteskift-agent (godkjent av vakt)';

export function generiskTiltak(k, t, ctx) {
  switch (k.handling) {
    case 'rollback': {
      const forrige = ctx.forrigeVersjon(k.tjeneste);
      if (!forrige) return { ok: false, melding: `Ingen tidligere versjon av ${k.tjeneste} å rulle tilbake til.` };
      const fra = ctx.versjon(k.tjeneste);
      ctx.settVersjon(k.tjeneste, forrige);
      ctx.deploy({ tid: t, tjeneste: k.tjeneste, versjon: forrige, av: AV, endring: `Rollback fra ${fra} til ${forrige}.` });
      for (const vert of VERTER[k.tjeneste]) ctx.logg(t + heltall(5000, 60000), k.tjeneste, 'INFO', `starter ${k.tjeneste} versjon=${forrige} node=v22.11.0`, vert);
      return { ok: true, melding: `Rullet tilbake ${k.tjeneste} fra ${fra} til ${forrige}. Instansene starter på nytt i løpet av et minutt.` };
    }
    case 'avbryt_db_prosess':
      ctx.logg(t, 'kunde-db', 'WARN', `pg_cancel_backend(${k.parameter}): prosessen finnes ikke`);
      return { ok: false, melding: `WARNING: PID ${k.parameter} is not a PostgreSQL backend process. Ingenting ble avbrutt.` };
    case 'pause_reindeks':
      return { ok: false, melding: `sokctl: ingen reindeks kjører${k.parameter ? ` for ${k.parameter}` : ''}.` };
    case 'pause_varslingsmal':
      if (!k.parameter) return { ok: false, melding: 'varslingctl: oppgi mal, f.eks. leveringsvarsel.' };
      ctx.pausetMaler.add(k.parameter);
      ctx.logg(t, 'varsling', 'INFO', `utsending pauset mal=${k.parameter} av=${AV}`);
      return { ok: true, melding: `Utsending av mal=${k.parameter} er pauset. Andre maler går som før.` };
    case 'restart_tjeneste':
      for (const vert of VERTER[k.tjeneste]) {
        const ts = t + heltall(2000, 40000);
        ctx.logg(ts, k.tjeneste, 'WARN', `mottok SIGTERM, avslutter (restart bestilt av ${AV})`, vert);
        ctx.logg(ts + heltall(3000, 9000), k.tjeneste, 'INFO', `starter ${k.tjeneste} versjon=${ctx.versjon(k.tjeneste) ?? 'ukjent'}`, vert);
      }
      return { ok: true, melding: `Restartet ${k.tjeneste} (${VERTER[k.tjeneste].join(', ')}).` };
    default:
      return { ok: false, melding: `Ukjent handling «${k.handling}». Gyldige: ${HANDLINGER.join(', ')}` };
  }
}
