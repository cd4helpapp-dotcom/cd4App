# CD4 Play Store Release Guide

This project uses Expo + EAS for Android production builds and GitHub Actions for CI/CD.

## Current configuration

- App name: `CD4`
- Android package: `com.cd4.app`
- EAS project ID: `abd33322-02c5-4b08-abf2-705108d9d9c7`
- Production artifact: Android App Bundle (`.aab`)
- Version source: EAS remote versioning
- Production build profile: `production`
- Supabase project ref: `prcpnwectrptrpblmezy`

Do not change `com.cd4.app` after publishing. Google Play treats it as the permanent app identity.

## One-time setup

### Expo/EAS

```powershell
npm install --global eas-cli
eas login
eas whoami
```

Confirm that the account can access the `cd4ai` Expo owner and this EAS project.

### Google Play Console

1. Create the CD4 app in [Google Play Console](https://play.google.com/console).
2. Use package ID `com.cd4.app`.
3. Complete store listing, app access, content rating, target audience, Data safety, and privacy policy sections.
4. Create an Internal testing track.
5. Upload the first `.aab` manually if Google requires the first upload to establish app signing.

### Android signing

Run once interactively:

```powershell
eas credentials -p android
```

Let EAS manage the production keystore unless an existing production keystore must be preserved. Never commit `.jks`, `.keystore`, or private keys.

### Google sign-in / Firebase

The Android package must be exactly `com.cd4.app`. Add the EAS production keystore SHA-1 and SHA-256 fingerprints to Firebase/Google Cloud. Then download the matching `google-services.json`. This file is intentionally ignored by Git and must be supplied securely to EAS builds.

## GitHub Actions secrets

Create a GitHub Environment named `production`. Add these as Actions secrets:

| Secret | Used for | Value |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase link and deployments | Supabase access token |
| `SUPABASE_PROJECT_REF` | Selecting the project | `prcpnwectrptrpblmezy` |
| `SUPABASE_DB_PASSWORD` | Applying migrations | Supabase database password |
| `EXPO_TOKEN` | EAS build and Play submission | Expo token |

`SUPABASE_DB_PASSWORD` is not the anon key, service-role key, or access token. The CI workflow passes it to `supabase db push`.

Create an Expo token with the required project access:

```powershell
eas token:create
```

Never put these values in source code, committed `.env` files, workflow YAML, screenshots, or chat.

## EAS Play submission setup

The Android workflow is `.github/workflows/android-release.yml`. Configure Google Play service-account credentials in EAS once, using the minimum Play Console upload permission. Verify interactively:

```powershell
eas submit --platform android --profile production
```

After this succeeds, GitHub can submit non-interactively using `EXPO_TOKEN`.

## Supabase production configuration

Configure these as Supabase Edge Function secrets where required:

- Razorpay live key ID and secret
- Razorpay webhook secret
- AI provider keys used by chat, voice, and prescription functions
- Agora server credentials used for call-token generation
- Security and scheduled-job secrets

Public client values may use `EXPO_PUBLIC_*` (Supabase URL, anon key, Agora app ID, Razorpay public key). Never expose private keys, webhook secrets, service-role keys, or database passwords through `EXPO_PUBLIC_*` variables.

For live payments, configure the live Razorpay public key in the production EAS environment and private credentials only in Supabase. Test successful, failed, cancelled, and webhook payment flows before production.

## Release process

### Local validation

```powershell
npm ci
npx tsc --noEmit
git diff --check
npx expo export --platform web --no-minify
```

### Push and automatic Supabase deployment

```powershell
git add .
git commit -m "Prepare release"
git push origin main
```

`.github/workflows/ci-cd.yml` validates the app on pull requests and deploys Supabase migrations plus all Edge Functions after a successful push to `main` or `master`.

### Android build and Play submission

1. Open GitHub Actions.
2. Select **Android release**.
3. Click **Run workflow**.
4. Keep `submit_to_play_store` false for build-only testing.
5. Test the AAB in Internal testing.
6. Set it true only after EAS Play submission credentials are configured.
7. Promote the tested release to Closed testing and then Production in Play Console.

Equivalent local commands:

```powershell
eas build --platform android --profile production
eas submit --platform android --profile production
```

The production profile uses EAS remote versioning and automatically increments the Android version code. Never reuse an uploaded version code.

## Play Store listing checklist

Prepare:

- App icon and feature graphic
- Phone screenshots and current Android screenshots
- Short and full descriptions
- Support email and developer contact details
- Privacy policy URL
- Account deletion instructions
- Data safety declaration for health data, voice input, reports, appointments, payments, location, camera/microphone, and notifications
- Content rating questionnaire
- Target audience and advertising declaration
- Reviewer login/test-account instructions
- Required health/medical app declarations for the target region

Do not claim that CD4 diagnoses patients or replaces doctors. The listing should accurately describe health support, consultations, appointments, prescriptions, and doctor communication.

## Release testing checklist

Test the release on at least two Android versions and different screen sizes:

- Patient and doctor login/logout
- Doctor search, slots, normal Consultation booking
- Second Opinion booking and doctor-side `Second Opinion` label
- Successful, failed, and cancelled payment flows
- Doctor payment notification, revenue, and transaction history
- Voice assistant speaker output on multiple Android manufacturers
- Voice prescription review and non-overlapping PDF
- Chat, audio/video call, mute, speaker, and keyboard behavior
- Push notifications and notification permission
- Camera, microphone, location, calendar, document, and gallery permissions
- Dark mode, small screens, slow network, and retry states

## Common failures

### Supabase database password error

Use the database password, not the Supabase access token or anon key:

```powershell
$env:SUPABASE_DB_PASSWORD="your-database-password"
npx supabase db push
```

In GitHub, confirm the secret exists in the `production` environment.

### EAS submit fails in non-interactive mode

Run `eas submit --platform android --profile production` interactively once and configure the Google Play service account in EAS.

### Google sign-in fails after publishing

Add the EAS production keystore SHA-1/SHA-256 fingerprints to Firebase/Google Cloud and update `google-services.json`.

### Play Console rejects the version code

Start a new production EAS build. Do not manually reuse an Android version code already uploaded to Play Console.

### GitHub build fails while local build works

Check the `production` environment, `EXPO_TOKEN`, Node version, EAS project access, public production variables, and the first failing EAS log step.

## Security rules

- Never commit `.env`, `google-services.json`, Play service-account JSON, keystores, or private keys.
- Rotate any credential exposed in logs, screenshots, commits, or chat.
- Keep database and service-role credentials server-side only.
- Prefer separate Supabase and Razorpay test/live environments.
- Review GitHub Actions logs to ensure secrets are not printed.
