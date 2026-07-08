# EAS and store setup runbook

Goal: configure Apple, Google Play, and Expo/EAS for the mobile app profiles
already checked into the repo, then produce the first working builds for Phase
0.9.

This document is the source of truth for `JDMA-116`.

## What exists in the repo today

`apps/mobile/app.config.ts` already pins these variants:

| Profile     | `APP_VARIANT` | iOS bundle id                   | Android package                 | Intended use                             |
| ----------- | ------------- | ------------------------------- | ------------------------------- | ---------------------------------------- |
| development | development   | `com.jdmexperience.app.dev`     | `com.jdmexperience.app.dev`     | First EAS dev-client / simulator proof   |
| preview     | preview       | `com.jdmexperience.app.preview` | `com.jdmexperience.app.preview` | Internal device builds for smoke testing |
| production  | production    | `com.jdmexperience.app`         | `com.jdmexperience.app`         | App Store / Play Store release           |

`apps/mobile/eas.json` already pins:

- `development`: development client, iOS simulator build.
- `preview`: internal distribution, iOS device build, Android APK.
- `production`: store-targeted profile with submit stubs.

Implication:

- The fastest first proof is `development` on an iOS simulator.
- The first real-device build for push, Stripe native modules, and v0.1 smoke is
  `preview`, not `development`.
- Google Play is not required to install the first `preview` APK, but it is
  required before Play Internal / production submission.

## Secrets and storage rules

Never commit any of the following:

- Apple certificates, provisioning profiles, `.p8` keys.
- Google Play service-account JSON.
- Android upload keystores.
- `apps/mobile/.env`.
- `apps/mobile/secrets/play-service-account.json`.

Store locations:

- EAS hosted credentials: Apple certs/profiles, Android keystore.
- EAS secret store: `APPLE_ID`, `ASC_APP_ID` when submit is in scope.
- Local untracked file: `apps/mobile/.env` with `EAS_PROJECT_ID`.
- Local untracked file: `apps/mobile/secrets/play-service-account.json` only when
  running `eas submit` manually.
- GitHub Actions secrets: `EXPO_TOKEN`, `EAS_PROJECT_ID` when CI build automation
  starts.

## Step 1: Apple setup

Do this once before the first iOS device build.

### 1.0 Exact values for JDM Experience

Use these values exactly.

#### App IDs

| Purpose            | Description field        | Bundle ID field                 | Type              |
| ------------------ | ------------------------ | ------------------------------- | ----------------- |
| Dev variant        | `JDM Experience Dev`     | `com.jdmexperience.app.dev`     | `Explicit App ID` |
| Preview variant    | `JDM Experience Preview` | `com.jdmexperience.app.preview` | `Explicit App ID` |
| Production variant | `JDM Experience`         | `com.jdmexperience.app`         | `Explicit App ID` |

#### Merchant ID

| Field       | Value                            |
| ----------- | -------------------------------- |
| Description | `JDM Experience Apple Pay`       |
| Identifier  | `merchant.com.jdmexperience.app` |

This merchant identifier matches the checked-in mobile code:

- `apps/mobile/app/_layout.tsx` uses `merchantIdentifier="merchant.com.jdmexperience.app"`.

#### App Store Connect record

Create this record now:

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Platforms        | `iOS`                                                                                      |
| Name             | `JDM Experience`                                                                           |
| Primary language | `Portuguese (Brazil)` if available; otherwise the closest Portuguese option shown by Apple |
| Bundle ID        | `com.jdmexperience.app`                                                                    |
| SKU              | `jdm-experience-ios-prod`                                                                  |
| User Access      | `Full Access`                                                                              |

Do not create the Store Connect record against `com.jdmexperience.app.preview`
unless you explicitly want preview builds in TestFlight as a separate app record.

### 1.1 Confirm account access

- Apple Developer Program membership must be active.
- In App Store Connect, the acting user needs `Account Holder`, `Admin`, or
  `App Manager` to create app records.
- In the Apple Developer portal, the same team must own the bundle ids below.

### 1.2 Create the bundle identifiers

Create these App IDs in Apple Developer:

- `com.jdmexperience.app.dev`
- `com.jdmexperience.app.preview`
- `com.jdmexperience.app`

Recommended display names:

- `JDM Experience Dev`
- `JDM Experience Preview`
- `JDM Experience`

Apple screen inputs for each App ID:

1. `Certificates, Identifiers & Profiles` → `Identifiers` → `+`
2. Choose `App IDs`
3. Keep the default `App` type
4. Fill the fields from the `App IDs` table above
5. Choose `Explicit App ID`
6. Paste the bundle ID exactly
7. Enable only the capabilities listed in `1.2a`
8. `Continue` → `Register`

### 1.2a Capabilities to enable on the App IDs

Enable these on all three App IDs:

- `Push Notifications`
- `Apple Pay`

Do not enable these today unless scope changes:

- `Sign in with Apple`
- `Associated Domains`
- `iCloud`
- `App Groups`
- `Wallet`

Why these two:

- Push is already in the app via `expo-notifications`.
- Apple Pay is already referenced by the Stripe payment sheet config and the
  `merchant.com.jdmexperience.app` identifier.

