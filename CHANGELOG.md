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

## 0.1.1 - Pane Recovery

Patch release focused on startup reliability and debugging.

- fixed a blank terminal pane caused by mounting the view into a brittle DOM child instead of Obsidian's `contentEl`
- added in-pane diagnostics for session startup, restore failures, and non-zero process exits
- added a visible startup status overlay so silent terminal startup failures are easier to identify
- clarified installation and update steps for the packaged desktop plugin

## 0.1.0

Initial public release.
