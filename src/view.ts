import { ItemView, Menu, Modal, Notice, Setting, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { getBackendReadiness, type BackendReadiness } from "./backend";
import { formatDiagnosticTime } from "./diagnostics";
import { TerminalSession, makeSessionLabel } from "./session";
import type EmbeddedAiTerminalPlugin from "./main";
import type { ProfileId, ViewStatePayload } from "./types";
import { VIEW_TYPE_EMBEDDED_AI_TERMINAL } from "./constants";

export class TerminalView extends ItemView {
  sessions: TerminalSession[] = [];
  activeSession: TerminalSession | null = null;
  nextId = 1;
  tabBarEl!: HTMLElement;
  sessionsEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private sessionActionsEl!: HTMLElement;
  private rootEl!: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: number | null = null;
  private readinessEl!: HTMLElement;
  private readiness: BackendReadiness | null = null;
  private readinessProbe: Promise<void> | null = null;
  private readinessRefreshRequested = false;
  private readinessForced = false;
  private diagnosticsEl!: HTMLElement;
  private pendingState: ViewStatePayload | null = null;
  private opened = false;
  private isRenaming = false;
  private toolbarVisible = false;
  private unsubscribeDiagnostics: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: EmbeddedAiTerminalPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_EMBEDDED_AI_TERMINAL;
  }

  getDisplayText(): string {
    return "Embedded Terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  getState(): Record<string, unknown> {
    return {
      sessions: this.sessions.map((session) => session.toState()),
      activeId: this.activeSession?.id ?? null,
      nextId: this.nextId,
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    this.pendingState = this.validateState(state);
    if (this.opened) {
      this.restoreState();
    }
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    const container = this.contentEl;
    container.empty();
    container.addClass("vin-terminal-container");
    this.rootEl = container;

    container.addEventListener("keydown", (event) => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        event.stopPropagation();
        this.toggleToolbar();
        return;
      }

      if (!event.metaKey) {
        event.stopPropagation();
      }
    });

    container.addEventListener("wheel", (event) => {
      event.stopPropagation();
    });

    container.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest(".vin-terminal-tab-bar")) {
        return;
      }

      this.contentEl.ownerDocument.defaultView?.setTimeout(() => this.activeSession?.focus(), 0);
    });

    this.tabBarEl = container.createDiv({ cls: "vin-terminal-tab-bar" });
    this.sessionActionsEl = container.createDiv({ cls: "vin-terminal-session-actions" });
    const newSessionButton = this.sessionActionsEl.createEl("button", {
      cls: "vin-terminal-new-session-button",
      text: "＋ New session",
    });
    newSessionButton.addEventListener("click", () => this.createSession("shell"));
    this.readinessEl = container.createDiv({ cls: "vin-terminal-readiness" });
    this.diagnosticsEl = container.createDiv({ cls: "vin-terminal-diagnostics" });
    this.emptyStateEl = container.createDiv({ cls: "vin-terminal-empty-state" });
    this.sessionsEl = container.createDiv({ cls: "vin-terminal-sessions" });
    this.unsubscribeDiagnostics = this.plugin.subscribeDiagnostics(() => this.renderDiagnostics());
    this.renderDiagnostics();
    this.renderReadiness();
    this.renderEmptyState();

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFit(50);
    });
    this.resizeObserver.observe(this.sessionsEl);

    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const session of this.sessions) {
          session.updateTheme();
        }
        this.scheduleFit(50);
      }),
    );
    void this.refreshReadiness();

    if (this.pendingState?.sessions?.length) {
      this.restoreState();
    } else {
      this.createSession("shell");
    }
    this.ensureSessionExists();
  }

  private toggleToolbar(): void {
    this.toolbarVisible = !this.toolbarVisible;
    this.rootEl.toggleClass("is-toolbar-visible", this.toolbarVisible);
    this.scheduleFit(40);
  }

  toggleTabs(): void {
    this.toggleToolbar();
  }

  private scheduleFit(delay: number): void {
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }
    this.clearScheduledFit();
    this.fitTimer = ownerWindow.setTimeout(() => {
      this.fitTimer = null;
      this.activeSession?.fit();
    }, delay);
  }

  private clearScheduledFit(): void {
    if (this.fitTimer !== null) {
      this.contentEl.ownerDocument.defaultView?.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
  }

  async refreshReadiness(force = false): Promise<void> {
    if (this.readinessProbe) {
      if (force) {
        this.readinessRefreshRequested = true;
      }
      return this.readinessProbe;
    }
    this.readinessProbe = getBackendReadiness(this.plugin)
      .then((readiness) => {
        this.readiness = readiness;
        this.renderReadiness();
      })
      .catch(() => {
        this.renderReadiness();
      })
      .finally(() => {
        this.readinessProbe = null;
        if (this.readinessRefreshRequested) {
          this.readinessRefreshRequested = false;
          void this.refreshReadiness();
        }
      });
    return this.readinessProbe;
  }

  showReadiness(): void {
    this.readinessForced = true;
    this.renderReadiness();
    void this.refreshReadiness(true);
  }

  private renderReadiness(): void {
    if (!this.readinessEl) {
      return;
    }
    const readiness = this.readiness;
    const selectedIsPty = this.activeSession?.backend.isPty;
    const profileId = this.activeSession?.profileId;
    const commandAvailable = profileId === "codex" || profileId === "claude" || profileId === "opencode"
      ? readiness?.commands[profileId]
      : true;
    const actionable = selectedIsPty === false || commandAvailable === false;
    const visible = this.readinessForced || actionable;
    this.readinessEl.toggleClass("is-visible", visible);
    if (!visible) {
      this.readinessEl.empty();
      return;
    }
    this.readinessEl.empty();
    if (!readiness) {
      this.readinessEl.createDiv({ cls: "vin-terminal-readiness-title", text: "Checking terminal readiness…" });
      return;
    }
    const limited = selectedIsPty === false;
    this.readinessEl.toggleClass("is-limited", limited);
    this.readinessEl.createDiv({
      cls: "vin-terminal-readiness-title",
      text: limited ? "Limited terminal mode" : "Terminal readiness",
    });
    this.readinessEl.createDiv({
      cls: "vin-terminal-readiness-description",
      text: limited
        ? "Regular commands can run, but full-screen apps such as Codex, Claude Code, and OpenCode may not work here. Install the matching native bundle from the release page for full terminal support."
        : commandAvailable === false
          ? `The ${profileId} command was not found on PATH. Install it or update its command in settings.`
          : "Full terminal support is active.",
    });
    const missing = (Object.entries(readiness.commands) as Array<[keyof typeof readiness.commands, boolean]>)
      .filter(([, available]) => !available)
      .map(([name]) => name);
    if (missing.length) {
      this.readinessEl.createDiv({
        cls: "vin-terminal-readiness-missing",
        text: `Not found on PATH: ${missing.join(", ")}.`,
      });
    }
    const details = this.readinessEl.createEl("details", { cls: "vin-terminal-readiness-details" });
    details.createEl("summary", { text: "Technical details" });
    details.createEl("pre", {
      text: [
        `Native backend available: ${readiness.nativeAvailable}`,
        `Python backend available: ${readiness.pythonAvailable}`,
        `Selected backend: ${this.activeSession?.backend.name ?? "not started"}`,
        `Commands: ${Object.entries(readiness.commands).map(([name, available]) => `${name}=${available}`).join(", ")}`,
      ].join("\n"),
    });
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearScheduledFit();
    this.unsubscribeDiagnostics?.();
    this.unsubscribeDiagnostics = null;
    for (const session of this.sessions) {
      session.destroy();
    }
    this.sessions = [];
    this.activeSession = null;
    this.readinessForced = false;
    this.renderEmptyState();
  }

  createSession(profileId: ProfileId, startupOverride?: string): TerminalSession | null {
    const id = this.nextId++;
    const cwd = this.plugin.getDefaultCwd();
    const startupCommand = startupOverride ?? this.plugin.getStartupCommand(profileId);
    let session: TerminalSession;
    try {
      session = new TerminalSession(this.plugin, this, id, profileId, cwd, startupCommand);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.plugin.recordDiagnostic({
        level: "error",
        scope: "session-create",
        summary: `Failed to start ${makeSessionLabel(profileId, id)}.`,
        error,
        context: {
          profile: profileId,
          shellPath: this.plugin.settings.shellPath,
          shellArgs: this.plugin.settings.shellArgs,
          cwd,
          startupCommand,
        },
      });
      new Notice(message, 8000);
      return null;
    }
    session.name = makeSessionLabel(profileId, id);
    this.plugin.trackSession(session);
    this.sessions.push(session);
    this.switchTo(session);
    this.renderReadiness();
    this.renderTabs();
    this.renderEmptyState();
    this.plugin.requestLayoutSave();
    return session;
  }

  switchTo(session: TerminalSession): void {
    if (this.activeSession === session) {
      session.focus();
      this.renderEmptyState();
      return;
    }

    this.activeSession?.hide();
    this.activeSession = session;
    session.show();
    this.renderReadiness();
    this.renderTabs();
    this.renderEmptyState();
    this.plugin.requestLayoutSave();
  }

  closeSession(session: TerminalSession): void {
    const index = this.sessions.indexOf(session);
    if (index === -1) {
      return;
    }

    session.destroy();
    this.sessions.splice(index, 1);

    if (this.activeSession === session) {
      this.activeSession = null;
      const fallback = this.sessions[Math.max(0, index - 1)] ?? this.sessions[0] ?? null;
      if (fallback) {
        this.switchTo(fallback);
      }
    }

    if (!this.sessions.length) {
      this.renderEmptyState("No terminal session.", "Trying to start a fresh shell...");
      this.createSession("shell");
    }

    this.renderTabs();
    this.renderEmptyState();
    this.plugin.requestLayoutSave();
  }

  renderTabs(): void {
    if (!this.tabBarEl || this.isRenaming) {
      return;
    }

    this.tabBarEl.empty();
    this.rootEl.toggleClass("has-multiple-sessions", this.sessions.length > 1);
    const tabsScroll = this.tabBarEl.createDiv({ cls: "vin-terminal-tabs-scroll" });

    for (const session of this.sessions) {
      const tab = tabsScroll.createDiv({ cls: "vin-terminal-tab" });
      if (session === this.activeSession) {
        tab.addClass("is-active");
      }
      if (session.hasActivity && session !== this.activeSession) {
        tab.addClass("has-activity");
      }

      const label = tab.createSpan({ cls: "vin-terminal-tab-label", text: session.name });
      tab.addEventListener("click", () => this.switchTo(session));
      tab.addEventListener("dblclick", () => this.startRename(tab, label, session));
      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(() => this.startRename(tab, label, session)));
        menu.addItem((item) => item.setTitle("Close").setIcon("x").onClick(() => this.closeSession(session)));
        menu.showAtMouseEvent(event);
      });
    }

    const newTab = tabsScroll.createDiv({ cls: "vin-terminal-tab-new", text: "+" });
    newTab.title = "New shell tab";
    newTab.addEventListener("click", () => this.createSession("shell"));

    const controls = this.tabBarEl.createDiv({ cls: "vin-terminal-tab-controls" });
    const help = controls.createDiv({ cls: "vin-terminal-tab-help", text: "?" });
    help.title = "Terminal help";
    help.addEventListener("click", () => new TerminalHelpModal(this.app).open());
  }

  private startRename(tab: HTMLElement, labelEl: HTMLElement, session: TerminalSession): void {
    if (this.isRenaming) {
      return;
    }

    this.isRenaming = true;
    const input = this.contentEl.ownerDocument.createElement("input");
    input.type = "text";
    input.className = "vin-terminal-tab-rename";
    input.value = session.name;
    input.style.setProperty("--vin-terminal-rename-width", `${Math.max(5, session.name.length + 1)}ch`);
    labelEl.replaceWith(input);

    const finish = (save: boolean): void => {
      if (!this.isRenaming) {
        return;
      }

      this.isRenaming = false;
      if (save) {
        session.rename(input.value);
      }
      this.renderTabs();
      this.plugin.requestLayoutSave();
    };

    input.addEventListener("input", () => {
      input.style.setProperty("--vin-terminal-rename-width", `${Math.max(5, input.value.length + 1)}ch`);
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        finish(true);
      } else if (event.key === "Escape") {
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  private restoreState(): void {
    if (!this.pendingState || !this.sessionsEl) {
      return;
    }

    for (const session of this.sessions) {
      session.destroy();
    }
    this.sessions = [];
    this.activeSession = null;
    const restoredIds = this.pendingState.sessions.map((session) => session.id);
    this.nextId = Math.max(0, ...restoredIds) + 1;

    for (const saved of this.pendingState.sessions) {
      let session: TerminalSession;
      try {
        session = new TerminalSession(
          this.plugin,
          this,
          saved.id,
          saved.profileId,
          saved.cwd || this.plugin.getDefaultCwd(),
          saved.startupCommand,
        );
        this.plugin.trackSession(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.recordDiagnostic({
          level: "error",
          scope: "session-restore",
          summary: `Failed to restore terminal tab "${saved.name}".`,
          error,
          context: {
            profile: saved.profileId,
            shellPath: this.plugin.settings.shellPath,
            shellArgs: this.plugin.settings.shellArgs,
            cwd: saved.cwd || this.plugin.getDefaultCwd(),
            startupCommand: saved.startupCommand,
          },
        });
        new Notice(`Failed to restore terminal tab "${saved.name}": ${message}`, 8000);
        continue;
      }
      session.name = saved.name || makeSessionLabel(saved.profileId, saved.id);
      session.hide();
      this.sessions.push(session);
    }

    const active = this.sessions.find((session) => session.id === this.pendingState?.activeId) ?? this.sessions[0] ?? null;
    if (active) {
      this.switchTo(active);
    }

    this.renderTabs();
    this.renderEmptyState();
    this.pendingState = null;
    this.ensureSessionExists();
  }

  private validateState(state: unknown): ViewStatePayload | null {
    if (!state || typeof state !== "object") return null;
    const payload = state as Record<string, unknown>;
    if (!Array.isArray(payload.sessions)) return null;
    const sessions = payload.sessions.filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.id === "number" && Number.isFinite(value.id) &&
        typeof value.name === "string" && typeof value.cwd === "string" &&
        (value.profileId === "shell" || value.profileId === "codex" || value.profileId === "claude" ||
          value.profileId === "opencode" || value.profileId === "custom") &&
        typeof value.startupCommand === "string";
    }).map((item) => ({
      id: item.id as number,
      name: item.name as string,
      cwd: item.cwd as string,
      profileId: item.profileId as ProfileId,
      startupCommand: item.startupCommand as string,
    }));
    const activeId = typeof payload.activeId === "number" && Number.isFinite(payload.activeId) ? payload.activeId : null;
    const nextId = typeof payload.nextId === "number" && Number.isFinite(payload.nextId) && payload.nextId > 0
      ? Math.floor(payload.nextId)
      : 1;
    return { sessions, activeId, nextId };
  }

  private renderDiagnostics(): void {
    if (!this.diagnosticsEl || !this.rootEl) {
      return;
    }

    const entries = this.plugin.getDiagnostics();
    this.diagnosticsEl.empty();

    if (!entries.length) {
      this.diagnosticsEl.hide();
      this.rootEl.removeClass("has-diagnostics");
      return;
    }

    this.rootEl.addClass("has-diagnostics");
    this.diagnosticsEl.show();

    const header = this.diagnosticsEl.createDiv({ cls: "vin-terminal-diagnostics-header" });
    const titleWrap = header.createDiv({ cls: "vin-terminal-diagnostics-title-wrap" });
    titleWrap.createDiv({ cls: "vin-terminal-diagnostics-title", text: "Terminal diagnostics" });
    titleWrap.createDiv({
      cls: "vin-terminal-diagnostics-subtitle",
      text: `${entries.length} recent issue${entries.length === 1 ? "" : "s"} • latest ${formatDiagnosticTime(entries[0].timestamp)}`,
    });

    const clearButton = header.createEl("button", {
      cls: "vin-terminal-diagnostics-clear",
      text: "Clear",
    });
    clearButton.addEventListener("click", () => this.plugin.clearDiagnostics());

    const list = this.diagnosticsEl.createDiv({ cls: "vin-terminal-diagnostics-list" });
    for (const entry of entries.slice(0, 5)) {
      const item = list.createDiv({ cls: `vin-terminal-diagnostic is-${entry.level}` });
      const itemHeader = item.createDiv({ cls: "vin-terminal-diagnostic-header" });
      itemHeader.createDiv({ cls: "vin-terminal-diagnostic-badge", text: entry.level });
      itemHeader.createDiv({ cls: "vin-terminal-diagnostic-scope", text: entry.scope });
      itemHeader.createDiv({ cls: "vin-terminal-diagnostic-time", text: formatDiagnosticTime(entry.timestamp) });
      item.createDiv({ cls: "vin-terminal-diagnostic-summary", text: entry.summary });
      if (entry.detail) {
        item.createEl("pre", { cls: "vin-terminal-diagnostic-detail", text: entry.detail });
      }
    }
  }

  private ensureSessionExists(): void {
    if (this.sessions.length > 0) {
      this.renderEmptyState();
      return;
    }

    this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
      if (!this.opened || this.sessions.length > 0) {
        this.renderEmptyState();
        return;
      }

      this.plugin.recordDiagnostic({
        level: "warning",
        scope: "empty-view",
        summary: "Terminal view opened without an active session. Retrying shell startup.",
      });
      this.renderEmptyState("No active terminal session.", "Retrying shell startup...");
      this.createSession("shell");
    }, 50);
  }

  private renderEmptyState(title = "No active terminal session.", description = "Start a shell tab to attach a terminal."): void {
    if (!this.emptyStateEl || !this.rootEl) {
      return;
    }

    this.emptyStateEl.empty();
    if (this.sessions.length > 0 || this.activeSession) {
      this.emptyStateEl.hide();
      this.rootEl.removeClass("has-empty-state");
      return;
    }

    this.rootEl.addClass("has-empty-state");
    this.emptyStateEl.show();
    this.emptyStateEl.createDiv({ cls: "vin-terminal-empty-title", text: title });
    this.emptyStateEl.createDiv({ cls: "vin-terminal-empty-description", text: description });
    const actions = this.emptyStateEl.createDiv({ cls: "vin-terminal-empty-actions" });
    const button = actions.createEl("button", {
      cls: "vin-terminal-empty-button",
      text: "Start shell",
    });
    button.addEventListener("click", () => {
      this.plugin.recordDiagnostic({
        level: "info",
        scope: "empty-view",
        summary: "Manual shell startup requested from empty terminal view.",
      });
      this.createSession("shell");
    });
  }
}

export class TerminalHelpModal extends Modal {
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vin-terminal-help-modal");
    new Setting(contentEl).setHeading().setName("Embedded terminal");

    const items: Array<[string, string]> = [
      ["+", "Open a fresh shell tab"],
      ["Codex", "Open a new tab and run the configured Codex command"],
      ["Claude", "Open a new tab and run the configured Claude Code command"],
      ["OpenCode", "Open a new tab and run the configured OpenCode command"],
      ["Double-click tab", "Rename a terminal tab"],
      ["Right-click tab", "Rename or close a tab"],
      ["Drop files", "Paste file paths into the terminal"],
    ];

    const table = contentEl.createEl("table");
    for (const [key, description] of items) {
      const row = table.createEl("tr");
      row.createEl("td", { text: key });
      row.createEl("td", { text: description });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
