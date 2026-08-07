# Perfil progressivo — cadastro permissivo + gates de checkout e assinatura

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development`. Passos usam checkbox (`- [ ]`).

**Objetivo:** cadastro exige só nome, e-mail e senha. CPF e telefone ficam visíveis e opcionais no cadastro. Compras avulsas exigem CPF e telefone antes de finalizar. Assinatura exige CPF, telefone e um documento enviado.

**Ordem de execução:** backend → banco → infra/segurança → mobile.

---

## 0. Correções de premissa

Verificado no repo antes de escrever este plano:

| Premissa do pedido | Realidade | Consequência |
| --- | --- | --- |
| `cpf`, `telefone`, `documento_id` existem e precisam aceitar `NULL` | Nenhum dos três existe. `User` tem só `bio`, `city`, `stateCode`, `avatarObjectKey` como perfil ([schema.prisma:47-51](../packages/db/prisma/schema.prisma:47)) | Migração **cria** colunas nullable. Não há `ALTER COLUMN DROP NOT NULL`. Zero risco de backfill. |
| Tabela `documents` | Não existe. Precedente de anexo privado é `SupportTicket.attachmentObjectKey` ([me-support.ts:24](../apps/api/src/routes/me-support.ts:24)) | Nova tabela `UserDocument`, nome em PascalCase para casar com as outras 90 tabelas do schema. |
| `phone` | Existe em `ShippingAddress.phone` e `SupportTicket.phone`, ambos `VarChar(20)`, ambos em claro | `User.phone` segue o mesmo tipo e não é cifrado. |
| CPF em claro | `sentry-breadcrumb-filter.ts` e `sentry-scrubber.ts` já removem padrão de CPF de telemetria | CPF é cifrado em repouso com `encryptField` ([field-encryption.ts:34](../apps/api/src/services/crypto/field-encryption.ts:34)), chave `FIELD_ENCRYPTION_KEY` já em env. |

**Decisão travada:** auto-aprovação otimista. Enviar documento libera a assinatura na hora com `status = pending`. Revisão posterior no admin pode rejeitar.

---

## 1. Tarefas técnicas por componente

### 1.1 Banco (`packages/db`)

- [ ] `schema.prisma` — `User` recebe `cpf String? @db.VarChar(200)` (guarda ciphertext `enc_v1:...`, daí o tamanho) e `phone String? @db.VarChar(20)`.
- [ ] `schema.prisma` — `User` recebe relação `documents UserDocument[]`.
- [ ] `schema.prisma` — enums `UserDocumentType { cnh rg }` e `UserDocumentStatus { pending approved rejected }`.
- [ ] `schema.prisma` — modelo `UserDocument`.
- [ ] Migração `20260806HHMMSS_user_profile_cpf_phone_documents` (SQL na seção 3).
- [ ] `prisma/seed.ts` — nada a alterar. Usuários de seed continuam sem CPF, o que exercita o caminho bloqueado em dev.

### 1.2 Shared (`packages/shared`)

- [ ] `src/profile.ts` — `cpfSchema`: string, `.transform` remove não-dígitos, `.refine` valida os dois dígitos verificadores, rejeita as 11 sequências repetidas (`00000000000`…`99999999999`). Retorna 11 dígitos sem máscara.
- [ ] `src/profile.ts` — `phoneSchema`: string, `.transform` remove não-dígitos, `.refine` aceita 10 ou 11 dígitos (DDD + número), armazena como dígitos.
- [ ] `src/profile.ts` — `updateProfileSchema` ganha `cpf` e `phone` opcionais.
- [ ] `src/profile.ts` — `publicProfileSchema` ganha `cpf: z.string().nullable()` e `phone: z.string().nullable()`. Sem máscara: é o próprio dono lendo o próprio dado, e o form de edição precisa pré-preencher.
- [ ] `src/auth.ts` — `signupSchema` ganha `cpf` e `phone` opcionais reaproveitando os schemas acima.
- [ ] `src/profile-status.ts` (novo) — `PROFILE_SCOPES = ['checkout', 'subscription']`, `MISSING_FIELD_KEYS = ['cpf', 'phone', 'document']`, `profileStatusSchema`, `incompleteProfileErrorSchema`.
- [ ] `src/documents.ts` (novo) — `USER_DOCUMENT_TYPES`, `USER_DOCUMENT_STATUSES`, `ALLOWED_DOCUMENT_TYPES` (`image/jpeg`, `image/png`, `image/webp`), `MAX_DOCUMENT_BYTES = 10 * 1024 * 1024`, `documentUploadRequestSchema`, `documentUploadResponseSchema`, `createDocumentBodySchema`, `userDocumentSchema`, `userDocumentListResponseSchema`.
- [ ] `package.json` — adicionar exports `./profile-status` e `./documents`.
- [ ] `src/feed.ts` — a denylist de chaves já inclui `cpf` e `phone`. Nada a fazer, mas o teste `feed-privacy-contract.test.ts` precisa continuar verde.
- [ ] `src/legal.ts` — acrescentar CPF/telefone de perfil e documento de identidade na tabela de bases legais e na de retenção.

### 1.3 API — serviço de completude (`apps/api/src/services/profile/`)

Um único ponto de verdade. Todo gate chama daqui.

- [ ] `completeness.ts` (novo):
  - `REQUIRED_BY_SCOPE = { checkout: ['cpf', 'phone'], subscription: ['cpf', 'phone', 'document'] }`.
  - `loadProfileCompleteness(userId)` — uma query: `user.findUnique` com `select { cpf, phone, documents: { where: { status: { in: ['pending','approved'] } }, take: 1 } }`. `document` conta como presente com `pending` **ou** `approved`. `rejected` não conta.
  - `missingFor(completeness, scope): MissingFieldKey[]`.
  - `incompleteProfileReply(reply, missing)` — 403 com o payload padronizado da seção 2.4.
- [ ] `gate.ts` (novo) — `enforceProfileGate(app, request, reply, scope)`. Lê a flag e o percentual de rollout, chama `loadProfileCompleteness`, devolve `null` quando liberado ou a reply 403 quando bloqueado. Bucketing determinístico: `parseInt(sha1(userId).slice(0,8), 16) % 100 < PROFILE_GATE_ROLLOUT_PERCENT`.

### 1.4 API — rotas a alterar

- [ ] `routes/auth/signup.ts:34-41` — gravar `cpf` (cifrado com `encryptField`) e `phone` na mesma `$transaction` que cria `User` + `Garage`. Não mexer no restante do handler.
- [ ] `routes/me.ts:31-43` (`serializeUser`) — incluir `cpf` decifrado com `decryptField` e `phone`. Estender o type `DbUser`.
- [ ] `routes/me.ts:56-93` (`PATCH /me`) — cifrar `cpf` antes de gravar. `phone` grava direto.
- [ ] `routes/me.ts` — nova rota `GET /me/profile-status`.
- [ ] `routes/cart.ts:467` (`POST /cart/checkout`) — `enforceProfileGate(..., 'checkout')` como primeira linha após `requireUser`, antes de `beginCheckoutRequestSchema`. Antes de qualquer reserva de estoque, para não deixar `Cart.status` em `checking_out`.
- [ ] `routes/orders.ts:378` (`POST /orders`) — mesmo gate, antes de `prepareOrder`.
- [ ] `routes/orders.ts:509` (`POST /orders/checkout`) — mesmo gate, antes de `prepareOrder`.
- [ ] `routes/me-premium.ts:56` (`GET /checkout-precheck`) — gate `subscription` logo após o `GROWTH_PREMIUM_BILLING_ENABLED`, antes da busca de garagem. Permite o mobile pré-bloquear o botão sem tentar o POST.
- [ ] `routes/me-premium.ts:126` (`checkoutHandler`) — gate `subscription` antes de `premiumCheckoutRequestSchema.safeParse`. Não confiar no precheck: a janela entre GET e POST é a mesma que o código já fecha para `AlreadySubscribed`.
- [ ] `routes/me-documents.ts` (novo) — `POST /me/documents/upload`, `POST /me/documents`, `GET /me/documents`.
- [ ] `app.ts:134` — registrar `meDocumentRoutes` junto de `uploadRoutes`.

### 1.5 API — uploads

- [ ] `services/uploads/types.ts:1-8` — `UploadKind` ganha `identity_document`.
- [ ] `services/uploads/types.ts:15-23` — `UPLOAD_KIND_PATH_PREFIX` ganha `identity_document: 'identity-document'`.
- [ ] `packages/shared/src/uploads.ts` — **não** adicionar em `UPLOAD_KINDS`. Segue o padrão de `garage_cover`: o kind vive só na union interna da API e só é alcançável pelo endpoint próprio, que injeta o kind server-side. Cliente nunca consegue repontar o presign.
- [ ] `services/uploads/r2.ts` — `presignPut` passa a aceitar bucket alvo. Documento vai para `R2_DOCUMENTS_BUCKET` quando configurado, senão `R2_BUCKET`. `presignGet`/`buildSignedGetUrl`/`deleteObject` resolvem o bucket pelo prefixo do objectKey (`identity-document/` → bucket de documentos).
- [ ] `services/uploads/r2.ts` — para `identity_document`, `ContentDisposition: 'attachment'` e `CacheControl: 'private, no-store'`. `UPLOAD_CACHE_CONTROL` público não serve.
- [ ] `services/uploads/dev.ts` — espelhar o novo kind para os testes e o dev-upload-server.

### 1.6 API — admin

- [ ] `routes/admin/users.ts` — `adminUserDetailSchema` ganha `hasCpf: boolean`, `hasPhone: boolean` e `documents: [{ id, type, status, sentAt, reviewedAt, rejectionReason }]`. **Nunca** serializar o CPF nem URL do documento nesta rota.
- [ ] `routes/admin/documents.ts` (novo):
  - `GET /admin/documents?status=pending&cursor=&limit=` — fila de revisão, cursor igual ao de `admin/users.ts:20-29`.
  - `GET /admin/documents/:id/file` — 302 para signed GET com TTL de 60s. Registra `recordAudit` com ação de visualização.
  - `POST /admin/documents/:id/approve`.
  - `POST /admin/documents/:id/reject` com `{ reason }`.
- [ ] `services/admin-audit.ts:6-34` — `entityType` ganha `'user_document'`.
- [ ] `packages/shared/src/admin.ts` — ações de audit para `document_viewed`, `document_approved`, `document_rejected`.
- [ ] `routes/admin/index.ts:56-74` — registrar `adminDocumentRoutes` no escopo `requireRole('organizer', 'admin')`. Staff não vê documento.

**Rejeição não escreve status de assinatura.** O invariante do repo é que estado de assinatura só muda por webhook verificado ([me-premium.ts:417-425](../apps/api/src/routes/me-premium.ts:417)). Rejeitar documento grava `status = rejected`, dispara notificação e nada mais. Suspender a assinatura é ação separada e explícita do admin pelo caminho de cancelamento Stripe já existente.

### 1.7 API — LGPD (obrigatório, não opcional)

- [ ] `services/data-export.ts` — incluir `cpf` (decifrado) e `phone` no export do usuário e a lista de `UserDocument` (metadados, sem bytes).
- [ ] `services/account-deletion/anonymize.ts:120-130` — zerar `cpf` e `phone` junto de `bio`/`city`.
- [ ] `services/account-deletion/anonymize.ts:39` — enfileirar os `objectKey` de todos os `UserDocument` do usuário em `UploadDeletionQueue` com `reason: 'account_anonymized'`. Rows caem por `onDelete: Cascade`.
- [ ] `workers/retention.ts` — nova regra: documento `approved` há mais de 90 dias e documento `rejected` há mais de 30 dias vão para `UploadDeletionQueue` com `reason: 'document_retention'`. A row fica, o arquivo sai.
- [ ] `docs/ropa.md` e `docs/legal/` — registrar as duas finalidades novas.

### 1.8 Infra

- [ ] `env.ts` — `PROFILE_GATE_ENABLED` (`'true'|'false'`, default `'false'`).
- [ ] `env.ts` — `PROFILE_GATE_ROLLOUT_PERCENT` (`coerce.number().int().min(0).max(100).default(0)`).
- [ ] `env.ts` — `R2_DOCUMENTS_BUCKET` (`string().optional()`).
- [ ] `env.ts` — `DOCUMENT_URL_TTL_SECONDS` (`default(60)`). O TTL de 300s de imagem pública é longo demais para documento.
- [ ] Railway — criar as 4 variáveis. `PROFILE_GATE_ENABLED=false` no deploy inicial.
- [ ] Cloudflare R2 — criar bucket privado de documentos, **sem** dev subdomain público e sem custom domain. Nenhuma política de leitura pública.
- [ ] `docs/r2.md` e `docs/secrets.md` — documentar bucket e variáveis.
- [ ] Sem fila nem worker novo. Auto-aprovação otimista não tem processamento assíncrono. A limpeza de arquivo usa `UploadDeletionQueue` + `retention.ts`, ambos já existentes.

### 1.9 Mobile

Detalhado na seção 4.

---

## 2. Contratos de API

Envelope de erro segue `error-handler.ts`: `{ error, message }` para 4xx, `{ error: 'ValidationError', issues }` para `ZodError` (400).

### 2.1 `POST /auth/signup`

Corpo (`signupSchema`):

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `name` | string 1..100 | sim |
| `email` | e-mail, lowercase | sim |
| `password` | string >= 10 | sim |
| `cpf` | string, 11 dígitos válidos | não |
| `phone` | string, 10 ou 11 dígitos | não |

- `201` — `authResponseSchema` inalterado.
- `400` — `ValidationError` com `issues`. CPF com dígito verificador inválido cai aqui.
- `409` — `{ error: 'Conflict', message: 'email already registered' }`.
- `429` — rate limit existente.
- `500` — `InternalServerError`.

### 2.2 `GET /me` e `PATCH /me`

`publicProfileSchema` ganha:

```
cpf: string | null      // 11 dígitos, sem máscara
phone: string | null    // 10 ou 11 dígitos, sem máscara
```

`PATCH /me` aceita `cpf` e `phone` como parciais, junto dos campos já existentes.

- `200` — perfil serializado.
- `400` — `ValidationError`, ou `{ error: 'BadRequest', message: 'avatar key not owned' }`.
- `401` — `{ error: 'Unauthorized' }`.

### 2.3 `GET /me/profile-status`

Endpoint de verificação de status de perfil. Auth obrigatório.

- `200`:

```
{
  "fields": { "cpf": true, "phone": false, "document": false },
  "checkout":     { "complete": false, "missing": ["phone"] },
  "subscription": { "complete": false, "missing": ["phone", "document"] },
  "latestDocument": {
    "id": "...",
    "type": "cnh",
    "status": "pending",
    "sentAt": "2026-08-06T12:00:00.000Z",
    "rejectionReason": null
  }
}
```

`latestDocument` é `null` quando não há nenhum. `fields.document` é `true` para `pending` e `approved`, `false` para `rejected` e para ausência.

- `401` — `{ error: 'Unauthorized' }`.

### 2.4 Payload de perfil incompleto

Devolvido por todos os gates. `403`:

```
{
  "error": "Forbidden",
  "status": "incomplete_profile",
  "code": "INCOMPLETE_PROFILE",
  "missing": ["cpf", "phone"],
  "message": "Complete seu cadastro para continuar."
}
```

`status` atende ao contrato pedido. `code` existe porque o helper `getApiErrorCode` do mobile ([errors.ts:17](../apps/mobile/src/api/errors.ts:17)) lê `body.code`, e reaproveitá-lo evita um segundo caminho de parsing. `missing` usa as chaves `cpf`, `phone`, `document`, nesta ordem fixa.

### 2.5 Endpoints com gate `checkout` (`cpf` + `phone`)

| Endpoint | Arquivo |
| --- | --- |
| `POST /cart/checkout` | [cart.ts:467](../apps/api/src/routes/cart.ts:467) |
| `POST /orders` | [orders.ts:378](../apps/api/src/routes/orders.ts:378) |
| `POST /orders/checkout` | [orders.ts:509](../apps/api/src/routes/orders.ts:509) |

Respostas existentes preservadas. O `403` da seção 2.4 é acrescentado e avaliado **antes** de qualquer reserva de estoque, criação de `Order` ou chamada a provedor.

### 2.6 Endpoints com gate `subscription` (`cpf` + `phone` + `document`)

| Endpoint | Arquivo |
| --- | --- |
| `GET /api/me/premium/checkout-precheck` | [me-premium.ts:56](../apps/api/src/routes/me-premium.ts:56) |
| `POST /api/me/premium/checkout` | [me-premium.ts:126](../apps/api/src/routes/me-premium.ts:126) |

Ordem de precedência no precheck e no checkout: `503` (flag de billing off) → `403` (perfil incompleto) → `409` (`AlreadySubscribed`) → fluxo normal.

### 2.7 `POST /me/documents/upload`

Presign de PUT. Sem campo `kind`: o servidor injeta `identity_document`.

Corpo:

```
{ "contentType": "image/jpeg", "size": 1048576 }
```

- `201` — `documentUploadResponseSchema`: `{ uploadUrl, objectKey, expiresAt, headers }`. Schema próprio, **sem** `publicUrl`: `presignResponseSchema` exige `publicUrl` como URL válida ([uploads.ts](../packages/shared/src/uploads.ts)) e documento não tem URL pública por definição.
- `400` — `ValidationError` (MIME fora da allowlist ou `size` acima de 10 MB).
- `401` — `{ error: 'Unauthorized' }`.
- `429` — 5 requisições por 15 minutos por usuário, mesmo padrão de `me-support.ts:46-53`.
- `503` — `{ error: 'ServiceUnavailable', message: 'document storage not configured' }` quando não há bucket de documentos nem R2.

### 2.8 `POST /me/documents`

Confirma o upload e cria a row.

Corpo:

```
{ "type": "cnh", "objectKey": "identity-document/<userId>/<cuid>.jpg" }
```

- `201`:

```
{
  "id": "...",
  "type": "cnh",
  "status": "pending",
  "sentAt": "2026-08-06T12:00:00.000Z",
  "rejectionReason": null
}
```

- `400` — `{ error: 'BadRequest', message: 'invalid document key' }` quando `isOwnedKey(objectKey, sub, 'identity_document')` falha.
- `401` — `{ error: 'Unauthorized' }`.
- `409` — `{ error: 'Conflict', code: 'DOCUMENT_ALREADY_PENDING', message: '...' }` quando já existe documento `pending` ou `approved`. Um documento vivo por usuário.
- `429` — 5 por 15 minutos por usuário.

### 2.9 `GET /me/documents`

- `200` — `{ "items": [ { id, type, status, sentAt, reviewedAt, rejectionReason, fileUrl } ] }`. `fileUrl` é signed GET com TTL `DOCUMENT_URL_TTL_SECONDS`, `null` quando o arquivo já foi purgado por retenção.
- `401` — `{ error: 'Unauthorized' }`.

### 2.10 Admin

| Método | URI | Sucesso | Erros |
| --- | --- | --- | --- |
| `GET` | `/admin/documents?status=&cursor=&limit=` | `200 { items, nextCursor }` | `401`, `403` |
| `GET` | `/admin/documents/:id/file` | `302` para signed GET, TTL 60s | `401`, `403`, `404`, `410` (arquivo purgado) |
| `POST` | `/admin/documents/:id/approve` | `200 { id, status: 'approved', reviewedAt }` | `401`, `403`, `404`, `409` (já revisado) |
| `POST` | `/admin/documents/:id/reject` | `200 { id, status: 'rejected', reviewedAt, rejectionReason }` | `400` (sem `reason`), `401`, `403`, `404`, `409` |

Toda mutação grava `recordAudit` com `entityType: 'user_document'`. O `GET /file` também.

---

## 3. Migração de banco

`packages/db/prisma/migrations/20260806HHMMSS_user_profile_cpf_phone_documents/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "UserDocumentType" AS ENUM ('cnh', 'rg');

