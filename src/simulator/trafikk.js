// Trafikken: forespørsler gjennom api-gateway til tjenestene bak, med logglinjer
// på begge sider. Feil logges alltid, vellykkede kall bare et utvalg av.
import { ENDEPUNKTER, VERTER } from './modell.js';
import { heltall, hex, latens, poisson, sjanse, velg } from './tilfeldig.js';

export const UTVALG = Number(process.env.SIM_LOGG_UTVALG ?? 0.05);

const SØKEORD = ['vinterjakke', 'gresskar', 'hodelykt', 'ullsokker', 'kaffetrakter', 'refleksvest', 'termos',
  'sovepose', 'kostyme heks', 'lyslenke', 'regnbukse', 'pannekakemiks', 'vinterdekk', 'skistav'];

export function genererTrafikk(fra, til, tilstand, ctx) {
  const sekunder = (til - fra) / 1000;
  for (const ep of ENDEPUNKTER) {
    for (let i = poisson(ep.rps * sekunder); i > 0; i--) forespørsel(ep, fra + Math.random() * (til - fra), tilstand, ctx);
  }
  // Varsling sender også ting som ikke kommer via api-gateway.
  for (let i = poisson(0.25 * sekunder); i > 0; i--) bakgrunnsvarsel(fra + Math.random() * (til - fra), tilstand, ctx);
}

function forespørsel(ep, t, tilstand, ctx) {
  const s = tilstand[ep.tjeneste];
  const req = {
    trace: hex(16),
    bruker: heltall(100000, 999999),
    id: `${ep.tjeneste[0]}-${heltall(100000, 999999)}`,
    kort: sjanse(0.12) ? 'utenlandsk' : 'norsk',
    gammeltKort: sjanse(0.15),
  };
  const intern = `${ep.metode} ${ep.sti.replace('/api', '')}`;
  const vert = velg(VERTER[ep.tjeneste]);

  let ms = latens(ep.median * s.latensFaktor);
  if (ep.tjeneste === 'betaling') ms += req.kortnett = latens(s.kortnettMedian, 0.6);

  let status = 200;
  let melding;
  if (ms >= 30000 && ep.tjeneste === 'betaling') {
    status = 504;
    melding = `Kortnett: ingen svar innen 30000ms, avbryter trekk id=${req.id} trace=${req.trace}`;
  } else if (ms >= 30000 || sjanse(s.timeoutAndel)) {
    status = 504;
    melding = `${s.timeoutMelding?.(ep, req) ?? `${intern} avbrutt etter 30000ms`} trace=${req.trace}`;
  } else if (s.feil && sjanse(s.feil.andel(ep, req))) {
    status = s.feil.status ?? 500;
    ms = latens(35);
    melding = `${s.feil.melding(ep, req)} trace=${req.trace}`;
  }
  if (status === 504) ms = 30000 + heltall(0, 40);

  if (status >= 500) {
    ctx.logg(t + ms, ep.tjeneste, 'ERROR', melding, vert);
  } else {
    const avvist = forretningsfeil(ep, req);
    if (avvist) {
      status = avvist.status;
      ctx.logg(t + ms, ep.tjeneste, 'INFO', avvist.melding, vert);
    } else if (sjanse(UTVALG)) {
      ctx.logg(t + ms, ep.tjeneste, 'INFO', suksess(ep, req, ms, vert), vert);
    }
    if (req.kortnett > 3000) {
      ctx.logg(t + ms, 'betaling', 'WARN', `Kortnett: treg respons ${req.kortnett}ms (terskel 3000ms) id=${req.id}`, vert);
    }
  }
  ctx.måling(ep.tjeneste, t, status, ms, intern);

  // api-gateway logger alt som ikke er 2xx, og et utvalg av resten.
  const gw = `${ep.metode} ${ep.sti} ${status} ${ms}ms upstream=${ep.tjeneste} trace=${req.trace}`;
  if (status >= 500) ctx.logg(t + ms, 'api-gateway', 'WARN', gw);
  else if (status >= 400 || sjanse(UTVALG)) ctx.logg(t + ms, 'api-gateway', 'INFO', gw);
  ctx.måling('api-gateway', t, status, ms, `${ep.metode} ${ep.sti}`);

  if (ep.sti === '/api/innlogging' && status === 200 && sjanse(0.35)) sms(t + ms, 'engangskode', tilstand, ctx);
}

