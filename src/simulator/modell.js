// Hvordan nettstedet ser ut: verter, endepunkter og normaltilstanden.
export const TJENESTER = ['api-gateway', 'innlogging', 'betaling', 'sok', 'varsling', 'kunde-db'];

export const VERTER = {
  'api-gateway': ['api-gateway-01', 'api-gateway-02'],
  innlogging: ['innlogging-01', 'innlogging-02'],
  betaling: ['betaling-01', 'betaling-02'],
  sok: ['sok-node-1', 'sok-node-2', 'sok-node-3'],
  varsling: ['varsling-01'],
  'kunde-db': ['kunde-db-01'],
};

// Trafikk om natta. Alt utenfra går via api-gateway.
export const ENDEPUNKTER = [
  { metode: 'GET', sti: '/api/sok', tjeneste: 'sok', rps: 1.6, median: 140 },
  { metode: 'GET', sti: '/api/konto/meg', tjeneste: 'innlogging', rps: 1.0, median: 70 },
  { metode: 'POST', sti: '/api/innlogging', tjeneste: 'innlogging', rps: 0.35, median: 220 },
  { metode: 'POST', sti: '/api/betaling/trekk', tjeneste: 'betaling', rps: 0.45, median: 380 },
  { metode: 'POST', sti: '/api/betaling/refusjon', tjeneste: 'betaling', rps: 0.04, median: 300 },
  { metode: 'GET', sti: '/api/varsler', tjeneste: 'varsling', rps: 0.3, median: 40 },
];

// Versjonene før historikken i historikk.js rulles ut.
export const STARTVERSJONER = {
  'api-gateway': '5.2.0', innlogging: '4.7.3', betaling: '2.13.0', sok: '3.8.2', varsling: '1.21.4',
};

// Det scenariene skrur på. Bygges på nytt hver tick, så et scenario som er
// over, slutter å virke av seg selv.
export function grunntilstand() {
  const tjeneste = () => ({ latensFaktor: 1, timeoutAndel: 0, timeoutMelding: null, feil: null });
  return {
    'api-gateway': tjeneste(),
    innlogging: tjeneste(),
    betaling: { ...tjeneste(), kortnettMedian: 180 },
    sok: tjeneste(),
    varsling: { ...tjeneste(), smsFeil: 0.01, smsFeilMelding: null },
    'kunde-db': { tilkoblingerMål: 38 },
    disk: {}, // vert -> ønsket diskbruk i prosent
  };
}
