// Edge Function: cria uma cobrança Pix dinâmica (Mercado Pago) para uma contribuição já registrada.
// Chamada pelo site com a chave anon. Posse comprovada por (contribution_id + client_key).
// STATUS: escrita conforme a documentação do provedor, NÃO testada contra o ambiente real (exige credenciais).
import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'METODO_INVALIDO' }, 405);

  let body: { contribution_id?: string; client_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'DADOS_INVALIDOS' }, 400);
  }
  const { contribution_id: id, client_key: key } = body;
  if (!id || !key || !UUID.test(id) || !UUID.test(key)) return json({ error: 'DADOS_INVALIDOS' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: c } = await supabase
    .from('contributions')
    .select('id, code, total_cents, status, pix_copia_cola, pix_expires_at')
    .eq('id', id)
    .eq('client_key', key)
    .maybeSingle();
  if (!c) return json({ error: 'NAO_ENCONTRADA' }, 404);
  if (c.pix_copia_cola) return json({ ok: true, reused: true }); // idempotente: nunca cria 2 cobranças
  if (c.status !== 'aguardando_pagamento') return json({ error: 'TRANSICAO_INVALIDA' }, 409);

  const { data: s } = await supabase.from('settings').select('pix_mode, manually_closed, deadline').single();
  if (s?.pix_mode !== 'dynamic') return json({ error: 'PIX_NAO_CONFIGURADO' }, 409);

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  const payerEmail = Deno.env.get('PIX_PAYER_EMAIL');
  if (!token || !payerEmail) return json({ error: 'PIX_NAO_CONFIGURADO' }, 503);

  const minutes = Math.max(10, Math.min(60 * 24 * 7, Number(Deno.env.get('PIX_CHARGE_MINUTES') ?? 1440)));
  const expires = new Date(Date.now() + minutes * 60_000);

  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `lm-${c.id}`, // mesma contribuição => mesma cobrança, mesmo com repetição
    },
    body: JSON.stringify({
      transaction_amount: Number((c.total_cents / 100).toFixed(2)),
      description: `Lua de mel Lhaiany & Janderson ${c.code}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: c.code,
      date_of_expiration: expires.toISOString().replace('Z', '-00:00'),
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-webhook`,
    }),
  });
  if (!res.ok) {
    console.error('Mercado Pago recusou a cobrança', res.status, await res.text());
    return json({ error: 'FALHA_PROVEDOR' }, 502);
  }
  const p = await res.json();
  const copia = p?.point_of_interaction?.transaction_data?.qr_code as string | undefined;
  if (!p?.id || !copia) {
    console.error('Resposta sem QR Code', JSON.stringify(p).slice(0, 500));
    return json({ error: 'FALHA_PROVEDOR' }, 502);
  }

  const { error } = await supabase.rpc('attach_pix_charge', {
    p_id: c.id,
    p_provider: 'mercadopago',
    p_payment_id: String(p.id),
    p_copia_cola: copia,
    p_expires_at: p.date_of_expiration ?? expires.toISOString(),
  });
  if (error) {
    console.error('Falha ao salvar a cobrança', error.message);
    return json({ error: 'ERRO_INTERNO' }, 500);
  }
  return json({ ok: true });
});
