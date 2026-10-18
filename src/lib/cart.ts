import type { Gift } from './types';

export type Cart = Record<string, number>;
export const MAX_QTY = 99;
const KEY = 'lm.cart.v1';

export function setQty(cart: Cart, id: string, qty: number): Cart {
  const next = { ...cart };
  const q = Math.floor(qty);
  if (!Number.isFinite(q) || q <= 0) delete next[id];
  else next[id] = Math.min(MAX_QTY, q);
  return next;
}

export const cartTotal = (cart: Cart, gifts: Gift[]): number =>
  gifts.reduce((sum, g) => sum + (cart[g.id] ?? 0) * g.price_cents, 0);

export const cartCount = (cart: Cart): number => Object.values(cart).reduce((a, b) => a + b, 0);

export const cartLines = (cart: Cart, gifts: Gift[]) =>
  gifts
    .filter((g) => (cart[g.id] ?? 0) > 0)
    .map((g) => ({ gift: g, quantity: cart[g.id], subtotal: cart[g.id] * g.price_cents }));

/** Remove itens de cotas que não existem mais / foram desativadas. */
export function pruneCart(cart: Cart, gifts: Gift[]): Cart {
  const ids = new Set(gifts.map((g) => g.id));
  return Object.fromEntries(Object.entries(cart).filter(([id]) => ids.has(id)));
}

export const toRpcItems = (cart: Cart) =>
  Object.entries(cart).map(([gift_id, quantity]) => ({ gift_id, quantity }));

export function loadCart(): Cart {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Cart = {};
    for (const [id, q] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof q === 'number' && q > 0) out[id] = Math.min(MAX_QTY, Math.floor(q));
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCart(cart: Cart): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* armazenamento indisponível: a seleção só vale nesta aba */
  }
}
