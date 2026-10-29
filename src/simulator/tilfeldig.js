export const tilfeldig = (a, b) => a + Math.random() * (b - a);
export const heltall = (a, b) => Math.floor(tilfeldig(a, b + 1));
export const sjanse = (p) => Math.random() < p;
export const velg = (liste) => liste[Math.floor(Math.random() * liste.length)];
export const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export function poisson(λ) {
  const grense = Math.exp(-λ);
  let k = 0;
  for (let p = Math.random(); p > grense; p *= Math.random()) k++;
  return k;
}

// Responstider er skjeve: de fleste er raske, noen få er trege. Lognormal rundt medianen.
export function latens(median, spredning = 0.5) {
  const z = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  return Math.max(1, Math.round(median * Math.exp(spredning * z)));
}
