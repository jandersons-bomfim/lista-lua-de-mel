// Edge Function: recebe notificações do Mercado Pago e confirma pagamentos.
// Segurança: (1) assinatura HMAC do cabeçalho x-signature; (2) NUNCA confia no corpo: consulta o pagamento na API do provedor;
// (3) valor precisa bater exatamente com o total da contribuição; (4) idempotência por (provider, event_id).
// STATUS: escrita conforme a documentação do provedor, NÃO testada contra o ambiente real (exige credenciais).
import { createClient } from 'npm:@supabase/supabase-js@2';

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  const token = Deno.env.get('MP_ACCESS_TOKEN');
  if (!secret || !token) return new Response('not configured', { status: 503 });

  const url = new URL(req.url);
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await req.json();
  } catch {
    /* alguns avisos chegam sem corpo; o id vem na query */
  }
  const rawId = url.searchParams.get('data.id') ?? (body.data?.id != null ? String(body.data.id) : '');
  const type = url.searchParams.get('type') ?? body.type ?? '';

  // --- 1. Verificação da assinatura (formato documentado pelo Mercado Pago) ---
  const sigHeader = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.trim().split('=') as [string, string]));
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1 || !rawId) return new Response('invalid signature', { status: 401 });
  const idForManifest = /^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId;
  const expected = await hmacHex(secret, `id:${idForManifest};request-id:${requestId};ts:${ts};`);
  if (!safeEqual(expected, v1)) return new Response('invalid signature', { status: 401 });

  if (type !== 'payment') return new Response('ignored', { status: 200 });
  if (!/^\d{1,20}$/.test(rawId)) return new Response('invalid id', { status: 400 });

  // --- 2. Consulta o pagamento no provedor (fonte da verdade) ---
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${rawId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error('Consulta ao provedor falhou', res.status);
    return new Response('provider error', { status: 502 }); // o provedor tentará de novo
  }
  const p = await res.json();
  const status = String(p.status ?? '');
  const code = String(p.external_reference ?? '');
  const amountCents = Math.round(Number(p.transaction_amount) * 100);
  if (!code || !Number.isFinite(amountCents)) return new Response('ignored', { status: 200 });

  // --- 3. Registro idempotente e confirmação (regras no banco) ---
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc('confirm_contribution_payment', {
    p_provider: 'mercadopago',
    p_payment_id: String(p.id),
    p_event_id: `${p.id}:${status}`,
    p_code: code,
    p_amount_cents: amountCents,
    p_provider_status: status,
  });
  if (error) {
    console.error('Falha ao registrar pagamento', error.message);
    return new Response('error', { status: 500 });
  }
  console.log('webhook', rawId, status, data);
  return new Response('ok', { status: 200 });
});
