# PokéRogue Offline Apps

[![Build offline app releases](https://github.com/VdustR/pokerogue-offline/actions/workflows/build-releases.yml/badge.svg)](https://github.com/VdustR/pokerogue-offline/actions/workflows/build-releases.yml)
[![Latest release](https://img.shields.io/github/v/release/VdustR/pokerogue-offline?display_name=tag&sort=date)](https://github.com/VdustR/pokerogue-offline/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Unofficial, fully offline PokéRogue apps for Electron desktop and Android. Automated builds track the official `main` branch and fail closed when an upstream change can no longer be applied or verified safely.

- **Download apps:** [GitHub Releases](https://github.com/VdustR/pokerogue-offline/releases/latest)
- **Inspect update runs:** [GitHub Actions](https://github.com/VdustR/pokerogue-offline/actions/workflows/build-releases.yml)

There is no hosted web or PWA edition. Every app includes the complete game and can start without downloading game data.

## Editions

| Edition | Progression | App identity |
| --- | --- | --- |
| `normal` | Official local progression with login and server access disabled | PokéRogue Offline |
| `unlock-all` | Automatically applies every supported local progression unlock | PokéRogue Unlock All |

The two editions use separate application identifiers, so they can be installed side by side. Their saves are intentionally separate.

The unlock-all preset is idempotent and runs when a local save is created or loaded. It preserves player identity and run history while unlocking supported species variants, natures, 31 IVs, abilities, egg moves, passives, cost reductions, modes, achievements, vouchers, and ribbons.

The offline build stores its language choice separately from other PokéRogue installations, so a stale official-site `prLang` value cannot silently select Thai. On first launch it checks the operating system's preferred languages in order, saves the first supported match, and keeps that choice until the player changes it in PokéRogue's language settings.

Locale matching is deliberately strict: exact supported locales win; language-wide translations accept region variants such as `de-AT` -> `de`; Taiwan, Hong Kong, and Macau map to Traditional Chinese; China, Singapore, and Malaysia map to Simplified Chinese; and regional Spanish maps to either Spain or LATAM. Ambiguous or unsupported locales (for example bare `zh`, bare `es`, or `pt-PT`) continue to the next system preference, then fall back to English when none match.

## Electron desktop

Electron releases are provided for:

- macOS Apple silicon (`arm64`)
- macOS Intel (`x64`)
- Windows (`x64`)
- Linux (`x64`)

Desktop builds keep the small Electron shell in ASAR and place the complete game in the platform's standard read-only resources directory for reliable media streaming. The renderer uses an isolated custom protocol with Node.js integration disabled, Chromium sandboxing enabled, permission requests denied, and HTTP, HTTPS, and WebSocket traffic blocked. Press `F11` to toggle fullscreen.

### macOS installation and Gatekeeper

These community builds have a complete ad-hoc bundle signature, but are not signed with an Apple Developer ID and are not notarized. macOS may report that it cannot verify the developer. Keep Gatekeeper enabled and use Apple's per-app override:

1. Download the ZIP matching the Mac processor and extract it.
2. Move the `.app` into `/Applications`.
3. Double-click the app once. If macOS blocks it, choose **Done**.
4. Within about one hour, open **System Settings → Privacy & Security**. In the **Security** section, choose **Open Anyway** for the blocked PokéRogue app, authenticate, then confirm **Open**.

The override is remembered for that app. Do not disable Gatekeeper globally. Verify the download against `SHA256SUMS.txt` before opening it.

Do not bypass a warning that says the app **is damaged** or **will damage your computer**. Re-download it, verify its checksum, and report the release instead; those warnings are different from the expected unidentified-developer warning.

### Windows and Linux

On Windows, extract the ZIP and run the executable inside. Windows SmartScreen may show an unsigned-publisher warning; use **More info → Run anyway** only after verifying the checksum.

On Linux, extract the `.tar.gz` archive and run the included executable. The archive preserves executable permissions.

## Android

Android 8.0 or newer is supported. Each APK contains the complete game, requests no `INTERNET` permission, runs in an immersive landscape WebView, serves media with byte-range support, and uses Android's system document picker for save import and export. The status and navigation bars stay hidden during play and can be revealed temporarily with an edge swipe. Display cutouts are applied as a dynamic safe area so a notch or camera hole cannot cover the game controls.

Pressing Android's Back button opens a native confirmation dialog. Cancel returns to the game; Exit stops playback, closes the app, and removes it from Recents.

The app uses PokéRogue's official web-app logo as its launcher icon. It remains landscape to preserve the game's layout, but follows Android's user rotation setting when choosing normal or reverse landscape. It does not force sensor rotation when the user has rotation lock enabled.

1. Download the APK for the preferred edition from the latest Release.
2. Verify it against `SHA256SUMS.txt`.
3. Open the APK and allow **Install unknown apps** for the browser or file manager when Android asks.
4. Install an update over the same edition to retain its local saves. Do not uninstall first.

Normal and unlock-all have different package names and can be installed together. Future updates are signed with the same project key so Android can update them in place.

Because each APK contains the full game, keep at least 1.5 GB of free storage for download, installation, and WebView data. Android may display an additional warning for apps distributed outside an app store.

## Automated upstream updates

The [release workflow](.github/workflows/build-releases.yml) runs at minute 23 every six hours, on every push and pull request to `main`, and on manual dispatch.

Each update:

1. Checks out [`pagefaultgames/pokerogue@main`](https://github.com/pagefaultgames/pokerogue) with its assets and locales submodules.
2. Applies the tracked offline patch and additive overlay.
3. Runs TypeScript checks and the complete upstream Vitest suite.
4. Builds normal and unlock-all editions.
5. Launches each edition before and after Linux packaging, then verifies canvas startup, save persistence, renderer isolation, local-resource integrity, and blocked network access.
6. Builds and lints both Android flavors, signs the APKs, verifies their signatures, and rejects any APK that requests `INTERNET` permission.
7. Packages platform-specific Electron archives and publishes all files with one SHA-256 checksum manifest as a GitHub Release.

Artifacts are uploaded to a draft Release as each platform passes, then the Release becomes public only after every verification gate succeeds. An incomplete draft is removed automatically. A release tag contains both the upstream and builder revisions, so a builder change also produces a newly verified release even when upstream has not moved.

Android releases require these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## Local verification

Requirements: Git, the Node.js version declared by upstream, pnpm 10.33.2, Electron's Linux runtime dependencies or macOS/Windows, JDK 17, Android SDK 36, and at least 8 GB of free working space.

```sh
git clone --depth 1 --recurse-submodules https://github.com/pagefaultgames/pokerogue.git upstream
pnpm install --frozen-lockfile
bash scripts/apply-overlay.sh upstream
pnpm --dir upstream install --frozen-lockfile
pnpm --dir upstream typecheck
pnpm --dir upstream test:silent
pnpm --dir upstream build:offline
pnpm e2e:electron upstream/dist
```

Build both Android flavors after staging the two web builds:

```sh
pnpm stage:android builds/normal builds/unlock-all
cd android
./gradlew assembleNormalDebug assembleUnlockAllDebug lintNormalDebug lintUnlockAllDebug
```

Use `pnpm --dir upstream build:offline:unlock-all` for the unlock-all web payload. Release APK signing is intentionally performed by GitHub Actions rather than local Gradle configuration.

## Licensing and project status

This project is not affiliated with Pagefault Games, Nintendo, Game Freak, or The Pokémon Company. PokéRogue is licensed under AGPL-3.0-only. Distributed builds keep the corresponding source and builder available and must comply with upstream asset licensing and attribution requirements.
