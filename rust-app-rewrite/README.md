# Koko, Rust app (Tauri)

The same React interface as the web and Electron builds, hosted by Rust and the system web view.
The Electron app in `../electron` stays until this one has been checked in everyday use.

## Run

    cargo tauri dev      # live reload
    cargo tauri build    # makes src-tauri/target/release/bundle/macos/Koko.app (installed name: Koko; same name as the Electron app, so migrate before replacing it)
    node tests/parity.cjs   # Code-mode file, git, undo and command results must match the Electron code

Needs Rust, `cargo install tauri-cli`, and `npm install` in the parent folder.

## Layout

- `src-tauri/src/core/`  files, search, git, commands, undo, migration (no window needed; port of `electron/tools.cjs`, `checkpoints.cjs`)
- `src-tauri/src/pty.rs`, `browser.rs`, `js/`  terminal; side-panel browser and agent control
- `src-tauri/src/commands.rs`  what the interface may call (only the app's own page)
- `../src/lib/tauriBridge.ts`  provides the same `window.koko` as the Electron preload

## Works

Chat, custom top bar, Code mode (files, edits, search, commands, git, undo, sub-agents, task list, permissions),
side panel (terminal, files, browser), agent browser control, running-agents close warning, Cmd+, ,
and moving over from Electron (Settings → General, shown when Electron data exists).

## Different from Electron

- Agent clicks and typing are done by script, not real input events. Pages that insist on real input
  (some sign-in, payment and drag interfaces) will ignore them.
- Browser tabs are native views above the page; they hide while a menu or dialog covers their spot.
- The JavaScript syntax check needs `node` on your PATH.
- Editing refuses files that are not UTF-8.
- Browser control and the build are macOS only so far (commands and terminal use Unix calls).

## Notifications

Native, with Allow and Deny buttons (macOS: UserNotifications; Windows: toasts, not yet tried). The built app is needed,
and macOS asks for permission the first time: answer the prompt in the top-right corner.

## Nightly release

`.github/workflows/nightly-build.yml` builds this app for macOS (Apple silicon) and Windows into the same release as Electron.

## Not ported yet

Quick Ask, menu bar icon, global shortcut, screen capture, 1minRelay sign-in popup.

## Moving from Electron

The Electron app exports its own data (`electron/export.cjs`), so it must be built with that support
(`npm run electron:pack`) and be closed. The Rust app replaces its own data with the export and keeps a backup.
"Clean up Electron" is a separate question: it moves `~/Library/Application Support/kokochat` and an installed
`/Applications/Koko.app` to the Trash. It never touches this source folder or `release/`.