-- CreateEnum
CREATE TYPE "UserDocumentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cpf" VARCHAR(200),
ADD COLUMN     "phone" VARCHAR(20);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserDocumentType" NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "status" "UserDocumentStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" VARCHAR(200),
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "fileDeletedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDocument_userId_sentAt_idx" ON "UserDocument"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "UserDocument_status_sentAt_idx" ON "UserDocument"("status", "sentAt");

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Bloco correspondente no `schema.prisma`:

```prisma
enum UserDocumentType {
  cnh
  rg
}

enum UserDocumentStatus {
  pending
  approved
  rejected
}

// Documento de identidade para contratação de assinatura. Auto-aprovação
// otimista: a row nasce `pending` e já libera o gate de assinatura. Revisão
// posterior no admin pode marcar `rejected`, o que NÃO altera o status da
// assinatura — estado de assinatura só muda por webhook verificado.
// `objectKey` aponta para o bucket R2 privado de documentos, nunca o público.
// `fileDeletedAt` marca a purga por retenção: a row sobrevive para auditoria,
// o arquivo não.
model UserDocument {
  id                String             @id @default(cuid())
  userId            String
  type              UserDocumentType
  objectKey         String             @db.VarChar(500)
  status            UserDocumentStatus @default(pending)
  rejectionReason   String?            @db.VarChar(200)
  reviewedByAdminId String?
  reviewedAt        DateTime?
  fileDeletedAt     DateTime?
  sentAt            DateTime           @default(now())
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, sentAt])
  @@index([status, sentAt])
}
```

