# Railway

Canonical Railway deploy runbook lives at [`docs/railway.md`](./docs/railway.md).
See also [`docs/secrets.md`](./docs/secrets.md) for the full Railway env var inventory.

## Variáveis do gate de perfil

| Variável | Default | Descrição |
| --- | --- | --- |
| `PROFILE_GATE_ENABLED` | `false` | Liga os gates de perfil no checkout e na assinatura. |
| `PROFILE_GATE_ROLLOUT_PERCENT` | `0` | Percentual de usuários sob o gate. Bucket determinístico por `userId`. |
| `R2_DOCUMENTS_BUCKET` | Sem default | Bucket R2 privado de documentos de identidade. Obrigatório em produção. |
| `DOCUMENT_URL_TTL_SECONDS` | `60` | TTL do signed GET de documento. |

## Rollout do gate de perfil

1. Deploy com `PROFILE_GATE_ENABLED=false`. Cadastro já coleta CPF e telefone;
   nada bloqueia.
2. Esperar acúmulo de perfis completos entre os novos cadastros. Ligar o gate
   antes disso bloqueia a base legada inteira de uma vez.
3. `PROFILE_GATE_ENABLED=true` e `PROFILE_GATE_ROLLOUT_PERCENT=5`.
4. Escalar 5 → 25 → 50 → 100, com no mínimo 24 h de observação em cada passo.

Métricas a acompanhar em cada passo:

| Métrica | Limiar de alerta |
| --- | --- |
| `403 INCOMPLETE_PROFILE` sobre tentativas de checkout | acima de 40% no bucket ativo |
| Conversão de assinatura vs. semana anterior | queda acima de 20% |
| `5xx` nas rotas de checkout e premium | qualquer aumento sobre a linha de base |
| `count(UserDocument where status='pending')` | acima de 200 |

Rollback: `PROFILE_GATE_ROLLOUT_PERCENT=0`, ou `PROFILE_GATE_ENABLED=false`.
Efeito imediato, sem deploy. Não reverter a migração por problema de funil:
as colunas são nullable e a tabela nova não afeta nenhum caminho existente com
a flag desligada.
