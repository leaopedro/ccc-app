# Perfil Progressivo — API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro aceita nome, e-mail e senha; CPF e telefone entram opcionais. Compra avulsa passa a exigir CPF e telefone. Assinatura passa a exigir CPF, telefone e um documento de identidade enviado.

**Architecture:** Um serviço único de completude (`services/profile/completeness.ts`) é a fonte de verdade, e um helper de gate (`services/profile/gate.ts`) o aplica nas cinco rotas de pagamento. Documento de identidade usa presign R2 em bucket privado dedicado, com row `UserDocument` em auto-aprovação otimista: nasce `pending` e já libera a assinatura. Tudo atrás da flag `PROFILE_GATE_ENABLED` com rollout percentual determinístico.

**Tech Stack:** Fastify, Prisma, Zod, `@aws-sdk/client-s3` + `s3-request-presigner`, Vitest com Postgres real.

**Spec:** [plans/perfil-progressivo-plan.md](../../../plans/perfil-progressivo-plan.md). Escopo deste plano: lotes B1 a B7. Mobile (B8 a B10) tem plano próprio, escrito depois que esta API estiver verde.

## Global Constraints

- Idioma primário PT-BR. Toda mensagem voltada ao usuário em português. Chaves de contrato e identificadores em inglês.
- Comentário de código em inglês, seguindo o estilo do arquivo que você está editando. A regra de não usar em-dash vale para prosa em markdown e para texto voltado ao usuário, não para comentários de código: `schema.prisma` já tem em-dashes pré-existentes, e exigir o contrário dentro de uma tarefa criaria inconsistência local sem varredura no repo.
- `Order` só vira `paid` por webhook verificado. Nenhuma tarefa aqui toca status de pedido ou de assinatura.
- Estado de assinatura só muda por webhook verificado. Rejeitar documento **não** escreve em `PremiumMembership`.
- CPF cifrado em repouso com `encryptField`, chave `FIELD_ENCRYPTION_KEY`. Nunca em log, breadcrumb, serializer de admin ou payload de feed.
- Documento vive em bucket R2 privado. Leitura só por signed GET. Nunca `buildPublicUrl`.
- Testes de integração da API rodam contra Postgres real via `global-setup.ts`. Sem mock de banco.
- Colunas novas nascem nullable. Nenhum backfill, nenhum `NOT NULL`.
- Chaves de `missing` são exatamente `cpf`, `phone`, `document`, nesta ordem.
- Payload de bloqueio carrega `status: "incomplete_profile"` **e** `code: "INCOMPLETE_PROFILE"`. Os dois. `status` atende o contrato pedido; `code` é o que `getApiErrorCode` do mobile já lê.
- Gate roda antes de qualquer reserva de estoque, transição de `Cart.status` ou chamada a provedor de pagamento.
- Cada tarefa termina com lint, typecheck e os testes do escopo verdes antes do commit.
- **Lint e typecheck sempre com filtro de pacote**, nunca no repo inteiro. `pnpm lint` sem filtro estoura o heap do Node neste repo, mesmo com 8 GB, e a falha é pré-existente e não relacionada a esta feature. Use `pnpm --filter @ccc/shared lint`, `pnpm --filter @ccc/api lint`, e o mesmo para `typecheck`.
- **Testes de integração da API exigem o daemon do Docker** rodando, porque `apps/api/test/global-setup.ts` levanta um Postgres via Testcontainers. Sem daemon, a suíte não roda e a tarefa não pode ser declarada pronta com base só em typecheck.
- **Teste focado não usa `pnpm ... test -- <padrão>`.** Nesta versão do pnpm o `--` chega ao vitest como argumento literal, o filtro é ignorado e a suíte inteira roda em silêncio. Numa suíte de 800 testes com Testcontainers isso parece travamento. Use `exec`, que não passa pelo encaminhamento de argumentos do runner de scripts:

```bash
pnpm --filter @ccc/api exec vitest run test/<caminho>
```

  A suíte **completa** também precisa de `exec`, pelo mesmo motivo mais um:

```bash
pnpm --filter @ccc/api exec vitest run
```

- **`pnpm --filter @ccc/api test` está quebrado neste ambiente.** O hook `pretest` roda `prisma generate`, que falha com `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`. Algum processo de vida longa mantém a DLL aberta, e o repositório fica dentro do OneDrive, que também tranca arquivos durante sync. O `node_modules/.prisma/client/` acumula vários `.tmp` de renames falhados, prova de que isso vem ocorrendo há tempo.

  Isso **não** invalida os testes. A DLL é o engine binário e não muda com o schema; o que muda são o JS e os tipos, e esses regeneram normalmente. O client no disco está atual: `grep -c UserDocument node_modules/.prisma/client/index.d.ts` retorna 739. Portanto rodar o vitest direto, pulando o `pretest`, testa o schema correto.

  Depois de alterar `schema.prisma`, gere o client com `pnpm --filter @ccc/db exec prisma migrate dev`, que já regenera, ou tente `db:generate` e confirme pelo grep acima que os tipos novos entraram, mesmo que o rename da DLL falhe no fim.

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/shared/src/profile-status.ts` | Escopos, chaves de `missing`, schema de status de perfil, construtor do erro 403. |
| `packages/shared/src/documents.ts` | Tipos e status de documento, allowlist de MIME, schemas de upload e de listagem. |
| `packages/shared/src/__tests__/profile-cpf-phone.test.ts` | Unidade de `cpfSchema` e `phoneSchema`. |
| `apps/api/src/services/profile/completeness.ts` | Leitura da completude. Uma query. Sem HTTP. |
| `apps/api/src/services/profile/gate.ts` | Flag, rollout, e a reply 403. Única coisa que rotas chamam. |
| `apps/api/src/routes/me-documents.ts` | `POST /me/documents/upload`, `POST /me/documents`, `GET /me/documents`. |
| `apps/api/src/routes/admin/documents.ts` | Fila de revisão, visualização auditada, aprovar, rejeitar. |
| `apps/api/test/profile/completeness.test.ts` | Unidade do serviço de completude e do bucketing. |
| `apps/api/test/profile/profile-status.route.test.ts` | `GET /me/profile-status`. |
| `apps/api/test/profile/gate-checkout.test.ts` | Gate nas três rotas de compra avulsa. |
| `apps/api/test/profile/gate-subscription.test.ts` | Gate nas duas rotas de assinatura. |
| `apps/api/test/documents/me-documents.test.ts` | Upload, confirmação, listagem, posse, duplicidade. |
| `apps/api/test/documents/admin-documents.test.ts` | Fila, papéis, aprovar, rejeitar, audit. |
| `packages/db/prisma/migrations/<ts>_user_profile_cpf_phone_documents/migration.sql` | DDL. |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `packages/shared/src/profile.ts` | `cpfSchema`, `phoneSchema`, campos em `updateProfileSchema` e `publicProfileSchema`. |
| `packages/shared/src/auth.ts` | `signupSchema` ganha `cpf` e `phone` opcionais. |
| `packages/shared/src/admin.ts` | Ações de audit e schema de documento no detalhe de usuário. |
| `packages/shared/src/legal.ts` | Bases legais e retenção das duas finalidades novas. |
| `packages/shared/package.json` | Exports `./profile-status` e `./documents`. |
| `packages/db/prisma/schema.prisma` | `User.cpf`, `User.phone`, `User.documents`, enums e modelo `UserDocument`. |
| `apps/api/src/env.ts` | 4 variáveis novas. |
| `apps/api/src/services/uploads/types.ts` | Kind `identity_document`, prefixo, constantes de documento. |
| `apps/api/src/services/uploads/r2.ts` | Bucket alvo por prefixo, headers privados. |
| `apps/api/src/services/uploads/dev.ts` | Espelhar headers privados. |
| `apps/api/src/services/uploads/index.ts` | Passar `R2_DOCUMENTS_BUCKET` ao construtor. |
| `apps/api/src/routes/me.ts` | `cpf`/`phone` no serializer e no PATCH; `GET /me/profile-status`. |
| `apps/api/src/routes/auth/signup.ts` | Gravar `cpf`/`phone` na tx existente. |
| `apps/api/src/routes/cart.ts` | Gate `checkout`. |
| `apps/api/src/routes/orders.ts` | Gate `checkout` em duas rotas. |
| `apps/api/src/routes/me-premium.ts` | Gate `subscription` em duas rotas. |
| `apps/api/src/routes/admin/users.ts` | `hasCpf`, `hasPhone`, lista de documentos. |
| `apps/api/src/routes/admin/index.ts` | Registrar `adminDocumentRoutes`. |
| `apps/api/src/services/admin-audit.ts` | `entityType: 'user_document'`. |
| `apps/api/src/services/data-export.ts` | CPF, telefone e metadados de documento. |
| `apps/api/src/services/account-deletion/anonymize.ts` | Zerar CPF/telefone, enfileirar arquivos. |
| `apps/api/src/workers/retention.ts` | Purga de arquivo de documento por idade. |
| `apps/api/src/app.ts` | Registrar `meDocumentRoutes`. |
| `apps/api/test/helpers.ts` | `resetDatabase` limpa `userDocument`. |
| `apps/api/test/setup.ts` | Limpar as flags novas em `beforeEach`. |

---

## Task 1: Shared — validação de CPF e telefone

**Files:**
- Modify: `packages/shared/src/profile.ts`
- Test: `packages/shared/src/__tests__/profile-cpf-phone.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `cpfSchema: ZodType<string>` e `phoneSchema: ZodType<string>`, ambos aceitando entrada mascarada e devolvendo só dígitos. `updateProfileSchema` com `cpf?: string` e `phone?: string`. `publicProfileSchema` com `cpf: string | null` e `phone: string | null`.

- [ ] **Step 1: Write the failing test**

Criar `packages/shared/src/__tests__/profile-cpf-phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { cpfSchema, phoneSchema, publicProfileSchema, updateProfileSchema } from '../profile.js';

describe('cpfSchema', () => {
  it('accepts a valid CPF and strips the mask', () => {
    expect(cpfSchema.parse('529.982.247-25')).toBe('52998224725');
  });

  it('accepts a valid CPF already unmasked', () => {
    expect(cpfSchema.parse('52998224725')).toBe('52998224725');
  });

  it('rejects a CPF whose check digits are wrong', () => {
    expect(cpfSchema.safeParse('529.982.247-26').success).toBe(false);
  });

  it('rejects repeated-digit sequences that pass the arithmetic', () => {
    expect(cpfSchema.safeParse('11111111111').success).toBe(false);
    expect(cpfSchema.safeParse('00000000000').success).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(cpfSchema.safeParse('5299822472').success).toBe(false);
    expect(cpfSchema.safeParse('529982247250').success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('accepts an 11-digit mobile and strips the mask', () => {
    expect(phoneSchema.parse('(11) 98765-4321')).toBe('11987654321');
  });

  it('accepts a 10-digit landline', () => {
    expect(phoneSchema.parse('1132654321')).toBe('1132654321');
  });

  it('rejects a DDD starting with zero', () => {
    expect(phoneSchema.safeParse('01987654321').success).toBe(false);
  });

  it('rejects too few and too many digits', () => {
    expect(phoneSchema.safeParse('119876543').success).toBe(false);
    expect(phoneSchema.safeParse('119876543210').success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts cpf and phone as partials', () => {
    expect(updateProfileSchema.parse({ cpf: '529.982.247-25' })).toEqual({ cpf: '52998224725' });
    expect(updateProfileSchema.parse({ phone: '(11) 98765-4321' })).toEqual({
      phone: '11987654321',
    });
  });

  it('still accepts an empty object', () => {
    expect(updateProfileSchema.parse({})).toEqual({});
  });
});

describe('publicProfileSchema', () => {
  const base = {
    id: 'u1',
    email: 'a@b.test',
    name: 'A',
    role: 'user' as const,
    emailVerifiedAt: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    bio: null,
    city: null,
    stateCode: null,
    avatarUrl: null,
  };

  it('accepts null cpf and phone', () => {
    const parsed = publicProfileSchema.parse({ ...base, cpf: null, phone: null });
    expect(parsed.cpf).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it('accepts digit strings for cpf and phone', () => {
    const parsed = publicProfileSchema.parse({
      ...base,
      cpf: '52998224725',
      phone: '11987654321',
    });
    expect(parsed.cpf).toBe('52998224725');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/shared test -- profile-cpf-phone`
