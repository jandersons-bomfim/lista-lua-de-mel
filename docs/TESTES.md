# Testes: o que foi executado e o que depende de você

## Executados automaticamente (ambiente de desenvolvimento, resultados reais)
- **Banco (Postgres 16 local com simulação do Supabase): 81 verificações, 81 aprovadas.** `supabase/tests/test.sql`. Cobre: criação, total calculado no servidor, idempotência, validações, pendente/em verificação nunca somam na meta, confirmação manual com auditoria, transições proibidas, webhook (duplicado, valor divergente, pagamento repetido), prazo e encerramento, reativação com histórico, RLS e permissões (anônimo e usuário sem permissão), limite de requisições.
- **Lógica e interface (Vitest, 36 testes)**: dinheiro/percentual, Pix estático (CRC), carrinho, CSV (anti-fórmula), prazo/fuso, e a página pública (seleção, quantidades, total, nome obrigatório, Pix pendente, duplo clique, retomada após recarregar, Pix não configurado, erro de rede, lista encerrada, confirmação).
- Verificação de tipos e build de produção: aprovados.

Rodar de novo: `npm test`. Banco: suba um Postgres, rode `supabase/tests/bootstrap_local.sql`, `supabase/migrations/0001_init.sql` e `supabase/tests/test.sql` com `psql`.

## NÃO executados (precisam de serviços reais): faça antes de divulgar
Marque cada item no site publicado, no celular:
- [ ] Layout em tela pequena (iPhone/Android), sem rolagem lateral; barra de resumo não cobre botões.
- [ ] Ilustrações das cotas aparecem; prévia no WhatsApp com título e imagem (precisa de `og.jpg`).
- [ ] Botão WhatsApp abre mensagem com o link real; "Copiar link" funciona.
- [ ] Login do painel funciona; **uma conta que não é admin não entra**; sem login, `#/admin` não mostra dados.
- [ ] Criar contribuição de teste, recarregar a página e ver que ela permanece.
- [ ] Pix estático: pagar R$ 1 real? (use uma cota de teste temporária de R$ 1 criada no painel, depois desative) e conferir que o banco lê o QR com o valor certo.
- [ ] Confirmar manualmente: meta sobe; pendente não sobe.
- [ ] Exportar CSV e abrir no Excel/Google Planilhas.
- [ ] Mudar o prazo para o passado: nova contribuição é recusada; voltar ao correto.
- [ ] Modo avião ao clicar em "Continuar para o Pix": mensagem de erro clara.
- [ ] (Só Pix dinâmico) homologação do Mercado Pago e do webhook, conforme `docs/PIX.md`.
- [ ] Apagar/cancelar todas as contribuições de teste (com justificativa) antes de divulgar.
