export const formatBRL = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

/** Converte "1.000,50" / "150" / "150,5" (formato brasileiro) em centavos inteiros. Retorna null se inválido. */
export function reaisToCents(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/, '');
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null;
  const [intPart, dec = ''] = s.replace(/\./g, '').split(',');
  const cents = parseInt(intPart, 10) * 100 + parseInt(dec.padEnd(2, '0') || '0', 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

export const centsToInput = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

export const percentOf = (confirmed: number, goal: number): number => (goal > 0 ? (confirmed / goal) * 100 : 0);
/** Percentual visual da barra: nunca passa de 100%. O valor real é preservado em `confirmed`. */
export const clampPercent = (p: number): number => Math.max(0, Math.min(100, p));

/** Arredonda para BAIXO (1 casa) para nunca mostrar 100% antes de a meta ser atingida. */
export function formatPercent(p: number): string {
  const v = Math.floor(Math.max(0, p) * 10) / 10;
  return (
    v.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 1, maximumFractionDigits: 1 }) + '%'
  );
}
