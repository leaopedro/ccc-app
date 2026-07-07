# Admin MFA with TOTP and Recovery Codes

## Problem

Admin/organizer/staff accounts control sensitive operations (user management, finance, broadcasting). A compromised password gives full access. LGPD L15 requires security TOMs including MFA and access control.

## Design

### Approach: Challenge-token login flow

When MFA-enrolled user logs in, the existing `/auth/login` endpoint returns a short-lived MFA challenge token instead of full auth tokens. A second call to `/auth/mfa/verify` (or `/auth/mfa/recovery`) completes authentication.

This approach works because access tokens already have 15-minute TTL, so login-time MFA verification effectively means "recent MFA" for all operations within that window. No step-up auth needed for MVP.

### Database Schema

```prisma
model MfaSecret {
  id              String    @id @default(cuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  encryptedSecret String    // AES-256-GCM encrypted TOTP secret
  verifiedAt      DateTime? // null until enrollment confirmed with first valid code
  createdAt       DateTime  @default(now())
}

model MfaRecoveryCode {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash  String    // SHA-256 hash
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}
```

User model additions:

```prisma
model User {
  // existing fields...
  mfaSecret       MfaSecret?
  mfaRecoveryCodes MfaRecoveryCode[]
}
```

### TOTP Parameters

- Algorithm: SHA1 (Google Authenticator compatibility)
- Digits: 6
- Period: 30 seconds
- Window: 1 step tolerance (accepts t-1, t, t+1)
- Issuer: "JDM Experience"
- Library: `otpauth` npm package

### Secret Encryption

TOTP secrets encrypted at rest with AES-256-GCM:

- Key: `MFA_ENCRYPTION_KEY` env var (32 bytes, base64-encoded)
- Format stored: `iv:authTag:ciphertext` (all base64)
- Encrypt on enrollment, decrypt only during verification

### Recovery Codes

- 10 codes generated at enrollment
- Format: `XXXX-XXXX` (uppercase alphanumeric, no ambiguous chars: 0/O/I/1/L removed)
- Stored as SHA-256 hashes (no salt needed, codes have sufficient entropy)
- Single-use: `usedAt` timestamp set on consumption
- Regeneration: deletes all existing codes and creates 10 new ones
- Shown to user once at enrollment and regeneration only

### API Endpoints

**Enrollment (admin routes, requires auth):**

| Method | Path                        | Description                                             |
| ------ | --------------------------- | ------------------------------------------------------- |
| POST   | `/admin/mfa/setup`          | Generate TOTP secret, return otpauth URI + backup codes |
| POST   | `/admin/mfa/verify-setup`   | Confirm enrollment with first valid TOTP code           |
| DELETE | `/admin/mfa`                | Disable MFA (requires current TOTP or recovery code)    |
| POST   | `/admin/mfa/recovery-codes` | Regenerate recovery codes (requires TOTP)               |

**Authentication (public routes):**

| Method | Path                 | Description                       |
| ------ | -------------------- | --------------------------------- |
| POST   | `/auth/mfa/verify`   | Complete login with TOTP code     |
| POST   | `/auth/mfa/recovery` | Complete login with recovery code |

### Login Flow Changes

Current `/auth/login` response:

```json
{ "accessToken": "...", "refreshToken": "...", "user": {...} }
```

With MFA enabled, login returns:

```json
{ "mfaRequired": true, "mfaToken": "..." }
```

MFA token: JWT with 5-minute TTL, payload `{ sub: userId, purpose: "mfa_challenge" }`, signed with `JWT_ACCESS_SECRET`.

### Rate Limiting

- `/auth/mfa/verify`: 5 attempts per 5 minutes per IP
- `/auth/mfa/recovery`: 5 attempts per 5 minutes per IP
- `/admin/mfa/setup`: 3 per hour per user

### Admin App UI Changes

1. **Login page**: After credentials, show TOTP input field when `mfaRequired` returned. Recovery code link below.
2. **Settings/Security page**: MFA setup card with QR code display, recovery code download, enable/disable toggle.

### Shared Schemas (packages/shared)

```typescript
// MFA schemas
export const mfaSetupResponseSchema = z.object({
  otpauthUri: z.string(),
  recoveryCodes: z.array(z.string()),
});

export const mfaVerifySetupSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
});

export const mfaVerifySchema = z.object({
  mfaToken: z.string(),
  code: z.string().length(6).regex(/^\d+$/),
});

export const mfaRecoverySchema = z.object({
  mfaToken: z.string(),
  code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
});

export const mfaDisableSchema = z.object({
  code: z.string(), // TOTP or recovery code
});
```

### Audit Events

Add to admin audit actions:

- `mfa.setup_started`
- `mfa.enrolled`
- `mfa.disabled`
- `mfa.recovery_code_used`
- `mfa.recovery_codes_regenerated`

### Security Considerations

- TOTP secret never returned after enrollment verification
- Recovery codes shown once, then only hashes stored
- MFA token is purpose-scoped JWT, cannot be used for API access
- Failed MFA attempts are rate-limited and logged
- Disabling MFA requires proof of possession (TOTP or recovery code)
- Encryption key rotation: re-encrypt all secrets with new key, document in runbook

### Testing Strategy

- Unit tests for TOTP generation/verification
- Unit tests for recovery code generation/hashing
- Integration tests for enrollment flow (setup -> verify-setup)
- Integration tests for login-with-MFA flow
- Integration tests for recovery code usage
- Integration tests for MFA disable flow
- All tests hit real Postgres per repo rules

### Out of Scope

- Mandatory MFA enforcement (admin can choose to enroll)
- SMS/email OTP (TOTP only)
- WebAuthn/FIDO2 (future consideration)
- Step-up auth for individual admin actions (15-min JWT TTL covers this)
- MFA for regular `user` role (admin/organizer/staff only)
