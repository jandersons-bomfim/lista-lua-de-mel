import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon);

// Apenas a chave pública (anon) existe no navegador. A proteção dos dados está nas regras RLS do banco.
export const supabase = createClient(url ?? 'http://localhost', anon ?? 'sem-chave', {
  auth: { persistSession: true, autoRefreshToken: true },
});
