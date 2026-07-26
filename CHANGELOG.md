# Changelog

## Unreleased

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