Rollback:

```sql
DROP TABLE "UserDocument";
DROP TYPE "UserDocumentStatus";
DROP TYPE "UserDocumentType";
ALTER TABLE "User" DROP COLUMN "phone", DROP COLUMN "cpf";
```

Colunas nascem nullable, então o rollback é seguro em qualquer ponto. Registrar em `plans/rebrand-ccc-deferred-migrations.md` se o deploy for parcial.

---

## 4. Telas e fluxos mobile

Reaproveita `TextField` ([components/TextField.tsx](../apps/mobile/src/components/TextField.tsx)), `Button` e `Text` de `@ccc/ui`, `react-hook-form` + `zodResolver`, `expo-image-picker` (já usado em avatar e foto de carro) e o padrão de presign de `api/uploads.ts`.

### 4.1 Cadastro — `app/(auth)/signup.tsx`

Ordem dos campos: nome, e-mail, senha, **CPF (opcional)**, **telefone (opcional)**, **documento (opcional)**, aceite de termos.

- CPF e telefone são `TextField` com `keyboardType="number-pad"` e máscara na apresentação. O valor enviado é só dígitos.
- Rótulo dos três traz o sufixo "opcional" para não parecer obrigatório.
- Documento **não** é upload nesta tela. Presign exige token, que só existe depois do `signup`. É uma linha tocável que grava intenção local.
- `onSubmit` chama `signup(values)` com `cpf`/`phone` quando preenchidos. Se a intenção de documento estava marcada, navega para `/profile/documento?next=/verify-email-pending`. Caso contrário, mantém o `router.replace('/verify-email-pending')` atual.

