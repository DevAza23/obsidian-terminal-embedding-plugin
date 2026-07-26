# Embedded AI Terminal for Obsidian

An Obsidian desktop plugin that embeds a real terminal inside a pane, with support for AI coding CLIs such as Codex, Claude Code, and OpenCode.

The plugin uses a PTY-backed terminal and supports Windows, macOS, and Linux. The native `node-pty` installation path remains platform- and Electron-ABI-specific.

## Features

- Embedded terminal inside Obsidian
- Multi-tab terminal sessions
- Commands to open shell, Codex, Claude, and OpenCode tabs
- `[[...]]` file citation picker from your vault
- Drag and drop files into the terminal to paste paths
- Obsidian theme integration
- POSIX shell defaults with login and interactive startup

## Installation

### Community Plugins

After the plugin is accepted into the Obsidian Community Plugin directory, install it from **Settings → Community plugins**. Obsidian downloads the standard plugin files:

- `main.js`
- `manifest.json`
- `styles.css`

This store installation is the JavaScript/plugin layer. The current terminal backend still requires a native `node-pty` runtime, so a store installation may report that the native runtime is unavailable until the native backend work is completed.

### Manual native installation

Download the platform-specific bundle from the GitHub release matching your operating system and CPU architecture, then extract it into:

`.obsidian/plugins/embedded-ai-terminal/`

The bundle contains:

- `main.js`
- `manifest.json`
- `styles.css`
- the matching `node-pty` JavaScript and native runtime files

Available bundle names use this format:

`embedded-ai-terminal-<platform>-<architecture>.zip`

For example:

`embedded-ai-terminal-linux-x64.zip`

Restart Obsidian or reload community plugins, then enable **Embedded AI Terminal** in **Settings → Community plugins**.

### BRAT

BRAT installs the same standard release assets as the Community Plugin directory. It does not install `node_modules` or native `.node` files, so it is useful for testing the JavaScript layer but does not replace the platform-specific native bundle.

## Development

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

Run the type checker without writing JavaScript files:

```bash
npm run typecheck
```

Watch and rebuild during development:

```bash
npm run dev
```

The generated `main.js` is intentionally not committed. Build it before copying the plugin into a vault or creating a release.

## Native runtime and Electron ABI

`node-pty` is a native module. It must be compiled or packaged for the operating system, CPU architecture, and Electron ABI used by the installed Obsidian desktop build.

If Obsidian updates Electron, an existing native binary can stop loading with a module-version or ABI-mismatch error. Download the matching platform bundle from the latest release rather than copying only `main.js`.

The release workflow publishes the three standard Obsidian files individually and also publishes the native bundle produced on the workflow runner. Platform-specific release bundles should be built on the corresponding platform.

## Packaging

Build first, then create a platform-specific native bundle:

```bash
npm run build
npm run package:release
```

The packaging script includes only the plugin files and the `node-pty` runtime files needed for the current platform and architecture. On POSIX systems it requires the `zip` command; on Windows it uses PowerShell `Compress-Archive`. If no archive mechanism is available, the script reports the required dependency.

## Usage

### Open the terminal

Use the command palette:

- **Open embedded terminal pane**
- **Open embedded terminal in new tab**

Inside a terminal view, press `Ctrl+T` to toggle the top bar.

### Start AI CLI tabs

Use the command palette:

- **New shell terminal tab**
- **New Codex terminal tab**
- **New Claude terminal tab**
- **New OpenCode terminal tab**

### Cite vault files

Inside the terminal, type:

`[[`

This opens a picker of Markdown notes from your vault and inserts a wiki-style path reference.

## Settings

The plugin settings include:

- shell executable (`powershell.exe` on Windows, or `$SHELL` with a POSIX fallback)
- shell arguments
- default working directory
- font size
- startup commands
- provider command strings for Codex, Claude, OpenCode, and custom commands

On POSIX systems, the default shell arguments are `-il` so login and interactive startup configuration is loaded. Custom shell arguments are preserved exactly when configured.

## Troubleshooting

### Blank terminal or native module error

Confirm that the plugin directory contains the platform-specific bundle, including:

- `manifest.json`
- `main.js`
- `styles.css`
- `node_modules/node-pty/`

If the error mentions a module version, ABI, or native binary mismatch:

1. Check the installed Obsidian desktop version.
2. Download a fresh bundle built for the same operating system and architecture.
3. Replace the entire plugin folder rather than only `main.js`.
4. Restart Obsidian.

The native runtime must match Obsidian's Electron ABI; a binary built by ordinary system Node or copied from another Obsidian/Electron release may not load.

### Shell command not found on Linux or macOS

The default shell starts as a login, interactive shell so normal shell startup files can add tools to `PATH`. If a custom shell or custom shell arguments are configured, verify that those arguments source the expected profile and that the CLI is available from that shell.

## License

This project is open source under the MIT license. See [LICENSE](./LICENSE).
