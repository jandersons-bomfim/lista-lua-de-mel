# Lista de presentes de lua de mel · Lhaiany & Janderson

Página única (React + TypeScript) publicada no **GitHub Pages** + **Supabase apenas como banco** (dados, login do casal, regras no servidor).
Custo previsto: R$ 0 nos planos gratuitos para este volume. Pix: ver `docs/PIX.md`.

## Arquitetura
```
Convidado (celular) ──► GitHub Pages (site estático)
                           │  chave pública (anon)
                           ▼
                      Supabase Postgres  ◄── RLS: público só lê cotas e totais agregados
   funções SQL (create_contribution, claim_payment…)  ◄── valores calculados NO SERVIDOR
   Painel (#/admin) ──► Supabase Auth (login) + tabela admins + RLS + funções admin_*
   Pix dinâmico (opcional) ──► Edge Functions create-pix-charge / pix-webhook ──► Mercado Pago
```
Decisões: valores em centavos; meta = soma de contribuições `confirmada` calculada no banco; contribuição, itens e pagamentos só mudam por funções `SECURITY DEFINER`; histórico automático (`audit_log`); `localStorage` só guarda a seleção temporária.

## Passo a passo
Tudo está em **`docs/PUBLICACAO.md`** (Supabase, depois GitHub, depois checklist). Resumo:
1. Subir o código no GitHub:
```
git init
git add .
git status        # confira: NÃO pode aparecer .env nem node_modules
git commit -m "Lista de presentes de lua de mel"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/lista-lua-de-mel.git
git push -u origin main
```
2. Criar o projeto Supabase e rodar `supabase/migrations/0001_init.sql`; criar os dois usuários e `supabase/seed_admin.sql`.
3. No GitHub: Settings > Pages > Source "GitHub Actions" e cadastrar as 3 variáveis (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`).
4. Fotos em `public/img/`, Pix no painel, checklist de `docs/TESTES.md`.

Rodar localmente (opcional): `cp .env.example .env`, preencher, `npm install`, `npm run dev`.

## Comandos
`npm run dev` · `npm run build` · `npm test` (36 testes) · testes do banco: `docs/TESTES.md`.

## Limitações (leia)
- As imagens são ilustrações; fotos reais são opcionais (veja `public/img/README.md`). A foto do casal usa `public/img/casal.jpg` se existir.
- Pix dinâmico: código escrito, **não testado** contra o provedor (exige credenciais). O modo estático funciona sem provedor, com confirmação manual.
- O painel fica em `<site>/#/admin` (GitHub Pages não tem rotas de servidor).
- A data limite usa UTC-3 fixo (Bahia não tem horário de verão).
- Contribuições pendentes não expiram sozinhas; marque como expirada no painel.
