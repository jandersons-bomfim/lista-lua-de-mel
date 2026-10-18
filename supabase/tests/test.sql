-- Testes do banco (rodam em Postgres comum após bootstrap_local.sql + migração).
-- Uso: psql -d lm -f supabase/tests/bootstrap_local.sql -f supabase/migrations/0001_init.sql -f supabase/tests/test.sql
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on

create schema t;
grant usage on schema t to public;
create table t.ctx (k text primary key, v text);
create table t.results (name text, ok boolean);
grant all on t.ctx, t.results to public;

create function t.fails(q text) returns text language plpgsql as $$
begin execute q; return 'OK'; exception when others then return sqlerrm; end $$;
grant execute on function t.fails(text) to public;

create function t.check(name text, cond boolean) returns void language plpgsql as $$
begin insert into t.results values (name, coalesce(cond, false)); end $$;
grant execute on function t.check(text, boolean) to public;

create function t.ctxv(k text) returns text language sql stable as $$ select v from t.ctx where t.ctx.k = $1 $$;
grant execute on function t.ctxv(text) to public;

-- Preparação (superusuário): usuários, admin, ids de presentes
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@exemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'intruso@exemplo.com');
insert into public.admins(user_id) values ('11111111-1111-1111-1111-111111111111');
-- Verificações da lista real de cotas (seed)
select t.check('seed: 11 cotas ativas', (select count(*) from public.gifts where active) = 11);
select t.check('seed: soma de 1 unidade de cada cota = R$ 5.600', (select sum(price_cents) from public.gifts) = 560000);
select t.check('seed: valores conferem com a lista do casal', (select array_agg(price_cents order by sort_order) from public.gifts) =
  array[20000,30000,20000,40000,50000,60000,30000,50000,20000,100000,140000]);
select t.check('seed: todas as cotas têm imagem', (select count(*) from public.gifts where image_url is null or image_url = '') = 0);

-- Cotas dedicadas aos testes (R$ 100, R$ 300, R$ 1.000), removidas da lista real no fim das verificações iniciais
insert into public.gifts(title, price_cents, sort_order) values ('T100', 10000, 9001), ('T300', 30000, 9002), ('T1000', 100000, 9003);
insert into t.ctx select 'g100', id::text from public.gifts where title = 'T100';
insert into t.ctx select 'g300', id::text from public.gifts where title = 'T300';
insert into t.ctx select 'g1000', id::text from public.gifts where title = 'T1000';

-- ======================= ANÔNIMO =======================
set role anon;
select t.check('anon: public_state meta=600000, confirmado=0, aberta',
  (public.public_state()->>'goal_cents')::int = 600000
  and (public.public_state()->>'confirmed_cents')::int = 0
  and (public.public_state()->>'is_open')::boolean);
select t.check('anon: lê cotas ativas', (select count(*) from public.gifts) = 14);
select t.check('anon: NÃO lê contribuições', t.fails('select * from public.contributions') like 'permission denied%');
select t.check('anon: NÃO lê settings', t.fails('select * from public.settings') like 'permission denied%');
select t.check('anon: NÃO lê audit_log', t.fails('select * from public.audit_log') like 'permission denied%');
select t.check('anon: NÃO insere contribuição direto', t.fails($q$insert into public.contributions(code,client_key,guest_name,total_cents) values ('X', gen_random_uuid(), 'x', 100)$q$) like 'permission denied%');
select t.check('anon: NÃO altera status direto', t.fails($q$update public.contributions set status='confirmada'$q$) like 'permission denied%');
select t.check('anon: NÃO executa admin_set_status', t.fails($q$select public.admin_set_status(gen_random_uuid(),'confirmada','teste ok')$q$) like 'permission denied%');
select t.check('anon: NÃO executa confirm_contribution_payment', t.fails($q$select public.confirm_contribution_payment('mp','1','1:approved','LM-AAAAAA',100,'approved')$q$) like 'permission denied%');
select t.check('anon: NÃO altera cotas', t.fails($q$update public.gifts set price_cents = 1$q$) like 'permission denied%');

