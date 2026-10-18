import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/lib/csv';

describe('exportação CSV', () => {
  it('escapa aspas, ponto e vírgula e quebras de linha', () => {
    expect(csvCell('Maria; "Tia"')).toBe('"Maria; ""Tia"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });
  it('neutraliza injeção de fórmula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+55 71')).toBe("'+55 71");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('gera BOM e separador ;', () => {
    const csv = toCsv([['a', 'b'], [1, null]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFa;b\r\n1;');
  });
});