Estados: `idle` → `submitting` → `error` (erro de campo via `setError`) ou `success`.

### 4.2 Sheet de complementação — `src/components/ProfileCompletionSheet.tsx` (novo)

Componente único, usado por checkout e por assinatura. Não é tela: é modal por cima do fluxo, para não perder o carrinho.

Props: `visible`, `missing: MissingFieldKey[]`, `scope: 'checkout' | 'subscription'`, `onCompleted`, `onDismiss`.

Comportamento:

- Renderiza somente os campos de `missing`. Quem já tem CPF vê só telefone.
- `document` em `missing` não vira campo. Vira botão que navega para `/profile/documento?next=<rota atual>`.
- `cpf`/`phone` são gravados com um único `PATCH /me`.
- Sucesso: invalida o cache de `/me` e `/me/profile-status`, fecha e chama `onCompleted`, que re-executa a ação bloqueada.

Estados: `bloqueado` → `preenchendo` → `salvando` → `salvo` → `continuar fluxo`. Em erro: `salvando` → `erro` → `preenchendo`.

### 4.3 Ganchos de checkout

Todo chamador de checkout ganha o mesmo tratamento: `catch` do `ApiError`, `getApiErrorCode(err) === 'INCOMPLETE_PROFILE'`, lê `body.missing`, abre o sheet, e no `onCompleted` repete a chamada original.

