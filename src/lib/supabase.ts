import { createClient } from '@supabase/supabase-js';

// No GitHub Actions, variável não cadastrada chega como texto vazio (""), não como "indefinida".
// Por isso usamos || (e não ??): com "" o createClient lançaria erro e a página ficaria em branco.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const isConfigured = Boolean(url && anon);

// Apenas a chave pública (anon) existe no navegador. A proteção dos dados está nas regras RLS do banco.
export const supabase = createClient(url || 'http://localhost', anon || 'sem-chave', {
  auth: { persistSession: isConfigured, autoRefreshToken: isConfigured },
});
