# Changelog

## Unreleased

- added WebGL rendering with DOM fallback, including per-session renderer diagnostics and context-loss recovery
- enabled truecolor capability signaling for native and Python PTY sessions
- coalesced resize fitting, avoided redundant PTY resizes, and removed the full-buffer refresh after fitting
- added a plain-language terminal readiness surface with PATH checks for Codex, Claude Code, and OpenCode
- added contrast-aware ANSI palettes for light and dark Obsidian themes and enabled custom glyph rendering
- added pluggable node-pty, Python PTY, and pipe terminal backends for store-compatible installation
- added backend selection settings and diagnostics for degraded no-PTY sessions
- added tagged GitHub release automation with store assets and platform-specific native bundles
- improved POSIX shell argument parsing and default login-shell startup
- removed committed build output and clarified store versus native installation paths
- fixed Linux postinstall behavior and store submission UI compliance
- split terminal, session, settings, diagnostics, platform, theme, and citation logic into focused modules
- fixed POSIX shell defaults, path quoting, vault path handling, citation ranking, and terminal lifecycle cleanup
- added typecheck tooling and cross-platform release packaging
- resolved `--font-monospace` to a concrete fallback font stack because CSS `var()` cannot be used in the canvas font string xterm measures and rasterizes with, fixing DOM cell metrics and box-drawing glyphs
- fixed font-size changes so existing sessions repaint and refit their PTYs
- fixed session teardown on plugin unload and made the Python helper terminate with its process group, including Linux parent-death protection
- made the terminal tab bar always visible instead of relying on Ctrl+T, and fixed tab rename reconciliation and persistence
- prevented citation dropdown keys from reaching Obsidian hotkeys while the dropdown is open
- added a plain-language shell-start failure message while retaining the raw helper error in diagnostics
- added a modest contrast floor for ANSI white and bright-white foregrounds while preserving white background semantics

## 0.1.1 - Pane Recovery

Patch release focused on startup reliability and debugging.

- fixed a blank terminal pane caused by mounting the view into a brittle DOM child instead of Obsidian's `contentEl`
- added in-pane diagnostics for session startup, restore failures, and non-zero process exits
- added a visible startup status overlay so silent terminal startup failures are easier to identify
- clarified installation and update steps for the packaged desktop plugin

## 0.1.0

Initial public release.
