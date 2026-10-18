import { describe, expect, it } from 'vitest';
import { cartCount, cartLines, cartTotal, MAX_QTY, pruneCart, setQty, toRpcItems } from '../src/lib/cart';
import type { Gift } from '../src/lib/types';

const g = (id: string, price_cents: number): Gift => ({
  id, title: id, description: '', price_cents, image_url: null, image_alt: '', sort_order: 0, active: true,
});
const gifts = [g('a', 10000), g('b', 30000), g('c', 100000)];

describe('carrinho de presentes', () => {
  it('seleciona uma cota', () => {
    const c = setQty({}, 'a', 1);
    expect(cartTotal(c, gifts)).toBe(10000);
  });
  it('seleciona várias cotas e várias unidades; total correto', () => {
    let c = setQty({}, 'a', 2);
    c = setQty(c, 'b', 1);
    c = setQty(c, 'c', 3);
    expect(cartTotal(c, gifts)).toBe(2 * 10000 + 30000 + 3 * 100000);
    expect(cartCount(c)).toBe(6);
    expect(cartLines(c, gifts).map((l) => l.subtotal)).toEqual([20000, 30000, 300000]);
  });
  it('altera quantidade e remove ao chegar a zero', () => {
    let c = setQty({}, 'a', 3);
    c = setQty(c, 'a', 2);
    expect(c.a).toBe(2);
    c = setQty(c, 'a', 0);
    expect(c.a).toBeUndefined();
    expect(cartTotal(c, gifts)).toBe(0);
  });
  it('limita a quantidade e ignora valores inválidos', () => {
    expect(setQty({}, 'a', 1000).a).toBe(MAX_QTY);
    expect(setQty({ a: 2 }, 'a', NaN).a).toBeUndefined();
    expect(setQty({ a: 2 }, 'a', -1).a).toBeUndefined();
  });
  it('remove cotas que não existem mais', () => {
    expect(pruneCart({ a: 1, zzz: 4 }, gifts)).toEqual({ a: 1 });
  });
  it('monta os itens enviados ao servidor (sem valores monetários)', () => {
    expect(toRpcItems({ a: 2 })).toEqual([{ gift_id: 'a', quantity: 2 }]);
  });
});
