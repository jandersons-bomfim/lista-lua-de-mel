import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { friendlyError } from '../lib/api';
import { toCsv } from '../lib/csv';
import { formatDateTime, formatDeadlineLong, fromInputLocal, toInputLocal } from '../lib/dates';
import { centsToInput, formatBRL, formatPercent, percentOf, reaisToCents } from '../lib/money';
import { isConfigured, supabase } from '../lib/supabase';
import { STATUS_LABEL, type AdminContribution, type AdminSettings, type AuditEntry, type Gift, type Status } from '../lib/types';

type Tab = 'contribuicoes' | 'presentes' | 'config' | 'historico';
type Flash = { kind: 'ok' | 'err'; text: string } | null;

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = 'Painel · Lua de mel';
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setAllowed(null);
      return;
    }
    supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setAllowed(Boolean(data)));
  }, [session]);

  if (!isConfigured) return <p className="center-note">Configure as variáveis do Supabase (veja o README).</p>;
  if (!ready) return <p className="center-note">Carregando…</p>;
  if (!session) return <Login />;
  if (allowed === null) return <p className="center-note">Verificando permissão…</p>;
  if (!allowed)
    return (
      <div className="login">
        <h1>Sem permissão</h1>
        <p className="section__lead">Esta conta não está autorizada a acessar o painel.</p>
        <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    );
  return <Dashboard session={session} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <h1>Painel do casal</h1>
      <p className="section__lead">Acesso restrito.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          if (error) setError('E-mail ou senha incorretos.');
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <input id="senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="field__error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>('contribuicoes');
  const [rows, setRows] = useState<AdminContribution[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([
      supabase.from('contributions').select('*, contribution_items(title, unit_cents, quantity)').order('created_at', { ascending: false }),
      supabase.from('settings').select('*').maybeSingle(),
    ]);
    if (c.error) setFlash({ kind: 'err', text: friendlyError(c.error) });
    else setRows(c.data as AdminContribution[]);
    if (s.data) setSettings(s.data as AdminSettings);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const notify = (kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="admin">
      <div className="admin__top">
        <h1>Painel da lua de mel</h1>
        <div className="actions">
          <span className="fine">{session.user.email}</span>
          <button className="btn btn--ghost" onClick={() => void reload()}>Atualizar</button>
          <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </div>
      {flash && (
        <p className={`flash ${flash.kind === 'err' ? 'flash--err' : ''}`} role={flash.kind === 'err' ? 'alert' : 'status'}>{flash.text}</p>
      )}
      <div className="tabs" role="tablist" aria-label="Seções do painel">
        {(
          [
            ['contribuicoes', 'Contribuições'],
            ['presentes', 'Presentes'],
            ['config', 'Configurações'],
            ['historico', 'Histórico'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {loading ? (
        <p>Carregando…</p>
      ) : (
        <>
          {tab === 'contribuicoes' && <Contributions rows={rows} settings={settings} onChanged={reload} notify={notify} />}
          {tab === 'presentes' && <GiftsAdmin notify={notify} />}
          {tab === 'config' && settings && <SettingsAdmin settings={settings} onSaved={reload} notify={notify} />}
          {tab === 'historico' && <History />}
        </>
      )}
    </main>
  );
}

/* ---------------- Contribuições ---------------- */

type SortKey = 'created_at' | 'total_cents' | 'guest_name' | 'status';

function Contributions(props: {
  rows: AdminContribution[];
  settings: AdminSettings | null;
  onChanged: () => Promise<void>;
  notify: (k: 'ok' | 'err', t: string) => void;
}) {
  const { rows, settings } = props;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'todos' | Status>('todos');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);

  const stats = useMemo(() => {
    const sum = (s: Status) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.total_cents, 0);
    const n = (s: Status) => rows.filter((r) => r.status === s).length;
    const confirmed = sum('confirmada');
    return {
      confirmed,
      nConfirmed: n('confirmada'),
      nPending: n('aguardando_pagamento') + n('em_verificacao'),
      pendingValue: sum('aguardando_pagamento') + sum('em_verificacao'),
    };
  }, [rows]);

  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (status === 'todos' ? true : r.status === status))
      .filter((r) => !term || r.guest_name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term))
      .sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      });
  }, [rows, q, status, sort]);

  const th = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  async function exportCsv() {
    const header = ['Identificador', 'Convidado', 'Presentes', 'Valor total (R$)', 'Criada em', 'Status', 'ID da transação', 'Confirmada em', 'Confirmada por', 'Origem da confirmação', 'Mensagem'];
    const lines = view.map((r) => [
      r.code,
      r.guest_name,
      r.contribution_items.map((i) => `${i.quantity}x ${i.title}`).join(' | '),
      centsToInput(r.total_cents).replace('.', ','),
      formatDateTime(r.created_at),
      STATUS_LABEL[r.status],
      r.provider_payment_id ?? '',
      r.confirmed_at ? formatDateTime(r.confirmed_at) : '',
      r.confirmed_by ?? '',
      r.confirmation_source ?? '',
      r.message ?? '',
    ]);
    const blob = new Blob([toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `contribuicoes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    await supabase.rpc('admin_log_export', { p_rows: view.length });
  }

  const goal = settings?.goal_cents ?? 600000;
  const sel = rows.find((r) => r.id === selected) ?? null;

  return (
    <>
      <dl className="cards">
        <div className="card"><dt>Meta</dt><dd>{formatBRL(goal)}</dd></div>
        <div className="card"><dt>Total confirmado</dt><dd>{formatBRL(stats.confirmed)}</dd></div>
        <div className="card"><dt>Saldo restante</dt><dd>{formatBRL(Math.max(0, goal - stats.confirmed))}</dd></div>
        <div className="card"><dt>Percentual da meta</dt><dd>{formatPercent(percentOf(stats.confirmed, goal))}</dd></div>
        <div className="card"><dt>Confirmadas</dt><dd>{stats.nConfirmed}</dd></div>
        <div className="card"><dt>Pendentes</dt><dd>{stats.nPending}</dd></div>
        <div className="card"><dt>Aguardando confirmação</dt><dd>{formatBRL(stats.pendingValue)}</dd></div>
        <div className="card">
          <dt>Data limite</dt>
          <dd>{settings ? formatDeadlineLong(settings.deadline) : '—'}</dd>
          {settings?.manually_closed && <p className="fine">Lista encerrada manualmente</p>}
        </div>
      </dl>

      <div className="toolbar">
        <div>
          <label className="sr-only" htmlFor="busca">Buscar</label>
          <input id="busca" type="text" placeholder="Buscar por nome ou código" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="sr-only" htmlFor="filtro">Filtrar por status</label>
          <select id="filtro" value={status} onChange={(e) => setStatus(e.target.value as 'todos' | Status)}>
            <option value="todos">Todos os status</option>
            {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== 'em_selecao').map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <button className="btn btn--ghost" onClick={() => void exportCsv()}>Exportar CSV ({view.length})</button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Código</th>
              {th('guest_name', 'Convidado')}
              <th scope="col">Presentes</th>
              {th('total_cents', 'Valor')}
              {th('created_at', 'Criada em')}
              {th('status', 'Status')}
              <th scope="col">Transação</th>
              <th scope="col">Confirmada em</th>
              <th scope="col"><span className="sr-only">Detalhes</span></th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={9}>Nenhuma contribuição encontrada.</td></tr>
            )}
            {view.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td>{r.guest_name}</td>
                <td>{r.contribution_items.map((i) => `${i.quantity}× ${i.title}`).join('; ')}</td>
                <td>{formatBRL(r.total_cents)}</td>
                <td>{formatDateTime(r.created_at)}</td>
                <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td className="mono">{r.provider_payment_id ?? '—'}</td>
                <td>{r.confirmed_at ? formatDateTime(r.confirmed_at) : '—'}</td>
                <td><button className="link" onClick={() => setSelected(r.id)}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && <Detail row={sel} onClose={() => setSelected(null)} onChanged={props.onChanged} notify={props.notify} />}
    </>
  );
}

function Detail(props: {
  row: AdminContribution;
  onClose: () => void;
  onChanged: () => Promise<void>;
  notify: (k: 'ok' | 'err', t: string) => void;
}) {
  const { row, notify } = props;
  const [note, setNote] = useState('');
  const [name, setName] = useState(row.guest_name);
  const [msg, setMsg] = useState(row.message ?? '');
  const [hist, setHist] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const loadHist = useCallback(async () => {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .eq('entity', 'contribution')
      .eq('entity_id', row.id)
      .order('at', { ascending: false });
    setHist((data ?? []) as AuditEntry[]);
  }, [row.id]);

  useEffect(() => {
    setName(row.guest_name);
    setMsg(row.message ?? '');
    setNote('');
    void loadHist();
  }, [row.id, row.guest_name, row.message, row.status, loadHist]);

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>, confirmText?: string) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return notify('err', friendlyError(error));
    setNote('');
    notify('ok', `${label} registrado no histórico.`);
    await props.onChanged();
    await loadHist();
  }

  const setStatus = (s: Status, label: string, confirmText: string) =>
    run(label, () => supabase.rpc('admin_set_status', { p_id: row.id, p_status: s, p_note: note }), confirmText);

  const st = row.status;
  const noteOk = note.trim().length >= 3;

  return (
    <section className="detail" aria-labelledby="det-titulo">
      <div className="admin__top">
        <h2 id="det-titulo">{row.code} · {row.guest_name}</h2>
        <button className="btn btn--ghost" onClick={props.onClose}>Fechar</button>
      </div>
      <div className="detail__grid">
        <div>
          <p><span className={`pill pill--${st}`}>{STATUS_LABEL[st]}</span></p>
          <p><strong>{formatBRL(row.total_cents)}</strong> · criada em {formatDateTime(row.created_at)}</p>
          <ul>{row.contribution_items.map((i) => <li key={i.title}>{i.quantity}× {i.title} ({formatBRL(i.unit_cents)})</li>)}</ul>
          {row.message && <p className="fine">Mensagem: “{row.message}”</p>}
          {row.provider_payment_id && <p className="fine">Transação: <span className="mono">{row.provider_payment_id}</span> ({row.provider})</p>}
          {row.confirmed_at && (
            <p className="fine">Confirmada em {formatDateTime(row.confirmed_at)} por {row.confirmed_by} ({row.confirmation_source === 'manual' ? 'manual' : 'automática'})</p>
          )}
        </div>
        <div>
          <div className="field">
            <label htmlFor="nota">Justificativa / observação (obrigatória para mudar o status)</label>
            <textarea id="nota" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: conferido no extrato do banco, Pix de R$ 500,00 às 14h10" />
          </div>
          <div className="actions">
            {(st === 'aguardando_pagamento' || st === 'em_verificacao' || st === 'expirada' || st === 'cancelada') && (
              <button className="btn btn--primary" disabled={busy || !noteOk}
                onClick={() => setStatus('confirmada', 'Confirmação manual', `Confirmar ${formatBRL(row.total_cents)} de ${row.guest_name}?\nUse somente após conferir o recebimento no extrato.`)}>
                Confirmar pagamento
              </button>
            )}
            {(st === 'aguardando_pagamento' || st === 'em_verificacao') && (
              <>
                <button className="btn btn--ghost" disabled={busy || !noteOk}
                  onClick={() => setStatus('expirada', 'Expiração', 'Marcar esta contribuição como expirada?')}>Marcar como expirada</button>
                <button className="btn btn--danger" disabled={busy || !noteOk}
                  onClick={() => setStatus('cancelada', 'Cancelamento', 'Cancelar esta contribuição?')}>Cancelar contribuição</button>
              </>
            )}
            {(st === 'expirada' || st === 'cancelada') && (
              <button className="btn btn--ghost" disabled={busy || !noteOk}
                onClick={() => setStatus('aguardando_pagamento', 'Reativação', 'Reativar como “aguardando pagamento”? A mudança ficará registrada.')}>Reativar (aguardando pagamento)</button>
            )}
            {st === 'confirmada' && (
              <button className="btn btn--danger" disabled={busy || !noteOk}
                onClick={() => setStatus('em_verificacao', 'Desfazer confirmação', 'Desfazer a confirmação? O valor deixa de contar na meta. Use só para corrigir um engano.')}>Desfazer confirmação</button>
            )}
            <button className="btn btn--ghost" disabled={busy || note.trim().length < 1}
              onClick={() => run('Observação', () => supabase.rpc('admin_add_note', { p_id: row.id, p_note: note }))}>Salvar observação</button>
          </div>
          <details>
            <summary>Corrigir nome ou mensagem</summary>
            <div className="field"><label htmlFor="cn">Nome</label><input id="cn" type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="cm">Mensagem</label><textarea id="cm" rows={2} value={msg} maxLength={500} onChange={(e) => setMsg(e.target.value)} /></div>
            <button className="btn btn--ghost" disabled={busy || !noteOk || !name.trim()}
              onClick={() => run('Correção', () => supabase.rpc('admin_correct_contribution', { p_id: row.id, p_guest_name: name, p_message: msg, p_note: note }))}>
              Salvar correção (usa a justificativa acima)
            </button>
          </details>
        </div>
      </div>
      <h3 className="serif h3">Histórico de alterações</h3>
      <ul className="hist">
        {hist.length === 0 && <li>Sem registros.</li>}
        {hist.map((h) => (
          <li key={h.id}>
            <strong>{formatDateTime(h.at)}</strong> · {describe(h)} · {h.actor_email ?? 'sistema'}
            {h.note && <> — “{h.note}”</>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function describe(h: AuditEntry): string {
  if (h.action === 'status') {
    const o = (h.old_data?.status as Status | undefined) ?? '?';
    const n = (h.new_data?.status as Status | undefined) ?? '?';
    return `status: ${STATUS_LABEL[o as Status] ?? o} → ${STATUS_LABEL[n as Status] ?? n}`;
  }
  const map: Record<string, string> = {
    criada: 'contribuição criada',
    observacao: 'observação',
    correcao: 'correção de dados',
    exportacao_csv: 'exportação CSV',
  };
  return map[h.action] ?? h.action;
}

/* ---------------- Presentes (cotas) ---------------- */

interface GiftDraft { id: string | null; title: string; description: string; price: string; image_url: string; image_alt: string; sort_order: string; active: boolean }
const toDraft = (g: Gift): GiftDraft => ({
  id: g.id, title: g.title, description: g.description, price: centsToInput(g.price_cents), image_url: g.image_url ?? '',
  image_alt: g.image_alt, sort_order: String(g.sort_order), active: g.active,
});

function GiftsAdmin({ notify }: { notify: (k: 'ok' | 'err', t: string) => void }) {
  const [drafts, setDrafts] = useState<GiftDraft[]>([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('gifts').select('*').order('sort_order');
    if (error) return notify('err', friendlyError(error));
    setDrafts((data as Gift[]).map(toDraft));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const patch = (i: number, p: Partial<GiftDraft>) => setDrafts((d) => d.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function save(d: GiftDraft) {
    const cents = reaisToCents(d.price);
    if (!d.title.trim() || cents === null || cents <= 0) return notify('err', 'Informe um título e um valor válido (ex.: 150 ou 1.000,50).');
    const payload = {
      title: d.title.trim(), description: d.description.trim(), price_cents: cents, image_url: d.image_url.trim() || null,
      image_alt: d.image_alt.trim(), sort_order: parseInt(d.sort_order || '0', 10) || 0, active: d.active,
    };
    const { error } = d.id ? await supabase.from('gifts').update(payload).eq('id', d.id) : await supabase.from('gifts').insert(payload);
    if (error) return notify('err', friendlyError(error));
    notify('ok', 'Cota salva. Contribuições já registradas mantêm o valor original.');
    await load();
  }

  return (
    <>
      <p className="section__lead">Edite títulos, descrições, valores e imagens. Para tirar uma cota da lista, desmarque “Visível”: contribuições já feitas continuam intactas.</p>
      {drafts.map((d, i) => (
        <div className="giftrow" key={d.id ?? `new-${i}`}>
          <div className="formgrid two">
            <div className="field"><label htmlFor={`t${i}`}>Título</label><input id={`t${i}`} type="text" value={d.title} maxLength={120} onChange={(e) => patch(i, { title: e.target.value })} /></div>
            <div className="field"><label htmlFor={`p${i}`}>Valor (R$)</label><input id={`p${i}`} type="text" inputMode="decimal" value={d.price} onChange={(e) => patch(i, { price: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor={`d${i}`}>Descrição</label><textarea id={`d${i}`} rows={2} value={d.description} maxLength={400} onChange={(e) => patch(i, { description: e.target.value })} /></div>
          <div className="formgrid two">
            <div className="field"><label htmlFor={`i${i}`}>Endereço da imagem</label><input id={`i${i}`} type="text" value={d.image_url} placeholder="img/cafe.svg ou https://…" onChange={(e) => patch(i, { image_url: e.target.value })} /></div>
            <div className="field"><label htmlFor={`a${i}`}>Texto alternativo da imagem</label><input id={`a${i}`} type="text" value={d.image_alt} maxLength={200} onChange={(e) => patch(i, { image_alt: e.target.value })} /></div>
          </div>
          <div className="formgrid two">
            <div className="field"><label htmlFor={`o${i}`}>Ordem</label><input id={`o${i}`} type="number" value={d.sort_order} onChange={(e) => patch(i, { sort_order: e.target.value })} /></div>
            <div className="field"><label><input type="checkbox" checked={d.active} onChange={(e) => patch(i, { active: e.target.checked })} /> Visível na lista</label></div>
          </div>
          <div className="actions"><button className="btn btn--primary" onClick={() => void save(d)}>Salvar cota</button></div>
        </div>
      ))}
      <button className="btn btn--ghost" onClick={() => setDrafts((d) => [...d, { id: null, title: '', description: '', price: '', image_url: '', image_alt: '', sort_order: String((d.length + 1) * 10), active: true }])}>
        Adicionar cota
      </button>
    </>
  );
}

/* ---------------- Configurações ---------------- */

function SettingsAdmin(props: { settings: AdminSettings; onSaved: () => Promise<void>; notify: (k: 'ok' | 'err', t: string) => void }) {
  const { settings, notify } = props;
  const [goal, setGoal] = useState(centsToInput(settings.goal_cents));
  const [deadline, setDeadline] = useState(toInputLocal(settings.deadline));
  const [mode, setMode] = useState(settings.pix_mode);
  const [key, setKey] = useState(settings.pix_key ?? '');
  const [rname, setRname] = useState(settings.pix_receiver_name ?? '');
  const [rcity, setRcity] = useState(settings.pix_receiver_city ?? '');
  const [note, setNote] = useState('');
  const [closeNote, setCloseNote] = useState('');

  async function save() {
    const cents = reaisToCents(goal);
    if (cents === null || cents <= 0) return notify('err', 'Informe uma meta válida (ex.: 6.000,00).');
    let iso: string;
    try { iso = fromInputLocal(deadline); } catch { return notify('err', 'Informe uma data limite válida.'); }
    const { error } = await supabase.rpc('admin_update_settings', {
      p_goal_cents: cents, p_deadline: iso, p_pix_mode: mode, p_pix_key: key, p_receiver_name: rname, p_receiver_city: rcity, p_note: note,
    });
    if (error) return notify('err', friendlyError(error));
    setNote('');
    notify('ok', 'Configurações salvas e registradas no histórico.');
    await props.onSaved();
  }

  async function toggleClosed() {
    const closing = !settings.manually_closed;
    if (!window.confirm(closing ? 'Encerrar a lista agora? Ninguém mais poderá contribuir.' : 'Reabrir a lista? (respeita a data limite)')) return;
    const { error } = await supabase.rpc('admin_set_list_closed', { p_closed: closing, p_note: closeNote });
    if (error) return notify('err', friendlyError(error));
    setCloseNote('');
    notify('ok', closing ? 'Lista encerrada.' : 'Lista reaberta.');
    await props.onSaved();
  }

  return (
    <div className="formgrid">
      <div className="field"><label htmlFor="meta">Meta (R$)</label><input id="meta" type="text" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="prazo">Data e horário finais (horário de Salvador)</label>
        <input id="prazo" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <p className="fine">Inicialmente 05/01/2027 às 23:59.</p>
      </div>
      <fieldset className="field">
        <legend>Pix</legend>
        <div className="field">
          <label htmlFor="modo">Modo</label>
          <select id="modo" value={mode} onChange={(e) => setMode(e.target.value as 'static' | 'dynamic')}>
            <option value="static">Pix estático (confirmação manual)</option>
            <option value="dynamic">Pix dinâmico (confirmação automática — exige configurar o provedor)</option>
          </select>
          {mode === 'dynamic' && <p className="fine">Só ative depois de publicar as Edge Functions e cadastrar as credenciais (veja docs/PIX.md). Sem isso, os convidados verão erro ao gerar o Pix.</p>}
        </div>
        <div className="field"><label htmlFor="chave">Chave Pix do casal</label><input id="chave" type="text" value={key} maxLength={77} onChange={(e) => setKey(e.target.value)} placeholder="e-mail, CPF, celular (+5571…) ou chave aleatória" /></div>
        <div className="formgrid two">
          <div className="field"><label htmlFor="rn">Nome do recebedor (até 25)</label><input id="rn" type="text" value={rname} maxLength={25} onChange={(e) => setRname(e.target.value)} /></div>
          <div className="field"><label htmlFor="rc">Cidade (até 15)</label><input id="rc" type="text" value={rcity} maxLength={15} onChange={(e) => setRcity(e.target.value)} /></div>
        </div>
      </fieldset>
      <div className="field"><label htmlFor="sn">Motivo da alteração (fica no histórico)</label><input id="sn" type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="actions"><button className="btn btn--primary" onClick={() => void save()}>Salvar configurações</button></div>

      <hr />
      <h2 className="serif h3">{settings.manually_closed ? 'A lista está encerrada manualmente' : 'Encerrar a lista antes do prazo'}</h2>
      <div className="field"><label htmlFor="cn2">Justificativa</label><input id="cn2" type="text" value={closeNote} maxLength={200} onChange={(e) => setCloseNote(e.target.value)} /></div>
      <div className="actions">
        <button className={`btn ${settings.manually_closed ? 'btn--primary' : 'btn--danger'}`} disabled={closeNote.trim().length < 3} onClick={() => void toggleClosed()}>
          {settings.manually_closed ? 'Reabrir lista' : 'Encerrar lista agora'}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Histórico geral ---------------- */

function History() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => {
    supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300).then(({ data }) => setRows((data ?? []) as AuditEntry[]));
  }, []);
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">Onde</th><th scope="col">O quê</th><th scope="col">Justificativa</th></tr></thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{formatDateTime(h.at)}</td>
              <td>{h.actor_email ?? 'sistema'}</td>
              <td>{h.entity}</td>
              <td>{describe(h)}</td>
              <td>{h.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
