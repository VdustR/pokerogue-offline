These harmless native-runtime regression contracts are adapted from Electron's
official patches. They use loopback HTTP, a fixture marker, hidden windows, and
a temporary profile. They do not demonstrate that the offline game is exploitable
or emulate a compromised renderer.

- [Top-level sandbox inheritance](https://github.com/electron/electron/commit/29fc130569f970e91e355383821a4af0f25724a2): a modified link click must preserve the opener's CSP sandbox in its popup.
- [File and HTTP protocol opacity](https://github.com/electron/electron/commit/4d2784cc8592471ee2276235b8c2a03efddf937d): cross-origin no-cors fetches must not expose the fixture marker.
- [Worker Node inheritance](https://github.com/electron/electron/commit/6462a2e1dc4e6adffd3b7d9b9be1474c45dcbbe2): a guest worker must not gain `require` when its unsandboxed embedder disables Node integration.
- [Preload cache isolation](https://github.com/electron/electron/commit/000453e399bd1dee5e86376cdd9ece5fc071e601): two distinct loopback sites consuming one preload must retain separate cache entries. This tests principal separation, not forged renderer cache writes.

Run `pnpm e2e:electron-security` with a native Electron installation and a display
(use `xvfb-run -a` on headless Linux). Each asynchronous contract has a 15-second
deadline; the launcher limits the entire process to 90 seconds and removes its
temporary profile after the child exits. The main process waits for the preload
IPC before observing the asynchronous cache writer.