-- Criação com 2 cotas (R$100 x2 + R$300 x1 = R$500); valor vem do servidor
select set_config('lm.key1', gen_random_uuid()::text, false);
insert into t.ctx select 'c1', public.create_contribution(
  current_setting('lm.key1')::uuid, '  Tia Maria  ', 'Felicidades!',
  jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g100'), 'quantity', 2, 'total', 1),
                    jsonb_build_object('gift_id', t.ctxv('g300'), 'quantity', 1)))::text;
select t.check('criação: total calculado no servidor = 50000', ((t.ctxv('c1'))::jsonb->>'total_cents')::int = 50000);
select t.check('criação: status aguardando_pagamento', (t.ctxv('c1'))::jsonb->>'status' = 'aguardando_pagamento');
select t.check('criação: nome aparado', (t.ctxv('c1'))::jsonb->>'guest_name' = 'Tia Maria');
select t.check('criação: código LM-XXXXXX', (t.ctxv('c1'))::jsonb->>'code' ~ '^LM-[A-Z2-9]{6}$');

-- Idempotência (recarregar/duplo clique)
insert into t.ctx select 'c1b', public.create_contribution(current_setting('lm.key1')::uuid, 'Outro nome', null,
  jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g1000'), 'quantity', 5)))::text;
select t.check('idempotência: mesma chave devolve a mesma contribuição', (t.ctxv('c1b'))::jsonb->>'id' = (t.ctxv('c1'))::jsonb->>'id');
select t.check('idempotência: total não muda com repetição', ((t.ctxv('c1b'))::jsonb->>'total_cents')::int = 50000);

-- Validações
select t.check('valida: cota inexistente', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'A',null,'[{"gift_id":"%s","quantity":1}]')$q$, gen_random_uuid())) like '%ITEM_INVALIDO%');
select t.check('valida: quantidade 0', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'A',null,'[{"gift_id":"%s","quantity":0}]')$q$, t.ctxv('g100'))) like '%ITEM_INVALIDO%');
select t.check('valida: quantidade 100', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'A',null,'[{"gift_id":"%s","quantity":100}]')$q$, t.ctxv('g100'))) like '%ITEM_INVALIDO%');
select t.check('valida: itens não-array', t.fails($q$select public.create_contribution(gen_random_uuid(),'A',null,'{"a":1}')$q$) like '%ITEM_INVALIDO%');
select t.check('valida: lista vazia', t.fails($q$select public.create_contribution(gen_random_uuid(),'A',null,'[]')$q$) like '%ITEM_INVALIDO%');
select t.check('valida: gift_id lixo', t.fails($q$select public.create_contribution(gen_random_uuid(),'A',null,'[{"gift_id":"x; drop table gifts","quantity":1}]')$q$) like '%ITEM_INVALIDO%');
select t.check('valida: nome vazio', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'   ',null,'[{"gift_id":"%s","quantity":1}]')$q$, t.ctxv('g100'))) like '%DADOS_INVALIDOS%');
select t.check('valida: mensagem > 500', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'A',repeat('x',501),'[{"gift_id":"%s","quantity":1}]')$q$, t.ctxv('g100'))) like '%DADOS_INVALIDOS%');
select t.check('valida: teto de valor (R$ 20.000)', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'A',null,'[{"gift_id":"%s","quantity":50},{"gift_id":"%s","quantity":50}]')$q$, t.ctxv('g1000'), t.ctxv('g300'))) like '%VALOR_INVALIDO%');
select t.check('valida: XSS fica como texto puro no banco', (public.create_contribution(gen_random_uuid(), '<script>alert(1)</script>', null,
  jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g100'), 'quantity', 1))))->>'guest_name' = '<script>alert(1)</script>');

-- Pendente nunca entra na meta
select t.check('meta: pendentes NÃO somam no confirmado', (public.public_state()->>'confirmed_cents')::int = 0);

-- Convidado informa Pix (em verificação) e não confirma
insert into t.ctx select 'c1claim', public.claim_payment(((t.ctxv('c1'))::jsonb->>'id')::uuid, current_setting('lm.key1')::uuid)::text;
select t.check('claim: vira em_verificacao', (t.ctxv('c1claim'))::jsonb->>'status' = 'em_verificacao');
select t.check('claim: em_verificacao NÃO soma na meta', (public.public_state()->>'confirmed_cents')::int = 0);
select t.check('claim: chave errada recusada', t.fails(format($q$select public.claim_payment('%s', gen_random_uuid())$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%NAO_ENCONTRADA%');
select t.check('get: chave errada recusada', t.fails(format($q$select public.get_contribution('%s', gen_random_uuid())$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%NAO_ENCONTRADA%');
reset role;

-- ======================= USUÁRIO AUTENTICADO SEM PERMISSÃO =======================
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select t.check('intruso: is_admin = false', public.is_admin() = false);
select t.check('intruso: RLS esconde contribuições (0 linhas)', (select count(*) from public.contributions) = 0);
select t.check('intruso: RLS esconde audit_log', (select count(*) from public.audit_log) = 0);
select t.check('intruso: admin_set_status recusado', t.fails(format($q$select public.admin_set_status('%s','confirmada','tentando confirmar')$q$, (t.ctxv('c1'))::jsonb->>'id') ) like '%NAO_AUTORIZADO%');
select t.check('intruso: update de cota afeta 0 linhas', (with u as (update public.gifts set price_cents = 1 returning 1) select count(*) from u) = 0);
select t.check('intruso: não muda configurações', t.fails($q$select public.admin_update_settings(1, now(), 'static', null, null, null, 'x')$q$) like '%NAO_AUTORIZADO%');
reset role;
select t.check('intruso: nada foi confirmado', (select count(*) from public.contributions where status = 'confirmada') = 0);

-- ======================= ADMIN =======================
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select t.check('admin: is_admin = true', public.is_admin());
select t.check('admin: vê contribuições', (select count(*) from public.contributions) >= 2);
select t.check('admin: confirmar sem justificativa é recusado', t.fails(format($q$select public.admin_set_status('%s','confirmada','')$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%JUSTIFICATIVA_OBRIGATORIA%');
select public.admin_set_status(((t.ctxv('c1'))::jsonb->>'id')::uuid, 'confirmada', 'Conferido no extrato, Pix de R$ 500,00');
reset role;
select t.check('admin: confirmação soma exatamente 50000 na meta', (public.public_state()->>'confirmed_cents')::int = 50000);
select t.check('admin: confirmação registra responsável e origem', exists (
  select 1 from public.contributions where id = ((t.ctxv('c1'))::jsonb->>'id')::uuid and confirmed_by = 'admin@exemplo.com' and confirmation_source = 'manual' and confirmed_at is not null));
select t.check('auditoria: status registrado com justificativa e autor', exists (
  select 1 from public.audit_log where action = 'status' and note like 'Conferido no extrato%' and actor_email = 'admin@exemplo.com'
   and new_data->>'status' = 'confirmada' and old_data->>'status' = 'em_verificacao'));

set role authenticated;
select t.check('admin: confirmada -> cancelada é bloqueado', t.fails(format($q$select public.admin_set_status('%s','cancelada','tentando cancelar')$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%TRANSICAO_INVALIDA%');
select t.check('admin: repetir o mesmo status é recusado', t.fails(format($q$select public.admin_set_status('%s','confirmada','de novo')$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%SEM_MUDANCA%');
select public.admin_add_note(((t.ctxv('c1'))::jsonb->>'id')::uuid, 'Tia Maria avisou que mandou o comprovante por WhatsApp');
select t.check('admin: observação registrada no histórico', exists (select 1 from public.audit_log where action = 'observacao' and note like 'Tia Maria avisou%'));
select public.admin_correct_contribution(((t.ctxv('c1'))::jsonb->>'id')::uuid, 'Maria Aparecida (Tia Maria)', 'Felicidades!', 'Nome completo informado pela própria');
select t.check('admin: correção mantém histórico (antigo e novo)', exists (
  select 1 from public.audit_log where action = 'correcao' and old_data->>'guest_name' = 'Tia Maria' and new_data->>'guest_name' like 'Maria Aparecida%'));
select t.check('admin: correção sem justificativa recusada', t.fails(format($q$select public.admin_correct_contribution('%s','X',null,'')$q$, (t.ctxv('c1'))::jsonb->>'id')) like '%JUSTIFICATIVA_OBRIGATORIA%');
reset role;

-- ======================= WEBHOOK (service_role) =======================
-- Contribuição nova pendente (R$ 100) para o webhook
set role anon;
insert into t.ctx select 'c2', public.create_contribution(gen_random_uuid(), 'Família Souza', null,
  jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g100'), 'quantity', 1)))::text;
insert into t.ctx select 'c3', public.create_contribution(gen_random_uuid(), 'João', null,
  jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g300'), 'quantity', 1)))::text;
reset role;
set role service_role;
select t.check('webhook: valor divergente NÃO confirma',
  public.confirm_contribution_payment('mercadopago','900','900:approved',(t.ctxv('c3'))::jsonb->>'code', 1000, 'approved') = 'valor_divergente');
select t.check('webhook: pagamento pendente (pending) é ignorado',
  public.confirm_contribution_payment('mercadopago','901','901:pending',(t.ctxv('c2'))::jsonb->>'code', 10000, 'pending') = 'ignorado');
select t.check('webhook: approved com valor exato confirma',
  public.confirm_contribution_payment('mercadopago','902','902:approved',(t.ctxv('c2'))::jsonb->>'code', 10000, 'approved') = 'confirmada');
select t.check('webhook: reentrega do mesmo evento é idempotente',
  public.confirm_contribution_payment('mercadopago','902','902:approved',(t.ctxv('c2'))::jsonb->>'code', 10000, 'approved') = 'evento_duplicado');
select t.check('webhook: segundo pagamento (outro id) não soma de novo',
  public.confirm_contribution_payment('mercadopago','903','903:approved',(t.ctxv('c2'))::jsonb->>'code', 10000, 'approved') = 'pagamento_duplicado');
select t.check('webhook: código inexistente não quebra',
  public.confirm_contribution_payment('mercadopago','904','904:approved','LM-ZZZZZZ', 10000, 'approved') = 'contribuicao_nao_encontrada');
reset role;
select t.check('webhook: meta = 50000 + 10000 (duplicado e divergente não somam)', (public.public_state()->>'confirmed_cents')::int = 60000);
select t.check('webhook: divergente ficou em_verificacao', exists (select 1 from public.contributions where code = (t.ctxv('c3'))::jsonb->>'code' and status = 'em_verificacao'));
select t.check('webhook: eventos registrados sem duplicar', (select count(*) from public.payment_events where provider = 'mercadopago') = 5);
select t.check('webhook: duplicado/divergente geram alerta de revisão no histórico', (select count(*) from public.audit_log where action like 'pagamento:%') = 3);

-- ======================= PRAZO E ENCERRAMENTO =======================
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.admin_update_settings(600000, now() - interval '1 minute', 'static', '11999999999', 'LHAIANY E JANDERSON', 'SALVADOR', 'Teste de prazo vencido');
reset role;
set role anon;
select t.check('prazo: is_open = false após o prazo', (public.public_state()->>'is_open')::boolean = false);
select t.check('prazo: nova contribuição é recusada', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'Tarde demais',null,'[{"gift_id":"%s","quantity":1}]')$q$, t.ctxv('g100'))) like '%LISTA_ENCERRADA%');
select t.check('prazo: reabrir a mesma chave antiga ainda devolve o registro', (public.get_contribution(((t.ctxv('c1'))::jsonb->>'id')::uuid, current_setting('lm.key1')::uuid))->>'status' = 'confirmada');
reset role;
select t.check('prazo: confirmados preservados', (public.public_state()->>'confirmed_cents')::int = 60000);
select t.check('prazo: configuração auditada com nota', exists (select 1 from public.audit_log where entity = 'settings' and note = 'Teste de prazo vencido'));

set role authenticated;
select public.admin_update_settings(600000, timestamptz '2027-01-05 23:59:00-03', 'static', '11999999999', 'LHAIANY E JANDERSON', 'SALVADOR', 'Prazo restaurado');
select public.admin_set_list_closed(true, 'Encerrando antes do prazo');
reset role;
select t.check('encerramento manual: is_open = false', (public.public_state()->>'is_open')::boolean = false);
set role anon;
select t.check('encerramento manual: contribuição recusada', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'X',null,'[{"gift_id":"%s","quantity":1}]')$q$, t.ctxv('g100'))) like '%LISTA_ENCERRADA%');
reset role;
set role authenticated;
select t.check('encerramento manual exige justificativa', t.fails($q$select public.admin_set_list_closed(false, '')$q$) like '%JUSTIFICATIVA_OBRIGATORIA%');
select public.admin_set_list_closed(false, 'Reabrindo a lista');
reset role;
select t.check('reabertura: is_open = true', (public.public_state()->>'is_open')::boolean);
select t.check('public_state expõe a chave Pix só em modo estático', (public.public_state()->>'pix_key') = '11999999999');

-- ======================= CANCELAR / EXPIRAR / REATIVAR =======================
set role anon;
insert into t.ctx select 'c4', public.create_contribution(gen_random_uuid(), 'Pedro', null, jsonb_build_array(jsonb_build_object('gift_id', t.ctxv('g100'), 'quantity', 1)))::text;
reset role;
set role authenticated;
select public.admin_set_status(((t.ctxv('c4'))::jsonb->>'id')::uuid, 'expirada', 'Cobrança venceu sem pagamento');
select t.check('expirada: não vira confirmada sem justificativa explícita', t.fails(format($q$select public.admin_set_status('%s','confirmada','')$q$, (t.ctxv('c4'))::jsonb->>'id')) like '%JUSTIFICATIVA_OBRIGATORIA%');
select public.admin_set_status(((t.ctxv('c4'))::jsonb->>'id')::uuid, 'aguardando_pagamento', 'Pedro pediu mais prazo; reativado');
reset role;
select t.check('reativação registrada no histórico', exists (select 1 from public.audit_log where new_data->>'status' = 'aguardando_pagamento' and old_data->>'status' = 'expirada' and note like 'Pedro pediu%'));
set role authenticated;
select public.admin_set_status(((t.ctxv('c4'))::jsonb->>'id')::uuid, 'cancelada', 'Cancelado a pedido');
select t.check('cancelada: não vai direto para expirada', t.fails(format($q$select public.admin_set_status('%s','expirada','teste')$q$, (t.ctxv('c4'))::jsonb->>'id')) like '%TRANSICAO_INVALIDA%');
reset role;
select t.check('meta segue 60000 depois de cancelar/expirar', (public.public_state()->>'confirmed_cents')::int = 60000);

-- ======================= SNAPSHOT DE PREÇOS / COTA INATIVA =======================
set role authenticated;
update public.gifts set price_cents = 12345, title = 'Título novo' where id = t.ctxv('g100')::uuid;
reset role;
select t.check('snapshot: item antigo mantém título e valor originais', exists (
  select 1 from public.contribution_items where contribution_id = ((t.ctxv('c1'))::jsonb->>'id')::uuid and title = 'T100' and unit_cents = 10000));
select t.check('cota editada é auditada', exists (select 1 from public.audit_log where entity = 'gifts' and action = 'update' and (new_data->>'price_cents')::int = 12345));
set role authenticated;
update public.gifts set active = false where id = t.ctxv('g300')::uuid;
reset role;
set role anon;
select t.check('cota inativa não aparece para o público', (select count(*) from public.gifts where id = t.ctxv('g300')::uuid) = 0);
select t.check('cota inativa não pode ser escolhida', t.fails(format($q$select public.create_contribution(gen_random_uuid(),'X',null,'[{"gift_id":"%s","quantity":1}]')$q$, t.ctxv('g300'))) like '%ITEM_INVALIDO%');
reset role;

-- ======================= LIMITE DE REQUISIÇÕES =======================
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', false);
set role anon;
do $$
declare i int; r text; okc int := 0; blocked boolean := false;
begin
  for i in 1..12 loop
    r := t.fails(format($q$select public.create_contribution(gen_random_uuid(),'Robô %s',null,'[{"gift_id":"%s","quantity":1}]')$q$, i, (select v from t.ctx where k = 'g1000')));
    if r = 'OK' then okc := okc + 1; elsif r like '%MUITAS_TENTATIVAS%' then blocked := true; end if;
  end loop;
  insert into t.results values ('rate limit: 10 criações por hora por IP, depois bloqueia', okc = 10 and blocked);
end $$;
reset role;

-- ======================= RESULTADO =======================
\echo ----- RESULTADOS -----
select case when ok then 'PASS  ' else 'FAIL  ' end || name from t.results order by ok, name;
select 'TOTAL: ' || count(*) || ' | PASS: ' || count(*) filter (where ok) || ' | FAIL: ' || count(*) filter (where not ok) from t.results;
