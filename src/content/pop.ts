/** A population (in millions) written in Spanish, for news that keep both languages. */
export function fmtPopEs(m: number) {
  if (m < 0.001) return 'un puñado';
  if (m < 1) return `${Math.round(m * 1000).toLocaleString('es')} mil`;
  if (m < 1000) return `${m < 10 ? m.toFixed(1).replace('.', ',') : Math.round(m).toLocaleString('es')} millones`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} mil millones`;
}

/** A population (in millions) written in English. */
export function fmtPopEn(m: number) {
  if (m < 0.001) return 'a handful';
  if (m < 1) return `${Math.round(m * 1000).toLocaleString('en')} thousand`;
  if (m < 1000) return `${m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en')} million`;
  return `${(m / 1000).toFixed(1)} billion`;
}