Expected: FAIL. `cpfSchema` e `phoneSchema` não existem.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/profile.ts`, acima de `updateProfileSchema`:

```ts
const CPF_DIGITS_RE = /^\d{11}$/;
const CPF_REPEATED_RE = /^(\d)\1{10}$/;

// Modulo-11 check digits, the standard Receita Federal algorithm. The
// repeated-digit guard is not redundant: sequences like 111.111.111-11
// satisfy the arithmetic and would otherwise pass.
const isValidCpf = (digits: string): boolean => {
  if (!CPF_DIGITS_RE.test(digits)) return false;
  if (CPF_REPEATED_RE.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const rounds: ReadonlyArray<readonly [number, number]> = [
    [9, 10],
    [10, 11],
  ];
  for (const [len, startWeight] of rounds) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += nums[i]! * (startWeight - i);
    const expected = ((sum * 10) % 11) % 10;
    if (expected !== nums[len]) return false;
  }
  return true;
};

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

// Both schemas accept masked input from the client and normalize to digits.
// Digits are what the DB stores, so every read path sees one shape.
export const cpfSchema = z
  .string()
  .transform(digitsOnly)
  .refine(isValidCpf, { message: 'CPF inválido' });

// Brazilian DDD + subscriber number: 10 digits (landline) or 11 (mobile).
// No DDD starts with 0.
export const phoneSchema = z
  .string()
  .transform(digitsOnly)
  .refine((v) => /^[1-9]{2}\d{8,9}$/.test(v), { message: 'Telefone inválido' });
```

Estender `updateProfileSchema`:

```ts
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    bio: z.string().trim().max(500),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    avatarObjectKey: z.string().min(1).max(300).nullable(),
    cpf: cpfSchema,
    phone: phoneSchema,
  })
  .partial();
```

Estender `publicProfileSchema` com dois campos, depois de `avatarUrl`:

```ts
  cpf: z.string().nullable(),
  phone: z.string().nullable(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/shared test -- profile-cpf-phone`
Expected: PASS, 13 testes.

- [ ] **Step 5: Run the full shared suite**

Run: `pnpm --filter @ccc/shared test`
Expected: PASS. `feed-privacy-contract.test.ts` continua verde — a denylist dele já cobre `cpf` e `phone`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/profile.ts packages/shared/src/__tests__/profile-cpf-phone.test.ts
git commit -m "feat(shared): schemas de CPF e telefone no perfil"
```

---

## Task 2: Shared — contratos de status de perfil e de documento

**Files:**
- Create: `packages/shared/src/profile-status.ts`
- Create: `packages/shared/src/documents.ts`
- Modify: `packages/shared/src/auth.ts`
- Modify: `packages/shared/package.json`
- Test: `packages/shared/src/__tests__/profile-status.test.ts`

**Interfaces:**
- Consumes: `cpfSchema`, `phoneSchema` da Task 1.
- Produces:
  - `PROFILE_SCOPES = ['checkout', 'subscription']`, type `ProfileScope`.
  - `MISSING_FIELD_KEYS = ['cpf', 'phone', 'document']`, type `MissingFieldKey`.
  - `INCOMPLETE_PROFILE_CODE = 'INCOMPLETE_PROFILE'`, `INCOMPLETE_PROFILE_STATUS = 'incomplete_profile'`.
  - `buildIncompleteProfileError(missing: MissingFieldKey[]): IncompleteProfileError`.
  - `profileStatusSchema`, `incompleteProfileErrorSchema`.
  - `USER_DOCUMENT_TYPES = ['cnh', 'rg']`, `USER_DOCUMENT_STATUSES = ['pending', 'approved', 'rejected']`, `LIVE_DOCUMENT_STATUSES = ['pending', 'approved']`.
  - `ALLOWED_DOCUMENT_TYPES`, `MAX_DOCUMENT_BYTES`.
  - `documentUploadRequestSchema`, `documentUploadResponseSchema`, `createDocumentBodySchema`, `userDocumentSchema`, `userDocumentListResponseSchema`.
  - `signupSchema` com `cpf?: string` e `phone?: string`.

- [ ] **Step 1: Write the failing test**

Criar `packages/shared/src/__tests__/profile-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { signupSchema } from '../auth.js';
import {
  createDocumentBodySchema,
  documentUploadRequestSchema,
  MAX_DOCUMENT_BYTES,
  userDocumentSchema,
} from '../documents.js';
import {
  buildIncompleteProfileError,
  incompleteProfileErrorSchema,
  MISSING_FIELD_KEYS,
  profileStatusSchema,
} from '../profile-status.js';

describe('profile-status contracts', () => {
  it('keeps the missing-key order stable', () => {
    expect(MISSING_FIELD_KEYS).toEqual(['cpf', 'phone', 'document']);
  });

  it('builds a 403 payload carrying both status and code', () => {
    const payload = buildIncompleteProfileError(['cpf', 'phone']);
    expect(payload.error).toBe('Forbidden');
    expect(payload.status).toBe('incomplete_profile');
    expect(payload.code).toBe('INCOMPLETE_PROFILE');
    expect(payload.missing).toEqual(['cpf', 'phone']);
    expect(incompleteProfileErrorSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an empty missing list', () => {
    expect(incompleteProfileErrorSchema.safeParse(buildIncompleteProfileError([])).success).toBe(
      false,
    );
  });

  it('parses a full profile status', () => {
    const parsed = profileStatusSchema.parse({
      fields: { cpf: true, phone: false, document: false },
      checkout: { complete: false, missing: ['phone'] },
      subscription: { complete: false, missing: ['phone', 'document'] },
      latestDocument: {
        id: 'd1',
        type: 'cnh',
        status: 'pending',
        sentAt: '2026-08-06T00:00:00.000Z',
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    expect(parsed.subscription.missing).toEqual(['phone', 'document']);
  });

  it('accepts a null latestDocument', () => {
    const parsed = profileStatusSchema.parse({
      fields: { cpf: false, phone: false, document: false },
      checkout: { complete: false, missing: ['cpf', 'phone'] },
      subscription: { complete: false, missing: ['cpf', 'phone', 'document'] },
      latestDocument: null,
    });
    expect(parsed.latestDocument).toBeNull();
  });
});

describe('document contracts', () => {
  it('accepts an allowed image type within the size cap', () => {
    expect(
      documentUploadRequestSchema.parse({ contentType: 'image/jpeg', size: 1024 }),
    ).toEqual({ contentType: 'image/jpeg', size: 1024 });
  });

  it('rejects pdf', () => {
    expect(
      documentUploadRequestSchema.safeParse({ contentType: 'application/pdf', size: 1024 }).success,
    ).toBe(false);
  });

  it('rejects a size above the cap', () => {
    expect(
      documentUploadRequestSchema.safeParse({
        contentType: 'image/png',
        size: MAX_DOCUMENT_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('accepts a create body with a known type', () => {
    const parsed = createDocumentBodySchema.parse({
      type: 'rg',
      objectKey: 'identity-document/u1/abc.jpg',
    });
    expect(parsed.type).toBe('rg');
  });

  it('rejects an unknown document type', () => {
    expect(
      createDocumentBodySchema.safeParse({ type: 'passport', objectKey: 'x' }).success,
    ).toBe(false);
  });

  it('allows a null fileUrl for a purged document', () => {
    const parsed = userDocumentSchema.parse({
      id: 'd1',
      type: 'cnh',
      status: 'approved',
      sentAt: '2026-08-06T00:00:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      rejectionReason: null,
      fileUrl: null,
    });
    expect(parsed.fileUrl).toBeNull();
  });
});

describe('signupSchema', () => {
  const base = { name: 'A', email: 'a@b.test', password: 'correct-horse-battery' };

  it('accepts the minimum payload', () => {
    const parsed = signupSchema.parse(base);
    expect(parsed.cpf).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('accepts and normalizes optional cpf and phone', () => {
    const parsed = signupSchema.parse({
      ...base,
      cpf: '529.982.247-25',
      phone: '(11) 98765-4321',
    });
    expect(parsed.cpf).toBe('52998224725');
    expect(parsed.phone).toBe('11987654321');
  });

  it('rejects an invalid optional cpf instead of ignoring it', () => {
    expect(signupSchema.safeParse({ ...base, cpf: '111.111.111-11' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/shared test -- profile-status`
Expected: FAIL. Módulos `profile-status.js` e `documents.js` não existem.

- [ ] **Step 3: Write minimal implementation**

Criar `packages/shared/src/profile-status.ts`:

```ts
import { z } from 'zod';

import { USER_DOCUMENT_STATUSES, USER_DOCUMENT_TYPES } from './documents.js';

// The two gates. `checkout` covers one-off purchases (tickets, day-use,
// store); `subscription` covers recurring membership.
export const PROFILE_SCOPES = ['checkout', 'subscription'] as const;
export const profileScopeSchema = z.enum(PROFILE_SCOPES);
export type ProfileScope = z.infer<typeof profileScopeSchema>;

// Order is part of the contract: clients render the completion form in this
// sequence. Do not sort at the call site.
export const MISSING_FIELD_KEYS = ['cpf', 'phone', 'document'] as const;
export const missingFieldKeySchema = z.enum(MISSING_FIELD_KEYS);
export type MissingFieldKey = z.infer<typeof missingFieldKeySchema>;

export const INCOMPLETE_PROFILE_CODE = 'INCOMPLETE_PROFILE' as const;
export const INCOMPLETE_PROFILE_STATUS = 'incomplete_profile' as const;
export const INCOMPLETE_PROFILE_MESSAGE = 'Complete seu cadastro para continuar.';

// `status` satisfies the product contract; `code` is what the mobile
// getApiErrorCode helper already reads off every other coded error in this
// API. Both ship so neither side needs a second parsing path.
export const incompleteProfileErrorSchema = z.object({
  error: z.literal('Forbidden'),
  status: z.literal(INCOMPLETE_PROFILE_STATUS),
  code: z.literal(INCOMPLETE_PROFILE_CODE),
  missing: z.array(missingFieldKeySchema).min(1),
  message: z.string().min(1),
});
export type IncompleteProfileError = z.infer<typeof incompleteProfileErrorSchema>;

export const buildIncompleteProfileError = (
  missing: readonly MissingFieldKey[],
): IncompleteProfileError => ({
  error: 'Forbidden',
  status: INCOMPLETE_PROFILE_STATUS,
  code: INCOMPLETE_PROFILE_CODE,
  missing: [...missing],
  message: INCOMPLETE_PROFILE_MESSAGE,
});

const scopeStatusSchema = z.object({
  complete: z.boolean(),
  missing: z.array(missingFieldKeySchema),
});

export const profileStatusSchema = z.object({
  fields: z.object({
    cpf: z.boolean(),
    phone: z.boolean(),
    document: z.boolean(),
  }),
  checkout: scopeStatusSchema,
  subscription: scopeStatusSchema,
  latestDocument: z
    .object({
      id: z.string().min(1),
      type: z.enum(USER_DOCUMENT_TYPES),
      status: z.enum(USER_DOCUMENT_STATUSES),
      sentAt: z.string().datetime(),
      reviewedAt: z.string().datetime().nullable(),
      rejectionReason: z.string().nullable(),
    })
    .nullable(),
});
export type ProfileStatus = z.infer<typeof profileStatusSchema>;
```

Criar `packages/shared/src/documents.ts`:

```ts
import { z } from 'zod';

export const USER_DOCUMENT_TYPES = ['cnh', 'rg'] as const;
export type UserDocumentType = (typeof USER_DOCUMENT_TYPES)[number];

export const USER_DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type UserDocumentStatus = (typeof USER_DOCUMENT_STATUSES)[number];

// Deliberately separate from ALLOWED_IMAGE_TYPES in ./uploads. Adding PDF to
// documents must not widen what avatars and car photos accept.
export const ALLOWED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const documentUploadRequestSchema = z
  .object({
    contentType: z.enum(ALLOWED_DOCUMENT_TYPES),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  })
  .strict();
export type DocumentUploadRequest = z.infer<typeof documentUploadRequestSchema>;

// No `publicUrl`: presignResponseSchema in ./uploads requires it to be a valid
// URL, and an identity document has no public URL by design.
export const documentUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string()),
});
export type DocumentUploadResponse = z.infer<typeof documentUploadResponseSchema>;

export const createDocumentBodySchema = z
  .object({
    type: z.enum(USER_DOCUMENT_TYPES),
    objectKey: z.string().min(1).max(500),
  })
  .strict();
export type CreateDocumentBody = z.infer<typeof createDocumentBodySchema>;

export const userDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(USER_DOCUMENT_TYPES),
  status: z.enum(USER_DOCUMENT_STATUSES),
  sentAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  // Null once retention purged the object; the row survives for audit.
  fileUrl: z.string().nullable(),
});
export type UserDocument = z.infer<typeof userDocumentSchema>;

export const userDocumentListResponseSchema = z.object({
  items: z.array(userDocumentSchema),
});

export const DOCUMENT_ALREADY_PENDING_CODE = 'DOCUMENT_ALREADY_PENDING' as const;

// A "live" document is one that satisfies the subscription gate. Single source
// of truth: services/profile/completeness.ts filters on it, and
// routes/me-documents.ts enforces one-live-at-a-time with it. Optimistic
// auto-approval is exactly the decision that `pending` belongs in this list.
export const LIVE_DOCUMENT_STATUSES = ['pending', 'approved'] as const;
```

Em `packages/shared/src/auth.ts`, importar os schemas e estender o signup:

```ts
import { cpfSchema, phoneSchema } from './profile.js';

export const signupSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  // Permissive signup: collected when offered, never required. An invalid
  // value is still a 400 — silently dropping bad input would leave the user
  // believing the field was saved.
  cpf: cpfSchema.optional(),
  phone: phoneSchema.optional(),
});
```

Em `packages/shared/package.json`, dentro de `exports`, depois do bloco `./cars`:

```json
    "./documents": {
      "types": "./src/documents.ts",
      "default": "./dist/documents.js"
    },
```

e depois do bloco `./profile`:

```json
    "./profile-status": {
      "types": "./src/profile-status.ts",
      "default": "./dist/profile-status.js"
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/shared test -- profile-status`
Expected: PASS, 14 testes.

- [ ] **Step 5: Verify the whole package builds and lints**

Run: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/shared lint && pnpm --filter @ccc/shared test`
Expected: PASS. O build precisa emitir `dist/profile-status.js` e `dist/documents.js`, senão os exports do `package.json` apontam para o vazio.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/profile-status.ts packages/shared/src/documents.ts packages/shared/src/auth.ts packages/shared/package.json packages/shared/src/__tests__/profile-status.test.ts
git commit -m "feat(shared): contratos de status de perfil e documento de identidade"
```

---

## Task 3: Banco — colunas de perfil e tabela de documentos

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_user_profile_cpf_phone_documents/migration.sql`
- Modify: `apps/api/test/helpers.ts:98-109`

**Interfaces:**
- Consumes: nada.
- Produces: `prisma.user.cpf: string | null`, `prisma.user.phone: string | null`, `prisma.userDocument` com campos `id`, `userId`, `type`, `objectKey`, `status`, `rejectionReason`, `reviewedByAdminId`, `reviewedAt`, `fileDeletedAt`, `sentAt`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/migrations/user-documents.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('User profile columns and UserDocument table', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('creates a user with null cpf and phone', async () => {
    const { user } = await createUser();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
  });

  it('stores cpf and phone when provided', async () => {
    const { user } = await createUser();
    const row = await prisma.user.update({
      where: { id: user.id },
      data: { cpf: 'enc_v1:aa:bb:cc', phone: '11987654321' },
    });
    expect(row.cpf).toBe('enc_v1:aa:bb:cc');
    expect(row.phone).toBe('11987654321');
  });

  it('creates a document defaulting to pending', async () => {
    const { user } = await createUser();
    const doc = await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    expect(doc.status).toBe('pending');
    expect(doc.reviewedAt).toBeNull();
    expect(doc.fileDeletedAt).toBeNull();
    expect(doc.sentAt).toBeInstanceOf(Date);
  });

  it('cascades document deletion when the user is removed', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- migrations/user-documents`
Expected: FAIL. `prisma.userDocument` não existe no client.

- [ ] **Step 3: Write minimal implementation**

Em `packages/db/prisma/schema.prisma`, no bloco `User`, depois de `avatarObjectKey` (linha 51):

```prisma
  // Progressive profile. Both nullable by design: signup requires only
  // name/email/password. `cpf` holds ciphertext from encryptField (enc_v1:...),
  // hence the width — it is NOT searchable and NOT unique.
  cpf   String? @db.VarChar(200)
  phone String? @db.VarChar(20)
```

Na lista de relações do `User`, depois de `consents`:

```prisma
  documents           UserDocument[]
```

No fim do arquivo, ou junto dos outros modelos de usuário:

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

// Identity document for subscription onboarding. Optimistic auto-approval:
// the row is born `pending` and already satisfies the subscription gate.
// A later admin review may set `rejected`, which does NOT touch
// PremiumMembership — subscription state only ever changes through a
// verified webhook.
//
// `objectKey` points at the PRIVATE documents bucket, never the public one.
// `fileDeletedAt` marks a retention purge: the row survives for audit, the
// object does not.
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

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @ccc/db exec prisma migrate dev --name user_profile_cpf_phone_documents`
Expected: cria a pasta de migração e regenera o client.

Conferir que o SQL gerado casa com isto. Corrigir à mão se divergir:

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

- [ ] **Step 5: Extend resetDatabase**

Em `apps/api/test/helpers.ts`, antes da linha `await prisma.supportTicket.deleteMany();`:

```ts
  await prisma.userDocument.deleteMany();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- migrations/user-documents`
Expected: PASS, 4 testes.

- [ ] **Step 7: Verify no existing test regressed**

Run: `pnpm --filter @ccc/api test`

Expected: 2035 passando, e **9 falhas em 3 arquivos**, todas com uma única causa raiz:

| Arquivo | Asserts |
| --- | --- |
| `apps/api/test/me/patch.test.ts` | 6 |
| `apps/api/test/me/get.test.ts` | 2 |
| `apps/api/test/me/email-change.test.ts` | 1 |

Causa raiz: `serializeUser` em [me.ts:31](../../../apps/api/src/routes/me.ts:31) chama `publicProfileSchema.parse`, e a Task 1 tornou `cpf` e `phone` obrigatórios no schema enquanto a resposta de `/me` só ganha os campos na Task 5. O parse lança antes de devolver 200, e o `errorHandler` mapeia `ZodError` para **400** ([error-handler.ts](../../../apps/api/src/plugins/error-handler.ts)), então `GET /me` ([me.ts:53](../../../apps/api/src/routes/me.ts:53)) e `PATCH /me` ([me.ts:92](../../../apps/api/src/routes/me.ts:92)) devolvem 400 nesta branch até a Task 5. Os testes falham no `expect(res.statusCode).toBe(200)`, não no `parse` deles. Qualquer teste que leia `/me` cai junto.

Falha esperada e transitória, **não** causada por esta tarefa: não tente corrigir aqui, e não altere o schema para acomodar. A Task 5 fecha as três de uma vez, porque a correção é no serializer, não nos testes.

Qualquer outra falha é regressão desta tarefa. Colunas nullable e tabela nova não alteram nenhum caminho existente.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/test/helpers.ts apps/api/test/migrations/user-documents.test.ts
git commit -m "feat(db): colunas cpf e phone no usuario e tabela UserDocument"
```

---

## Task 4: API — serviço de completude e bucketing de rollout

**Files:**
- Create: `apps/api/src/services/profile/completeness.ts`
- Create: `apps/api/src/services/profile/gate.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/test/setup.ts`
- Test: `apps/api/test/profile/completeness.test.ts`

**Interfaces:**
- Consumes: `MissingFieldKey`, `ProfileScope`, `buildIncompleteProfileError` da Task 2. `prisma.userDocument` da Task 3.
- Produces:
  - `REQUIRED_BY_SCOPE: Record<ProfileScope, readonly MissingFieldKey[]>`
  - `type ProfileCompleteness = { cpf: boolean; phone: boolean; document: boolean }`
  - `loadProfileCompleteness(userId: string): Promise<ProfileCompleteness | null>`
  - `missingFor(c: ProfileCompleteness, scope: ProfileScope): MissingFieldKey[]`
  - `isInRollout(userId: string, percent: number): boolean`
  - `enforceProfileGate(app: FastifyInstance, userId: string, reply: FastifyReply, scope: ProfileScope): Promise<FastifyReply | null>` — devolve `null` quando liberado, ou a reply já enviada quando bloqueado.
  - Env: `PROFILE_GATE_ENABLED: boolean`, `PROFILE_GATE_ROLLOUT_PERCENT: number`, `R2_DOCUMENTS_BUCKET?: string`, `DOCUMENT_URL_TTL_SECONDS: number`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/profile/completeness.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadProfileCompleteness,
  missingFor,
  REQUIRED_BY_SCOPE,
} from '../../src/services/profile/completeness.js';
import { isInRollout } from '../../src/services/profile/gate.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('loadProfileCompleteness', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('returns null for an unknown user', async () => {
    expect(await loadProfileCompleteness('nope')).toBeNull();
  });

  it('reports everything missing for a fresh user', async () => {
    const { user } = await createUser();
    expect(await loadProfileCompleteness(user.id)).toEqual({
      cpf: false,
      phone: false,
      document: false,
    });
  });

  it('counts a pending document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(true);
  });

  it('counts an approved document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'approved',
      },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(true);
  });

  it('does NOT count a rejected document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
      },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(false);
  });

  it('treats an empty-string cpf as absent', async () => {
    const { user } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { cpf: '', phone: '' } });
    expect(await loadProfileCompleteness(user.id)).toEqual({
      cpf: false,
      phone: false,
      document: false,
    });
  });
});

