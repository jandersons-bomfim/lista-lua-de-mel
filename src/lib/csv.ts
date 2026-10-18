/** Célula CSV segura: escapa aspas/separadores e neutraliza fórmulas de planilha (= + - @). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Separador ";" + BOM UTF-8: abre corretamente no Excel em português. */
export const toCsv = (rows: unknown[][]): string =>
  '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
