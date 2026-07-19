# Android window experience research

This note records the platform contracts behind the Android shell behavior. The game source remains unchanged.

## Decisions

- Use immersive mode and hide both status and navigation bars. Configure transient bars so an edge swipe temporarily overlays them instead of resizing the game. This follows Android's official [immersive mode guidance](https://developer.android.com/develop/ui/views/layout/immersive).
- Draw edge to edge, use `shortEdges` cutout mode, and apply `DisplayCutout` safe insets to the WebView container. Android 15 enforces edge-to-edge for target SDK 35 and newer, so explicit safe-area handling is required to keep controls away from a notch or camera hole. See [edge-to-edge views](https://developer.android.com/develop/ui/views/layout/edge-to-edge) and [display cutout support](https://developer.android.com/develop/ui/views/layout/display-cutout).
- Keep the native WebView container as the single owner of cutout spacing. The upstream overlay step fails closed if PokéRogue starts using CSS `safe-area-inset-*`, because Android WebView still exposes those CSS values after view-level display-cutout insets are consumed; combining both mechanisms would double the safe area and requires an explicit migration.
- Use `userLandscape`, not `sensorLandscape`. Android documents that `sensorLandscape` uses the sensor even when the user has locked sensor rotation, while `userLandscape` chooses normal or reverse landscape using the sensor only according to the user's preference. See the [`<activity>` orientation reference](https://developer.android.com/guide/topics/manifest/activity-element#screen).
- Preserve landscape because PokéRogue is designed around a landscape canvas. On Android 16 large screens with smallest width of at least 600 dp, the platform can ignore requested orientation for resizable apps; phone behavior remains governed by `userLandscape`.
- Stage the launcher icon from the official build's `logo512.png` on every build. This keeps the Android launcher identity aligned with the upstream web app without maintaining a divergent copy. The adaptive foreground reserves Android's outer 18 dp mask area so the PokéRogue mark remains inside the launcher safe zone. See [adaptive icon design](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).

## Verification contract

The Android E2E check must prove that the running API 36 activity requests `SCREEN_ORIENTATION_USER_LANDSCAPE`, both system bar inset sources are hidden, the canvas starts, local storage persists across reload, and network access remains blocked. Gradle resource processing must resolve the staged upstream launcher icon for both editions.
