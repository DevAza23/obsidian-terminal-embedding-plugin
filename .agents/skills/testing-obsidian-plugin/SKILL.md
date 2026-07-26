---
name: testing-obsidian-plugin
description: How to run end-to-end runtime tests of the Embedded AI Terminal Obsidian plugin on a Linux box (install Obsidian, deploy the store-layout bundle, drive the terminal UI, gather PTY/renderer evidence).
---

# Testing the Embedded AI Terminal plugin inside real Obsidian

## Install Obsidian (Linux, headless-ish X session)

1. Asset URLs on `https://obsidian.md/download` change; do **not** guess a version. Fetch the page first, then download
   the `.deb`, e.g. `https://github.com/obsidianmd/obsidian-releases/releases/download/v1.12.7/obsidian_1.12.7_amd64.deb`.
2. `sudo dpkg -i /tmp/obsidian.deb || sudo apt-get -y -f install` (the second command is normally required).
3. Also install `xclip` and `wmctrl` — both are needed (see below).

## Register the vault without the GUI wizard

Obsidian shows "Vault not found" for `obsidian://open?path=...` unless the vault is pre-registered. Create
`~/.config/obsidian/obsidian.json`:

```json
{ "vaults": { "a1b2c3d4e5f60001": { "path": "/home/ubuntu/scratch-vault", "ts": 1700000000000, "open": true } } }
```

Then just run `obsidian --no-sandbox` — it opens that vault directly.

## Launching

- Launch detached or it dies with the shell: `nohup setsid obsidian --no-sandbox > /tmp/obsidian.log 2>&1 < /dev/null & disown`.
  Startup takes ~20–30 s before a window appears; poll `wmctrl -l`.
- Maximize with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz` (never `xdotool key super+Up`).
- **Do not add `--disable-gpu` by default** — the plugin's WebGL renderer needs WebGL. On a GPU-less box Chromium still
  supplies software WebGL2 (SwiftShader), so WebGL paths are testable.
- To force the plugin's DOM-renderer fallback you must remove WebGL entirely:
  `obsidian --no-sandbox --disable-gpu --disable-software-rasterizer`. Neither `--disable-gpu` alone nor
  `--disable-3d-apis` is sufficient. The plugin then logs `WebGL renderer was unavailable. Error: WebGL2 not supported null`.

## Deploying the plugin (store layout)

```
npm run build   # main.js is gitignored
cp main.js manifest.json styles.css /home/ubuntu/scratch-vault/.obsidian/plugins/embedded-ai-terminal/
```

Folder name must equal the plugin id `embedded-ai-terminal`. With no `node_modules` beside the bundle, Auto selects the
embedded Python `pty.fork()` helper (it writes `.embedded-ai-terminal-pty.py` into the plugin folder). To exercise the
native path, `cp -r node_modules/node-pty <plugindir>/node_modules/` and reload — Auto then picks `Native node-pty`
(sessions become `bash -il` directly under the Obsidian process, no python parent).

Settings persist in `<plugindir>/data.json` — useful for asserting that a settings change was actually saved even when
the UI does not visibly react.

## Driving the terminal UI

- Reliable entry points are the **command palette** commands: `Open embedded terminal in new tab`,
  `New shell terminal tab`, `New Codex terminal tab`, `Show terminal readiness`. The ribbon icon works too.
- `Ctrl+R` inside a focused terminal goes to the shell (reverse-i-search), not Obsidian. Use command palette →
  **Reload app without saving** to reload.
- The session tab bar may be unreachable: it only becomes visible when the view's `Ctrl+T` handler adds
  `is-toolbar-visible`, and Ctrl+T may never reach the handler (xterm consumes it) — clearing Obsidian's own Ctrl+T
  hotkey does not help. If you must test tab switch/rename/close and Ctrl+T fails, say so as blocked coverage; a
  workaround to try is `document.querySelector('.vin-terminal-container').classList.add('is-toolbar-visible')` in
  devtools, but avoid devtools for anything the user should see done through the UI.
- `xdotool type` mangles shifted characters (`$`, uppercase) in xterm.js. Stage exact commands with
  `printf '<cmd>' | xclip -selection clipboard` and paste with **Ctrl+Shift+V** inside the terminal.

## Evidence-gathering recipes

- Real PTY: `tty` → `/dev/pts/N`; degraded pipe mode → `not a tty` with `TERM=dumb`.
- Env: `echo "$TERM $COLORTERM"` → `xterm-256color truecolor` on PTY backends.
- Backend actually used: `ps -ef --forest | grep -E "pty.py|bash -il"`, plus the readiness panel's "Technical details".
- Resize: `stty size; tput cols` before/after `wmctrl -r :ACTIVE: -e 0,0,0,<w>,<h>`.
- Renderer: diagnostics panel entries with scope `renderer` (`… is using the WebGL/DOM renderer.`).
- Colors: dump `\033[3Xm`/`\033[9Xm` plus `\033[40m`/`\033[47m` in **both** Appearance → Light and Dark.
- Glyph coverage: `python3 -c "print('┌─┬┐ │ └┴┘ ░▒▓█ ✓ →')"`. If cells look blank, prove the bytes arrived with
  `python3 -c "print('┌─█✓')" | od -c` (note: `hexdump` is not installed on this image) — blank cells with correct
  bytes means a renderer/glyph bug, not data loss.
- Process hygiene: count `pgrep -fa "embedded-ai-terminal-pty.py"` and `pgrep -fa "bash -il"` before/after closing a
  view and after quitting Obsidian. Orphans surviving app shutdown have been observed — always check this explicitly and
  clean up with `pkill -f embedded-ai-terminal-pty.py` between runs so counts stay meaningful.
- Console: `Ctrl+Shift+I` → Console tab. Expect only Chromium noise
  ("Automatic fallback to software WebGL has been deprecated", "GPU stall due to ReadPixels"); anything else is a plugin error.

## Devin Secrets Needed

None — everything runs locally; `claude` / `codex` / `opencode` are usually absent, which is itself the fixture for the
"missing CLI" readiness messages.