describe('missingFor', () => {
  it('requires cpf and phone for checkout, not document', () => {
    expect(REQUIRED_BY_SCOPE.checkout).toEqual(['cpf', 'phone']);
    expect(missingFor({ cpf: false, phone: false, document: false }, 'checkout')).toEqual([
      'cpf',
      'phone',
    ]);
  });

  it('requires all three for subscription', () => {
    expect(missingFor({ cpf: false, phone: false, document: false }, 'subscription')).toEqual([
      'cpf',
      'phone',
      'document',
    ]);
  });

  it('reports only what is actually missing, in contract order', () => {
    expect(missingFor({ cpf: true, phone: false, document: false }, 'subscription')).toEqual([
      'phone',
      'document',
    ]);
  });

  it('returns an empty list when complete', () => {
    expect(missingFor({ cpf: true, phone: true, document: true }, 'subscription')).toEqual([]);
  });
});

describe('isInRollout', () => {
  it('excludes everyone at 0 and includes everyone at 100', () => {
    expect(isInRollout('user-abc', 0)).toBe(false);
    expect(isInRollout('user-abc', 100)).toBe(true);
  });

  it('is stable for the same user across calls', () => {
    const first = isInRollout('user-abc', 50);
    for (let i = 0; i < 20; i += 1) expect(isInRollout('user-abc', 50)).toBe(first);
  });

  it('is monotonic: anyone in at N is in at N+delta', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    for (const id of ids) {
      if (isInRollout(id, 25)) expect(isInRollout(id, 50)).toBe(true);
    }
  });

  it('lands roughly on the requested share over a large sample', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `user-${i}`);
    const share = ids.filter((id) => isInRollout(id, 25)).length / ids.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- profile/completeness`
Expected: FAIL. Os dois módulos não existem.

- [ ] **Step 3: Write minimal implementation**

Criar `apps/api/src/services/profile/completeness.ts`:

```ts
import { prisma } from '@ccc/db';
import { LIVE_DOCUMENT_STATUSES } from '@ccc/shared/documents';
import type { MissingFieldKey, ProfileScope } from '@ccc/shared/profile-status';

// The single source of truth for what each gate demands. Routes never
// hardcode field lists.
export const REQUIRED_BY_SCOPE: Record<ProfileScope, readonly MissingFieldKey[]> = {
  checkout: ['cpf', 'phone'],
  subscription: ['cpf', 'phone', 'document'],
};

export type ProfileCompleteness = {
  cpf: boolean;
  phone: boolean;
  document: boolean;
};

const present = (value: string | null): boolean => typeof value === 'string' && value.length > 0;

/**
 * One query, three booleans. Returns null when the user row is gone, which
 * callers translate to 401 — the access token outlived its user.
 *
 * `pending` counts as present: optimistic auto-approval means sending the
 * document unblocks the subscription immediately. `rejected` does not count,
 * so a rejection re-blocks the gate and the member is asked for a new file.
 */
export const loadProfileCompleteness = async (
  userId: string,
): Promise<ProfileCompleteness | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      cpf: true,
      phone: true,
      documents: {
        where: { status: { in: [...LIVE_DOCUMENT_STATUSES] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return null;
  return {
    cpf: present(user.cpf),
    phone: present(user.phone),
    document: user.documents.length > 0,
  };
};

export const missingFor = (
  completeness: ProfileCompleteness,
  scope: ProfileScope,
): MissingFieldKey[] => REQUIRED_BY_SCOPE[scope].filter((key) => !completeness[key]);
```

Criar `apps/api/src/services/profile/gate.ts`:

```ts
import { createHash } from 'node:crypto';

import { buildIncompleteProfileError, type ProfileScope } from '@ccc/shared/profile-status';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { loadProfileCompleteness, missingFor } from './completeness.js';

/**
 * Deterministic bucketing by user id. The same user must never see the gate
 * appear and disappear between requests, so the bucket cannot come from a
 * random draw or a request timestamp. Monotonic in `percent`: raising the
 * rollout only ever adds users.
 */
export const isInRollout = (userId: string, percent: number): boolean => {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = parseInt(createHash('sha1').update(userId).digest('hex').slice(0, 8), 16) % 100;
  return bucket < percent;
};

/**
 * Returns null when the request may proceed. Returns the already-sent reply
 * when it may not, so callers write:
 *
 *   const gated = await enforceProfileGate(app, sub, reply, 'checkout');
 *   if (gated) return gated;
 *
 * MUST be called before any stock reservation, Cart status transition, or
 * payment-provider call. A late block would leave a cart stuck in
 * `checking_out` with tiers reserved for a purchase that cannot complete.
 */
export const enforceProfileGate = async (
  app: FastifyInstance,
  userId: string,
  reply: FastifyReply,
  scope: ProfileScope,
): Promise<FastifyReply | null> => {
  if (!app.env.PROFILE_GATE_ENABLED) return null;
  if (!isInRollout(userId, app.env.PROFILE_GATE_ROLLOUT_PERCENT)) return null;

  const completeness = await loadProfileCompleteness(userId);
  if (!completeness) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'user not found' });
  }

  const missing = missingFor(completeness, scope);
  if (missing.length === 0) return null;

  return reply.status(403).send(buildIncompleteProfileError(missing));
};
```

Em `apps/api/src/env.ts`, dentro de `envSchema`, junto das outras flags:

```ts
  // Progressive-profile gates. Default OFF: the feature deploys inert, and
  // Railway variables drive the rollout. Percent is a deterministic bucket
  // over userId, not a sampling rate.
  PROFILE_GATE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PROFILE_GATE_ROLLOUT_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  // Private bucket for identity documents. Falls back to R2_BUCKET only so
  // local dev and tests work; production MUST set a dedicated private bucket.
  R2_DOCUMENTS_BUCKET: z.string().optional(),
  // Shorter than UPLOAD_URL_TTL_SECONDS on purpose: 300s is too long for a
  // link to someone's ID.
  DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),
