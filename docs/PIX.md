# Pix

## Modo 1 · Pix estático (padrão, sem provedor)
Painel > Configurações > Pix: informe a **chave real** do casal, nome do recebedor (até 25) e cidade (até 15). O site gera QR Code e "copia e cola" com o **valor exato** e o código da contribuição.
- Confirmação **manual**: o casal confere o extrato e usa "Confirmar pagamento". A página informa isso ao convidado.
- Bancos nem sempre exibem o identificador no extrato; use valor + nome + horário. O botão "Já fiz o Pix" só marca "Em verificação" (não soma na meta).
- Chave de celular: use o formato `+5571999999999`.

## Modo 2 · Pix dinâmico com Mercado Pago (confirmação automática)
Provedor sugerido: Mercado Pago (cobrança Pix por API, QR Code, copia e cola, webhook assinado). Alternativas equivalentes: Asaas, Efí. **Tarifas:** consulte a tabela vigente do provedor antes de ativar (não afirmamos valores aqui).

Requisitos: conta Mercado Pago verificada, aplicação criada no painel de desenvolvedores, credenciais de **teste** e de **produção**.

1. `npm i -g supabase` (ou `npx supabase`), `supabase login`, `supabase link --project-ref SEU_REF`.
2. Segredos: copie `supabase/functions/.env.example` para `supabase/functions/.env`, preencha `MP_ACCESS_TOKEN` (use o de TESTE primeiro), `MP_WEBHOOK_SECRET` (assinatura secreta do webhook), `PIX_PAYER_EMAIL` (e-mail do casal; o provedor exige um pagador e não coletamos e-mail de convidado). Rode `supabase secrets set --env-file supabase/functions/.env`.
3. `supabase functions deploy create-pix-charge` e `supabase functions deploy pix-webhook --no-verify-jwt`.
4. No Mercado Pago > Webhooks: URL `https://SEU_REF.supabase.co/functions/v1/pix-webhook`, evento **Pagamentos**; copie a assinatura secreta para `MP_WEBHOOK_SECRET`.
5. Homologação: com token de teste, crie uma contribuição, gere o Pix e simule/aprove o pagamento pelo ambiente de teste do provedor. Verifique no painel: status "Confirmada" e meta atualizada. **Pagamento de teste não é dinheiro recebido**: após os testes, apague/cancele essas contribuições (com justificativa) e troque para credenciais de produção.
6. Produção: troque os segredos pelos de produção, reimplante as funções, mude o modo para "dinâmico" no painel.

Garantias implementadas no código: assinatura HMAC verificada; o corpo do webhook nunca é confiado (consulta-se o pagamento na API); valor deve ser exatamente o total; evento repetido é ignorado; segundo pagamento da mesma contribuição não soma; valor divergente vira "Em verificação" com alerta no histórico.
Se algo falhar, volte o modo para "estático": o site continua funcionando.
