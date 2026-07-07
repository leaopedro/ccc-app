# Mobile build runbook

Goal: produce the first working mobile builds from the profiles already checked
into `apps/mobile/eas.json`, then install the preview build on real devices for
Phase 0.9 smoke testing.

Read [`docs/eas-credentials.md`](./eas-credentials.md) first. That file covers
Apple, Google Play, and Expo account setup. This file is the execution path once
those prerequisites exist.

## Profile map

| Profile       | Output                           | Device target                    | Main use            |
| ------------- | -------------------------------- | -------------------------------- | ------------------- |
| `development` | iOS simulator development client | local iOS simulator              | Fastest first proof |
| `preview`     | iOS internal build + Android APK | physical iPhone / Android device | Real-device smoke   |
| `production`  | Store-ready build                | App Store / Play Console         | Release only        |

Important:

- `development` is not enough for push or real-device smoke.
- `preview` is the first build that matters for v0.1 verification.
- Expo Go is not the target here. Native modules in the app require an EAS
  build.

## Prerequisites

- `pnpm install` already ran at repo root.
- `pnpm dlx eas-cli login` already succeeded.
- `apps/mobile/.env` contains a valid `EAS_PROJECT_ID`.
- For iOS preview installs, at least one iPhone was registered with
  `eas device:create`.

## Step 1: Confirm the current config

Run from the repo root:

```bash
pnpm --filter @jdm/mobile exec eas whoami
cat apps/mobile/eas.json
```

Sanity-check:

- `development` has `developmentClient: true`
- `development.ios.simulator` is `true`
- `preview.distribution` is `internal`
- `preview.android.buildType` is `apk`

## Step 2: First proof build

Run the fastest build first:

```bash
pnpm --filter @jdm/mobile exec eas build --profile development --platform ios
```

What this proves:

- Expo project linkage works
- the native iOS project compiles on EAS
- the `com.jdmexperience.app.dev` variant resolves correctly

What it does not prove:

- device install
- push registration
- Apple ad hoc provisioning
- TestFlight readiness

## Step 2.5: Native debug lane for iOS preview

Use this path when an EAS build fails or a preview build installs but does not
boot correctly. The goal is to reproduce the same native variant locally and
get real Xcode / simulator logs instead of guessing from the remote summary.

1. Regenerate the native iOS project for the correct variant:

```bash
pnpm --filter @jdm/mobile run ios:preview:prebuild
```

Important:

- Always use `--clean` for this repro path.
- Without a clean prebuild, Expo can reuse a stale `ios/` directory and compile
  the wrong native target.
- For this app, that means a preview repro can silently keep building the
  `JDMExperienceDev` project unless you regenerate it cleanly.

2. Install CocoaPods before trusting any local Xcode result:

```bash
pnpm --filter @jdm/mobile run ios:preview:pods
```

Why:

- `expo prebuild --no-install` creates the project, but not the CocoaPods
  workspace.
- If you skip this step, `xcodebuild` fails at `[CP] Check Pods Manifest.lock`
  before app code even runs.

3. Compile the preview variant for the simulator:

```bash
pnpm --filter @jdm/mobile run ios:preview:sim-build
```

If you hit a Sentry failure here, you should see `An organization ID or slug is
required` from the bundle step. That means the local debug lane is invoking
Sentry auto upload without local credentials. The script now sets
`SENTRY_DISABLE_AUTO_UPLOAD=true` for this lane, so it should continue to compile.

What this proves:

- the preview bundle identifier resolves locally
- the preview native target compiles under Xcode
- pods and generated native files are in sync

4. If compile succeeds, run the JS bundle in release-like mode:

```bash
pnpm --filter @jdm/mobile run ios:preview:metro-localhost
```

Then launch the preview dev client or simulator build against that bundle.

Important:

- For simulator repros, use `--host localhost`.
- The default Expo host mode is `lan`, which advertises a URL like
  `http://192.168.x.x:8081`. In this repo, that can produce a false
  "Could not connect to development server" red screen even after the native
  preview app and dev-launcher handoff are working.
- This script also forces `EXPO_PUBLIC_API_BASE_URL=https://jdm-production.up.railway.app`
  so the simulator debug lane talks to the same backend as the `preview` EAS profile
  instead of the local `http://localhost:4000` values in `.env` / `.env.local`.
- `localhost` is the reliable host mode for the iOS simulator debug lane.

5. Capture device or simulator logs during boot:

```bash
xcrun simctl boot "iPhone 16"
xcrun simctl spawn booted log stream --style compact --level debug --predicate 'process CONTAINS "JDMExperiencePreview"'
```

If the process name filter is too narrow, drop the predicate and capture the
full stream for the failing boot window.

Expected artifacts from this lane:

- the exact `xcodebuild` failure, if native compile is broken
- the exact boot-time exception, if native compile succeeds but app startup fails
- confirmation that the failure is local-native, JS runtime, or EAS signing only

Concrete failure fingerprints already seen in this repo:

- App opens `EXDevLauncher` and probes `http://localhost:{8081,8082,8083,8084,8085,19000,19001,19002}/status`:
  the preview build was still trying to reopen the last bundle. Regenerate with
  the checked-in `expo-dev-launcher` `launchMode: 'launcher'` config and clean
  prebuild.
- App reaches the bundle loader but red-screens on `http://192.168.x.x:8081/...bundle`:
  rerun Metro with `pnpm --filter @jdm/mobile run ios:preview:metro-localhost`.
- Metro crashes with `RangeError: Invalid string length` from
  `metro-file-map/src/crawlers/node/index.js`:
  this repo previously watched the entire workspace root in
  [`apps/mobile/metro.config.js`](../apps/mobile/metro.config.js), which made
  Metro's native `find` crawler buffer too much output when Watchman was absent.
  The checked-in config now relies on Expo's package-level watch folders instead
  of adding the monorepo root again.

## Step 3: First installable iPhone build

Run the real preview build:

```bash
pnpm --filter @jdm/mobile exec eas build --profile preview --platform ios
```

On the first run, accept the EAS prompts to:

- log into the Apple team if asked
- create or reuse the `com.jdmexperience.app.preview` identifier
- generate the signing certificate and provisioning profile
- include the registered test devices in the ad hoc profile

When it finishes:

- open the EAS build page
- send the install link to the iPhone
- install from Safari
- trust the profile in iOS settings if prompted

Expected app name:

- `JDM Experience (Preview)`

Expected backend target:

- `https://jdm-production.up.railway.app`

## Step 4: First installable Android build

Run:

```bash
pnpm --filter @jdm/mobile exec eas build --profile preview --platform android
```

When it finishes:

- download the APK from the EAS artifact page
- install it directly on an Android device
- or keep the artifact URL as the proof while Play Internal is being prepared

Expected result:

- installable APK for `com.jdmexperience.app.preview`

## Step 5: Optional Play Internal handoff

If Google Play Internal is already configured, move from direct APK sharing to
store-backed Android testing:

1. Build the Android artifact intended for Play.
2. Upload it to Play Console Internal testing.
3. Add tester emails or a Google Group.
4. Share the opt-in link or Play listing URL with testers.

Use this only after the direct APK proof exists. It is a distribution upgrade,
not the first unblocker.

## Step 6: Smoke checklist on the installed preview build

Run on at least one real phone:

- [ ] App launches without a native crash.
- [ ] First screen renders without a blank state loop.
- [ ] API is reachable and no global network error appears.
- [ ] Auth entrypoint opens.
- [ ] At least two route transitions work.
- [ ] Background and foreground once without crashing.
- [ ] No red-box or native fatal error appears.

Push and payments:

- Push is meaningful only on a real device build.
- Stripe native flows also need the real device build.
- If keys are still unset, record that limitation in the issue comment instead
  of treating it as a build failure.

## Step 7: What to paste into `JDMA-116`

Capture:

- build page URL for `development` iOS
- build page URL for `preview` iOS
- build page URL for `preview` Android
- which physical devices installed successfully
- pass/fail for each smoke item
- exact blocker, if any, with the failing profile and platform

## Troubleshooting

- Build asks for Apple login during `preview`:
  expected on the first interactive iOS build.
- `EAS project not configured` from `eas build` non-interactive runs:
  verify [`apps/mobile/app.config.ts`](../apps/mobile/app.config.ts) includes
  `extra.eas.projectId` for the linked Expo project. Dynamic config will not be
  patched automatically by `eas build`.
- Local preview repro still shows the dev app name or bundle id:
  rerun `pnpm --filter @jdm/mobile run ios:preview:prebuild`; a stale `ios/`
  directory can keep the wrong target.
- Local `xcodebuild` fails on `Podfile.lock` or `[CP] Check Pods Manifest.lock`:
  run `pnpm --filter @jdm/mobile run ios:preview:pods` first.
- Local `xcodebuild` fails in `Bundle React Native code and images` with
  `An organization ID or slug is required`:
  verify you are using `pnpm --filter @jdm/mobile run ios:preview:sim-build`
  (it now disables Sentry auto upload for local runs).
- iPhone install fails after adding a new device:
  rebuild `preview` iOS so the new UDID is in the provisioning profile.
- Android testers need Play instead of direct APK:
  use the Play Internal path after the first APK proof.
- Build succeeds but the app points to the wrong API:
  rebuild using the checked-in `preview` profile and verify the build page
  shows the expected environment.