After you enable a capability, Apple notes that provisioning profiles using that
App ID become invalid and need regeneration. That is fine here because EAS will
regenerate signing assets on the next interactive build.

### App Review note — iOS bundle must not reference Stripe

The iOS bundle MUST NOT reference Stripe checkout surfaces. This is required for
App Store Review compliance: Apple rejects apps that imply an external payment
method for digital goods (App Store Review Guideline 3.1.1).

Enforcement: the `jdm-mobile/no-stripe-on-ios` ESLint rule (added in F8.18)
scans both `apps/mobile/src/**/*.{ts,tsx}` AND `apps/mobile/app/**/*.{ts,tsx}`
at CI time and reports an error if any of the following tokens appear outside
a `Platform.OS !== 'ios'` (or `=== 'android'`) guard:

- `stripe://`
- `checkout.stripe.com`
- `STRIPE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Runtime isolation on iOS:

- `apps/mobile/app/_layout.tsx` only mounts `<StripeProvider>` when
  `Platform.OS !== 'ios'`. iOS users never get a Stripe context in the
  React tree.
- `apps/mobile/app/(app)/profile/orders.tsx` passes
  `stripeAvailable: Platform.OS !== 'ios' && STRIPE_AVAILABLE` to
  `selectResumeKind`, so the Stripe-based ticket resume CTA never renders
  on iOS.

iOS users subscribe via Apple StoreKit through RevenueCat (canon §F8.16).
Android + web users subscribe via the Stripe Checkout flow. The two paths
are completely isolated.

Open product gap (Phase F8.1): iOS one-time order checkout (event tickets)
currently falls back to `kind === 'none'` — no payment CTA renders. The
fallback path needs a RevenueCat one-time purchase product OR an in-app
purchase product before the iOS store release.

Before submitting a TestFlight or App Store build:

1. Run `pnpm --filter @ccc/mobile exec eslint src/ app/` and confirm 0
   errors from the `jdm-mobile/no-stripe-on-ios` rule.
2. Confirm `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` is `true` in the EAS build
   secret so the Premium screen is not hidden behind the maintenance banner.
3. Confirm `EXPO_PUBLIC_RC_IOS_API_KEY` is set as an EAS secret for the
   production build profile.
4. Confirm the Phase F8.1 iOS order-checkout fallback has shipped (see
   open product gap above) before the App Store submission.

### 1.2b Create the Merchant ID first

Because Apple Pay is one of the enabled capabilities, create the merchant
identifier before you finish enabling Apple Pay on the App IDs:

1. `Certificates, Identifiers & Profiles` → `Identifiers` → `+`
2. Choose `Merchant IDs`
3. Fill:
   - `Description` = `JDM Experience Apple Pay`
   - `Identifier` = `merchant.com.jdmexperience.app`
4. `Continue` → `Register`

Then go back to each App ID:

1. Open the App ID
2. Click `Edit`
3. Enable `Apple Pay`
4. Select `merchant.com.jdmexperience.app`
5. `Continue` → `Save`

Note:

- One merchant identifier can be reused across multiple apps. That is the right
  setup for these three variants.

### 1.3 Create the App Store Connect app record

Before uploading a build to App Store Connect, Apple requires an app record.
For Phase 0.9, create the production record now:

- Platform: `iOS`
- Name: `JDM Experience`
- Primary language: `Portuguese (Brazil)` or the closest PT option available
- Bundle ID: `com.jdmexperience.app`
- SKU: `jdm-experience-ios-prod`

Apple screen inputs:

1. App Store Connect → `Apps` → `+` → `New App`
2. `Platforms` = `iOS`
3. `Name` = `JDM Experience`
4. `Primary Language` = `Portuguese (Brazil)` if Apple offers it
5. `Bundle ID` = `com.jdmexperience.app`
6. `SKU` = `jdm-experience-ios-prod`
7. `User Access` = `Full Access`
8. Click `Create`

Optional now, useful later:

- Create a second record for `com.jdmexperience.app.preview` only if you want to
  push preview builds through TestFlight instead of Expo internal distribution.

Not required for Phase 0.9:

- A Store Connect app record for `com.jdmexperience.app.dev`

### 1.4 Register test devices for preview installs

For internal iOS preview builds, Expo uses ad hoc provisioning. Every iPhone
that will install the preview IPA must be registered first:

```bash
pnpm --filter @ccc/mobile exec eas device:create
pnpm --filter @ccc/mobile exec eas device:list
```

Notes:

- `eas device:create` opens the device-registration flow. Complete it on the
  iPhone in Safari.
- Adding a new iPhone later requires another `preview` build so the new UDID is
  included in the provisioning profile.
- Expo notes that after `eas device:create`, you need to run the iOS build
  interactively so Apple can add that device to the ad hoc provisioning profile.

### 1.5 Let EAS manage signing

For the first iOS build, accept the EAS prompts to generate and store:

- Apple distribution certificate
- Provisioning profile for the relevant bundle id

Do not export them into the repo.

## Step 2: Google Play setup

Do this once before Play Internal or production release. It is not required for
the first direct-install APK from EAS, but it should be configured in the same
heartbeat so Android does not become the next blocker.

### 2.1 Create the Play Console app

Create the production Android app in Play Console:

- App name: `JDM Experience`
- Default language: `Portuguese (Brazil)` if available
- Package name: `com.jdmexperience.app`

Why production only:

- `preview` already builds as an APK and can be installed directly from the EAS
  artifact URL.
- Play tracks are tied to the production package namespace.

### 2.2 Opt into Play App Signing

On the first Play upload, accept Play App Signing unless there is a specific
reason to bring a legacy signing key. That keeps the upload key and the Play
app-signing key separated.

### 2.3 Create a service account for EAS submit

Create a Google Cloud service account and grant it Play Console access with at
least release-management permissions for this app.

Expected local file path when submit work starts:

`apps/mobile/secrets/play-service-account.json`

That path matches `submit.production.android.serviceAccountKeyPath` in
`apps/mobile/eas.json`. Keep the file gitignored and local-only.

### 2.4 Create the internal testing track

Once the app exists in Play Console:

- Open `Testing > Internal testing`
- Create the internal test track if prompted
- Add tester emails or a Google Group

This is the store-backed Android test path. Use it after the first direct APK
proof if you want installs and updates through Google Play.

## Step 3: Expo / EAS linkage

### 3.1 Log in

Run on a real terminal with TTY:

```bash
pnpm dlx eas-cli login
pnpm --filter @ccc/mobile exec eas whoami
```

### 3.2 Link the project

Run once:

```bash
pnpm --filter @ccc/mobile exec eas init --non-interactive
```

Copy the generated UUID into `apps/mobile/.env`:

```dotenv
EAS_PROJECT_ID=<uuid-from-eas-init>
```

`app.config.ts` already reads `process.env.EAS_PROJECT_ID`.

### 3.3 Keep `.env` aligned

Minimum local file for the first build:

```dotenv
APP_VARIANT=development
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
EAS_PROJECT_ID=<uuid-from-eas-init>
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_redacted_replace_me
EXPO_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT_MOBILE=
```

For `preview`, `eas.json` overrides `APP_VARIANT=preview` and points the app at
`https://jdm-production.up.railway.app`.

