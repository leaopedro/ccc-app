# Plano Anual de Treinamento LGPD — 2026

**Versão:** 1.0  
**Data:** 2026-05-14  
**Responsável:** CEO (função temporária de Encarregado até contratação formal de DPO)  
**Base legal:** LGPD Art. 50 (L05 — accountability), ANPD Resolução CD/ANPD nº 2/2022 (L26 — governança atenua sanções)

---

## 1. Objetivo

Garantir que toda equipe compreenda obrigações da LGPD aplicáveis às suas funções, reduza risco de incidentes de dados, e que exista evidência auditável de capacitação contínua.

---

## 2. Escopo e Público

| Segmento      | Perfil                                             | Qtd. estimada |
| ------------- | -------------------------------------------------- | ------------- |
| Todos         | Fundadores, dev, ops, parceiros com acesso a dados | ~5 pessoas    |
| Técnico       | Devs com acesso a banco, APIs, Sentry              | ~3 pessoas    |
| Comercial/Ops | Atendimento, vendas, checkin de eventos            | ~2 pessoas    |

Fornecedores com acesso a dados pessoais (Railway, Cloudflare, Stripe, Sentry) são cobertos pelos seus próprios programas de conformidade; não fazem parte deste plano interno.

---

## 3. Tópicos por Módulo

### Módulo A — Fundamentos (todos)

1. O que é dado pessoal e dado sensível (LGPD Art. 5)
2. Bases legais que a JDM usa: consentimento, execução de contrato, legítimo interesse
3. Direitos dos titulares: acesso, correção, exclusão, portabilidade
4. O que é um incidente de dados e como reportar internamente
5. Política de retenção e descarte seguro

### Módulo B — Técnico (devs)

1. PII em logs e traces: regras do scrubber Sentry ([JDMA-637](/JDMA/issues/JDMA-637))
2. Presigned URLs e CORS no R2: TTL curto, headers obrigatórios
3. Hashing e pseudonimização vs. anonimização
4. DPIA: quando fazer, template básico
5. Exclusão de conta e exportação de dados (endpoints LGPD)
6. Segurança de webhooks: verificação de assinatura, idempotência

### Módulo C — Comercial/Ops (atendimento, checkin)

1. Coleta mínima: pedir só o que é necessário
2. Como responder pedido de titular (prazo 15 dias úteis)
3. Não compartilhar dados via WhatsApp/e-mail não corporativo
4. Fotografias em eventos: consentimento e uso autorizado

---

## 4. Cadência e Formato

| Frequência      | Evento                                        | Formato                               | Duração              |
| --------------- | --------------------------------------------- | ------------------------------------- | -------------------- |
| Anual (jan)     | Revisão completa — todos os módulos           | Reunião síncrona + leitura assíncrona | ~2 h                 |
| Semestral (jul) | Atualização de incidentes, mudanças na lei    | Reunião síncrona                      | ~30 min              |
| On-boarding     | Novos membros — módulos A + módulo de função  | 1:1 com CEO/DPO                       | ~1 h                 |
| Ad-hoc          | Incidente ou mudança significativa de produto | Reunião emergencial                   | conforme necessidade |

**Primeira sessão programada:** Janeiro de 2027 (ciclo 2026 é de implantação; revisão completa no início do próximo ciclo).  
**Sessão de kick-off do ciclo atual:** **Junho de 2026** — cobertura dos Módulos A + B, alinhada ao lançamento do scan de LGPD ([JDMA-655](/JDMA/issues/JDMA-655)).

---

## 5. Responsabilidades

| Papel                                                       | Responsabilidade                                          |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| CEO (Encarregado interino)                                  | Conduzir sessões, manter registros, atualizar plano       |
| DPO (quando contratado — [JDMA-630](/JDMA/issues/JDMA-630)) | Assumir condução, revisar tópicos, emitir certificados    |
| Tech Lead                                                   | Garantir módulo B coberto em on-boarding técnico          |
| Todos                                                       | Assinar lista de presença, completar checklist pós-sessão |

---

## 6. Evidência de Conclusão

Para cada sessão realizada, o CEO/DPO registra em `docs/evidence/lgpd-training-log.md`:

```
| Data | Módulos | Participantes | Assinatura CEO/DPO | Observações |
```

- Listas de presença (PDF ou print assinado digitalmente) salvas em pasta compartilhada interna.
- Qualquer material de apresentação versionado neste repositório em `docs/evidence/`.
- Certificados emitidos (quando aplicável) arquivados com os registros de RH.

---

## 7. Revisão do Plano

Este plano é revisado:

- Anualmente (junto com a sessão de janeiro)
- Após qualquer incidente de dados
- Após mudanças significativas na LGPD ou regulamentações da ANPD
- Quando a equipe dobrar de tamanho ou um DPO formal for designado

---

## 8. Aprovação

| Papel                      | Nome       | Data       |
| -------------------------- | ---------- | ---------- |
| CEO / Encarregado interino | Pedro Leão | 2026-05-14 |
| DPO (quando designado)     | —          | —          |