```

Em `apps/api/test/setup.ts`, no `beforeEach` raiz que já existe, acrescentar duas linhas:

```ts
beforeEach(() => {
  delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  // Same leak hazard as the flag above: vitest runs this suite in a single
  // fork, so a file that turns the gate on and forgets to restore it would
  // poison every later file. Clear here; files that want it set it in their
  // own beforeEach, which runs after this root hook.
  delete process.env.PROFILE_GATE_ENABLED;
  delete process.env.PROFILE_GATE_ROLLOUT_PERCENT;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- profile/completeness`
Expected: PASS, 15 testes.

- [ ] **Step 5: Verify env still loads everywhere**

Run: `pnpm --filter @ccc/api test -- env.test`
Expected: PASS. As quatro variáveis novas têm default ou são opcionais, então nenhum ambiente quebra.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/profile apps/api/src/env.ts apps/api/test/setup.ts apps/api/test/profile/completeness.test.ts
git commit -m "feat(api): servico de completude de perfil e gate com rollout percentual"
```

---

## Task 5: API — `GET /me`, `PATCH /me` e `GET /me/profile-status`

**Files:**
- Modify: `apps/api/src/routes/me.ts:18-93`
- Test: `apps/api/test/profile/profile-status.route.test.ts`

**Interfaces:**
- Consumes: `loadProfileCompleteness`, `missingFor` da Task 4. `cpfSchema`/`phoneSchema` e `profileStatusSchema` das Tasks 1 e 2. `encryptField`/`decryptField` de `services/crypto/field-encryption.js`.
- Produces: `GET /me` e `PATCH /me` devolvendo `cpf` e `phone` em claro. `GET /me/profile-status` devolvendo `profileStatusSchema`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/profile/profile-status.route.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { profileStatusSchema } from '@ccc/shared/profile-status';
import { publicProfileSchema } from '@ccc/shared/profile';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { isEncrypted } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('profile cpf/phone and GET /me/profile-status', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  it('requires authentication on profile-status', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/profile-status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns nulls for a fresh profile', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.cpf).toBeNull();
    expect(body.phone).toBeNull();
  });

  it('stores the cpf encrypted and returns it in the clear to its owner', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '(11) 98765-4321' },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.cpf).toBe('52998224725');
    expect(body.phone).toBe('11987654321');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isEncrypted(row.cpf!)).toBe(true);
    expect(row.cpf).not.toContain('52998224725');
    expect(row.phone).toBe('11987654321');
  });

  it('rejects an invalid cpf with 400 and leaves the row untouched', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '111.111.111-11' },
    });
    expect(res.statusCode).toBe(400);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
  });

  it('reports both scopes incomplete for a fresh user', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = profileStatusSchema.parse(res.json());
    expect(body.fields).toEqual({ cpf: false, phone: false, document: false });
    expect(body.checkout).toEqual({ complete: false, missing: ['cpf', 'phone'] });
    expect(body.subscription).toEqual({
      complete: false,
      missing: ['cpf', 'phone', 'document'],
    });
    expect(body.latestDocument).toBeNull();
  });

  it('completes the checkout scope once cpf and phone land', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '11987654321' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.checkout).toEqual({ complete: true, missing: [] });
    expect(body.subscription).toEqual({ complete: false, missing: ['document'] });
  });

  it('surfaces the latest document and completes the subscription scope', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '11987654321' },
    });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.subscription).toEqual({ complete: true, missing: [] });
    expect(body.latestDocument?.status).toBe('pending');
    expect(body.latestDocument?.type).toBe('cnh');
  });

  it('reports the newest document when several exist', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/old.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        sentAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/new.jpg`,
        sentAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.latestDocument?.type).toBe('cnh');
    expect(body.latestDocument?.status).toBe('pending');
  });

  it('never leaks the cpf ciphertext in the response', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.body).not.toContain('enc_v1:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- profile/profile-status.route`
Expected: FAIL. `/me/profile-status` retorna 404 e `publicProfileSchema.parse` reclama de `cpf` ausente.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/me.ts`, ajustar imports:

```ts
import { profileStatusSchema } from '@ccc/shared/profile-status';
import { decryptField, encryptField } from '../services/crypto/field-encryption.js';
import { loadProfileCompleteness, missingFor } from '../services/profile/completeness.js';
```

Estender o type `DbUser` com os dois campos:

```ts
  cpf: string | null;
  phone: string | null;
```

Trocar a assinatura de `serializeUser` para receber a chave e devolver os campos novos:

```ts
const serializeUser = (user: DbUser, uploads: Uploads, encKey: string) =>
  publicProfileSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    bio: user.bio,
    city: user.city,
    stateCode: user.stateCode,
    avatarUrl: user.avatarObjectKey ? uploads.buildPublicUrl(user.avatarObjectKey) : null,
    // Decrypted for its owner only. This route is authenticated and scoped to
    // request.user.sub — no other surface returns the plaintext CPF.
    cpf: user.cpf ? decryptField(user.cpf, encKey) : null,
    phone: user.phone,
  });
```

Atualizar as duas chamadas de `serializeUser` em `GET /me` e `PATCH /me` para passar `app.env.FIELD_ENCRYPTION_KEY`.

No handler de `PATCH /me`, depois do `Object.fromEntries` e antes do guard de avatar:

```ts
    // CPF is encrypted at rest. Do this after Zod has normalized it to digits
    // so the ciphertext always wraps the same canonical form.
    if (typeof data.cpf === 'string') {
      data.cpf = encryptField(data.cpf, app.env.FIELD_ENCRYPTION_KEY);
    }
```

Acrescentar a rota nova, depois de `PATCH /me`:

```ts
  app.get('/me/profile-status', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    const completeness = await loadProfileCompleteness(sub);
    if (!completeness) return reply.status(401).send({ error: 'Unauthorized' });

    const latest = await prisma.userDocument.findFirst({
      where: { userId: sub },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        status: true,
        sentAt: true,
        reviewedAt: true,
        rejectionReason: true,
      },
    });

    const checkoutMissing = missingFor(completeness, 'checkout');
    const subscriptionMissing = missingFor(completeness, 'subscription');

    return profileStatusSchema.parse({
      fields: completeness,
      checkout: { complete: checkoutMissing.length === 0, missing: checkoutMissing },
      subscription: { complete: subscriptionMissing.length === 0, missing: subscriptionMissing },
      latestDocument: latest
        ? {
            id: latest.id,
            type: latest.type,
            status: latest.status,
            sentAt: latest.sentAt.toISOString(),
            reviewedAt: latest.reviewedAt ? latest.reviewedAt.toISOString() : null,
            rejectionReason: latest.rejectionReason,
          }
        : null,
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- profile/profile-status.route`
Expected: PASS, 10 testes.

- [ ] **Step 5: Verify the existing /me suite still passes**

Run: `pnpm --filter @ccc/api test -- me`

Expected: PASS, e esta tarefa precisa fechar **todas as 9 falhas nos 3 arquivos** que estão vermelhos desde a Task 1: `me/patch.test.ts` (6), `me/get.test.ts` (2), `me/email-change.test.ts` (1). Causa raiz única: `serializeUser` chama `publicProfileSchema.parse` e o schema exige `cpf` e `phone` desde a Task 1, então o parse lança e `/me` devolve 500. Esta tarefa é a que passa a devolver os dois campos, e a correção no serializer resolve os três arquivos de uma vez. Não edite nenhum dos três testes: se algum continuar vermelho, o serializer é que está errado.

Rodar também `pnpm --filter @ccc/api test` completo antes do commit, para confirmar que a contagem de falhas caiu de 9 para 0.

`serializeUser` ganhou um parâmetro; qualquer chamador esquecido falha no typecheck.

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/test/profile/profile-status.route.test.ts
git commit -m "feat(api): cpf e telefone no perfil e endpoint de status de completude"
```

---

## Task 6: API — signup grava CPF e telefone opcionais

**Files:**
- Modify: `apps/api/src/routes/auth/signup.ts:24-41`
- Test: `apps/api/test/auth/signup-profile.test.ts`

**Interfaces:**
- Consumes: `signupSchema` estendido da Task 2. `encryptField`.
- Produces: nada novo. `authResponseSchema` não muda.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/auth/signup-profile.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEncrypted } from '../../src/services/crypto/field-encryption.js';
import { makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/signup with optional profile fields', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const base = {
    name: 'Ana Souza',
    email: 'ana@ccc.test',
    password: 'correct-horse-battery-staple',
  };

  it('creates the account with only name, email and password', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: base });
    expect(res.statusCode).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: base.email } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
    // The garage invariant must survive the change.
    expect(await prisma.garage.count({ where: { userId: row.id } })).toBe(1);
  });

  it('persists cpf encrypted and phone in the clear when supplied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-25', phone: '(11) 98765-4321' },
    });
    expect(res.statusCode).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: base.email } });
    expect(isEncrypted(row.cpf!)).toBe(true);
    expect(row.cpf).not.toContain('52998224725');
    expect(row.phone).toBe('11987654321');
  });

  it('rejects an invalid cpf with 400 and creates no user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-26' },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);
  });

  it('rejects an invalid phone with 400 and creates no user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, phone: '0198765' },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);
  });

  it('never echoes cpf or phone in the auth response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-25', phone: '11987654321' },
    });
    expect(res.body).not.toContain('52998224725');
    expect(res.body).not.toContain('11987654321');
    expect(res.body).not.toContain('enc_v1:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- auth/signup-profile`
Expected: FAIL no segundo teste: `row.cpf` é `null`, porque o handler ignora os campos novos.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/auth/signup.ts`, importar a cifra:

```ts
import { encryptField } from '../../services/crypto/field-encryption.js';
```

No `tx.user.create`, dentro da `$transaction` que já existe (linha 35), estender `data`:

```ts
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          // Permissive signup: both optional. Written in the same tx as the
          // User + Garage create so a half-filled profile never lands.
          ...(input.cpf ? { cpf: encryptField(input.cpf, app.env.FIELD_ENCRYPTION_KEY) } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
        },
      });
