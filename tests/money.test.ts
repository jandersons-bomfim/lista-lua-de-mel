import { describe, expect, it } from 'vitest';
import { clampPercent, formatBRL, formatPercent, percentOf, reaisToCents } from '../src/lib/money';

describe('dinheiro', () => {
  it('formata em reais', () => {
    expect(formatBRL(600000).replace(/\s/g, ' ')).toBe('R$ 6.000,00');
    expect(formatBRL(0).replace(/\s/g, ' ')).toBe('R$ 0,00');
  });
  it('converte formato brasileiro para centavos', () => {
    expect(reaisToCents('150')).toBe(15000);
    expect(reaisToCents('1.000,50')).toBe(100050);
    expect(reaisToCents('R$ 99,9')).toBe(9990);
    expect(reaisToCents('0,05')).toBe(5);
  });
  it('recusa entradas inválidas', () => {
    for (const bad of ['', 'abc', '1,234', '10.5', '-5', '1..000', '12,345,6']) expect(reaisToCents(bad)).toBeNull();
  });
  it('percentual: 0 sem contribuições, limitado a 100 na barra, real preservado', () => {
    expect(percentOf(0, 600000)).toBe(0);
    expect(formatPercent(0)).toBe('0%');
    expect(percentOf(700000, 600000)).toBeCloseTo(116.67, 1);
    expect(clampPercent(percentOf(700000, 600000))).toBe(100);
  });
  it('percentual arredonda para baixo (nunca mostra 100% antes da meta)', () => {
    expect(formatPercent(percentOf(599999, 600000))).toBe('99,9%');
    expect(formatPercent(percentOf(200000, 600000))).toBe('33,3%');
    expect(formatPercent(percentOf(300000, 600000))).toBe('50%');
  });
});
