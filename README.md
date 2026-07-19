# PokéRogue Offline Builder

[![Update offline builds](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml/badge.svg)](https://github.com/VdustR/pokerogue-offline/actions/workflows/update-offline-builds.yml)

Live unlock-all PWA: <https://vdustr.dev/pokerogue-offline/>

Automated packages: <https://github.com/VdustR/pokerogue-offline/releases>

This repository builds two self-contained, local-save-only PokéRogue PWA editions from the current official `main` branch:

- `normal`: official progression with login and server access disabled.
- `unlock-all`: the same offline game with all supported species variants, natures, IVs, abilities, egg moves, passives, cost reductions, modes, achievements, vouchers, and ribbons unlocked.

The overlay is deliberately small and fail-closed. A scheduled build first checks whether the tracked patch still applies cleanly to upstream. If upstream changes conflict with an integration point, the workflow fails instead of publishing an unverified build.

## Automated updates

The included workflow runs every six hours and can also be started manually. It:

1. Checks out official `pagefaultgames/pokerogue@main` with the assets and locales submodules.
2. Applies the tracked patch and additive overlay.
3. Runs TypeScript checks and the complete upstream Vitest suite, including the unlock-all contract.
4. Builds both editions.
5. Downloads the complete PWA cache in Chrome, switches the browser offline, and verifies a cold reload.
6. Publishes ZIP files and SHA-256 checksums as a GitHub Release.

To host one edition as an installable PWA, create a repository Actions variable named `DEPLOY_PWA_VARIANT` with either `normal` or `unlock-all`, then configure GitHub Pages to use GitHub Actions. Only one edition is deployed because each complete game is several hundred megabytes.

Every pull request and push to `main` runs the same build gates. Upstream patch conflicts, overlay path collisions, type/schema changes, test regressions, build errors, incomplete caches, and offline cold-start failures all stop the workflow before release or deployment.

## Local verification

Requirements: Git, Node.js 24.9 or newer, pnpm 10.33.2, Chrome, and `zip`.

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

Serve `upstream/dist` over HTTPS or localhost. On first launch, use **Download for offline play** and wait for **Offline ready** before disconnecting the network.

Each current edition is about 640 MB after extraction. Keep at least 1.5 GB free during an update because the atomic updater temporarily retains both the last complete cache and the incoming cache.

## Update model

The PWA keeps the last complete version until every file in a new revision is cached. Only then does it mark the new cache ready and remove the previous cache. Interrupted downloads can be retried and do not invalidate the last complete version.

## Licensing and project status

This is an unofficial builder and is not affiliated with Pagefault Games, Nintendo, Game Freak, or The Pokémon Company. PokéRogue is AGPL-3.0-only; when distributing a modified build, keep the corresponding source and builder available and follow the upstream asset licensing and attribution requirements.
