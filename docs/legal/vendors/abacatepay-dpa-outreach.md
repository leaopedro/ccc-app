# AbacatePay DPA Outreach

Tracking record for the AbacatePay Data Processing Agreement request
under [JDMA-717](/JDMA/issues/JDMA-717), the CEO-owned follow-up to
T09 ([JDMA-715](/JDMA/issues/JDMA-715)).

## Context

- Vendor: AbacatePay (payment processor, Pix-only one-time orders).
- Posture per vendor register: `GO — domestic`. No SCC required because
  processing stays in Brazil under LGPD Art. 33.
- Evidence target: `docs/legal/vendors/abacatepay-dpa.pdf` once signed.
- Escalation rule: if AbacatePay refuses to sign a vendor DPA, restrict
  the integration to receive-only webhook and open a replacement
  sourcing issue per the vendor register.

## Outreach channel

Primary: `contato@abacatepay.com` (vendor public contact).
Fallback: vendor dashboard support channel, if `contato@` does not
respond inside the 14-day soft window tracked below.

## Outreach email draft

```text
Subject: Solicitação de DPA — JDM Experience (LGPD)

Olá, equipe AbacatePay,

Sou Pedro Leão, fundador da JDM Experience (CNPJ a confirmar no
contrato). Utilizamos a API e webhooks da AbacatePay como meio de
pagamento via Pix no nosso aplicativo de eventos.

Para cumprir nossas obrigações como controlador sob a LGPD (Lei
13.709/2018), precisamos formalizar um Contrato de Tratamento de Dados
(Data Processing Agreement / DPA) com a AbacatePay, na condição de
operador, cobrindo:

- finalidades do tratamento (processamento de pagamentos via Pix,
  geração e validação de webhooks),
- categorias de titulares e de dados (compradores: nome, e-mail, total
  do pedido, referências Pix),
- obrigações de segurança e confidencialidade,
- subcontratação (subcontratados) e comunicação prévia,
- prazos de retenção e devolução/eliminação ao término do contrato,
- cooperação em pedidos de titulares e em incidentes (Art. 48 LGPD).

Como o tratamento ocorre integralmente no Brasil, não é necessária a
adoção das cláusulas de transferência internacional (Anexo II da
Resolução ANPD 19/2024). Caso a AbacatePay já possua um DPA padrão,
podemos partir dele e ajustar pontualmente; caso contrário, ficamos à
disposição para enviar uma minuta.

Podem nos confirmar:

1. O canal correto para tratar deste contrato (jurídico / DPO).
2. Se já existe um DPA padrão da AbacatePay para clientes pessoa
   jurídica no Brasil.
3. Um prazo estimado para assinatura.

Obrigado.

Pedro Leão
JDM Experience
leaop54@gmail.com
```

## Tracking

| Field                 | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| Outreach drafted      | 2026-05-15                                                   |
| Outreach sent         | Pending human-board send                                     |
| Vendor first response | Pending                                                      |
| Soft response window  | 14 days from send date                                       |
| Hard replacement gate | 30 days from send date                                       |
| Signed DPA filed      | Pending; target path `docs/legal/vendors/abacatepay-dpa.pdf` |
| Register row updated  | Yes — `Outreach status` column reflects draft state          |

## Owner

- Drafting + register update: CEO agent (this branch).
- Send + signature collection: human board (Pedro Leão), since the
  agent has no outbound-mail credential and cannot bind the company on
  signature.

## Next action

Human board must send the email above from `leaop54@gmail.com` to
`contato@abacatepay.com`, log the send date in this file, and open a
follow-up worktree to file the signed PDF once received.
