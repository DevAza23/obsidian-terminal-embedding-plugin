# Changelog

## 0.1.1 - Pane Recovery

Patch release focused on startup reliability and debugging.

- fixed a blank terminal pane caused by mounting the view into a brittle DOM child instead of Obsidian's `contentEl`
- added in-pane diagnostics for session startup, restore failures, and non-zero process exits
- added a visible startup status overlay so silent terminal startup failures are easier to identify
- clarified installation and update steps for the packaged desktop plugin

## 0.1.0

Initial public release.