## Step 4: First builds to run

Run these in order.

### 4.1 Fastest proof: iOS simulator dev build

Use this to prove the Expo project is linked and the native project compiles.
This does not prove device install, push, or App Store readiness.

```bash
pnpm --filter @ccc/mobile exec eas build --profile development --platform ios
```

Expected outcome:

- EAS build finishes successfully.
- Artifact is a simulator build for `com.jdmexperience.app.dev`.

### 4.2 First real iPhone build: preview

Use this for the first installable iPhone build:

```bash
pnpm --filter @ccc/mobile exec eas build --profile preview --platform ios
```

Expected outcome:

- Internal-distribution IPA for `com.jdmexperience.app.preview`
- Install URL or QR from Expo
- Build points at Railway production API per `eas.json`

Important:

- If a new device was just added, run this interactively so EAS can update the
  ad hoc provisioning profile.

### 4.3 First real Android build: preview APK

Use this for the first installable Android artifact:

```bash
pnpm --filter @ccc/mobile exec eas build --profile preview --platform android
```

Expected outcome:

- Installable APK for `com.jdmexperience.app.preview`
- Direct download URL from Expo

### 4.4 Store-targeted builds later

Do not use these as the first proof. They are for release readiness:

```bash
pnpm --filter @ccc/mobile exec eas build --profile production --platform ios
pnpm --filter @ccc/mobile exec eas build --profile production --platform android
```

Production submit remains blocked on:

- `APPLE_ID`
- `ASC_APP_ID`
- `apps/mobile/secrets/play-service-account.json`
- Store listing metadata and compliance screens

## Step 5: Evidence required for `JDMA-116`

Before Phase 0.9 can move toward done, capture all of this on the issue:

- EAS project linked and `EAS_PROJECT_ID` stored locally.
- Apple bundle ids created.
- App Store Connect production app record created.
- Google Play production app created.
- `development` iOS build URL.
- `preview` iOS build URL.
- `preview` Android build URL.
- Install proof on at least one physical iPhone or Android device for the
  `preview` build.
- Smoke result summary: launch, API reachability, navigation, auth open, no
  native crash on foreground/background.

Roadmap rule reminder:

- `plans/roadmap.md` 0.9 flips to `[x]` only after the required build proof is
  merged and the builds actually exist.

## Troubleshooting

- `eas init` says the project is already linked:
  inspect `apps/mobile/.env` and confirm `EAS_PROJECT_ID` is present.
- iOS preview build says no devices are registered:
  rerun `eas device:create`, then rebuild `preview` for iOS.
- Android preview build succeeds but testers cannot install:
  confirm the artifact is an APK from the `preview` profile, not a production
  AAB.
- iOS preview installs on one phone but not another:
  the second UDID was not in the provisioning profile used for that build.
- App launches but API calls fail:
  verify `https://jdm-production.up.railway.app/health` and confirm the preview
  build used the checked-in `preview` profile.
