import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  attemptKey,
  claimPayment,
  clearAttempt,
  clearStoredContribution,
  createContribution,
  fetchGifts,
  fetchPublicState,
  friendlyError,
  getContribution,
  loadStoredContribution,
  requestDynamicCharge,
  storeContribution,
} from '../lib/api';
import { cartCount, cartLines, cartTotal, loadCart, pruneCart, saveCart, setQty, toRpcItems, type Cart } from '../lib/cart';
import { formatDeadlineLong } from '../lib/dates';
import { clampPercent, formatBRL, formatPercent, percentOf } from '../lib/money';
import { resolveAsset } from '../lib/assets';
import { buildStaticPix } from '../lib/pix';
import { isConfigured } from '../lib/supabase';
import type { ContributionView, Gift, PublicState } from '../lib/types';

type Step = 'browse' | 'identify' | 'pix';

const TRIP = [
  { title: 'Copacabana', text: 'Passeios sem pressa pela orla, de manhã e ao fim do dia.', img: 'img/copacabana.svg', alt: 'Orla de Copacabana' },
  { title: 'Cristo Redentor', text: 'O Rio visto lá de cima, bem pertinho do céu.', img: 'img/cristo.svg', alt: 'Cristo Redentor' },
  { title: 'Parque Lage', text: 'Jardins, sombra e cantinhos para caminhar de mãos dadas.', img: 'img/jardins.svg', alt: 'Parque Lage' },
  { title: 'Bondinho do Pão de Açúcar', text: 'Uma vista inesquecível sobre a baía.', img: 'img/vista.svg', alt: 'Bondinho do Pão de Açúcar' },
  { title: 'Momentos a dois', text: 'Boa comida, boa conversa e tempo para nós.', img: 'img/jantar.svg', alt: 'Mesa posta para dois' },
];

const SHARE_TEXT =
  'Preparamos uma lista especial para a nossa lua de mel! Se quiser nos presentear, você pode escolher uma das experiências da nossa viagem pelo link abaixo. Cada contribuição será recebida com muito carinho. ❤️\n\nLhaiany & Janderson\n\n';

/* ------------------------------------------------------------------ */
/* Peças reutilizáveis                                                 */
/* ------------------------------------------------------------------ */

function Photo({ src: rawSrc, fallback, alt, className = '' }: { src: string | null; fallback?: string; alt: string; className?: string }) {
  const [stage, setStage] = useState(0); // 0 = imagem principal, 1 = alternativa, 2 = quadro vazio
  const failed = stage >= (fallback ? 2 : 1);
  const src = resolveAsset(stage === 0 ? rawSrc : fallback);
  if (!src || failed) {
    return (
      <div className={`photo photo--empty ${className}`} role="img" aria-label={alt || 'Imagem ilustrativa'}>
        <svg viewBox="0 0 64 40" aria-hidden="true" focusable="false">
          <path d="M2 34h60M8 34c6-14 12-14 18 0M22 34c8-22 16-22 24 0M40 34c4-9 9-9 14 0" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="50" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    );
  }
  return <img className={`photo ${className}`} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setStage((n) => n + 1)} />;
}