```

Nada mais no handler muda. `authResponseSchema` continua sem os campos, por desenho: o cliente lê perfil por `GET /me`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- auth/signup-profile`
Expected: PASS, 5 testes.

- [ ] **Step 5: Verify the existing auth suite still passes**

Run: `pnpm --filter @ccc/api test -- auth`
Expected: PASS. Os testes de signup existentes mandam só os três campos obrigatórios.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth/signup.ts apps/api/test/auth/signup-profile.test.ts
git commit -m "feat(api): signup aceita cpf e telefone opcionais"
```

---

## Task 7: API — gate de checkout nas três rotas de compra avulsa

**Files:**
- Modify: `apps/api/src/routes/cart.ts:467-476`
- Modify: `apps/api/src/routes/orders.ts:378-380`
- Modify: `apps/api/src/routes/orders.ts:509-512`
- Test: `apps/api/test/profile/gate-checkout.test.ts`

**Interfaces:**
- Consumes: `enforceProfileGate` da Task 4.
- Produces: `403` com `incompleteProfileErrorSchema` nas três rotas.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/profile/gate-checkout.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { incompleteProfileErrorSchema } from '@ccc/shared/profile-status';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const CPF = '52998224725';
const PHONE = '11987654321';

// Minimal published event + tier + an open cart holding one ticket line.
const seedTicketCart = async (userId: string) => {
  const event = await prisma.event.create({
    data: {
      title: 'Encontro CCC',
      slug: `encontro-${Date.now()}`,
      // EventType is `meeting | drift | other` — there is no `meetup`.
      // `description` and `capacity` are required with no default.
      description: 'Encontro de teste',
      capacity: 100,
      type: 'meeting',
      status: 'published',
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3600 * 1000),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal: 10,
      quantitySold: 0,
      requiresCar: false,
    },
  });
  const cart = await prisma.cart.create({ data: { userId, status: 'open' } });
  await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      kind: 'ticket',
      eventId: event.id,
      tierId: tier.id,
      quantity: 1,
      amountCents: 5000,
      // `extras: []` is required on the READ path (`cartItemTicketSchema`), even
      // though the request-side schemas default it. A bare `{}` here parses on
      // write and then fails when the cart is read back.
      tickets: [{ extras: [] }],
    },
  });
  return { event, tier, cart };
};

describe('checkout profile gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '100';
    ({ app } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  it('blocks POST /cart/checkout with 403 and the standard payload', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, cart } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(403);
    const body = incompleteProfileErrorSchema.parse(res.json());
    expect(body.status).toBe('incomplete_profile');
    expect(body.code).toBe('INCOMPLETE_PROFILE');
    expect(body.missing).toEqual(['cpf', 'phone']);

    // Nothing may have moved: this is the whole point of gating early.
    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(cartRow.status).toBe('open');
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
  });

  it('reports only phone as missing when the cpf is already set', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY) },
    });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['phone']);
  });

  it('lets the checkout through once cpf and phone are set', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
    });
    const { tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(1);
  });

  it('does not require a document for one-off purchases', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
    });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
    expect(res.statusCode).toBe(201);
  });

  it('blocks POST /orders', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        method: 'card',
        tickets: [{}],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['cpf', 'phone']);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
  });

  it('blocks POST /orders/checkout', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        method: 'card',
        tickets: [{}],
        successUrl: 'http://localhost:3000/ok',
        cancelUrl: 'http://localhost:3000/cancel',
      },
    });

    expect(res.statusCode).toBe(403);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
  });

  it('is inert when the flag is off', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'false';
    ({ app } = await makeAppWithFakes());

    const { user } = await createUser({ verified: true });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('is inert at 0 percent rollout even with the flag on', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '0';
    ({ app } = await makeAppWithFakes());

    const { user } = await createUser({ verified: true });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });
});
```

Os payloads de `/orders` e `/orders/checkout` acima são válidos contra `createOrderRequestSchema` ([orders.ts:55](../../../packages/shared/src/orders.ts:55)): `quantity` e `extrasOnly` têm default, e `ticketInputSchema` só tem campos opcionais, então `tickets: [{}]` passa. `createWebCheckoutRequestSchema` estende esse mesmo schema. Manter os payloads válidos é deliberado: prova que o `403` vem do gate e não de um `422` de schema.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- profile/gate-checkout`
Expected: FAIL. As três rotas devolvem 201 ou 422, nenhuma devolve 403.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/cart.ts`, importar:

```ts
import { enforceProfileGate } from '../services/profile/gate.js';
```

No handler de `POST /cart/checkout`, logo depois do `requireUser` (linha 468) e **antes** do `beginCheckoutRequestSchema.safeParse`:

```ts
    // Gate before anything mutates: below this line the cart flips to
    // `checking_out` and tiers get reserved.
    const gated = await enforceProfileGate(app, sub, reply, 'checkout');
    if (gated) return gated;
```

Em `apps/api/src/routes/orders.ts`, importar o mesmo helper. No handler de `POST /orders` (linha 379), depois do `requireUser` e antes do `createOrderRequestSchema.parse`:

```ts
      const gated = await enforceProfileGate(app, sub, reply, 'checkout');
      if (gated) return gated;
```

No handler de `POST /orders/checkout` (linha 510), depois do `requireUser` e antes do `createWebCheckoutRequestSchema.safeParse`:

```ts
      const gated = await enforceProfileGate(app, sub, reply, 'checkout');
      if (gated) return gated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- profile/gate-checkout`
Expected: PASS, 8 testes.

- [ ] **Step 5: Verify no existing checkout test regressed**

Run: `pnpm --filter @ccc/api test -- cart orders`
Expected: PASS. Os testes existentes não setam `PROFILE_GATE_ENABLED`, e o default é `false`, então o gate não dispara. Se algum falhar, é vazamento de flag — conferir que a Task 4 acrescentou os `delete` no `beforeEach` de `setup.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/cart.ts apps/api/src/routes/orders.ts apps/api/test/profile/gate-checkout.test.ts
git commit -m "feat(api): exige cpf e telefone nas tres rotas de compra avulsa"
```

---

## Task 8: API — gate de assinatura no precheck e no checkout premium

**Files:**
- Modify: `apps/api/src/routes/me-premium.ts:56-68`
- Modify: `apps/api/src/routes/me-premium.ts:126-135`
- Test: `apps/api/test/profile/gate-subscription.test.ts`

**Interfaces:**
- Consumes: `enforceProfileGate` da Task 4.
- Produces: `403` com `incompleteProfileErrorSchema` nas duas rotas premium.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/profile/gate-subscription.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { incompleteProfileErrorSchema } from '@ccc/shared/profile-status';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const CPF = '52998224725';
const PHONE = '11987654321';

const setCpfAndPhone = (userId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
  });

describe('subscription profile gate', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '100';
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = 'price_gold_monthly';
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
    await resetDatabase();
  });

  it('blocks the precheck with all three fields missing', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual([
      'cpf',
      'phone',
      'document',
    ]);
  });

  it('blocks the precheck on the document alone once cpf and phone are set', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
  });

  it('blocks POST /checkout and creates no Stripe session', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
    // FakeStripe records every call in `calls` with a `kind` discriminator
    // (apps/api/src/services/stripe/fake.ts). No session may have been minted.
    expect(
      stripe.calls.filter((c) => c.kind === 'createSubscriptionCheckoutSession'),
    ).toHaveLength(0);
  });

  it('lets a pending document through — optimistic auto-approval', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const precheck = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(precheck.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('url');
  });

  it('re-blocks after the document is rejected', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: new Date(),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
  });

  it('keeps the billing flag ahead of the profile gate', async () => {
    await app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    ({ app, stripe } = await makeAppWithFakeStripe());

    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    // 503 wins: an unavailable feature is not an incomplete profile.
    expect(res.statusCode).toBe(503);
  });

  it('is inert when the profile flag is off', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'false';
    ({ app, stripe } = await makeAppWithFakeStripe());

    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

A asserção acima já usa a API real do `FakeStripe`: ele registra tudo em `calls`, cada entrada com um discriminador `kind`, e `'createSubscriptionCheckoutSession'` é um dos membros da união ([fake.ts:29-51](../../../apps/api/src/services/stripe/fake.ts:29)). Não existe array `subscriptionCheckoutSessions`.

Os campos obrigatórios de `PremiumMembership` no fixture do último teste também já estão completos e conferidos contra [schema.prisma:319](../../../packages/db/prisma/schema.prisma:319): `tier`, `currentPeriodStart`, `baseAmountCents`, `devFeePercent`, `devFeeAmountCents`, `grossAmountCents` e `currency` não têm default.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- profile/gate-subscription`
Expected: FAIL. As duas rotas ainda não bloqueiam.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/me-premium.ts`, importar:

```ts
import { enforceProfileGate } from '../services/profile/gate.js';
```

No handler de `GET /api/me/premium/checkout-precheck`, depois do `requireUser` (linha 66) e antes do `prisma.garage.findUnique`:

```ts
      // Precedence: 503 (feature off) → 403 (incomplete profile) → 409
      // (already subscribed). An unavailable feature is not a profile problem.
      const gated = await enforceProfileGate(app, sub, reply, 'subscription');
      if (gated) return gated;
```

No `checkoutHandler`, depois do `requireUser` (linha 133) e antes do `premiumCheckoutRequestSchema.safeParse`:

```ts
    // Repeated here on purpose. The precheck is advisory; the window between
    // GET and POST is the same one the AlreadySubscribed check below closes.
    const gated = await enforceProfileGate(app, sub, reply, 'subscription');
    if (gated) return gated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- profile/gate-subscription`
Expected: PASS, 7 testes.

- [ ] **Step 5: Verify the premium suite still passes**

Run: `pnpm --filter @ccc/api test -- billing premium`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/test/profile/gate-subscription.test.ts
git commit -m "feat(api): exige cpf, telefone e documento para contratar assinatura"
```

---

## Task 9: API — upload privado de documento de identidade

**Files:**
- Modify: `apps/api/src/services/uploads/types.ts`
- Modify: `apps/api/src/services/uploads/r2.ts`
- Modify: `apps/api/src/services/uploads/dev.ts`
- Modify: `apps/api/src/services/uploads/index.ts`
- Test: `apps/api/test/uploads/identity-document.test.ts`

**Interfaces:**
- Consumes: env `R2_DOCUMENTS_BUCKET` e `DOCUMENT_URL_TTL_SECONDS` da Task 4.
- Produces:
  - `UploadKind` inclui `'identity_document'`.
  - `UPLOAD_KIND_PATH_PREFIX.identity_document === 'identity-document'`.
  - `DOCUMENT_PATH_PREFIX = 'identity-document'`, `DOCUMENT_CACHE_CONTROL = 'private, no-store'`.
  - `R2Uploads` construtor aceita um quinto argumento `documentsBucket?: string`.
  - `presignPut` grava documento no bucket privado, com `content-disposition: attachment`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/uploads/identity-document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DevUploads } from '../../src/services/uploads/dev.js';
import {
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_PATH_PREFIX,
  UPLOAD_KIND_PATH_PREFIX,
} from '../../src/services/uploads/types.js';

describe('identity_document upload kind', () => {
  it('maps to a hyphenated private prefix', () => {
    expect(UPLOAD_KIND_PATH_PREFIX.identity_document).toBe('identity-document');
    expect(DOCUMENT_PATH_PREFIX).toBe('identity-document');
  });

  it('presigns under the owner-scoped document prefix', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.objectKey).toMatch(/^identity-document\/u1\/[a-z0-9]+\.jpg$/);
  });

  it('sends private, non-inline headers for documents', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/png',
      size: 1024,
    });
    expect(result.headers['content-disposition']).toBe('attachment');
    expect(result.headers['cache-control']).toBe(DOCUMENT_CACHE_CONTROL);
    expect(result.headers['x-amz-meta-kind']).toBe('identity_document');
  });

  it('keeps public headers for a non-document kind', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'avatar',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.headers['content-disposition']).toBe('inline');
    expect(result.headers['cache-control']).not.toBe(DOCUMENT_CACHE_CONTROL);
  });

  it('scopes ownership to the requesting user', () => {
    const uploads = new DevUploads();
    expect(uploads.isOwnedKey('identity-document/u1/a.jpg', 'u1', 'identity_document')).toBe(true);
    expect(uploads.isOwnedKey('identity-document/u2/a.jpg', 'u1', 'identity_document')).toBe(false);
    expect(uploads.isOwnedKey('avatar/u1/a.jpg', 'u1', 'identity_document')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- uploads/identity-document`
Expected: FAIL. `identity_document` não existe na union e `DOCUMENT_PATH_PREFIX` não é exportado.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/services/uploads/types.ts`:

```ts
export type UploadKind =
  | 'avatar'
  | 'car_photo'
  | 'event_cover'
  | 'feed_photo'
  | 'product_photo'
  | 'support_attachment'
  | 'garage_cover'
  | 'identity_document';
```

No `UPLOAD_KIND_PATH_PREFIX`, acrescentar a entrada:

```ts
  identity_document: 'identity-document',
```

No fim do arquivo:

```ts
// Identity documents live behind their own prefix so bucket routing and
// access control can key off the objectKey alone, with no extra lookup.
export const DOCUMENT_PATH_PREFIX = 'identity-document';

// Never `public, max-age=...`: an ID must not be cached by any intermediary.
// `attachment` also stops a browser from rendering it inline from a signed URL.
export const DOCUMENT_CACHE_CONTROL = 'private, no-store';
export const DOCUMENT_CONTENT_DISPOSITION = 'attachment';

export const isDocumentKey = (objectKey: string): boolean =>
  objectKey.startsWith(`${DOCUMENT_PATH_PREFIX}/`);
```

Em `apps/api/src/services/uploads/r2.ts`, ajustar imports e construtor:

```ts
import type { PresignInput, PresignResult, UploadKind, Uploads } from './types.js';
import {
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_CONTENT_DISPOSITION,
  EXT_FOR_MIME,
  isDocumentKey,
  UPLOAD_CACHE_CONTROL,
  UPLOAD_KIND_PATH_PREFIX,
} from './types.js';

export class R2Uploads implements Uploads {
  private readonly client: S3Client;

  constructor(
    opts: { accountId: string; accessKeyId: string; secretAccessKey: string },
    private readonly bucket: string,
    private readonly publicBase: string,
    private readonly ttlSeconds: number,
    // Dedicated private bucket for identity documents. Falls back to the main
    // bucket only so local dev and tests work — production MUST set it, since
    // the main bucket is readable through R2_PUBLIC_BASE_URL.
    private readonly documentsBucket?: string,
  ) {
```

Acrescentar o resolvedor de bucket como método privado:

```ts
  private bucketFor(objectKey: string): string {
    return isDocumentKey(objectKey) ? (this.documentsBucket ?? this.bucket) : this.bucket;
  }
```

Reescrever `presignPut` para variar headers e bucket:

```ts
  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT_FOR_MIME[input.contentType] ?? 'bin';
    const prefix = UPLOAD_KIND_PATH_PREFIX[input.kind];
    const objectKey = `${prefix}/${input.userId}/${createId()}.${ext}`;
    const isDocument = isDocumentKey(objectKey);
    const disposition = isDocument ? DOCUMENT_CONTENT_DISPOSITION : 'inline';
    const cacheControl = isDocument ? DOCUMENT_CACHE_CONTROL : UPLOAD_CACHE_CONTROL;
    const command = new PutObjectCommand({
      Bucket: this.bucketFor(objectKey),
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.size,
      ContentDisposition: disposition,
      CacheControl: cacheControl,
      Metadata: { kind: input.kind },
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return {
      uploadUrl,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.size),
        'content-disposition': disposition,
        'cache-control': cacheControl,
        'x-amz-meta-kind': input.kind,
      },
    };
  }
```

Trocar `Bucket: this.bucket` por `Bucket: this.bucketFor(objectKey)` em `presignGet`, `buildSignedGetUrl` e `deleteObject`.

Em `apps/api/src/services/uploads/dev.ts`, espelhar a variação de headers em `presignPut`:

```ts
  // eslint-disable-next-line @typescript-eslint/require-await
  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT_FOR_MIME[input.contentType] ?? 'bin';
    const prefix = UPLOAD_KIND_PATH_PREFIX[input.kind];
    const objectKey = `${prefix}/${input.userId}/${createId()}.${ext}`;
    const isDocument = isDocumentKey(objectKey);
    const disposition = isDocument ? DOCUMENT_CONTENT_DISPOSITION : 'inline';
    const cacheControl = isDocument ? DOCUMENT_CACHE_CONTROL : UPLOAD_CACHE_CONTROL;
    return {
      uploadUrl: `${this.publicBase}/put/${objectKey}`,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.size),
        'content-disposition': disposition,
        'cache-control': cacheControl,
        'x-amz-meta-kind': input.kind,
      },
    };
  }
