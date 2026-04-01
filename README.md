# Embedded AI Terminal for Obsidian

An Obsidian desktop plugin that embeds a real terminal inside a pane, with support for AI coding CLIs such as Codex, Claude Code, and OpenCode.

The plugin is Windows-first and uses a PTY-backed terminal UI inside Obsidian.

## License

This project is open source under the MIT license.

See [LICENSE](./LICENSE).

## Features

- Embedded terminal inside Obsidian
- Multi-tab terminal sessions
- Commands to open new shell / Codex / Claude / OpenCode tabs
- `[[...]]` file citation picker from your vault
- Drag and drop files into the terminal to paste paths
- Minimal top bar with `Ctrl+T` toggle
- Community-plugin style install layout for Obsidian

## Screenshots

<!-- Demo screenshots: replace the paths below with your real screenshot files -->
<!-- Example:
![Terminal demo](./docs/demo-terminal.png)
![Citation picker demo](./docs/demo-citation.png)
-->

## Download

If you publish releases, attach the plugin zip from:

`release/embedded-ai-terminal.zip`

Users can then:

1. Download the zip
2. Extract it into their vault at:
   `.obsidian/plugins/embedded-ai-terminal/`
3. Restart Obsidian or reload community plugins
4. Enable `Embedded AI Terminal` in `Settings -> Community plugins`

## Manual Install

Copy these files and folders into:

`.obsidian/plugins/embedded-ai-terminal/`

Required:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`
- `node_modules/`

Important:

- This plugin depends on native modules, so copying only `main.js` is not enough.
- The `node_modules` folder must be present in the installed plugin directory.

## Development

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Watch mode

```bash
npm run dev
```

## Local Testing in Obsidian

After building, copy the project output into your vault plugin folder:

`.obsidian/plugins/embedded-ai-terminal/`

Then in Obsidian:

1. Open `Settings -> Community plugins`
2. Disable safe mode if needed
3. Reload plugins
4. Enable `Embedded AI Terminal`

## Usage

### Open the terminal

Use the command palette and run:

- `Open embedded terminal pane`
- `Open embedded terminal in new tab`

### Show or hide the top bar

Inside the terminal view, press:

`Ctrl+T`

### Start AI CLI tabs

Use the command palette:

- `New shell terminal tab`
- `New Codex terminal tab`
- `New Claude terminal tab`
- `New OpenCode terminal tab`

### Cite vault files

Inside the terminal, type:

`[[`

This opens a picker of notes from your vault and inserts a wiki-style path reference.

## Settings

The plugin settings include:

- shell executable
- shell arguments
- default working directory
- font size
- startup commands
- provider command strings for Codex / Claude / OpenCode / custom

## Packaging a Release

Build the plugin:

```bash
npm run build
```

Then package the installable plugin folder or zip:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`
- `node_modules/`

## Notes

- This plugin currently targets desktop Obsidian.
- The terminal implementation is Windows-first.
- If native module loading fails in Obsidian, verify that the installed plugin folder contains `node_modules/node-pty`.