function forretningsfeil(ep, req) {
  if (ep.sti === '/api/innlogging' && sjanse(0.05)) {
    return { status: 401, melding: `innlogging avvist bruker=${req.bruker} grunn=feil_passord` };
  }
  if (ep.sti === '/api/konto/meg' && sjanse(0.015)) return { status: 401, melding: `token utløpt bruker=${req.bruker}` };
  if (ep.sti === '/api/betaling/trekk' && sjanse(0.025)) {
    const grunn = velg(['51 insufficient funds', '05 do not honor', '54 expired card']);
    return { status: 402, melding: `trekk avvist id=${req.id} kort=${req.kort} grunn="${grunn}" (Kortnett)` };
  }
  if (ep.sti === '/api/sok' && sjanse(0.005)) return { status: 400, melding: 'ugyldig søk: tom spørring' };
  return null;
}

function suksess(ep, req, ms, vert) {
  switch (ep.sti) {
    case '/api/sok':
      return `søk q="${velg(SØKEORD)}" treff=${heltall(0, 900)} ${ms}ms node=${vert} trace=${req.trace}`;
    case '/api/konto/meg':
      return `GET /konto/meg bruker=${req.bruker} ${ms}ms trace=${req.trace}`;
    case '/api/innlogging':
      return `innlogging ok bruker=${req.bruker} metode=${velg(['passkey', 'passkey', 'passord', 'engangskode'])} ${ms}ms`;
    case '/api/betaling/trekk':
      return `trekk ok id=${req.id} kort=${req.kort} beløp=${heltall(49, 4999)}.00 NOK kortnett=${req.kortnett}ms`;
    case '/api/betaling/refusjon':
      return `refusjon ok id=${req.id} beløp=${heltall(49, 1999)}.00 NOK kortnett=${req.kortnett}ms`;
    default:
      return `GET /varsler bruker=${req.bruker} antall=${heltall(0, 12)} ${ms}ms`;
  }
}

function bakgrunnsvarsel(t, tilstand, ctx) {
  if (sjanse(0.1)) return ctx.pausetMaler.has('leveringsvarsel') ? undefined : sms(t, 'leveringsvarsel', tilstand, ctx);
  if (!sjanse(UTVALG * 4)) return;
  if (sjanse(0.65)) ctx.logg(t, 'varsling', 'INFO', `push sendt kanal=app bruker=${heltall(100000, 999999)}`);
  else ctx.logg(t, 'varsling', 'INFO', `e-post sendt mal=${velg(['kvittering', 'kvittering', 'velkommen', 'nytt-passord'])}`);
}

// Retry-policyen fra varsling 1.22.0: inntil 5 forsøk med kort pause.
function sms(t, mal, tilstand, ctx) {  const v = tilstand.varsling;
  if (!sjanse(v.smsFeil)) {
    if (sjanse(UTVALG * 4)) ctx.logg(t + latens(700), 'varsling', 'INFO', `sms levert mal=${mal} smsbud_id=sb-${hex(8)}`);
    return ctx.sms(t, true);
  }
  let levert = false;
  for (let forsøk = 1; forsøk <= 5; forsøk++) {
    const tf = t + forsøk * 10500;
    if (forsøk > 1 && !sjanse(v.smsFeil)) {
      ctx.logg(tf, 'varsling', 'INFO', `sms levert mal=${mal} smsbud_id=sb-${hex(8)} etter ${forsøk} forsøk`);
      levert = true;
      break;
    }
    ctx.logg(tf, 'varsling', 'WARN', v.smsFeilMelding?.(forsøk, mal) ?? `SmsBud: timeout etter 10000ms (forsøk ${forsøk} av 5) mal=${mal}`);
  }
  if (!levert) ctx.logg(t + 53000, 'varsling', 'ERROR', `SmsBud: gir opp etter 5 forsøk mal=${mal} mottaker=+47******${heltall(10, 99)}`);
  ctx.sms(t, levert);
}