function Stepper({ label, qty, onChange }: { label: string; qty: number; onChange: (q: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={`Quantidade de ${label}`}>
      <button type="button" className="stepper__btn" onClick={() => onChange(qty - 1)} aria-label={`Diminuir quantidade de ${label}`}>
        −
      </button>
      <span className="stepper__qty" aria-live="polite">{qty}</span>
      <button type="button" className="stepper__btn" onClick={() => onChange(qty + 1)} aria-label={`Aumentar quantidade de ${label}`}>
        +
      </button>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function ShareButtons() {
  const [copied, setCopied] = useState(false);
  const url = window.location.origin + window.location.pathname; // sem o #/admin, funciona em subpasta do GitHub Pages
  const wa = `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + url)}`;
  return (
    <div className="share">
      <a className="btn btn--ghost" href={wa} target="_blank" rel="noopener noreferrer">
        Compartilhar lista pelo WhatsApp
      </a>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={async () => {
          if (await copyText(url)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          }
        }}
      >
        {copied ? 'Link copiado' : 'Copiar link'}
      </button>
      <span className="sr-only" role="status">{copied ? 'Link copiado para a área de transferência' : ''}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function Public() {
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [pub, setPub] = useState<PublicState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(() => loadCart());
  const [step, setStep] = useState<Step>('browse');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [view, setView] = useState<ContributionView | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([fetchGifts(), fetchPublicState()]);
      setGifts(g);
      setPub(s);
      setCart((c) => pruneCart(c, g));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    void load();
    const stored = loadStoredContribution();
    if (stored) {
      getContribution(stored.id, stored.client_key)
        .then((v) => {
          setView(v);
          setClientKey(stored.client_key);
          setStep('pix');
        })
        .catch(() => clearStoredContribution());
    }
  }, [load]);

  useEffect(() => saveCart(cart), [cart]);

  // Acompanha o status real enquanto a contribuição está pendente.
  useEffect(() => {
    if (step !== 'pix' || !view || !clientKey) return;
    if (view.status !== 'aguardando_pagamento' && view.status !== 'em_verificacao') return;
    const t = setInterval(async () => {
      try {
        const v = await getContribution(view.id, clientKey);
        setView(v);
        if (v.status === 'confirmada') void load();
      } catch {
        /* falha de rede momentânea: tenta no próximo ciclo */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [step, view, clientKey, load]);

  const open = pub?.is_open ?? false;
  const total = useMemo(() => (gifts ? cartTotal(cart, gifts) : 0), [cart, gifts]);
  const count = cartCount(cart);
  const lines = useMemo(() => (gifts ? cartLines(cart, gifts) : []), [cart, gifts]);

  const changeQty = (id: string, q: number) => setCart((c) => setQty(c, id, q));

  async function startContribution() {
    if (busy || !gifts || !pub) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Conte para nós quem está presenteando.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setError(null);
    setBusy(true);
    try {
      const items = toRpcItems(cart);
      const signature = JSON.stringify([trimmed, message.trim(), [...items].sort((a, b) => a.gift_id.localeCompare(b.gift_id))]);
      const key = attemptKey(signature);
      let v = await createContribution(key, trimmed, message.trim(), items);
      storeContribution({ id: v.id, client_key: key });
      setClientKey(key);
      clearAttempt();
      setCart({});
      setPanelOpen(false);
      setView(v);
      setStep('pix');
      window.scrollTo({ top: 0 });
      if (pub.pix_mode === 'dynamic' && !v.pix_copia_cola) {
        try {
          await requestDynamicCharge(v.id, key);
          v = await getContribution(v.id, key);
          setView(v);
        } catch (e) {
          setError(friendlyError(e));
        }
      }
    } catch (e) {
      setError(friendlyError(e));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function retryCharge() {
    if (!view || !clientKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestDynamicCharge(view.id, clientKey);
      setView(await getContribution(view.id, clientKey));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function iPaid() {
    if (!view || !clientKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      setView(await claimPayment(view.id, clientKey));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function backToList() {
    clearStoredContribution();
    clearAttempt();
    setView(null);
    setClientKey(null);
    setError(null);
    setStep('browse');
    void load();
    window.scrollTo({ top: 0 });
  }

  if (!isConfigured) {
    return (
      <main className="shell">
        <p className="center-note">
          Faltam as variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>. Veja o README para configurar o banco de dados.
        </p>
      </main>
    );
  }

  const deadlineText = pub ? formatDeadlineLong(pub.deadline) : '05 de janeiro de 2027';

  return (
    <>
      <a className="skip" href="#conteudo">Ir para o conteúdo</a>
      <main id="conteudo" className={`shell ${step === 'browse' && open && count > 0 ? 'has-bar' : ''}`}>
        {step === 'browse' && (
          <>
            <Hero />
            <Trip />
            <Goal pub={pub} loadError={loadError} onRetry={load} />
            <GiftsSection
              gifts={gifts}
              loadError={loadError}
              cart={cart}
              open={open}
              deadlineText={deadlineText}
              onQty={changeQty}
              onRetry={load}
              hasState={Boolean(pub)}
            />
            <footer className="footer">
              <Skyline />
              <p className="serif footer__names">Lhaiany &amp; Janderson</p>
              <ShareButtons />
            </footer>
          </>
        )}

        {step === 'identify' && (
          <Identify
            name={name}
            message={message}
            nameError={nameError}
            nameRef={nameRef}
            lines={lines}
            total={total}
            busy={busy}
            error={error}
            onName={(v) => {
              setName(v);
              if (v.trim()) setNameError(null);
            }}
            onMessage={setMessage}
            onBack={() => setStep('browse')}
            onSubmit={startContribution}
          />
        )}

        {step === 'pix' && view && (
          <PixStep
            view={view}
            pub={pub}
            busy={busy}
            error={error}
            onRetryCharge={retryCharge}
            onPaid={iPaid}
            onBack={backToList}
          />
        )}
      </main>

      {step === 'browse' && open && count > 0 && (
        <SummaryBar
          lines={lines}
          total={total}
          count={count}
          openPanel={panelOpen}
          onToggle={() => setPanelOpen((v) => !v)}
          onQty={changeQty}
          onContinue={() => {
            setPanelOpen(false);
            setStep('identify');
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Seções                                                              */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <header className="hero">
      <p className="hero__names serif">Lhaiany &amp; Janderson</p>
      <span className="rule" aria-hidden="true" />
      <h1 className="hero__title serif">Nossa lua de mel, com um pouquinho de vocês.</h1>
      <p className="hero__lead">
        Depois de celebrar nosso casamento, queremos viver dias especiais no Rio de Janeiro. Em vez de presentes para a casa, escolhemos
        reunir contribuições para nossa viagem e transformar esse carinho em experiências e memórias.
      </p>
      <p className="hero__meta">
        <strong>Lua de mel no Rio de Janeiro</strong>
        <span>27 a 31 de janeiro de 2027</span>
      </p>
      <Photo className="arch" src="img/casal.jpg" fallback="img/copacabana.svg" alt="Lhaiany e Janderson; ilustração da orla de Copacabana, no Rio de Janeiro" />
    </header>
  );
}

function Skyline() {
  return (
    <svg className="skyline" viewBox="0 0 600 70" role="presentation" aria-hidden="true" focusable="false">
      <path d="M0 62 H120 C126 40 150 30 176 36 L182 62 H196 C198 34 220 14 246 14 C272 14 284 36 288 62 H340 L352 56 L366 62 H404 L412 20 M392 34 H432 M412 20 V62 H600" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M150 32 L232 18" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" fill="none" />
    </svg>
  );
}

function Trip() {
  return (
    <section className="section" aria-labelledby="viagem">
      <h2 id="viagem" className="serif h2">Nossa viagem</h2>
      <p className="section__lead">
        Cinco dias para caminhar sem pressa, conhecer lugares novos e aproveitar o começo da nossa vida juntos.
      </p>
      <ul className="trip">
        {TRIP.map((t) => (
          <li key={t.title} className="trip__item">
            <Photo src={t.img} alt={t.alt} className="trip__img" />
            <h3 className="serif h3">{t.title}</h3>
            <p>{t.text}</p>
          </li>
        ))}
      </ul>
      <p className="fine">
        As imagens são ilustrativas. Os passeios dependerão do orçamento final e das condições da viagem; nada está reservado ou pago por enquanto.
      </p>
    </section>
  );
}

function Goal({ pub, loadError, onRetry }: { pub: PublicState | null; loadError: string | null; onRetry: () => void }) {
  if (!pub) {
    return (
      <section className="section" aria-labelledby="meta">
        <h2 id="meta" className="serif h2">Nosso sonho: R$ 6.000,00</h2>
        {loadError ? (
          <div className="notice" role="alert">
            <p>{loadError}</p>
            <button className="btn btn--ghost" onClick={onRetry}>Tentar novamente</button>
          </div>
        ) : (
          <p className="section__lead">Carregando…</p>
        )}
      </section>
    );
  }
  const pct = percentOf(pub.confirmed_cents, pub.goal_cents);
  const remaining = Math.max(0, pub.goal_cents - pub.confirmed_cents);
  return (
    <section className="section" aria-labelledby="meta">
      <h2 id="meta" className="serif h2">Nosso sonho: {formatBRL(pub.goal_cents)}</h2>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampPercent(pct))}
        aria-label="Progresso da meta da lua de mel"
      >
        <span className="progress__bar" style={{ width: `${clampPercent(pct)}%` }} />
      </div>
      <dl className="goal">
        <div>
          <dt>Recebido e confirmado</dt>
          <dd>{formatBRL(pub.confirmed_cents)}</dd>
        </div>
        <div>
          <dt>Falta para a meta</dt>
          <dd>{formatBRL(remaining)}</dd>
        </div>
        <div>
          <dt>Arrecadado</dt>
          <dd>{formatPercent(pct)}</dd>
        </div>
      </dl>
      {pub.confirmed_cents >= pub.goal_cents && <p className="fine">Meta alcançada. Obrigado por tanto carinho!</p>}
      <p className="fine">Contam apenas as contribuições já confirmadas.</p>
    </section>
  );
}

function GiftsSection(props: {
  gifts: Gift[] | null;
  loadError: string | null;
  cart: Cart;
  open: boolean;
  hasState: boolean;
  deadlineText: string;
  onQty: (id: string, q: number) => void;
  onRetry: () => void;
}) {
  const { gifts, cart, open, deadlineText, onQty, loadError, onRetry, hasState } = props;
  return (
    <section className="section" aria-labelledby="presentes">
      <h2 id="presentes" className="serif h2">Escolha um pedacinho da nossa viagem</h2>
      <p className="section__lead">
        Cada contribuição é uma maneira de fazer parte dessa nova etapa da nossa história. Escolha um ou mais presentes e ajude a tornar
        nossa lua de mel ainda mais especial.
      </p>
      {hasState && open && <p className="deadline">Contribuições até {deadlineText}.</p>}

      {hasState && !open && (
        <div className="notice notice--soft" role="status">
          <p className="serif notice__title">A lista foi encerrada</p>
          <p>
            O prazo para contribuir terminou. Cada gesto de carinho já recebido nos emociona, e todos eles farão parte das lembranças dessa viagem.
            Obrigado por fazer parte da nossa história.
          </p>
        </div>
      )}

      {loadError && (
        <div className="notice" role="alert">
          <p>{loadError}</p>
          <button className="btn btn--ghost" onClick={onRetry}>Tentar novamente</button>
        </div>
      )}
      {!gifts && !loadError && <p className="section__lead">Carregando presentes…</p>}

      <ul className="gifts">
        {gifts?.map((g) => {
          const qty = cart[g.id] ?? 0;
          return (
            <li key={g.id} className={`gift ${qty > 0 ? 'is-selected' : ''}`}>
              <Photo src={g.image_url} alt={g.image_alt} className="gift__img" />
              <div className="gift__body">
                <h3 className="serif h3">{g.title}</h3>
                <p className="gift__desc">{g.description}</p>
                <div className="gift__foot">
                  <span className="price">{formatBRL(g.price_cents)}</span>
                  {qty === 0 ? (
                    <button type="button" className="btn btn--primary" disabled={!open} onClick={() => onQty(g.id, 1)} aria-label={`Escolher presente: ${g.title}`}>
                      Escolher presente
                    </button>
                  ) : (
                    <div className="gift__sel">
                      <span className="badge">
                        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                        Escolhido
                      </span>
                      <Stepper label={g.title} qty={qty} onChange={(q) => onQty(g.id, q)} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="fine">
        Os valores são simbólicos: representam contribuições para a viagem como um todo, não preços exatos de passeios ou serviços.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Resumo fixo                                                         */
/* ------------------------------------------------------------------ */

type Lines = ReturnType<typeof cartLines>;

function SummaryBar(props: {
  lines: Lines;
  total: number;
  count: number;
  openPanel: boolean;
  onToggle: () => void;
  onQty: (id: string, q: number) => void;
  onContinue: () => void;
}) {
  const { lines, total, count, openPanel, onToggle, onQty, onContinue } = props;
  return (
    <aside className="bar" aria-label="Resumo dos presentes">
      {openPanel && (
        <div className="bar__panel" id="resumo-painel">
          <h2 className="serif h3">Resumo dos presentes</h2>
          <ul className="sum">
            {lines.map(({ gift, quantity, subtotal }) => (
              <li key={gift.id} className="sum__row">
                <div>
                  <p className="sum__title">{gift.title}</p>
                  <p className="sum__meta">{quantity} × {formatBRL(gift.price_cents)} = <strong>{formatBRL(subtotal)}</strong></p>
                </div>
                <div className="sum__actions">
                  <Stepper label={gift.title} qty={quantity} onChange={(q) => onQty(gift.id, q)} />
                  <button type="button" className="link" onClick={() => onQty(gift.id, 0)} aria-label={`Remover ${gift.title}`}>Remover</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="bar__row">
        <button type="button" className="bar__toggle" aria-expanded={openPanel} aria-controls="resumo-painel" onClick={onToggle}>
          <span className="bar__count">{count} {count === 1 ? 'presente' : 'presentes'}</span>
          <span className="bar__total" aria-live="polite">{formatBRL(total)}</span>
          <span className="bar__hint">{openPanel ? 'Ocultar resumo' : 'Ver resumo'}</span>
        </button>
        <button type="button" className="btn btn--primary" onClick={onContinue}>Continuar para presentear</button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Identificação                                                       */
/* ------------------------------------------------------------------ */

function Identify(props: {
  name: string;
  message: string;
  nameError: string | null;
  nameRef: React.RefObject<HTMLInputElement>;
  lines: Lines;
  total: number;
  busy: boolean;
  error: string | null;
  onName: (v: string) => void;
  onMessage: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { name, message, nameError, nameRef, lines, total, busy, error } = props;
  return (
    <section className="flow" aria-labelledby="id-titulo">
      <button type="button" className="link link--back" onClick={props.onBack}>← Voltar para a lista</button>
      <h1 id="id-titulo" className="serif h1">Quem está presenteando?</h1>
      <p className="section__lead">Usamos esses dados apenas para organizar as contribuições e agradecer com carinho.</p>

      <ul className="sum sum--static" aria-label="Presentes escolhidos">
        {lines.map(({ gift, quantity, subtotal }) => (
          <li key={gift.id} className="sum__row">
            <p className="sum__title">{quantity} × {gift.title}</p>
            <p className="sum__meta">{formatBRL(subtotal)}</p>
          </li>
        ))}
        <li className="sum__row sum__row--total"><p className="sum__title">Total da contribuição</p><p className="sum__total">{formatBRL(total)}</p></li>
      </ul>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <div className="field">
          <label htmlFor="nome">Seu nome ou o da sua família</label>
          <input
            id="nome"
            ref={nameRef}
            name="nome"
            type="text"
            autoComplete="name"
            maxLength={120}
            required
            value={name}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'nome-erro' : undefined}
            onChange={(e) => props.onName(e.target.value)}
          />
          {nameError && <p id="nome-erro" className="field__error" role="alert">{nameError}</p>}
        </div>
        <div className="field">
          <label htmlFor="mensagem">Mensagem para o casal <span className="opt">(opcional)</span></label>
          <textarea id="mensagem" name="mensagem" rows={4} maxLength={500} value={message} onChange={(e) => props.onMessage(e.target.value)} />
          <p className="fine">{message.length}/500</p>
        </div>
        {error && <p className="field__error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Registrando…' : 'Continuar para o Pix'}
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pix                                                                 */
/* ------------------------------------------------------------------ */

function PixStep(props: {
  view: ContributionView;
  pub: PublicState | null;
  busy: boolean;
  error: string | null;
  onRetryCharge: () => void;
  onPaid: () => void;
  onBack: () => void;
}) {
  const { view, pub, busy, error } = props;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = view.status === 'aguardando_pagamento' || view.status === 'em_verificacao';

  // Dinâmico: código do provedor. Estático: BR Code gerado com a chave real do casal e o valor exato.
  const staticCode = useMemo(() => {
    if (!pub || pub.pix_mode !== 'static' || !pub.pix_key || !pub.pix_receiver_name || !pub.pix_receiver_city) return null;
    try {
      return buildStaticPix({
        key: pub.pix_key,
        receiverName: pub.pix_receiver_name,
        receiverCity: pub.pix_receiver_city,
        amountCents: view.total_cents,
        reference: view.code,
      });
    } catch {
      return null;
    }
  }, [pub, view.total_cents, view.code]);
  const code = view.pix_copia_cola ?? staticCode;
  const isManual = !view.pix_copia_cola && Boolean(staticCode);

  useEffect(() => {
    let alive = true;
    if (!code || !pending) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(code, { margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#2B1D19', light: '#FFFFFF' } })
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [code, pending]);

  return (
    <section className="flow" aria-labelledby="pix-titulo">
      <h1 id="pix-titulo" className="serif h1">Seu presente para a nossa lua de mel</h1>

      <div className="receipt">
        <p className="receipt__who">{view.guest_name}</p>
        <ul className="sum sum--static" aria-label="Presentes escolhidos">
          {view.items.map((i) => (
            <li key={i.title} className="sum__row">
              <p className="sum__title">{i.quantity} × {i.title}</p>
              <p className="sum__meta">{formatBRL(i.quantity * i.unit_cents)}</p>
            </li>
          ))}
          <li className="sum__row sum__row--total"><p className="sum__title">Total</p><p className="sum__total">{formatBRL(view.total_cents)}</p></li>
        </ul>
        <p className="fine">Identificador da contribuição: <strong className="mono">{view.code}</strong></p>
        <p className={`status status--${view.status}`} role="status">
          Status: <strong>{statusText(view.status)}</strong>
        </p>
      </div>

      {view.status === 'confirmada' && (
        <div className="notice notice--ok" role="status">
          <p className="serif notice__title">Contribuição confirmada</p>
          <p>Seu carinho já faz parte da nossa história. Obrigado por escolher um presente para a nossa lua de mel!</p>
        </div>
      )}

      {pending && (
        <>
          <p className="thanks">
            Seu carinho já faz parte da nossa história. Obrigado por escolher um presente para a nossa lua de mel!
          </p>
          <p className="pendingnote">
            Agora é só concluir o Pix. Assim que a contribuição for confirmada, ela será contabilizada na nossa meta.
          </p>

          {code ? (
            <div className="pix">
              {qr && <img className="pix__qr" src={qr} width={280} height={280} alt={`QR Code do Pix no valor de ${formatBRL(view.total_cents)}`} />}
              <label htmlFor="pix-code" className="pix__label">Pix copia e cola</label>
              <textarea id="pix-code" className="pix__code" readOnly rows={4} value={code} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={async () => {
                  if (await copyText(code)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 3000);
                  }
                }}
              >
                {copied ? 'Código copiado' : 'Copiar código Pix'}
              </button>
              <span className="sr-only" role="status">{copied ? 'Código Pix copiado' : ''}</span>
              <ol className="steps">
                <li>Abra o aplicativo do seu banco e escolha pagar com Pix.</li>
                <li>Leia o QR Code ou use a opção “Pix copia e cola”.</li>
                <li>Confira que o valor é {formatBRL(view.total_cents)} e conclua o pagamento.</li>
              </ol>
              {isManual ? (
                <p className="fine">
                  Neste momento a confirmação não é automática: o casal confere o recebimento e confirma manualmente, o que pode levar um tempinho.
                </p>
              ) : (
                <p className="fine">A confirmação é feita automaticamente assim que o pagamento for identificado.</p>
              )}
              {view.pix_expires_at && <p className="fine">Este código vale até {new Date(view.pix_expires_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}.</p>}
            </div>
          ) : pub?.pix_mode === 'dynamic' ? (
            <div className="notice" role="alert">
              <p>Não conseguimos gerar o código Pix agora.</p>
              <button className="btn btn--primary" disabled={busy} onClick={props.onRetryCharge}>{busy ? 'Gerando…' : 'Gerar Pix novamente'}</button>
            </div>
          ) : (
            <div className="notice" role="status">
              <p>
                O Pix ainda não está disponível nesta página. Sua contribuição ficou registrada com o código <strong className="mono">{view.code}</strong>; fale com a
                Lhaiany ou o Janderson para combinar o pagamento.
              </p>
            </div>
          )}

          {error && <p className="field__error" role="alert">{error}</p>}

          {view.status === 'aguardando_pagamento' && code && (
            <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={props.onPaid}>
              Já fiz o Pix
            </button>
          )}
          {view.status === 'em_verificacao' && (
            <p className="fine">Obrigado por avisar! Estamos verificando o recebimento. Isso ainda não conta na meta até a confirmação.</p>
          )}
        </>
      )}

      {(view.status === 'expirada' || view.status === 'cancelada') && (
        <div className="notice" role="status">
          <p>Esta contribuição não está mais ativa. Se quiser, é só escolher os presentes novamente.</p>
        </div>
      )}

      <button type="button" className="link link--back" onClick={props.onBack}>
        {view.status === 'confirmada' ? 'Voltar para a lista' : 'Fazer outra contribuição'}
      </button>
    </section>
  );
}

function statusText(s: ContributionView['status']): string {
  switch (s) {
    case 'aguardando_pagamento':
      return 'Aguardando pagamento';
    case 'em_verificacao':
      return 'Em verificação';
    case 'confirmada':
      return 'Contribuição confirmada';
    case 'expirada':
      return 'Expirada';
    case 'cancelada':
      return 'Cancelada';
    default:
      return 'Em seleção';
  }
}