- [ ] `app/(app)/cart/index.tsx` — chamada de `POST /cart/checkout`.
- [ ] `src/screens/buy/web-checkout.ts` — chamada de `POST /orders/checkout`.
- [ ] `src/screens/buy/per-ticket-wizard/` — chamada de `POST /orders`.

Nada de pré-checagem otimista nesses três. O `403` do servidor é a fonte de verdade e evita um round-trip a mais no caminho felizmente comum.

### 4.4 Assinatura — `src/screens/assinaturas/ContratarScreen.tsx`

Aqui a pré-checagem vale, porque o custo de descobrir tarde é abrir um navegador externo à toa.

- No mount, junto do precheck existente, ler `GET /me/profile-status`.
- `subscription.complete === false` → CTA passa a "Completar cadastro", com a lista do que falta.
- Toque abre o `ProfileCompletionSheet` em `scope: 'subscription'`.
- `document` pendente na lista → navega para `/profile/documento?next=/assinaturas/contratar`.
- Voltando com perfil completo, o CTA volta a "Contratar" e `startPremiumCheckout` roda sem alteração ([checkout.ts](../apps/mobile/src/screens/assinaturas/checkout.ts) não muda).
- `403 INCOMPLETE_PROFILE` no `POST /checkout` continua tratado, como rede de segurança para a corrida entre precheck e POST.

### 4.5 Documento — `app/(app)/profile/documento.tsx` (nova) + `src/screens/profile/DocumentoScreen.tsx`

Fluxo: seleção de tipo (CNH ou RG) → captura → preview → envio → estado.

- Captura por `expo-image-picker`, com câmera e galeria. `quality` reduzida para caber em 10 MB.
- Preview mostra a imagem escolhida, com "Trocar" e "Enviar".
- Envio: `POST /me/documents/upload` → `PUT` direto no `uploadUrl` com os `headers` devolvidos → `POST /me/documents`.
- Aceita o parâmetro `next` e navega para lá em caso de sucesso.

Estados e transições:

| Estado | Origem | Saída |
| --- | --- | --- |
| `selecting_type` | entrada | `capturing` |
| `capturing` | tipo escolhido | `preview` ou `selecting_type` (cancelou) |
| `preview` | arquivo escolhido | `uploading` ou `capturing` (trocar) |
| `uploading` | toque em enviar | `sent` ou `error` |
| `error` | falha de presign, PUT ou confirmação | `preview` (tentar de novo) |
| `sent` | `201` do `POST /me/documents` | navega para `next`, ou para `pending` |
| `pending` | `GET /me/documents` retorna `pending` | `approved` ou `rejected` na próxima leitura |
| `approved` | revisão do admin | terminal |
| `rejected` | revisão do admin | mostra `rejectionReason` e volta para `selecting_type` |

