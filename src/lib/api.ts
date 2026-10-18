import { supabase } from './supabase';
import type { ContributionView, Gift, PublicState } from './types';

const MESSAGES: Record<string, string> = {
  LISTA_ENCERRADA: 'A lista foi encerrada e não recebe mais contribuições. Obrigado pelo carinho!',
  ITEM_INVALIDO: 'Alguns presentes escolhidos não estão mais disponíveis. Revise a sua seleção.',
  VALOR_INVALIDO: 'O valor total está fora do permitido. Revise a sua seleção.',
  DADOS_INVALIDOS: 'Confira o nome e a mensagem e tente novamente.',
  MUITAS_TENTATIVAS: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  NAO_ENCONTRADA: 'Não encontramos essa contribuição neste aparelho.',
  NAO_AUTORIZADO: 'Você não tem permissão para esta ação.',
  JUSTIFICATIVA_OBRIGATORIA: 'Escreva uma justificativa (mínimo de 3 caracteres).',
  TRANSICAO_INVALIDA: 'Essa mudança de status não é permitida.',
  SEM_MUDANCA: 'A contribuição já está neste status.',
  PIX_NAO_CONFIGURADO: 'O Pix automático ainda não está configurado.',
};

export function friendlyError(e: unknown): string {
  const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  for (const code of Object.keys(MESSAGES)) if (msg.includes(code)) return MESSAGES[code];
  if (/failed to fetch|networkerror|load failed|network request/i.test(msg))
    return 'Não conseguimos conectar. Verifique sua internet e tente novamente.';
  return 'Algo não saiu como esperado. Tente novamente em instantes.';
}

export async function fetchGifts(): Promise<Gift[]> {
  const { data, error } = await supabase.from('gifts').select('*').eq('active', true).order('sort_order');
  if (error) throw error;
  return data as Gift[];
}

export async function fetchPublicState(): Promise<PublicState> {
  const { data, error } = await supabase.rpc('public_state');
  if (error) throw error;
  return data as PublicState;
}

export async function createContribution(
  clientKey: string,
  guestName: string,
  message: string,
  items: { gift_id: string; quantity: number }[],
): Promise<ContributionView> {
  const { data, error } = await supabase.rpc('create_contribution', {
    p_client_key: clientKey,
    p_guest_name: guestName,
    p_message: message,
    p_items: items,
  });
  if (error) throw error;
  return data as ContributionView;
}

export async function getContribution(id: string, clientKey: string): Promise<ContributionView> {
  const { data, error } = await supabase.rpc('get_contribution', { p_id: id, p_client_key: clientKey });
  if (error) throw error;
  return data as ContributionView;
}

export async function claimPayment(id: string, clientKey: string): Promise<ContributionView> {
  const { data, error } = await supabase.rpc('claim_payment', { p_id: id, p_client_key: clientKey });
  if (error) throw error;
  return data as ContributionView;
}

/** Pix dinâmico: pede à Edge Function que crie a cobrança no provedor. */
export async function requestDynamicCharge(id: string, clientKey: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('create-pix-charge', {
    body: { contribution_id: id, client_key: clientKey },
  });
  if (error) {
    let code = '';
    try {
      const body = await (error as { context?: Response }).context?.json();
      code = body?.error ?? '';
    } catch {
      /* ignora */
    }
    throw new Error(code || error.message);
  }
  if (data?.error) throw new Error(data.error);
}

// ---- Persistência local (não é o registro financeiro: apenas retoma a tela após recarregar) ----
const SESSION_KEY = 'lm.contribution.v1';
const ATTEMPT_KEY = 'lm.attempt.v1';

export interface StoredContribution {
  id: string;
  client_key: string;
}

export function loadStoredContribution(): StoredContribution | null {
  try {
    const v = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return v?.id && v?.client_key ? v : null;
  } catch {
    return null;
  }
}
export const storeContribution = (v: StoredContribution) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(v));
  } catch {
    /* ignora */
  }
};
export const clearStoredContribution = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignora */
  }
};

/** Mesma seleção + mesmo nome => mesma chave (evita duplicar em duplo clique / recarregamento). */
export function attemptKey(signature: string): string {
  try {
    const cur = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? 'null');
    if (cur?.sig === signature && cur?.key) return cur.key as string;
    const key = crypto.randomUUID();
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ sig: signature, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}
export const clearAttempt = () => {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* ignora */
  }
};
