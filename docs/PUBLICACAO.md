# Publicação: GitHub Pages (site) + Supabase (só o banco)

Endereço esperado do site: `https://SEU-USUARIO.github.io/lista-lua-de-mel/`
Painel do casal: `https://SEU-USUARIO.github.io/lista-lua-de-mel/#/admin`  (o `#` é necessário no GitHub Pages)

## A. Supabase (banco e login do casal) — ~15 min
1. supabase.com > New project (região **South America (São Paulo)**, senha forte do banco; guarde-a no gerenciador de senhas).
2. **SQL Editor** > New query > cole TODO o conteúdo de `supabase/migrations/0001_init.sql` > Run. Deve terminar sem erro.
3. **Authentication > Sign In / Providers > Email**: desative **"Allow new users to sign up"** (ninguém de fora cria conta).
4. **Authentication > Users > Add user > Create new user**: crie os dois e-mails do casal, senha forte, marque "Auto Confirm User".
   - Se você já tinha rodado uma versão anterior do arquivo, rode também `supabase/update_gifts.sql` para atualizar a lista de cotas.
5. Edite os dois e-mails em `supabase/seed_admin.sql`, cole no SQL Editor e execute. O resultado deve listar os 2 e-mails.
6. **Project Settings > API**: copie *Project URL* e a chave **anon / public**. (Nunca copie a `service_role` para lugar nenhum do site.)
7. **Authentication > URL Configuration > Site URL**: `https://SEU-USUARIO.github.io/lista-lua-de-mel/`

## B. GitHub (repositório + publicação automática) — ~10 min
1. Crie o repositório `lista-lua-de-mel` (**Public** para usar Pages no plano gratuito; o código não contém segredos) e envie o projeto (comandos no README).
2. Repositório > **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. Repositório > **Settings > Secrets and variables > Actions > aba Variables > New repository variable** (3 variáveis):
   - `VITE_SUPABASE_URL` = Project URL do passo A6
   - `VITE_SUPABASE_ANON_KEY` = chave anon do passo A6
   - `VITE_SITE_URL` = `https://SEU-USUARIO.github.io/lista-lua-de-mel` (sem barra no fim)
4. Aba **Actions**: o fluxo "Publicar no GitHub Pages" roda a cada envio para `main` (testa, compila e publica). Se já tinha enviado antes de criar as variáveis, clique em *Run workflow*.
5. Abra o endereço do site. Se aparecer o aviso de variáveis faltando, revise o passo 3 e rode o fluxo de novo.

## C. Antes de divulgar
1. (Opcional) Coloque `public/img/casal.jpg` e `public/og.jpg` (veja `public/img/README.md`), envie para o GitHub e espere o fluxo terminar.
2. Entre no painel (`#/admin`), vá em **Configurações > Pix** e cadastre chave, nome do recebedor e cidade.
3. Passe o checklist de `docs/TESTES.md` e apague/cancele as contribuições de teste (com justificativa).
4. Só então use o botão "Compartilhar lista pelo WhatsApp" na própria página.
Se o prazo (05/01/2027 23:59, Salvador) precisar mudar: painel > Configurações.

## Observações importantes
- A chave `anon` fica visível no código publicado; isso é esperado. Quem protege os dados são as regras RLS do banco (testadas).
- O plano gratuito do Supabase pausa projetos sem atividade por muito tempo; confira o projeto de vez em quando nas semanas antes do casamento.
- Pix dinâmico (confirmação automática) exige Edge Functions do Supabase e credenciais do Mercado Pago (`docs/PIX.md`). **Opcional**: sem ele o site funciona com Pix estático e confirmação manual.