Em `pending` o texto deixa claro que a assinatura já está liberada e a análise segue em paralelo. É o que a auto-aprovação otimista promete.

### 4.6 Perfil — `app/(app)/profile/edit.tsx`

- [ ] Campos de CPF e telefone, com a mesma validação do cadastro.
- [ ] Linha de documento mostrando o status atual e link para `/profile/documento`.

### 4.7 Cliente de API mobile

- [ ] `src/api/profile.ts` — `getProfileStatus()`.
- [ ] `src/api/documents.ts` (novo) — `requestDocumentUpload`, `createDocument`, `listDocuments`.
- [ ] `src/api/errors.ts` — `getIncompleteProfileMissing(error): MissingFieldKey[] | null`.
- [ ] `src/copy/profile.ts` — todas as strings PT-BR novas. Nenhuma literal em componente.

---

## 5. Integração de agentes (desenvolvimento)

Execução com `superpowers:subagent-driven-development`. Modelos: orquestrador **Opus 5**, reviewer **Opus 5**, implementadores **Sonnet 5**.

### 5.1 Responsabilidades

| Papel | Modelo | Responsabilidade |
| --- | --- | --- |
| Orquestrador | Opus 5 | Sequencia os lotes, monta o contexto de cada subagente, decide o que roda em paralelo, aplica os gates, integra os diffs. Não escreve código de produto. |
| Reviewer | Opus 5 | Revisa o diff de cada lote antes do merge. Verifica contratos da seção 2, invariantes de webhook e pagamento, cobertura da seção 6, e ausência de PII em log, serializer ou telemetria. Aponta pendências, não corrige. |
| Implementador | Sonnet 5 | Executa uma tarefa de lote, escreve teste e código, roda lint/typecheck/test do escopo dele. |

### 5.2 Lotes e paralelismo

| Lote | Conteúdo | Paralelizável |
| --- | --- | --- |
| B1 | Shared: schemas de CPF, telefone, profile-status, documents, exports do `package.json` | não, é base dos demais |
| B2 | Banco: schema Prisma + migração | sim, com B1 |
| B3 | API: `services/profile/completeness.ts` + `gate.ts` + `GET /me/profile-status` + `PATCH /me` + signup | depende de B1, B2 |
| B4 | API: gates nas 5 rotas de checkout e assinatura | depende de B3 |
| B5 | API: uploads privados + `routes/me-documents.ts` | depende de B1, B2. Paralelo com B4 |
| B6 | API: admin (fila, aprovar, rejeitar, audit) | depende de B5 |
| B7 | API: LGPD (data-export, anonymize, retention, legal) | depende de B2, B5. Paralelo com B6 |
| B8 | Mobile: cliente de API, copy, `ProfileCompletionSheet` | depende de B1 |
| B9 | Mobile: signup, edit, telas de documento | depende de B8, B5 |
| B10 | Mobile: ganchos de checkout e assinatura | depende de B8, B4 |

### 5.3 Gates

- Cada lote entra em review antes do próximo que depende dele.
- Um lote só é entregue com `pnpm lint`, `pnpm typecheck` e os testes do escopo verdes. Evidência colada no handoff, conforme `superpowers:verification-before-completion`.
- Reprovação do reviewer volta ao mesmo implementador com a lista de pendências. Orquestrador não corrige em nome dele.
- Após B10, um único review de integração ponta a ponta antes do PR.

### 5.4 Regras de contexto

- Cada subagente recebe apenas os arquivos do lote dele mais a seção correspondente deste plano.
- Contratos da seção 2 e SQL da seção 3 são congelados depois de B1 e B2. Mudança neles exige decisão do orquestrador e re-review dos lotes já fechados que dependem do contrato.

---

## 6. Matriz mínima de testes obrigatórios

Testes de API contra Postgres real, conforme o CLAUDE.md. Reaproveitar `apps/api/test/helpers.ts` e estender `resetDatabase` com `userDocument`.

