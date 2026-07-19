# PokéRogue Offline

[![Update offline builds](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml/badge.svg)](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml)
[![Latest release](https://img.shields.io/github/v/release/VdustR/pokerogue-offline?display_name=tag&sort=date)](https://github.com/VdustR/pokerogue-offline/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

An unofficial, fully offline PokéRogue PWA that automatically tracks the official `main` branch and stops publishing when an upstream change cannot be verified safely.

- **Play the unlock-all PWA:** [GitHub Pages](https://vdustr.dev/pokerogue-offline/)
- **Download normal or unlock-all ZIPs:** [GitHub Releases](https://github.com/VdustR/pokerogue-offline/releases)
- **Inspect update runs:** [GitHub Actions](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml)

## Editions

| Edition | Progression | Distribution |
| --- | --- | --- |
| `normal` | Official progression with login and server access disabled | GitHub Releases |
| `unlock-all` | Automatically applies every supported local progression unlock | GitHub Pages and Releases |

The unlock-all preset is idempotent and runs when a local save is created or loaded. It preserves player identity and run history while unlocking supported species variants, natures, 31 IVs, abilities, egg moves, passives, cost reductions, modes, achievements, vouchers, and ribbons.

All saves stay in browser-local storage. These builds do not connect to the official game server.

The offline build stores its language choice separately from other apps on the same origin. Browser locales for Taiwan, Hong Kong, and Macau are normalized to Traditional Chinese; China and Singapore are normalized to Simplified Chinese. A stale official-site `prLang` value therefore cannot silently select Thai in this build.

## Install and play offline

1. Open the [hosted PWA](https://vdustr.dev/pokerogue-offline/) while online.
2. Install it from the browser menu or home-screen install action.
3. Launch the installed PWA once while online. It prepares offline data automatically in the background.
4. After the brief **Offline ready** status appears, disconnect the network and launch the installed PWA normally.

Regular browser tabs do not show an offline prompt, register the dedicated service worker, or start the bulk download. The automatic installer only runs in standalone, fullscreen, or minimal-UI PWA display modes. Its status toast and bottom progress line do not intercept touches and disappear automatically.

Browsers share storage between an installed PWA and same-origin tabs. After installation, an ordinary tab may reuse already prepared offline data, but it never starts or retries the bulk download itself.

The current complete cache is about 640 MB. The PWA requests persistent browser storage and only marks a version ready after every file passes SHA-256 integrity verification. If the operating system suspends the browser, the next PWA launch resumes from the already verified files instead of starting over. Subsequent official updates reuse unchanged content by hash and keep the last complete revision available until the replacement is ready.

Browser storage is still controlled by the browser and operating system. Clearing site data or storage eviction removes the offline installation and requires another download.

## Automated upstream updates

The [update workflow](.github/workflows/update-offline-builds.yml) runs at minute 23 every six hours, on every push and pull request to `main`, and on manual dispatch.

Each update:

1. Checks out [`pagefaultgames/pokerogue@main`](https://github.com/pagefaultgames/pokerogue) and its assets and locales submodules.
2. Applies the tracked offline patch and additive overlay.
3. Runs TypeScript checks and the complete upstream Vitest suite.
4. Builds both editions.
5. Verifies in Chrome that regular web mode does not install offline data, installed-PWA mode downloads automatically, an interrupted download resumes without re-fetching completed files, and an offline cold reload succeeds for each edition.
6. Publishes both ZIPs with SHA-256 checksums as a GitHub Release.
7. Deploys the verified unlock-all edition to GitHub Pages.

The workflow is fail-closed. It publishes nothing when any of these gates fail:

- the patch no longer applies cleanly;
- an overlay path collides with a new upstream file;
- types or upstream tests fail;
- either production build fails;
- the service worker does not cache every declared file; or
- Chrome cannot cold-start the built game without a network.

An interrupted client-side update keeps the last complete cache. Content-addressed storage downloads only missing SHA-256 objects, activates a new revision only after every declared file is present, and then removes superseded metadata and unreferenced content.

## Local verification

Requirements: Git, the Node.js version declared by upstream, pnpm 10.33.2, Chrome, and `zip`.

```sh
git clone --depth 1 --recurse-submodules https://github.com/pagefaultgames/pokerogue.git upstream
pnpm install --frozen-lockfile
bash scripts/apply-overlay.sh upstream
pnpm --dir upstream install --frozen-lockfile
pnpm --dir upstream typecheck
pnpm --dir upstream test:silent
pnpm --dir upstream build:offline
node e2e/offline-e2e.mjs upstream/dist
```

Use `pnpm --dir upstream build:offline:unlock-all` to verify the unlock-all edition instead. Keep at least 1.5 GB free during an update because the atomic cache transition temporarily retains both the current and incoming versions.

## Licensing and project status

This project is not affiliated with Pagefault Games, Nintendo, Game Freak, or The Pokémon Company. PokéRogue is licensed under AGPL-3.0-only. Distributed builds must keep the corresponding source and builder available and comply with upstream asset licensing and attribution requirements.
