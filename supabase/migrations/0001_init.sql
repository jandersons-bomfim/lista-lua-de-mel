-- =====================================================================
-- Lista de presentes de lua de mel — Lhaiany & Janderson
-- Migração inicial: tabelas, regras de acesso (RLS), funções e dados iniciais.
-- Valores monetários sempre em centavos inteiros.
-- =====================================================================

create type public.contribution_status as enum (
  'em_selecao',            -- montando a lista (existe apenas no navegador; reservado)
  'aguardando_pagamento',  -- registrada, com instrução/cobrança de Pix
  'em_verificacao',        -- pagamento informado/identificado, ainda não validado
  'confirmada',            -- pagamento recebido e validado
  'expirada',              -- cobrança vencida ou encerrada sem pagamento
  'cancelada'              -- cancelada de forma legítima
);

-- ---------- Tabelas ----------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.settings (
  id boolean primary key default true check (id),            -- linha única
  goal_cents integer not null default 600000 check (goal_cents > 0),
  deadline timestamptz not null default timestamptz '2027-01-05 23:59:00-03',  -- America/Bahia (UTC-3)
  manually_closed boolean not null default false,
  pix_mode text not null default 'static' check (pix_mode in ('static','dynamic')),
  pix_key text check (pix_key is null or char_length(pix_key) <= 77),
  pix_receiver_name text check (pix_receiver_name is null or char_length(pix_receiver_name) <= 25),
  pix_receiver_city text check (pix_receiver_city is null or char_length(pix_receiver_city) <= 15),
  updated_at timestamptz not null default now()
);

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 400),
  price_cents integer not null check (price_cents > 0),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  image_alt text not null default '' check (char_length(image_alt) <= 200),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  client_key uuid not null unique,                           -- chave de idempotência/posse (gerada no navegador)
  guest_name text not null check (char_length(guest_name) between 1 and 120),
  message text check (message is null or char_length(message) <= 500),
  total_cents integer not null check (total_cents > 0),
  status public.contribution_status not null default 'aguardando_pagamento',
  provider text,
  provider_payment_id text unique,
  pix_copia_cola text,
  pix_expires_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by text,
  confirmation_source text check (confirmation_source in ('webhook','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contributions_status_idx on public.contributions(status);
create index contributions_created_idx on public.contributions(created_at desc);

create table public.contribution_items (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  gift_id uuid references public.gifts(id) on delete set null,
  title text not null,                                        -- cópia do título no momento da escolha
  unit_cents integer not null check (unit_cents > 0),        -- cópia do valor no momento da escolha
  quantity integer not null check (quantity between 1 and 99),
  unique (contribution_id, gift_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  entity text not null,
  entity_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  note text
);
create index audit_entity_idx on public.audit_log(entity, entity_id, at desc);

create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  payment_id text,
  contribution_id uuid references public.contributions(id) on delete set null,
  amount_cents integer,
  provider_status text,
  outcome text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)                                -- idempotência de eventos
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

-- ---------- Triggers genéricos ----------
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger gifts_updated before update on public.gifts for each row execute function public.set_updated_at();
create trigger contributions_updated before update on public.contributions for each row execute function public.set_updated_at();
create trigger settings_updated before update on public.settings for each row execute function public.set_updated_at();

create function public._actor_email() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select email::text from auth.users where id = auth.uid()
$$;

-- Auditoria de contribuições (criação e mudanças de status)
create function public.trg_contributions_audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log(actor, actor_email, entity, entity_id, action, new_data)
    values (auth.uid(), public._actor_email(), 'contribution', new.id::text, 'criada',
            jsonb_build_object('code', new.code, 'total_cents', new.total_cents, 'status', new.status));
  elsif new.status is distinct from old.status then
    insert into audit_log(actor, actor_email, entity, entity_id, action, old_data, new_data, note)
    values (auth.uid(), public._actor_email(), 'contribution', new.id::text, 'status',
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status),
            nullif(current_setting('app.audit_note', true), ''));
  end if;
  return new;
end $$;
create trigger contributions_audit after insert or update on public.contributions
  for each row execute function public.trg_contributions_audit();

-- Auditoria de configurações e presentes
create function public.trg_generic_audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log(actor, actor_email, entity, entity_id, action, old_data, new_data, note)
  values (auth.uid(), public._actor_email(), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', 'unico'),
          lower(tg_op),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end,
          nullif(current_setting('app.audit_note', true), ''));
  return coalesce(new, old);
end $$;
create trigger gifts_audit after insert or update or delete on public.gifts for each row execute function public.trg_generic_audit();
create trigger settings_audit after update on public.settings for each row execute function public.trg_generic_audit();

-- ---------- Funções de apoio ----------
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create function public.rl_hit(p_key text, p_max integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare h integer;
begin
  insert into rate_limits(key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when rate_limits.window_start < now() - make_interval(secs => p_seconds) then 1 else rate_limits.hits + 1 end,
    window_start = case when rate_limits.window_start < now() - make_interval(secs => p_seconds) then now() else rate_limits.window_start end
  returning hits into h;
  return h <= p_max;
end $$;

create function public._contribution_view(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'code', c.code, 'guest_name', c.guest_name, 'total_cents', c.total_cents,
    'status', c.status, 'pix_copia_cola', c.pix_copia_cola, 'pix_expires_at', c.pix_expires_at,
    'created_at', c.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'unit_cents', i.unit_cents, 'quantity', i.quantity) order by i.title)
                       from contribution_items i where i.contribution_id = c.id), '[]'::jsonb))
  from contributions c where c.id = p_id
