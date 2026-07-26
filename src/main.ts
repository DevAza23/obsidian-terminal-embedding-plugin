import { Notice, Plugin } from "obsidian";
import * as nodePath from "node:path";
import { EmbeddedTerminalSettingsTab, createDefaultSettings, normalizeSettings } from "./settings";
import { DiagnosticsStore } from "./diagnostics";
import { getVaultBase } from "./platform";
import { TerminalView } from "./view";
import type { DiagnosticEntry, DiagnosticLevel, EmbeddedTerminalSettings, ProfileId } from "./types";

export const VIEW_TYPE_EMBEDDED_AI_TERMINAL = "embedded-ai-terminal-view";

export default class EmbeddedAiTerminalPlugin extends Plugin {
  settings: EmbeddedTerminalSettings = createDefaultSettings();
  private readonly diagnostics = new DiagnosticsStore();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_EMBEDDED_AI_TERMINAL, (leaf) => new TerminalView(leaf, this));
    this.addRibbonIcon("terminal", "Open embedded terminal", () => {
      void this.openSideTerminal();
    });
    this.addSettingTab(new EmbeddedTerminalSettingsTab(this.app, this));

    this.addCommand({
      id: "open-terminal-pane",
      name: "Open embedded terminal pane",
      callback: () => void this.openSideTerminal(),
    });
    this.addCommand({
      id: "open-terminal-tab",
      name: "Open embedded terminal in new tab",
      callback: () => void this.openTerminalTab(),
    });
    this.addCommand({
      id: "new-shell-tab",
      name: "New shell terminal tab",
      callback: () => void this.withEnsuredView((view) => void view.createSession("shell")),
    });
    this.addCommand({
      id: "new-codex-tab",
      name: "New Codex terminal tab",
      callback: () => void this.withEnsuredView((view) => void view.createSession("codex")),
    });
    this.addCommand({
      id: "new-claude-tab",
      name: "New Claude terminal tab",
      callback: () => void this.withEnsuredView((view) => void view.createSession("claude")),
    });
    this.addCommand({
      id: "new-opencode-tab",
      name: "New OpenCode terminal tab",
      callback: () => void this.withEnsuredView((view) => void view.createSession("opencode")),
    });
    this.addCommand({
      id: "send-current-file-path",
      name: "Send current file path to terminal",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active file.");
          return;
        }
        void this.sendPathsToActiveSession([nodePath.join(getVaultBase(this.app), file.path)]);
      },
    });

    this.app.workspace.onLayoutReady(() => {
      void this.ensureLeaf();
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    if (!this.settings.defaultCwd) {
      this.settings.defaultCwd = getVaultBase(this.app);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getDefaultCwd(): string {
    return this.settings.defaultCwd.trim() || getVaultBase(this.app);
  }

  getStartupCommand(profileId: ProfileId): string {
    if (profileId === "shell") {
      return "";
    }
    return this.settings.commands[profileId] ?? "";
  }

  requestLayoutSave(): void {
    this.app.workspace.requestSaveLayout();
  }

  getDiagnostics(): DiagnosticEntry[] {
    return this.diagnostics.getEntries();
  }

  subscribeDiagnostics(listener: () => void): () => void {
    return this.diagnostics.subscribe(listener);
  }

  clearDiagnostics(): void {
    this.diagnostics.clear();
  }

  recordDiagnostic(input: {
    level: DiagnosticLevel;
    scope: string;
    summary: string;
    detail?: string;
    error?: unknown;
    context?: Record<string, string>;
  }): void {
    this.diagnostics.record(input);
  }

  refreshSessions(): void {
    this.withActiveView((view) => {
      for (const session of view.sessions) {
        session.updateTheme();
      }
    });
  }

  async openSideTerminal(): Promise<void> {
    await this.ensureLeaf();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBEDDED_AI_TERMINAL)[0];
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async openTerminalTab(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_EMBEDDED_AI_TERMINAL, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async ensureLeaf(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBEDDED_AI_TERMINAL).length > 0) {
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_EMBEDDED_AI_TERMINAL, active: false });
  }

  private async withEnsuredView(action: (view: TerminalView) => void): Promise<void> {
    await this.openSideTerminal();
    this.withActiveView(action);
  }

  private withActiveView(action: (view: TerminalView) => void): void {
    const view = this.getActiveTerminalView();
    if (!view) {
      new Notice("Open the embedded terminal first.");
      return;
    }
    action(view);
  }

  private getActiveTerminalView(): TerminalView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBEDDED_AI_TERMINAL)[0];
    return (leaf?.view as TerminalView | undefined) ?? null;
  }

  private async sendPathsToActiveSession(paths: string[]): Promise<void> {
    await this.withEnsuredView((view) => {
      view.activeSession?.sendFilePaths(paths);
    });
  }

}
