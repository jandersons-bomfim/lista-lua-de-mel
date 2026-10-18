import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co; base-uri 'self'; form-action 'self'";

// Substitui __SITE_URL__ no index.html (metadados do WhatsApp precisam de URL absoluta).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const site = (env.VITE_SITE_URL ?? '').replace(/\/$/, '');
  return {
    base: './', // caminhos relativos: funciona em https://usuario.github.io/nome-do-repositorio/
    plugins: [
      react(),
      {
        name: 'html-vars',
        transformIndexHtml: (html: string, ctx: { server?: unknown }) =>
          html.replaceAll('__SITE_URL__', site).replaceAll('__CSP__', ctx.server ? '' : CSP),
      },
    ],
    test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
  };
});