```

Ajustar os imports de `dev.ts` para incluir `DOCUMENT_CACHE_CONTROL`, `DOCUMENT_CONTENT_DISPOSITION` e `isDocumentKey`.

Em `apps/api/src/services/uploads/index.ts`, passar o bucket novo:

```ts
    return new R2Uploads(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      env.R2_BUCKET,
      env.R2_PUBLIC_BASE_URL,
      env.UPLOAD_URL_TTL_SECONDS,
      env.R2_DOCUMENTS_BUCKET,
    );
```

Logo antes desse `return`, avisar em produção quando o bucket privado não estiver configurado:

```ts
  if (r2Ready && !env.R2_DOCUMENTS_BUCKET && env.NODE_ENV === 'production') {
    console.warn(
      '[uploads] R2_DOCUMENTS_BUCKET unset — identity documents would land in the PUBLIC bucket',
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- uploads`
Expected: PASS. Os testes de presign existentes continuam verdes: `avatar` mantém `inline` e o cache público.

- [ ] **Step 5: Verify the dev upload server still works**

Run: `pnpm --filter @ccc/api test -- dev-uploads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/uploads apps/api/test/uploads/identity-document.test.ts
git commit -m "feat(api): kind de upload privado para documento de identidade"
```

---

## Task 10: API — rotas de documento do usuário

**Files:**
- Create: `apps/api/src/routes/me-documents.ts`
- Modify: `apps/api/src/app.ts:134`
- Test: `apps/api/test/documents/me-documents.test.ts`

**Interfaces:**
- Consumes: schemas de `@ccc/shared/documents` da Task 2. `app.uploads` com o kind da Task 9. `prisma.userDocument` da Task 3.
- Produces: `POST /me/documents/upload`, `POST /me/documents`, `GET /me/documents`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/documents/me-documents.test.ts`:

```ts
import { prisma } from '@ccc/db';
import {
  documentUploadResponseSchema,
  MAX_DOCUMENT_BYTES,
  userDocumentListResponseSchema,
} from '@ccc/shared/documents';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('me documents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const auth = (userId: string) => ({ authorization: bearer(loadEnv(), userId) });

  it('requires authentication on all three routes', async () => {
    for (const [method, url] of [
      ['POST', '/me/documents/upload'],
      ['POST', '/me/documents'],
      ['GET', '/me/documents'],
    ] as const) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
  });

  it('presigns an upload scoped to the caller', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    expect(res.statusCode).toBe(201);
    const body = documentUploadResponseSchema.parse(res.json());
    expect(body.objectKey).toMatch(new RegExp(`^identity-document/${user.id}/`));
    expect(body.headers['content-disposition']).toBe('attachment');
    expect(res.body).not.toContain('publicUrl');
  });

  it('rejects pdf and oversized uploads', async () => {
    const { user } = await createUser({ verified: true });
    const pdf = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'application/pdf', size: 2048 },
    });
    expect(pdf.statusCode).toBe(400);

    const big = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: MAX_DOCUMENT_BYTES + 1 },
    });
    expect(big.statusCode).toBe(400);
  });

  it('creates a pending document from a presigned key', async () => {
    const { user } = await createUser({ verified: true });
    const presign = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    const { objectKey } = documentUploadResponseSchema.parse(presign.json());

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; type: string };
    expect(body.status).toBe('pending');
    expect(body.type).toBe('cnh');

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.userId).toBe(user.id);
    expect(row.objectKey).toBe(objectKey);
  });

  it("rejects another user's object key", async () => {
    const { user } = await createUser({ verified: true, email: 'a@ccc.test' });
    const { user: other } = await createUser({ verified: true, email: 'b@ccc.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey: `identity-document/${other.id}/stolen.jpg` },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.userDocument.count()).toBe(0);
  });

  it('rejects a key from another upload kind', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey: `avatar/${user.id}/a.jpg` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows only one live document at a time', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code?: string }).code).toBe('DOCUMENT_ALREADY_PENDING');
  });

  it('allows a resend after a rejection', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    expect(res.statusCode).toBe(201);
  });

  it('lists documents newest first with a signed url', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/old.jpg`,
        status: 'rejected',
        sentAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/new.jpg`,
        sentAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    expect(res.statusCode).toBe(200);
    const body = userDocumentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]!.type).toBe('cnh');
    expect(body.items[0]!.fileUrl).toContain('identity-document');
  });

  it('returns a null fileUrl for a purged document', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/gone.jpg`,
        status: 'approved',
        reviewedAt: new Date(),
        fileDeletedAt: new Date(),
      },
    });
    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    const body = userDocumentListResponseSchema.parse(res.json());
    expect(body.items[0]!.fileUrl).toBeNull();
  });

  it("never lists another user's documents", async () => {
    const { user } = await createUser({ verified: true, email: 'a@ccc.test' });
    const { user: other } = await createUser({ verified: true, email: 'b@ccc.test' });
    await prisma.userDocument.create({
      data: { userId: other.id, type: 'cnh', objectKey: `identity-document/${other.id}/a.jpg` },
    });

    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    expect(userDocumentListResponseSchema.parse(res.json()).items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- documents/me-documents`
Expected: FAIL. As três rotas dão 404.

- [ ] **Step 3: Write minimal implementation**

Criar `apps/api/src/routes/me-documents.ts`:

```ts
import { prisma } from '@ccc/db';
import {
  createDocumentBodySchema,
  documentUploadRequestSchema,
  documentUploadResponseSchema,
  DOCUMENT_ALREADY_PENDING_CODE,
  LIVE_DOCUMENT_STATUSES,
  userDocumentListResponseSchema,
  userDocumentSchema,
  type UserDocument as SharedUserDocument,
} from '@ccc/shared/documents';
import rateLimit from '@fastify/rate-limit';
import type { UserDocument as DbUserDocument } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import type { Uploads } from '../services/uploads/index.js';

const serializeDocument = async (
  doc: DbUserDocument,
  uploads: Uploads,
  ttlSeconds: number,
): Promise<SharedUserDocument> =>
  userDocumentSchema.parse({
    id: doc.id,
    type: doc.type,
    status: doc.status,
    sentAt: doc.sentAt.toISOString(),
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    rejectionReason: doc.rejectionReason,
    // Signed GET only, short TTL. buildPublicUrl would hand out a URL in the
    // public bucket's namespace, which is exactly what this feature avoids.
    fileUrl: doc.fileDeletedAt
      ? null
      : await uploads.buildSignedGetUrl(doc.objectKey, ttlSeconds),
  });

export const meDocumentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/documents', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const docs = await prisma.userDocument.findMany({
      where: { userId: sub },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    });
    return userDocumentListResponseSchema.parse({
      items: await Promise.all(
        docs.map((d) => serializeDocument(d, app.uploads, app.env.DOCUMENT_URL_TTL_SECONDS)),
      ),
    });
  });

  await app.register(async (scoped) => {
    // Same shape as me-support.ts: an identity document is a heavy, rare
    // write, and the presign is the expensive half.
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '15 minutes',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `documents:${auth.sub}` : `documents-ip:${req.ip}`;
      },
    });

    scoped.post(
      '/me/documents/upload',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const input = documentUploadRequestSchema.parse(request.body);

        const presigned = await app.uploads.presignPut({
          // Server-injected: the client cannot repoint this presign at another
          // upload category. Same guard as POST /me/garage/cover/upload.
          kind: 'identity_document',
          userId: sub,
          contentType: input.contentType,
          size: input.size,
        });

        return reply.status(201).send(
          documentUploadResponseSchema.parse({
            uploadUrl: presigned.uploadUrl,
            objectKey: presigned.objectKey,
            expiresAt: presigned.expiresAt.toISOString(),
            headers: presigned.headers,
          }),
        );
      },
    );

    scoped.post('/me/documents', { preHandler: [scoped.authenticate] }, async (request, reply) => {
      const { sub } = requireUser(request);
      const input = createDocumentBodySchema.parse(request.body);

      if (!app.uploads.isOwnedKey(input.objectKey, sub, 'identity_document')) {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid document key' });
      }

      const live = await prisma.userDocument.findFirst({
        where: { userId: sub, status: { in: [...LIVE_DOCUMENT_STATUSES] } },
        select: { id: true },
      });
      if (live) {
        return reply.status(409).send({
          error: 'Conflict',
          code: DOCUMENT_ALREADY_PENDING_CODE,
          message: 'Você já tem um documento em análise.',
        });
      }

      const doc = await prisma.userDocument.create({
        data: { userId: sub, type: input.type, objectKey: input.objectKey },
      });

      return reply
        .status(201)
        .send(await serializeDocument(doc, app.uploads, app.env.DOCUMENT_URL_TTL_SECONDS));
    });
  });
};
```

Em `apps/api/src/app.ts`, importar e registrar depois de `uploadRoutes` (linha 134):

```ts
  await app.register(meDocumentRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- documents/me-documents`
Expected: PASS, 11 testes.

- [ ] **Step 5: Verify the gate now unlocks end to end**

Run: `pnpm --filter @ccc/api test -- profile documents`
Expected: PASS. O teste "lets a pending document through" da Task 8 usa a row direto; este passo confirma que a rota produz a mesma row.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-documents.ts apps/api/src/app.ts apps/api/test/documents/me-documents.test.ts
git commit -m "feat(api): rotas de envio e listagem de documento de identidade"
```

---

## Task 11: API — revisão de documento no admin

**Files:**
- Create: `apps/api/src/routes/admin/documents.ts`
- Modify: `apps/api/src/routes/admin/index.ts:56-74`
- Modify: `apps/api/src/services/admin-audit.ts:6-34`
- Modify: `packages/shared/src/admin.ts`
- Modify: `apps/api/src/routes/admin/users.ts`
- Test: `apps/api/test/documents/admin-documents.test.ts`

**Interfaces:**
- Consumes: `recordAudit`, `app.requireRole`, `app.uploads`, `prisma.userDocument`.
- Produces: `GET /admin/documents`, `GET /admin/documents/:id/file`, `POST /admin/documents/:id/approve`, `POST /admin/documents/:id/reject`. `entityType: 'user_document'` em `RecordAuditInput`. Ações de audit `document_viewed`, `document_approved`, `document_rejected`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/documents/admin-documents.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedDoc = async (userId: string, overrides: Record<string, unknown> = {}) =>
  prisma.userDocument.create({
    data: {
      userId,
      type: 'cnh',
      objectKey: `identity-document/${userId}/a.jpg`,
      ...overrides,
    },
  });

describe('admin document review', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const asAdmin = async () => {
    const { user } = await createUser({ verified: true, email: 'admin@ccc.test', role: 'admin' });
    return { admin: user, headers: { authorization: bearer(loadEnv(), user.id, 'admin') } };
  };

  it('rejects an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/documents' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a plain user', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects staff — documents are organizer/admin only', async () => {
    const { user } = await createUser({ verified: true, email: 's@ccc.test', role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists the pending queue', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await seedDoc(user.id);
    await seedDoc(user.id, {
      objectKey: `identity-document/${user.id}/b.jpg`,
      status: 'approved',
      reviewedAt: new Date(),
    });

    const res = await app.inject({ method: 'GET', url: '/admin/documents?status=pending', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ status: string; userId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.status).toBe('pending');
    expect(body.items[0]!.userId).toBe(user.id);
  });

  it('never exposes the file url in the list payload', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await seedDoc(user.id);
    const res = await app.inject({ method: 'GET', url: '/admin/documents', headers });
    expect(res.body).not.toContain('signed');
    expect(res.body).not.toContain('.jpg');
  });

  it('redirects to a signed url and records an audit entry', async () => {
    const { admin, headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/documents/${doc.id}/file`,
      headers,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('identity-document');

    const audit = await prisma.adminAudit.findFirst({
      where: { entityType: 'user_document', entityId: doc.id, actorId: admin.id },
    });
    expect(audit?.action).toBe('document_viewed');
  });

  it('returns 410 when the file was purged', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id, { fileDeletedAt: new Date() });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/documents/${doc.id}/file`,
      headers,
    });
    expect(res.statusCode).toBe(410);
  });

  it('approves a pending document and audits it', async () => {
    const { admin, headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/approve`,
      headers,
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('approved');
    expect(row.reviewedAt).not.toBeNull();
    expect(row.reviewedByAdminId).toBe(admin.id);

    const audit = await prisma.adminAudit.findFirst({
      where: { entityType: 'user_document', entityId: doc.id, action: 'document_approved' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects with a reason and audits it', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'Foto ilegível' },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('rejected');
    expect(row.rejectionReason).toBe('Foto ilegível');
  });

  it('requires a reason to reject', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('pending');
  });

  it('refuses to re-review an already-reviewed document', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id, { status: 'approved', reviewedAt: new Date() });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'mudei de ideia' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('does not touch subscription state on rejection', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_x',
        providerSubRef: 'sub_x',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        baseAmountCents: 9900,
        devFeePercent: 10,
        devFeeAmountCents: 990,
        grossAmountCents: 10890,
        currency: 'BRL',
      },
    });
    const doc = await seedDoc(user.id);

    await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'Foto ilegível' },
    });

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row.status).toBe('active');
  });

  it('returns 404 for an unknown document', async () => {
    const { headers } = await asAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/documents/nope/approve',
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('never leaks the cpf through the admin user detail route', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    await seedDoc(user.id);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${user.id}`, headers });
    expect(res.statusCode).toBe(200);
    // Presence flags only. Neither the plaintext, nor the ciphertext, nor a
    // file url may appear anywhere in the payload.
    expect(res.body).not.toContain('52998224725');
    expect(res.body).not.toContain('enc_v1:');
    expect(res.body).not.toContain('.jpg');
    const body = res.json() as { hasCpf: boolean; hasPhone: boolean; documents: unknown[] };
    expect(body.hasCpf).toBe(true);
    expect(body.hasPhone).toBe(true);
    expect(body.documents).toHaveLength(1);
  });
});
```

O último teste precisa de um import a mais neste arquivo:

```ts
import { encryptField } from '../../src/services/crypto/field-encryption.js';
```

A rota de detalhe é `GET /users/:id` dentro do prefixo `/admin` ([admin/users.ts:90](../../../apps/api/src/routes/admin/users.ts:90)), montada em [admin/index.ts](../../../apps/api/src/routes/admin/index.ts) com `prefix: '/admin'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- documents/admin-documents`
Expected: FAIL. Todas as rotas dão 404.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/services/admin-audit.ts`, acrescentar ao union de `entityType`, depois de `'support_ticket'`:

```ts
    | 'user_document'
```

Em `packages/shared/src/admin.ts`, acrescentar as três ações ao enum de `AdminAuditAction` já existente:

```ts
  'document_viewed',
  'document_approved',
  'document_rejected',
```

Criar `apps/api/src/routes/admin/documents.ts`:

```ts
import { prisma } from '@ccc/db';
import { USER_DOCUMENT_STATUSES } from '@ccc/shared/documents';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

const listQuerySchema = z.object({
  status: z.enum(USER_DOCUMENT_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

const encodeCursor = (row: { sentAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ s: row.sentAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): { sentAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { s: string; i: string };
  return { sentAt: new Date(parsed.s), id: parsed.i };
};

// The review queue. Deliberately returns NO file url: reading the document is
// a separate, audited request. Listing the queue is not the same act as
// looking at someone's ID.
export const adminDocumentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', async (request, reply) => {
    const { status, cursor, limit } = listQuerySchema.parse(request.query);

    const where = status ? { status } : {};
    const rows = await prisma.userDocument.findMany({
      where: cursor
        ? {
            ...where,
            OR: (() => {
              const c = decodeCursor(cursor);
              return [{ sentAt: { lt: c.sentAt } }, { sentAt: c.sentAt, id: { lt: c.id } }];
            })(),
          }
        : where,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        rejectionReason: true,
        reviewedAt: true,
        reviewedByAdminId: true,
        fileDeletedAt: true,
        sentAt: true,
        user: { select: { name: true, email: true } },
      },
    });

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? encodeCursor(page[page.length - 1]!) : null;

    return reply.status(200).send({
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: row.user.name,
        userEmail: row.user.email,
        type: row.type,
        status: row.status,
        rejectionReason: row.rejectionReason,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        reviewedByAdminId: row.reviewedByAdminId,
        filePurged: row.fileDeletedAt !== null,
        sentAt: row.sentAt.toISOString(),
      })),
      nextCursor: next,
    });
  });

  app.get<{ Params: { id: string } }>('/documents/:id/file', async (request, reply) => {
    const { sub } = requireUser(request);
    const doc = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true, objectKey: true, fileDeletedAt: true },
    });
    if (!doc) return reply.status(404).send({ error: 'NotFound', message: 'document not found' });
    if (doc.fileDeletedAt) {
      return reply.status(410).send({ error: 'Gone', message: 'document file was purged' });
    }

    // Audit BEFORE handing out the URL. If the audit write fails, the reviewer
    // does not get the link — an unlogged look at an ID is the failure mode
    // this ordering prevents.
    await recordAudit({
      actorId: sub,
      action: 'document_viewed',
      entityType: 'user_document',
      entityId: doc.id,
    });

    const url = await app.uploads.buildSignedGetUrl(doc.objectKey, 60);
    return reply.redirect(302, url);
  });

  const review = async (
    id: string,
    actorId: string,
    next: 'approved' | 'rejected',
    reason: string | null,
  ) => {
    // updateMany with a status guard makes the pending→reviewed transition
    // atomic: two reviewers clicking at once produce one winner and one 409.
    const guarded = await prisma.userDocument.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: next,
        rejectionReason: reason,
        reviewedByAdminId: actorId,
        reviewedAt: new Date(),
      },
    });
    return guarded.count;
  };

  app.post<{ Params: { id: string } }>('/documents/:id/approve', async (request, reply) => {
    const { sub } = requireUser(request);
    const exists = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!exists) return reply.status(404).send({ error: 'NotFound', message: 'document not found' });

    const count = await review(request.params.id, sub, 'approved', null);
    if (count === 0) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'document was already reviewed' });
    }

    await recordAudit({
      actorId: sub,
      action: 'document_approved',
      entityType: 'user_document',
      entityId: request.params.id,
    });

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: request.params.id } });
    return reply.status(200).send({
      id: row.id,
      status: row.status,
      reviewedAt: row.reviewedAt!.toISOString(),
    });
  });

  // Rejection records the decision and nothing else. It does NOT suspend an
  // existing membership: subscription state only ever changes through a
  // verified provider webhook. Suspending is a separate, explicit admin act
  // through the Stripe cancel path.
  app.post<{ Params: { id: string } }>('/documents/:id/reject', async (request, reply) => {
    const { sub } = requireUser(request);
    const { reason } = rejectBodySchema.parse(request.body);

    const exists = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!exists) return reply.status(404).send({ error: 'NotFound', message: 'document not found' });

    const count = await review(request.params.id, sub, 'rejected', reason);
    if (count === 0) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'document was already reviewed' });
    }

    await recordAudit({
      actorId: sub,
      action: 'document_rejected',
      entityType: 'user_document',
      entityId: request.params.id,
      metadata: { reason },
    });

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: request.params.id } });
    return reply.status(200).send({
      id: row.id,
      status: row.status,
      reviewedAt: row.reviewedAt!.toISOString(),
      rejectionReason: row.rejectionReason,
    });
  });
};
```

Em `apps/api/src/routes/admin/index.ts`, importar e registrar no escopo `requireRole('organizer', 'admin')`, junto de `adminSupportRoutes`:

```ts
    await scope.register(adminDocumentRoutes);
```

Em `apps/api/src/routes/admin/users.ts`, no serializer de detalhe, acrescentar os três campos derivados. Nunca o CPF, nunca a URL:

```ts
      hasCpf: u.cpf !== null && u.cpf.length > 0,
      hasPhone: u.phone !== null && u.phone.length > 0,
      documents: u.documents.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        sentAt: d.sentAt.toISOString(),
        reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
        rejectionReason: d.rejectionReason,
      })),
```