| # | Cenário | Critério de aceite técnico |
| --- | --- | --- |
| T1 | Cadastro mínimo | `POST /auth/signup` com nome, e-mail, senha → `201`. `User.cpf` e `User.phone` são `NULL`. `Garage` criada na mesma tx. |
| T2 | Cadastro com opcionais | `POST /auth/signup` com `cpf` e `phone` → `201`. `User.cpf` no banco casa `isEncrypted()`. `GET /me` devolve os 11 dígitos em claro. |
| T3 | CPF inválido no cadastro | dígito verificador errado → `400 ValidationError`. Nenhum `User` criado. |
| T4 | Checkout de carrinho sem CPF nem telefone | `POST /cart/checkout` → `403`, `status: 'incomplete_profile'`, `missing: ['cpf','phone']`. `Cart.status` permanece `open`. `TicketTier.quantitySold` inalterado. Nenhum `Order` criado. |
| T5 | Checkout com CPF e sem telefone | `403` com `missing: ['phone']` apenas. |
| T6 | Complementação libera checkout | `PATCH /me` com `phone` → `200`. Repetir `POST /cart/checkout` → `201`. `Order.status = 'pending'`. |
| T7 | Gate nos dois endpoints legados | `POST /orders` e `POST /orders/checkout` sem CPF → `403` com o mesmo payload. Sem reserva de estoque. |
| T8 | Assinatura sem documento, com CPF e telefone | `GET /checkout-precheck` → `403` com `missing: ['document']`. `POST /checkout` → `403` idem. Nenhuma sessão Stripe criada. |
| T9 | Upload e liberação da assinatura | `POST /me/documents/upload` → `201` com `uploadUrl`. `POST /me/documents` → `201` com `status: 'pending'`. `GET /me/profile-status` → `subscription.complete: true`. `POST /checkout` → `201` com `url`. |
| T10 | Documento de outro usuário | `POST /me/documents` com `objectKey` de outro `userId` → `400`. Nenhuma row criada. |
| T11 | Segundo documento com um pendente | `POST /me/documents` → `409 DOCUMENT_ALREADY_PENDING`. |
| T12 | MIME e tamanho | `POST /me/documents/upload` com `application/pdf` → `400`. Com `size` acima de 10 MB → `400`. |
| T13 | Rejeição não altera assinatura | `POST /admin/documents/:id/reject` → `200`, `status: 'rejected'`. `PremiumMembership.status` inalterado. `AdminAudit` com `entityType: 'user_document'`. `GET /me/profile-status` volta a `subscription.complete: false`. |
| T14 | Flag desligada | `PROFILE_GATE_ENABLED=false` → `POST /cart/checkout` sem CPF retorna `201`. |
| T15 | Rollout percentual | `PROFILE_GATE_ROLLOUT_PERCENT=0` → nenhum usuário bloqueado. `=100` → todos. Bucketing estável para o mesmo `userId` entre chamadas. |
| T16 | Anonimização | após `anonymizeUser`, `User.cpf` e `User.phone` são `NULL`, `UserDocument` do usuário sumiu, `objectKey` está em `UploadDeletionQueue`. |
| T17 | Export de dados | `data-export` inclui `cpf` em claro, `phone` e metadados de `UserDocument`, sem bytes de arquivo. |
| T18 | Serializer admin não vaza | `GET /admin/users/:id` não contém CPF nem URL de documento em nenhum campo da resposta. |
| T19 | Contrato de privacidade do feed | `feed-privacy-contract.test.ts` continua verde com as colunas novas em `User`. |

Mobile: testes de unidade para o parser de `missing` em `src/api/errors.ts`, para a máquina de estados da tela de documento e para a seleção de campos do `ProfileCompletionSheet`.

---

## 7. Rollout e feature flags

### 7.1 Estratégia

1. Deploy com `PROFILE_GATE_ENABLED=false`. Colunas, tabela, endpoints, upload e telas vão para produção inertes. Cadastro já coleta CPF e telefone dos novos usuários, o que aquece a base antes de qualquer bloqueio.
2. Aguardar acúmulo de perfis completos entre os novos cadastros. Sem isso, ligar o gate bloqueia toda a base legada de uma vez.
3. `PROFILE_GATE_ENABLED=true` com `PROFILE_GATE_ROLLOUT_PERCENT=5`.
4. Escalar 5 → 25 → 50 → 100, com pelo menos 24 h de observação em cada passo.
5. Bucketing determinístico por hash de `userId`: o mesmo usuário nunca vê o gate aparecer e desaparecer entre requisições.

### 7.2 Métricas

| Métrica | Fonte | Limiar de alerta |
| --- | --- | --- |
| Taxa de `403 INCOMPLETE_PROFILE` sobre total de tentativas de checkout | log estruturado da API por rota | acima de 40% no bucket ativo |
| Abandono no sheet de complementação | eventos mobile: `sheet_opened` sem `sheet_completed` em 10 min | acima de 50% |
| Conversão de assinatura | `PremiumMembership` criadas por dia, comparado à semana anterior | queda acima de 20% |
| `5xx` nas rotas tocadas | Sentry, tag de rota | qualquer aumento sobre a linha de base |
| Falha de upload de documento | razão `presign_failed`, `put_failed`, `confirm_failed` | acima de 10% dos envios |
| Fila de documentos pendentes | `count(UserDocument where status = 'pending')` | acima de 200 |

### 7.3 Rollback

- Reversão imediata, sem deploy: `PROFILE_GATE_ROLLOUT_PERCENT=0`, ou `PROFILE_GATE_ENABLED=false`. Os gates voltam a liberar e nenhum outro caminho muda.
- Não reverter a migração em incidente de conversão. Colunas nullable e tabela nova não afetam nenhum caminho existente com a flag desligada.
- O SQL de rollback da seção 3 fica reservado para defeito estrutural no schema, não para problema de funil.

---

## 8. Checklist de segurança e uploads