$$;

-- ---------- API pública (anon) ----------
-- Estado público: somente valores agregados e dados de recebimento do Pix (que são feitos para serem compartilhados).
create function public.public_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'goal_cents', s.goal_cents,
    'confirmed_cents', coalesce((select sum(total_cents) from contributions where status = 'confirmada'), 0),
    'deadline', s.deadline,
    'is_open', (not s.manually_closed and now() <= s.deadline),
    'pix_mode', s.pix_mode,
    'pix_key', case when s.pix_mode = 'static' then s.pix_key end,
    'pix_receiver_name', s.pix_receiver_name,
    'pix_receiver_city', s.pix_receiver_city,
    'server_now', now())
  from settings s
$$;

create function public.create_contribution(p_client_key uuid, p_guest_name text, p_message text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_total bigint; v_matched integer; v_requested integer; v_try integer := 0;
  v_name text := btrim(coalesce(p_guest_name, ''));
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_code text; v_ip text := '';
begin
  if p_client_key is null then raise exception 'DADOS_INVALIDOS'; end if;

  -- Idempotência: mesma chave devolve a contribuição já criada.
  select id into v_id from contributions where client_key = p_client_key;
  if v_id is not null then return public._contribution_view(v_id); end if;

  if not exists (select 1 from settings s where not s.manually_closed and now() <= s.deadline) then
    raise exception 'LISTA_ENCERRADA';
  end if;
  if char_length(v_name) not between 1 and 120 or (v_msg is not null and char_length(v_msg) > 500) then
    raise exception 'DADOS_INVALIDOS';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'ITEM_INVALIDO';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'gift_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or case when coalesce(e->>'quantity', '') ~ '^[0-9]{1,2}$' then (e->>'quantity')::int else 0 end not between 1 and 99
  ) then raise exception 'ITEM_INVALIDO'; end if;

  select count(distinct (e->>'gift_id')::uuid) into v_requested from jsonb_array_elements(p_items) e;
  with req as (
    select (e->>'gift_id')::uuid as gid, sum((e->>'quantity')::int) as q
    from jsonb_array_elements(p_items) e group by 1
  )
  select count(*), coalesce(sum(g.price_cents::bigint * r.q), 0)
    into v_matched, v_total
  from req r join gifts g on g.id = r.gid and g.active and r.q <= 99;
  if v_matched <> v_requested then raise exception 'ITEM_INVALIDO'; end if;
  if v_total <= 0 or v_total > 2000000 then raise exception 'VALOR_INVALIDO'; end if;

  -- Limite de criações por origem (IP informado pela plataforma): 10 por hora.
  begin
    v_ip := btrim(split_part(coalesce((current_setting('request.headers', true)::jsonb)->>'x-forwarded-for', ''), ',', 1));
  exception when others then v_ip := '';
  end;
  if not public.rl_hit('create:' || coalesce(nullif(v_ip, ''), 'sem-ip'), 10, 3600) then
    raise exception 'MUITAS_TENTATIVAS';
  end if;

  loop
    v_code := 'LM-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
                         from generate_series(1, 6));
    exit when not exists (select 1 from contributions where code = v_code);
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'ERRO_INTERNO'; end if;
  end loop;

  insert into contributions(code, client_key, guest_name, message, total_cents)
  values (v_code, p_client_key, v_name, v_msg, v_total)
  on conflict (client_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from contributions where client_key = p_client_key;
    return public._contribution_view(v_id);
  end if;

  insert into contribution_items(contribution_id, gift_id, title, unit_cents, quantity)
  with req as (
    select (e->>'gift_id')::uuid as gid, sum((e->>'quantity')::int) as q
    from jsonb_array_elements(p_items) e group by 1
  )
  select v_id, g.id, g.title, g.price_cents, r.q from req r join gifts g on g.id = r.gid;

  return public._contribution_view(v_id);
end $$;

create function public.get_contribution(p_id uuid, p_client_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from contributions where id = p_id and client_key = p_client_key) then
    raise exception 'NAO_ENCONTRADA';
  end if;
  return public._contribution_view(p_id);
end $$;

-- O convidado informa que fez o Pix. Isso NÃO confirma nada: só sinaliza "em verificação" ao casal.
create function public.claim_payment(p_id uuid, p_client_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status public.contribution_status;
begin
  select status into v_status from contributions where id = p_id and client_key = p_client_key for update;
  if not found then raise exception 'NAO_ENCONTRADA'; end if;
  if v_status = 'aguardando_pagamento' then
    perform set_config('app.audit_note', 'Convidado informou que realizou o Pix (ainda não validado).', true);
    update contributions set status = 'em_verificacao' where id = p_id;
  end if;
  return public._contribution_view(p_id);
end $$;

-- ---------- Funções do servidor (service_role: Edge Functions) ----------
create function public.attach_pix_charge(p_id uuid, p_provider text, p_payment_id text, p_copia_cola text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update contributions
     set provider = p_provider, provider_payment_id = p_payment_id, pix_copia_cola = p_copia_cola, pix_expires_at = p_expires_at
   where id = p_id and status = 'aguardando_pagamento' and provider_payment_id is null;
  return public._contribution_view(p_id);
end $$;

create function public.confirm_contribution_payment(
  p_provider text, p_payment_id text, p_event_id text, p_code text, p_amount_cents integer, p_provider_status text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v_outcome text; v_rows integer;
begin
  insert into payment_events(provider, event_id, payment_id, amount_cents, provider_status)
  values (p_provider, p_event_id, p_payment_id, p_amount_cents, p_provider_status)
  on conflict (provider, event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'evento_duplicado'; end if;

  select * into c from contributions where code = p_code for update;
  if not found then
    v_outcome := 'contribuicao_nao_encontrada';
  elsif p_provider_status = 'approved' then
    if p_amount_cents is distinct from c.total_cents then
      v_outcome := 'valor_divergente';
      if c.status = 'aguardando_pagamento' then
        perform set_config('app.audit_note', 'Pagamento aprovado com valor diferente do esperado. Conferir manualmente.', true);
        update contributions set status = 'em_verificacao' where id = c.id;
      end if;
    elsif c.status = 'confirmada' then
      v_outcome := case when c.provider_payment_id = p_payment_id then 'ja_confirmada' else 'pagamento_duplicado' end;
    elsif c.status in ('aguardando_pagamento', 'em_verificacao') then
      v_outcome := 'confirmada';
      perform set_config('app.audit_note', 'Pagamento aprovado pelo provedor (' || p_provider || ').', true);
      update contributions
         set status = 'confirmada', confirmed_at = now(), confirmed_by = 'webhook:' || p_provider,
             confirmation_source = 'webhook', provider_payment_id = coalesce(provider_payment_id, p_payment_id)
       where id = c.id;
    else
      v_outcome := 'requer_revisao';   -- pagamento chegou para contribuição cancelada/expirada
    end if;
  elsif p_provider_status = 'in_process' and c.status = 'aguardando_pagamento' then
    v_outcome := 'em_verificacao';
    perform set_config('app.audit_note', 'Provedor informa pagamento em processamento.', true);
    update contributions set status = 'em_verificacao' where id = c.id;
  elsif p_provider_status in ('cancelled', 'expired') and c.status = 'aguardando_pagamento' then
    v_outcome := 'expirada';
    perform set_config('app.audit_note', 'Cobrança encerrada pelo provedor (' || p_provider_status || ').', true);
    update contributions set status = 'expirada' where id = c.id;
  else
    v_outcome := 'ignorado';
  end if;

  update payment_events set contribution_id = c.id, outcome = v_outcome where provider = p_provider and event_id = p_event_id;

  if v_outcome in ('valor_divergente', 'pagamento_duplicado', 'requer_revisao', 'contribuicao_nao_encontrada') then
    insert into audit_log(entity, entity_id, action, new_data, note)
    values ('contribution', coalesce(c.id::text, p_code), 'pagamento:' || v_outcome,
            jsonb_build_object('payment_id', p_payment_id, 'amount_cents', p_amount_cents, 'provider', p_provider),
            'Requer revisão manual do casal.');
  end if;
  return v_outcome;
end $$;

-- ---------- Funções administrativas (usuário autenticado + admins) ----------
create function public._require_admin() returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'NAO_AUTORIZADO' using errcode = '42501'; end if;
end $$;

create function public.admin_set_status(p_id uuid, p_status public.contribution_status, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c contributions%rowtype; v_note text := btrim(coalesce(p_note, ''));
begin
  perform public._require_admin();
  if char_length(v_note) < 3 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  select * into c from contributions where id = p_id for update;
  if not found then raise exception 'NAO_ENCONTRADA'; end if;
  if c.status = p_status then raise exception 'SEM_MUDANCA'; end if;
  if p_status = 'em_selecao' then raise exception 'TRANSICAO_INVALIDA'; end if;
  if c.status = 'confirmada' and p_status <> 'em_verificacao' then raise exception 'TRANSICAO_INVALIDA'; end if;
  if p_status in ('expirada', 'cancelada') and c.status not in ('aguardando_pagamento', 'em_verificacao') then
    raise exception 'TRANSICAO_INVALIDA';
  end if;

  perform set_config('app.audit_note', v_note, true);
  if p_status = 'confirmada' then
    update contributions set status = 'confirmada', confirmed_at = now(),
           confirmed_by = coalesce(public._actor_email(), auth.uid()::text), confirmation_source = 'manual'
     where id = p_id;
  else
    update contributions set status = p_status,
           confirmed_at = case when c.status = 'confirmada' then null else confirmed_at end,
           confirmed_by = case when c.status = 'confirmada' then null else confirmed_by end,
           confirmation_source = case when c.status = 'confirmada' then null else confirmation_source end
     where id = p_id;
  end if;
  return public._contribution_view(p_id);
end $$;

create function public.admin_add_note(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_note, ''))) < 1 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if not exists (select 1 from contributions where id = p_id) then raise exception 'NAO_ENCONTRADA'; end if;
  insert into audit_log(actor, actor_email, entity, entity_id, action, note)
  values (auth.uid(), public._actor_email(), 'contribution', p_id::text, 'observacao', btrim(p_note));
end $$;

create function public.admin_correct_contribution(p_id uuid, p_guest_name text, p_message text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c contributions%rowtype; v_name text := btrim(coalesce(p_guest_name, '')); v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  if char_length(v_name) not between 1 and 120 or (v_msg is not null and char_length(v_msg) > 500) then raise exception 'DADOS_INVALIDOS'; end if;
  select * into c from contributions where id = p_id for update;
  if not found then raise exception 'NAO_ENCONTRADA'; end if;
  update contributions set guest_name = v_name, message = v_msg where id = p_id;
  insert into audit_log(actor, actor_email, entity, entity_id, action, old_data, new_data, note)
  values (auth.uid(), public._actor_email(), 'contribution', p_id::text, 'correcao',
          jsonb_build_object('guest_name', c.guest_name, 'message', c.message),
          jsonb_build_object('guest_name', v_name, 'message', v_msg), btrim(p_note));
  return public._contribution_view(p_id);
end $$;

create function public.admin_update_settings(
  p_goal_cents integer, p_deadline timestamptz, p_pix_mode text, p_pix_key text,
  p_receiver_name text, p_receiver_city text, p_note text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  perform set_config('app.audit_note', coalesce(btrim(p_note), ''), true);
  update settings set goal_cents = p_goal_cents, deadline = p_deadline, pix_mode = p_pix_mode,
         pix_key = nullif(btrim(coalesce(p_pix_key, '')), ''),
         pix_receiver_name = nullif(btrim(coalesce(p_receiver_name, '')), ''),
         pix_receiver_city = nullif(btrim(coalesce(p_receiver_city, '')), '')
   where id;
end $$;

create function public.admin_set_list_closed(p_closed boolean, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'JUSTIFICATIVA_OBRIGATORIA'; end if;
  perform set_config('app.audit_note', btrim(p_note), true);
  update settings set manually_closed = p_closed where id;
end $$;

create function public.admin_log_export(p_rows integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  insert into audit_log(actor, actor_email, entity, action, new_data)
  values (auth.uid(), public._actor_email(), 'contribution', 'exportacao_csv', jsonb_build_object('linhas', p_rows));
end $$;

-- ---------- Row Level Security ----------
alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.gifts enable row level security;
alter table public.contributions enable row level security;
alter table public.contribution_items enable row level security;
alter table public.audit_log enable row level security;
alter table public.payment_events enable row level security;
alter table public.rate_limits enable row level security;

create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());
create policy gifts_public_read on public.gifts for select to anon, authenticated using (active);
create policy gifts_admin_all on public.gifts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_admin_read on public.settings for select to authenticated using (public.is_admin());
create policy contributions_admin_read on public.contributions for select to authenticated using (public.is_admin());
create policy items_admin_read on public.contribution_items for select to authenticated using (public.is_admin());
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());
create policy events_admin_read on public.payment_events for select to authenticated using (public.is_admin());
-- Sem políticas de escrita: contribuições, itens e eventos só mudam por funções SECURITY DEFINER.

-- ---------- Privilégios (menor privilégio) ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.gifts to anon, authenticated;
grant insert, update, delete on public.gifts to authenticated;
grant select on public.settings, public.contributions, public.contribution_items,
                public.audit_log, public.payment_events, public.admins to authenticated;

grant execute on function public.public_state() to anon, authenticated;
grant execute on function public.create_contribution(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_contribution(uuid, uuid) to anon, authenticated;
grant execute on function public.claim_payment(uuid, uuid) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_set_status(uuid, public.contribution_status, text) to authenticated;
grant execute on function public.admin_add_note(uuid, text) to authenticated;
grant execute on function public.admin_correct_contribution(uuid, text, text, text) to authenticated;
grant execute on function public.admin_update_settings(integer, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.admin_set_list_closed(boolean, text) to authenticated;
grant execute on function public.admin_log_export(integer) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on function public.attach_pix_charge(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.confirm_contribution_payment(text, text, text, text, integer, text) to service_role;

-- ---------- Dados iniciais ----------
insert into public.settings (id) values (true);

insert into public.gifts (title, description, price_cents, image_url, image_alt, sort_order) values
 ('Nosso primeiro café no Rio', 'Uma manhã tranquila à beira-mar, com café quente e nenhuma pressa.', 20000, 'img/cafe.svg', 'Xícara de café fumegante diante do mar', 10),
 ('Nosso encontro com o Cristo', 'Um dos cartões-postais mais bonitos do Rio, visto de pertinho.', 30000, 'img/cristo.svg', 'Ilustração do Cristo Redentor sobre o Corcovado', 20),
 ('Nosso passeio entre jardins', 'Um passeio sem pressa entre árvores e cantinhos do Parque Lage.', 20000, 'img/jardins.svg', 'Ilustração do palacete do Parque Lage entre palmeiras', 30),
 ('Uma vista para guardar na memória', 'Um mirante, o mar lá embaixo e uma lembrança que fica para sempre.', 40000, 'img/vista.svg', 'Ilustração do Pão de Açúcar sobre a baía', 40),
 ('Uma experiência nas alturas', 'Um momento lá no alto, para ver o Rio de um jeito diferente.', 50000, 'img/alturas.svg', 'Ilustração de uma asa-delta sobre a costa do Rio', 50),
 ('Uma noite da nossa lua de mel', 'Um descanso a dois, depois de dias cheios de passeios.', 60000, 'img/noite.svg', 'Ilustração noturna do Rio com lua crescente', 60),
 ('Um álbum de momentos felizes', 'Para revelar fotos, guardar lembranças e reviver cada instante da viagem.', 30000, 'img/album.svg', 'Ilustração de fotos coladas em um álbum', 70),
 ('Um jantar de celebração', 'Uma noite à mesa, só nós dois, para brindar o começo dessa história.', 50000, 'img/jantar.svg', 'Ilustração de duas taças brindando', 80),
 ('Nossa noite de sabores cariocas', 'Petiscos, bebidas e uma noite para provar o Rio com calma.', 20000, 'img/sabores.svg', 'Ilustração de uma caipirinha e petiscos', 90),
 ('Uma surpresa especial para os recém-casados', 'Uma lembrança escolhida com carinho para surpreender os dois.', 100000, 'img/surpresa.svg', 'Ilustração de um presente com laço dourado', 100),
 ('Conexão Salvador x Rio de Janeiro', 'Ajuda a levar a gente de Salvador até o Rio e a começar a viagem.', 140000, 'img/conexao.svg', 'Ilustração de um avião ligando Salvador ao Rio', 110);