Incluir `cpf`, `phone` e `documents` no `select`/`include` da query de detalhe, e os campos correspondentes em `adminUserDetailSchema` em `packages/shared/src/admin.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- documents/admin-documents`
Expected: PASS, 15 testes.

- [ ] **Step 5: Verify the admin suite still passes**

Run: `pnpm --filter @ccc/api test -- admin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin apps/api/src/services/admin-audit.ts packages/shared/src/admin.ts apps/api/test/documents/admin-documents.test.ts
git commit -m "feat(api): fila de revisao de documento no admin com audit"
```

---

## Task 12: API — LGPD: export, anonimização e retenção

**Files:**
- Modify: `apps/api/src/services/data-export.ts`
- Modify: `apps/api/src/services/account-deletion/anonymize.ts:27-130`
- Modify: `apps/api/src/workers/retention.ts`
- Modify: `packages/shared/src/legal.ts`
- Test: `apps/api/test/documents/lgpd-documents.test.ts`

**Interfaces:**
- Consumes: `prisma.userDocument`, `queueObjectDeletion`, `decryptField`.
- Produces: `DOCUMENT_APPROVED_RETENTION_DAYS = 90`, `DOCUMENT_REJECTED_RETENTION_DAYS = 30`, `purgeExpiredDocumentFiles(now: Date): Promise<number>` exportado de `workers/retention.ts`.

- [ ] **Step 1: Write the failing test**

Criar `apps/api/test/documents/lgpd-documents.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
// The collector is exported under a _forTest alias (data-export.ts:468); the
// public surface is processExportJob, which needs a job row and R2.
import { _collectUserDataForTest as collectUserData } from '../../src/services/data-export.js';
import { DevUploads } from '../../src/services/uploads/dev.js';
import {
  DOCUMENT_APPROVED_RETENTION_DAYS,
  DOCUMENT_REJECTED_RETENTION_DAYS,
  purgeExpiredDocumentFiles,
} from '../../src/workers/retention.js';
import { createUser, resetDatabase } from '../helpers.js';

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 3600 * 1000);

describe('LGPD handling for cpf, phone and documents', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('includes cpf, phone and document metadata in the data export', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const payload = await collectUserData(user.id);
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('52998224725');
    expect(serialized).toContain('11987654321');
    expect(serialized).not.toContain('enc_v1:');
    expect(serialized).toContain('identity-document');
  });

  it('clears cpf and phone and removes documents on anonymization', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    const objectKey = `identity-document/${user.id}/a.jpg`;
    await prisma.userDocument.create({ data: { userId: user.id, type: 'cnh', objectKey } });

    // anonymizeUser(userId, uploads, priorSteps?) — see anonymize.ts:19.
    const result = await anonymizeUser(user.id, new DevUploads());
    expect(result.ok).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
    const queued = await prisma.uploadDeletionQueue.findUnique({ where: { objectKey } });
    expect(queued).not.toBeNull();
  });

  it('purges an approved document file after its retention window', async () => {
    const { user } = await createUser({ verified: true });
    const objectKey = `identity-document/${user.id}/old-approved.jpg`;
    const doc = await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey,
        status: 'approved',
        reviewedAt: daysAgo(DOCUMENT_APPROVED_RETENTION_DAYS + 1),
      },
    });

    const purged = await purgeExpiredDocumentFiles(new Date());
    expect(purged).toBe(1);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    // Row survives for audit; only the object goes.
    expect(row.fileDeletedAt).not.toBeNull();
    expect(await prisma.uploadDeletionQueue.findUnique({ where: { objectKey } })).not.toBeNull();
  });

  it('purges a rejected document file on the shorter window', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/old-rejected.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: daysAgo(DOCUMENT_REJECTED_RETENTION_DAYS + 1),
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(1);
  });

  it('leaves a fresh decision and a pending document alone', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/fresh.jpg`,
        status: 'approved',
        reviewedAt: daysAgo(1),
      },
    });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/pending.jpg`,
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(0);
  });

  it('is idempotent — an already-purged row is not re-queued', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/done.jpg`,
        status: 'approved',
        reviewedAt: daysAgo(DOCUMENT_APPROVED_RETENTION_DAYS + 1),
        fileDeletedAt: daysAgo(1),
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(0);
  });
});
```

Conferir o nome real da função de export em `apps/api/src/services/data-export.ts` e o de `anonymizeUser` (assinatura em `anonymize.ts:19`), e ajustar imports e argumentos.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- documents/lgpd-documents`
Expected: FAIL. `purgeExpiredDocumentFiles` não existe.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/services/data-export.ts`, no `select` do usuário, incluir `cpf` e `phone`, e decifrar o CPF antes de serializar. Acrescentar uma consulta à lista de documentos, no mesmo `Promise.all` das demais:

```ts
    prisma.userDocument.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        objectKey: true,
        status: true,
        rejectionReason: true,
        sentAt: true,
        reviewedAt: true,
        fileDeletedAt: true,
      },
    }),
```

O CPF vai em claro no export — é o titular exercendo o direito de acesso. `enc_v1:` nunca aparece.

Em `apps/api/src/services/account-deletion/anonymize.ts`, estender o `select` inicial (linha 27) com `documents: { select: { objectKey: true } }`, e acrescentar as chaves em `objectKeys` junto do avatar (linha 39):

```ts
  for (const doc of user.documents) objectKeys.push(doc.objectKey);
```

No `update` do usuário (linha 124), acrescentar:

```ts
        cpf: null,
        phone: null,
```

As rows de `UserDocument` caem por `onDelete: Cascade` quando o usuário é apagado; no caminho de anonimização, que preserva a row do usuário, apagar explicitamente dentro da mesma tx:

```ts
      await tx.userDocument.deleteMany({ where: { userId } });
```

Em `apps/api/src/workers/retention.ts`, acrescentar as constantes e a função:

```ts
// Identity-document files are the most sensitive object this system stores.
// The approval decision is what needs to survive, not the image: keep the row
// for audit and purge the object. 90 days after approval leaves room for a
// dispute; 30 after rejection is enough for a resend.
export const DOCUMENT_APPROVED_RETENTION_DAYS = 90;
export const DOCUMENT_REJECTED_RETENTION_DAYS = 30;

const daysBefore = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 24 * 3600 * 1000);

/**
 * Queues expired document objects for deletion and stamps `fileDeletedAt`.
 * Idempotent: rows already stamped are skipped, so a re-run queues nothing.
 * Returns how many rows were purged this pass.
 */
export const purgeExpiredDocumentFiles = async (now: Date): Promise<number> => {
  const due = await prisma.userDocument.findMany({
    where: {
      fileDeletedAt: null,
      OR: [
        { status: 'approved', reviewedAt: { lt: daysBefore(now, DOCUMENT_APPROVED_RETENTION_DAYS) } },
        { status: 'rejected', reviewedAt: { lt: daysBefore(now, DOCUMENT_REJECTED_RETENTION_DAYS) } },
      ],
    },
    select: { id: true, objectKey: true },
  });

  for (const doc of due) {
    await queueObjectDeletion({ objectKey: doc.objectKey, reason: 'document_retention' });
    await prisma.userDocument.update({
      where: { id: doc.id },
      data: { fileDeletedAt: now },
    });
  }

  return due.length;
};
```

Chamar `purgeExpiredDocumentFiles(new Date())` no laço principal do worker, junto das outras regras de retenção, e importar `queueObjectDeletion` de `../services/uploads/deletion-queue.js` se ainda não estiver importado.

Em `packages/shared/src/legal.ts`, acrescentar duas linhas na tabela de bases legais e duas na de retenção:

```
| Validar identidade para assinatura | CPF, telefone, documento de identidade | Art. 7, V — execução de contrato |
```

```
| Documento de identidade (aprovado) | 90 dias após a análise | Prevenção a fraude |
| Documento de identidade (rejeitado) | 30 dias após a análise | Prevenção a fraude |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- documents/lgpd-documents`
Expected: PASS, 6 testes.

- [ ] **Step 5: Verify the LGPD suites still pass**

Run: `pnpm --filter @ccc/api test -- account-deletion me-data-export workers`
Expected: PASS.

Run: `pnpm --filter @ccc/shared test`
Expected: PASS. Se houver snapshot da tabela legal, atualizar com as linhas novas.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/data-export.ts apps/api/src/services/account-deletion/anonymize.ts apps/api/src/workers/retention.ts packages/shared/src/legal.ts apps/api/test/documents/lgpd-documents.test.ts
git commit -m "feat(api): export, anonimizacao e retencao de cpf, telefone e documento"
```

---

## Task 13: Infra e documentação de operação

**Files:**
- Modify: `docs/r2.md`
- Modify: `docs/secrets.md`
- Modify: `docs/railway.md` (o runbook canônico. `RAILWAY.md` na raiz é só um ponteiro de 36 linhas e deve continuar assim)

**Interfaces:**
- Consumes: as quatro variáveis da Task 4.
- Produces: documentação. Nenhum código.

- [ ] **Step 1: Document the R2 documents bucket**

Em `docs/r2.md`, seção nova:

```markdown
## Bucket privado de documentos

Documento de identidade NÃO vai para o bucket principal. O principal é legível
através de `R2_PUBLIC_BASE_URL`, e um `objectKey` com cuid2 é difícil de
adivinhar, não um controle de acesso.

Criar um bucket separado:

- Sem dev subdomain público (`r2.dev` desabilitado).
- Sem custom domain.
- Sem política de leitura pública.
- Mesma credencial de API do bucket principal, ou uma credencial própria com
  escopo só nele.

Setar `R2_DOCUMENTS_BUCKET` com o nome dele. Sem essa variável, a API loga
`R2_DOCUMENTS_BUCKET unset` na subida em produção e grava documento no bucket
público — situação a corrigir imediatamente.

Leitura sempre por signed GET com TTL de `DOCUMENT_URL_TTL_SECONDS` (default
60s). Nunca `buildPublicUrl`.
```

- [ ] **Step 2: Document the four variables**

Em `docs/secrets.md` e `docs/railway.md`, na tabela de variáveis:

```markdown
| `PROFILE_GATE_ENABLED` | `false` | Liga os gates de perfil no checkout e na assinatura. |
| `PROFILE_GATE_ROLLOUT_PERCENT` | `0` | Percentual de usuários sob o gate. Bucket determinístico por `userId`. |
| `R2_DOCUMENTS_BUCKET` | — | Bucket R2 privado de documentos de identidade. Obrigatório em produção. |
| `DOCUMENT_URL_TTL_SECONDS` | `60` | TTL do signed GET de documento. |
```

- [ ] **Step 3: Write the rollout runbook**

Em `docs/railway.md`, seção nova:

```markdown
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
```

- [ ] **Step 4: Verify the whole suite is green before closing the plan**

Um comando por pacote. `pnpm lint` sem filtro estoura o heap neste repo.

```bash
pnpm --filter @ccc/shared lint && pnpm --filter @ccc/shared typecheck && pnpm --filter @ccc/shared test
```

```bash
pnpm --filter @ccc/api lint && pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api test
```

Expected: PASS em tudo. A suíte da API exige o daemon do Docker rodando. Colar a saída no handoff.

- [ ] **Step 5: Commit**

```bash
git add docs/r2.md docs/secrets.md RAILWAY.md
git commit -m "docs: bucket privado de documentos e runbook do gate de perfil"
```

---

## Notas de escopo

**Fora deste plano, por desenho:**

- Mobile. Ganha plano próprio depois que esta API estiver verde: cadastro com campos opcionais, sheet de complementação, tela de documento, ganchos de checkout e assinatura.
- Admin web (`apps/admin`). As rotas de revisão existem; a tela que as consome é escopo separado.
- Assinatura Apple via RevenueCat. Não passa por `POST /api/me/premium/checkout`, portanto não é coberta pelo gate. Se o requisito valer para iOS, é trabalho no webhook do RevenueCat.
- Unicidade de CPF entre contas. CPF cifrado não é pesquisável. Bloquear duplicidade exigiria uma coluna de hash determinístico, e não foi pedido.
- Preencher `customer.taxId` na AbacatePay a partir do CPF do perfil. Melhoria natural agora que o dado existe, mas fora do escopo.
- Notificação push ao rejeitar documento. O status já aparece em `GET /me/profile-status` e `GET /me/documents`; push é incremento.
