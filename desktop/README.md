# Desktop window (Tauri 2)

A ~5 MB window around the same local server the browser version uses (shares `data\tutorial.db`).

**Status: written, not yet compiled.** Network access was blocked where this was prepared, so Rust crates could not be fetched. `main.rs` passes `rustfmt`, and the JSON configs are valid, but expect to fix a small thing or two on the first build.

## How it works

1. On launch the app checks `127.0.0.1:4173`. If the server is already running (you started `start.cmd`), it reuses it.
2. Otherwise it starts `node server/index.js` (hidden window) from the project folder.
3. The window shows `splash/index.html`, which polls `/api/health` and then jumps to `http://127.0.0.1:4173`.
4. On exit it stops the server **only if it started it**.

The project folder is found by walking up from the exe until `server\index.js` exists, or from `TUTORIAL_APP_ROOT`. So build it inside this project and it just works.

## Build (Windows)

Prerequisites (one time):

1. Rust: https://rustup.rs (choose the MSVC toolchain; it will ask you to install "Visual Studio Build Tools, Desktop development with C++").
2. WebView2 runtime (already included in Windows 10/11).
3. `cargo install tauri-cli --version "^2" --locked`

Then, from this `desktop\src-tauri` folder:

```
cargo tauri dev                    # try it
cargo tauri build --no-bundle      # portable exe: target\release\tutorial-tracker-desktop.exe
cargo tauri build                  # NSIS installer in target\release\bundle\nsis
```

If you copy the exe elsewhere, set `TUTORIAL_APP_ROOT=C:\dev\tutorial-app` so it can find the server.

Node.js 22.13+ must be installed (the server runs on it).