- [ ] MIME aceito apenas `image/jpeg`, `image/png`, `image/webp`. Enum no Zod, não regex.
- [ ] Tamanho máximo de 10 MB, validado no Zod **e** fixado em `ContentLength` no presign. R2 rejeita PUT com tamanho divergente.
- [ ] Extensão derivada de `EXT_FOR_MIME`, nunca do nome enviado pelo cliente.
- [ ] `objectKey` gerado no servidor: `identity-document/<userId>/<cuid2>.<ext>`. Cliente nunca escolhe caminho.
- [ ] `isOwnedKey` validado em `POST /me/documents` antes de criar a row, igual a `me-support.ts:65`.
- [ ] `Metadata: { kind: 'identity_document' }` no PUT, para conferência posterior.
- [ ] Bucket R2 dedicado e privado. Sem dev subdomain, sem custom domain, sem política de leitura pública. Este item é bloqueante: no bucket público atual, quem conhece o `objectKey` lê o arquivo, e o cuid2 é apenas difícil de adivinhar, não um controle de acesso.
- [ ] `ContentDisposition: 'attachment'` e `CacheControl: 'private, no-store'` para este kind.
- [ ] Leitura só por signed GET com TTL de 60 s. Nunca `buildPublicUrl`.
- [ ] Rate limit de 5 por 15 minutos por usuário em `upload` e em `documents`, chaveado por `sub`.
- [ ] `GET /admin/documents/:id/file` restrito a `organizer` e `admin`. Staff bloqueado.
- [ ] `recordAudit` em toda visualização e decisão de documento, com `actorId`, `entityId` e motivo.
- [ ] CPF cifrado em repouso com `encryptField`. Nunca em log, nunca em breadcrumb, nunca em serializer de admin, nunca em resposta de feed.
- [ ] Retenção: arquivo de documento `approved` purgado após 90 dias, `rejected` após 30 dias, via `UploadDeletionQueue` e `retention.ts`. `fileDeletedAt` marcado. Row preservada para auditoria.
- [ ] Anonimização remove CPF, telefone, rows de documento e enfileira os arquivos.
- [ ] Nenhum campo novo entra em query string. Sempre corpo de requisição.

---

## 9. Notas de implementação

### 9.1 Dependências internas a reaproveitar

| Necessidade | Módulo existente |
| --- | --- |
| Autenticação | `app.authenticate` + `requireUser` ([plugins/auth.ts](../apps/api/src/plugins/auth.ts)) |
| Cifra de campo | `encryptField` / `decryptField` ([services/crypto/field-encryption.ts](../apps/api/src/services/crypto/field-encryption.ts)) |
| Presign e signed GET | `app.uploads` ([services/uploads/](../apps/api/src/services/uploads/)) |
| Anexo privado, precedente completo | [routes/me-support.ts](../apps/api/src/routes/me-support.ts) |
| Endpoint de upload com kind injetado | `POST /me/garage/cover/upload` ([api/uploads.ts:32](../apps/mobile/src/api/uploads.ts:32)) |
| Purga de objeto | `queueObjectDeletion` ([services/uploads/deletion-queue.ts](../apps/api/src/services/uploads/deletion-queue.ts)) + `workers/retention.ts` |
| Audit de admin | `recordAudit` ([services/admin-audit.ts](../apps/api/src/services/admin-audit.ts)) |
| Paginação por cursor no admin | [routes/admin/users.ts:20-29](../apps/api/src/routes/admin/users.ts:20) |
| Rate limit por usuário | [routes/me-support.ts:46-53](../apps/api/src/routes/me-support.ts:46) |
| Flag de env booleana | padrão `GROWTH_PREMIUM_BILLING_ENABLED` ([env.ts:72](../apps/api/src/env.ts:72)) |
| Erro tipado no mobile | `ApiError` + `getApiErrorCode` ([api/errors.ts](../apps/mobile/src/api/errors.ts)) |
| Captura de imagem | `expo-image-picker`, já usado em avatar e foto de carro |

Nada de fila nova, worker novo ou dependência externa nova.

### 9.2 Premissas

- `FIELD_ENCRYPTION_KEY` já está configurada em todos os ambientes. É pré-requisito do fluxo de suporte que já roda.
- CPF cifrado não é pesquisável nem único. Não foi pedido bloqueio de CPF duplicado entre contas.
- Documento aceita imagem, não PDF. Adicionar PDF exige separar a allowlist de MIME de documento da de imagem e estender `EXT_FOR_MIME`.
- Um documento vivo por usuário. Reenvio só depois de rejeição.
- Assinatura via Apple/RevenueCat não passa por `POST /api/me/premium/checkout` e portanto não é coberta pelo gate. Se o requisito valer para iOS também, é escopo adicional no webhook do RevenueCat.
- AbacatePay aceita `customer.taxId` ([abacatepay/index.ts:21](../apps/api/src/services/abacatepay/index.ts:21)) e hoje nenhum caller preenche. Com CPF disponível no perfil, passar a preencher é melhoria natural, mas fora deste escopo.

### 9.3 Riscos e mitigantes

| Risco | Mitigante |
| --- | --- |
| Queda de conversão no checkout ao ligar o gate | Rollout percentual com bucketing estável, métrica de bloqueio com limiar, reversão por variável de ambiente sem deploy. |
| Base legada inteira bloqueada de uma vez | Deploy inerte primeiro, coleta no cadastro antes de ligar o gate, escalada de 5% em diante. |
| Documento em bucket público | Bucket dedicado privado é item bloqueante do checklist da seção 8. Sem ele, o lote B5 não passa no review. |
| Atrito extra na assinatura afugentar contratação | Auto-aprovação otimista: o `pending` já libera. A tela deixa isso explícito. |
| CPF vazando em log ou telemetria | Scrubbers de Sentry já cobrem o padrão. Reviewer checa serializer por serializer. Teste T18 fixa o contrato do admin. |
| Fila de documentos crescer sem revisão | Métrica de pendentes com limiar de 200. Revisão é assíncrona por desenho, não bloqueia receita. |
| `Cart` travado em `checking_out` por bloqueio tardio | Gate roda antes de `loadCartForCheckout`, antes de qualquer transição de status ou reserva de estoque. Teste T4 fixa isso. |
| Corrida entre precheck e POST de assinatura | Gate repetido no POST, mesmo padrão que o código já usa para `AlreadySubscribed`. |
