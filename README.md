# PokéRogue Offline

[![Update offline builds](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml/badge.svg)](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml)
[![Latest release](https://img.shields.io/github/v/release/VdustR/pokerogue-offline?display_name=tag&sort=date)](https://github.com/VdustR/pokerogue-offline/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

An unofficial, fully offline PokéRogue PWA that automatically tracks the official `main` branch and stops publishing when an upstream change cannot be verified safely.

- **Play the unlock-all PWA:** <https://vdustr.dev/pokerogue-offline/>
- **Download normal or unlock-all ZIPs:** <https://github.com/VdustR/pokerogue-offline/releases>
- **Inspect update runs:** <https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml>

## Editions

| Edition | Progression | Distribution |
| --- | --- | --- |
| `normal` | Official progression with login and server access disabled | GitHub Releases |
| `unlock-all` | Automatically applies every supported local progression unlock | GitHub Pages and Releases |

The unlock-all preset is idempotent and runs when a local save is created or loaded. It preserves player identity and run history while unlocking supported species variants, natures, 31 IVs, abilities, egg moves, passives, cost reductions, modes, achievements, vouchers, and ribbons.

All saves stay in browser-local storage. These builds do not connect to the official game server.

## Install and play offline

1. Open the [hosted PWA](https://vdustr.dev/pokerogue-offline/) while online.
2. Select **Download for offline play**.
3. Keep the page open until it reports **Offline ready**.
4. Install the PWA from the browser menu if desired.
5. Disconnect the network and launch or reload the game normally.

The current complete cache is about 640 MB. The installer requests persistent browser storage, downloads every required file, and only marks the version ready after the cache is complete.

Browser storage is still controlled by the browser and operating system. Clearing site data or storage eviction removes the offline installation and requires another download.

## Automated upstream updates

The [update workflow](.github/workflows/update-offline-builds.yml) runs at minute 23 every six hours, on every push and pull request to `main`, and on manual dispatch.

Each update:

1. Checks out [`pagefaultgames/pokerogue@main`](https://github.com/pagefaultgames/pokerogue) and its assets and locales submodules.
2. Applies the tracked offline patch and additive overlay.
3. Runs TypeScript checks and the complete upstream Vitest suite.
4. Builds both editions.
5. Loads the complete cache in Chrome, switches Chrome offline, and verifies a cold reload for each edition.
6. Publishes both ZIPs with SHA-256 checksums as a GitHub Release.
7. Deploys the verified unlock-all edition to GitHub Pages.

The workflow is fail-closed. It publishes nothing when any of these gates fail:

- the patch no longer applies cleanly;
- an overlay path collides with a new upstream file;
- types or upstream tests fail;
- either production build fails;
- the service worker does not cache every declared file; or
- Chrome cannot cold-start the built game without a network.

An interrupted client-side update keeps the last complete cache. The service worker activates a new revision only after every file has downloaded successfully, then removes the previous revision.

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
