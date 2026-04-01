import { App, ItemView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { IPty } from "node-pty";
import * as path from "node:path";

export const VIEW_TYPE_EMBEDDED_AI_TERMINAL = "embedded-ai-terminal-view";

type ProfileId = "shell" | "codex" | "claude" | "opencode" | "custom";

interface SavedSessionState {
  id: number;
  name: string;
  cwd: string;
  profileId: ProfileId;
  startupCommand: string;
}

interface ViewStatePayload {
  sessions: SavedSessionState[];
  activeId: number | null;
  nextId: number;
}

interface EmbeddedTerminalSettings {
  shellPath: string;
  shellArgs: string;
  defaultCwd: string;
  fontSize: number;
  cursorBlink: boolean;
  startupLines: string;
  commands: Record<Exclude<ProfileId, "shell">, string>;
}

const DEFAULT_SETTINGS: EmbeddedTerminalSettings = {
  shellPath: "powershell.exe",
  shellArgs: "-NoLogo",
  defaultCwd: "",
  fontSize: 14,
  cursorBlink: true,
  startupLines: "",
  commands: {
    codex: "codex",
    claude: "claude",
    opencode: "opencode",
    custom: "",
  },
};

let cachedNodePty: { spawn: typeof import("node-pty")["spawn"] } | null = null;

function getPluginInstallDir(plugin: EmbeddedAiTerminalPlugin): string {
  const manifestDir = (plugin.manifest as { dir?: string }).dir ?? "";
  if (!manifestDir) {
    return "";
  }

  return path.isAbsolute(manifestDir) ? manifestDir : path.join(getVaultBase(plugin.app), manifestDir);
}

function loadNodePty(plugin: EmbeddedAiTerminalPlugin): { spawn: typeof import("node-pty")["spawn"] } {
  if (cachedNodePty) {
    return cachedNodePty;
  }

  const runtimeRequire: NodeRequire | undefined =
    typeof require === "function"
      ? require
      : typeof window !== "undefined" && "require" in window
        ? (window.require as NodeRequire)
        : undefined;

  if (!runtimeRequire) {
    throw new Error("No CommonJS require() is available in this Obsidian runtime.");
  }

  const pluginDir = getPluginInstallDir(plugin);
  const candidates = [
    pluginDir ? path.join(pluginDir, "node_modules", "node-pty") : "",
    pluginDir ? path.join(pluginDir, "node_modules", "node-pty", "lib", "index.js") : "",
    "node-pty",
  ].filter(Boolean);

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      cachedNodePty = runtimeRequire(candidate) as { spawn: typeof import("node-pty")["spawn"] };
      return cachedNodePty;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to load node-pty. Copy the plugin with its node_modules folder, or rebuild node-pty for Obsidian/Electron. ${failures.join(" | ")}`);
}

function parseArgs(argsText: string): string[] {
  const args: string[] = [];
  const matcher = /[^\s"]+|"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(argsText)) !== null) {
    args.push(match[1] ?? match[0]);
  }

  return args;
}

function getVaultBase(app: App): string {
  return (app.vault.adapter as { basePath?: string }).basePath ?? "";
}

function getTerminalFontFamily(): string {
  return "var(--font-monospace), monospace";
}

function getTerminalTheme(): NonNullable<Terminal["options"]["theme"]> {
  const styles = getComputedStyle(document.body);
  const get = (name: string): string => styles.getPropertyValue(name).trim();
  const isDark = document.body.classList.contains("theme-dark");

  return {
    background: get("--background-primary") || (isDark ? "#101217" : "#ffffff"),
    foreground: get("--text-normal") || (isDark ? "#d7dae0" : "#20232a"),
    cursor: get("--text-accent") || get("--interactive-accent") || "#6c7cff",
    cursorAccent: get("--background-primary") || (isDark ? "#101217" : "#ffffff"),
    selectionBackground: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)",
    black: isDark ? "#20242c" : "#2f3542",
    red: "#e05f65",
    green: "#57c38c",
    yellow: "#d5b65a",
    blue: "#6c8cff",
    magenta: "#b072d1",
    cyan: "#4bb8d1",
    white: isDark ? "#d7dae0" : "#f1f2f6",
    brightBlack: isDark ? "#67707f" : "#57606f",
    brightRed: "#ff7b84",
    brightGreen: "#6dde9c",
    brightYellow: "#ebcb72",
    brightBlue: "#8ba2ff",
    brightMagenta: "#c792ea",
    brightCyan: "#68d4ea",
    brightWhite: isDark ? "#f8f9fb" : "#ffffff",
  };
}

function escapeForPowerShell(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

function makeSessionLabel(profileId: ProfileId, id: number): string {
  switch (profileId) {
    case "codex":
      return `Codex ${id}`;
    case "claude":
      return `Claude ${id}`;
    case "opencode":
      return `OpenCode ${id}`;
    case "custom":
      return `Custom ${id}`;
    default:
      return `Shell ${id}`;
  }
}

class FileCitationAutocomplete {
  private cachedFiles: Array<{ basename: string; basenameLower: string; pathNoExt: string; pathLower: string; mtime: number }> | null = null;
  private active = false;
  private query = "";
  private results: TFile[] = [];
  private selectedIndex = 0;
  private lastCharWasBracket = false;
  private dropdownEl: HTMLElement | null = null;
  private renderFrame: number | null = null;

  constructor(
    private readonly app: App,
    private readonly term: Terminal,
    private readonly writeToShell: (data: string) => void,
    private readonly containerEl: HTMLElement,
  ) {
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (!this.active) {
        return true;
      }

      if (event.type !== "keydown") {
        return false;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.render();
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectedIndex = Math.min(this.results.length - 1, this.selectedIndex + 1);
        this.render();
        return false;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        this.accept();
        return false;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        this.dismiss();
        return false;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        if (this.query.length > 0) {
          this.query = this.query.slice(0, -1);
          this.updateResults();
        } else {
          this.dismiss();
        }
        return false;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.query += event.key;
        this.updateResults();
        return false;
      }

      return false;
    });
  }

  handleData(data: string): void {
    if (this.active) {
      return;
    }

    if (data.length > 1) {
      if (data.includes("[[")) {
        this.activate();
      }
      this.lastCharWasBracket = data.endsWith("[");
      return;
    }

    if (data === "[") {
      if (this.lastCharWasBracket) {
        this.lastCharWasBracket = false;
        this.activate();
      } else {
        this.lastCharWasBracket = true;
      }
    } else {
      this.lastCharWasBracket = false;
    }
  }

  destroy(): void {
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
    }
    this.removeDropdown();
  }

  private activate(): void {
    this.active = true;
    this.query = "";
    this.selectedIndex = 0;
    this.updateResults();
  }

  private dismiss(): void {
    if (this.query) {
      this.writeToShell(this.query);
    }
    this.deactivate();
  }

  private accept(): void {
    const target = this.results[this.selectedIndex];
    if (target) {
      this.writeToShell(`${target.path.replace(/\.md$/i, "")}]]`);
    } else if (this.query) {
      this.writeToShell(`${this.query}]]`);
    } else {
      this.writeToShell("]]");
    }
    this.deactivate();
  }

  private deactivate(): void {
    this.active = false;
    this.query = "";
    this.results = [];
    this.selectedIndex = 0;
    this.removeDropdown();
  }

  private updateResults(): void {
    const q = this.query.toLowerCase();
    const files = this.getCachedFiles();
    if (!q) {
      this.results = files
        .slice()
        .sort((left, right) => right.mtime - left.mtime)
        .slice(0, 8)
        .map((file) => this.app.vault.getAbstractFileByPath(`${file.pathNoExt}.md`))
        .filter((file): file is TFile => file instanceof TFile);
    } else {
      const prefix: typeof files = [];
      const contains: typeof files = [];
      for (const file of files) {
        if (file.basenameLower.startsWith(q) || file.pathLower.startsWith(q)) {
          prefix.push(file);
        } else if (file.basenameLower.includes(q) || file.pathLower.includes(q)) {
          contains.push(file);
        }
        if (prefix.length + contains.length >= 20) {
          break;
        }
      }
      this.results = [...prefix, ...contains]
        .slice(0, 8)
        .map((file) => this.app.vault.getAbstractFileByPath(`${file.pathNoExt}.md`))
        .filter((file): file is TFile => file instanceof TFile);
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.results.length - 1));
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private getCachedFiles(): Array<{ basename: string; basenameLower: string; pathNoExt: string; pathLower: string; mtime: number }> {
    if (this.cachedFiles) {
      return this.cachedFiles;
    }

    this.cachedFiles = this.app.vault.getFiles().map((file) => {
      const pathNoExt = file.path.replace(/\.md$/i, "");
      return {
        basename: file.basename,
        basenameLower: file.basename.toLowerCase(),
        pathNoExt,
        pathLower: pathNoExt.toLowerCase(),
        mtime: file.stat.mtime,
      };
    });

    return this.cachedFiles;
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.containerEl.createDiv({ cls: "vin-terminal-citation-dropdown" });
    }

    this.dropdownEl.empty();
    this.dropdownEl.createDiv({ cls: "vin-terminal-citation-header", text: `[[${this.query}` });

    if (!this.results.length) {
      this.dropdownEl.createDiv({ cls: "vin-terminal-citation-empty", text: "No matching notes" });
      return;
    }

    const list = this.dropdownEl.createDiv({ cls: "vin-terminal-citation-list" });
    this.results.forEach((file, index) => {
      const item = list.createDiv({ cls: "vin-terminal-citation-item" });
      if (index === this.selectedIndex) {
        item.addClass("is-selected");
      }
      item.createDiv({ cls: "vin-terminal-citation-name", text: file.basename });
      item.createDiv({ cls: "vin-terminal-citation-path", text: file.path.replace(/\.md$/i, "") });
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selectedIndex = index;
        this.accept();
      });
    });
  }

  private removeDropdown(): void {
    this.dropdownEl?.remove();
    this.dropdownEl = null;
  }
}

class TerminalSession {
  readonly containerEl: HTMLElement;
  readonly hostEl: HTMLElement;
  readonly fitAddon = new FitAddon();
  readonly term: Terminal;
  readonly ptyProcess: IPty;
  readonly citationAutocomplete: FileCitationAutocomplete;
  name: string;
  hasActivity = false;
  private disposed = false;

  constructor(
    private readonly plugin: EmbeddedAiTerminalPlugin,
    private readonly view: TerminalView,
    readonly id: number,
    readonly profileId: ProfileId,
    readonly cwd: string,
    private startupCommand: string,
  ) {
    this.name = makeSessionLabel(profileId, id);
    this.containerEl = this.view.sessionsEl.createDiv({ cls: "vin-terminal-session" });
    this.hostEl = this.containerEl.createDiv({ cls: "vin-terminal-host" });

    this.term = new Terminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: this.plugin.settings.cursorBlink,
      customGlyphs: false,
      fontFamily: getTerminalFontFamily(),
      fontSize: this.plugin.settings.fontSize,
      fontWeight: "400",
      fontWeightBold: "700",
      letterSpacing: 0.15,
      lineHeight: 1.24,
      minimumContrastRatio: 1,
      rescaleOverlappingGlyphs: false,
      scrollback: 8000,
      theme: getTerminalTheme(),
    });
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.hostEl);

    const nodePty = loadNodePty(this.plugin);

    this.ptyProcess = nodePty.spawn(this.plugin.settings.shellPath, parseArgs(this.plugin.settings.shellArgs), {
      cols: 80,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
      name: "xterm-color",
      rows: 24,
      // Obsidian's renderer can reject worker_threads-backed ConPTY.
      // Force winpty on Windows to avoid startup failure inside Electron.
      useConpty: false,
    });

    this.citationAutocomplete = new FileCitationAutocomplete(
      this.plugin.app,
      this.term,
      (data) => this.ptyProcess.write(data),
      this.containerEl,
    );

    this.term.onData((data) => {
      this.citationAutocomplete.handleData(data);
      this.ptyProcess.write(data);
    });

    this.ptyProcess.onData((data) => {
      this.term.write(data);
      if (this.view.activeSession !== this && !this.hasActivity) {
        this.hasActivity = true;
        this.view.renderTabs();
      }
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.term.write(`\r\n[process exited with code ${exitCode}]\r\n`);
    });

    this.installDropHandlers();

    requestAnimationFrame(() => {
      this.fit();
      this.focus();
      const startupLines = [
        ...this.plugin.settings.startupLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ...this.startupCommand.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      ];
      if (startupLines.length) {
        window.setTimeout(() => {
          for (const line of startupLines) {
            this.sendText(line);
          }
        }, 80);
      }
    });

    window.setTimeout(() => {
      if (!this.disposed) {
        this.fit();
      }
    }, 180);
  }

  toState(): SavedSessionState {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      profileId: this.profileId,
      startupCommand: this.startupCommand,
    };
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed) {
      this.name = trimmed;
    }
  }

  focus(): void {
    this.term.focus();
    this.hasActivity = false;
    this.view.renderTabs();
  }

  fit(): void {
    if (this.disposed) {
      return;
    }

    if (this.hostEl.clientWidth === 0 || this.hostEl.clientHeight === 0) {
      return;
    }

    this.fitAddon.fit();
    this.ptyProcess.resize(this.term.cols, this.term.rows);
    this.term.refresh(0, this.term.rows - 1);
  }

  show(): void {
    this.containerEl.addClass("is-active");
    this.containerEl.style.display = "";
    this.fit();
    this.focus();
  }

  hide(): void {
    this.containerEl.removeClass("is-active");
    this.containerEl.style.display = "none";
  }

  updateTheme(): void {
    this.term.options.theme = getTerminalTheme();
    this.term.options.fontSize = this.plugin.settings.fontSize;
    this.term.options.cursorBlink = this.plugin.settings.cursorBlink;
    this.fit();
  }

  sendText(text: string, appendEnter = true): void {
    if (!text) {
      return;
    }

    this.ptyProcess.write(appendEnter ? `${text}\r` : text);
    this.focus();
  }

  sendFilePaths(paths: string[]): void {
    if (!paths.length) {
      return;
    }

    const escaped = paths.map((item) => escapeForPowerShell(item)).join(" ");
    this.sendText(`${escaped} `, false);
  }

  private installDropHandlers(): void {
    const dropzone = this.containerEl.createDiv({ cls: "vin-terminal-dropzone" });
    dropzone.createSpan({ cls: "vin-dropzone-label", text: "Drop files to paste paths" });

    const show = (): void => dropzone.addClass("is-visible");
    const hide = (): void => dropzone.removeClass("is-visible");

    this.containerEl.addEventListener("dragenter", (event) => {
      event.preventDefault();
      show();
    });

    this.containerEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      show();
    });

    this.containerEl.addEventListener("dragleave", (event) => {
      if (event.target === this.containerEl) {
        hide();
      }
    });

    this.containerEl.addEventListener("drop", (event) => {
      event.preventDefault();
      hide();

      const dt = event.dataTransfer;
      if (!dt) {
        return;
      }

      const paths: string[] = [];
      for (const file of Array.from(dt.files)) {
        const filePath = (file as File & { path?: string }).path;
        if (filePath) {
          paths.push(filePath);
        }
      }

      if (!paths.length) {
        const rawText = dt.getData("text/plain").trim();
        if (rawText) {
          paths.push(rawText);
        }
      }

      this.sendFilePaths(paths);
    });
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.citationAutocomplete.destroy();
    this.ptyProcess.kill();
    this.term.dispose();
    this.containerEl.remove();
  }
}

class TerminalView extends ItemView {
  sessions: TerminalSession[] = [];
  activeSession: TerminalSession | null = null;
  nextId = 1;
  tabBarEl!: HTMLElement;
  sessionsEl!: HTMLElement;
  private rootEl!: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private pendingState: ViewStatePayload | null = null;
  private opened = false;
  private isRenaming = false;
  private toolbarVisible = false;

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

  getState(): ViewStatePayload {
    return {
      sessions: this.sessions.map((session) => session.toState()),
      activeId: this.activeSession?.id ?? null,
      nextId: this.nextId,
    };
  }

  async setState(state: ViewStatePayload): Promise<void> {
    this.pendingState = state;
    if (this.opened) {
      this.restoreState();
    }
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    const container = this.containerEl.children[1] as HTMLElement;
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

      window.setTimeout(() => this.activeSession?.focus(), 0);
    });

    this.tabBarEl = container.createDiv({ cls: "vin-terminal-tab-bar" });
    this.sessionsEl = container.createDiv({ cls: "vin-terminal-sessions" });

    this.resizeObserver = new ResizeObserver(() => {
      window.setTimeout(() => this.activeSession?.fit(), 50);
    });
    this.resizeObserver.observe(this.sessionsEl);

    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const session of this.sessions) {
          session.updateTheme();
        }
      }),
    );

    if (this.pendingState?.sessions?.length) {
      this.restoreState();
    } else {
      void this.createSession("shell");
    }
  }

  private toggleToolbar(): void {
    this.toolbarVisible = !this.toolbarVisible;
    this.rootEl.toggleClass("is-toolbar-visible", this.toolbarVisible);
    window.setTimeout(() => this.activeSession?.fit(), 40);
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const session of this.sessions) {
      session.destroy();
    }
    this.sessions = [];
    this.activeSession = null;
  }

  createSession(profileId: ProfileId, startupOverride?: string): TerminalSession | null {
    const id = this.nextId++;
    const cwd = this.plugin.getDefaultCwd();
    const startupCommand = startupOverride ?? this.plugin.getStartupCommand(profileId);
    let session: TerminalSession;
    try {
      session = new TerminalSession(this.plugin, this, id, profileId, cwd, startupCommand);
    } catch (error) {
      this.nextId -= 1;
      new Notice(error instanceof Error ? error.message : String(error));
      return null;
    }
    session.name = makeSessionLabel(profileId, id);
    this.sessions.push(session);
    this.switchTo(session);
    this.renderTabs();
    this.plugin.requestLayoutSave();
    return session;
  }

  switchTo(session: TerminalSession): void {
    if (this.activeSession === session) {
      session.focus();
      return;
    }

    this.activeSession?.hide();
    this.activeSession = session;
    session.show();
    this.renderTabs();
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
      void this.createSession("shell");
      return;
    }

    this.renderTabs();
    this.plugin.requestLayoutSave();
  }

  renderTabs(): void {
    if (!this.tabBarEl || this.isRenaming) {
      return;
    }

    this.tabBarEl.empty();
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
    newTab.addEventListener("click", () => void this.createSession("shell"));

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
    const input = document.createElement("input");
    input.type = "text";
    input.className = "vin-terminal-tab-rename";
    input.value = session.name;
    input.style.width = `${Math.max(5, session.name.length + 1)}ch`;
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
      input.style.width = `${Math.max(5, input.value.length + 1)}ch`;
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
    this.nextId = this.pendingState.nextId ?? 1;

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
      } catch (error) {
        new Notice(`Failed to restore terminal tab "${saved.name}": ${error instanceof Error ? error.message : String(error)}`);
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
    this.pendingState = null;
  }
}

class TerminalHelpModal extends Modal {
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vin-terminal-help-modal");
    contentEl.createEl("h3", { text: "Embedded Terminal" });

    const items: Array<[string, string]> = [
      ["+", "Open a fresh shell tab"],
      ["Codex", "Open a new tab and run the configured Codex command"],
      ["Claude", "Open a new tab and run the configured Claude Code command"],
      ["OpenCode", "Open a new tab and run the configured OpenCode command"],
      ["Double-click tab", "Rename a terminal tab"],
      ["Right-click tab", "Rename or close a tab"],
      ["Drop files", "Paste Windows file paths into the terminal"],
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

class EmbeddedTerminalSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: EmbeddedAiTerminalPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Embedded Terminal" });

    new Setting(containerEl)
      .setName("Shell executable")
      .setDesc("Windows shell launched inside each tab.")
      .addText((text) => {
        text.setPlaceholder("powershell.exe");
        text.setValue(this.plugin.settings.shellPath);
        text.onChange(async (value) => {
          this.plugin.settings.shellPath = value.trim() || "powershell.exe";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Shell args")
      .setDesc("Passed to the shell on startup.")
      .addText((text) => {
        text.setPlaceholder("-NoLogo");
        text.setValue(this.plugin.settings.shellArgs);
        text.onChange(async (value) => {
          this.plugin.settings.shellArgs = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default working directory")
      .setDesc("Defaults to the vault root when empty.")
      .addText((text) => {
        text.setPlaceholder(getVaultBase(this.app));
        text.setValue(this.plugin.settings.defaultCwd);
        text.onChange(async (value) => {
          this.plugin.settings.defaultCwd = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Terminal font size in pixels.")
      .addSlider((slider) => {
        slider.setLimits(11, 22, 1);
        slider.setDynamicTooltip();
        slider.setValue(this.plugin.settings.fontSize);
        slider.onChange(async (value) => {
          this.plugin.settings.fontSize = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSessions();
        });
      });

    new Setting(containerEl)
      .setName("Cursor blink")
      .setDesc("Use a blinking cursor in xterm.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.cursorBlink);
        toggle.onChange(async (value) => {
          this.plugin.settings.cursorBlink = value;
          await this.plugin.saveSettings();
          this.plugin.refreshSessions();
        });
      });

    new Setting(containerEl)
      .setName("Startup commands")
      .setDesc("Optional commands sent to every new tab before provider-specific commands.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.setValue(this.plugin.settings.startupLines);
        text.onChange(async (value) => {
          this.plugin.settings.startupLines = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Provider Commands" });
    this.renderCommandSetting(containerEl, "Codex", "codex");
    this.renderCommandSetting(containerEl, "Claude Code", "claude");
    this.renderCommandSetting(containerEl, "OpenCode", "opencode");
    this.renderCommandSetting(containerEl, "Custom", "custom");
  }

  private renderCommandSetting(containerEl: HTMLElement, label: string, key: Exclude<ProfileId, "shell">): void {
    new Setting(containerEl)
      .setName(label)
      .setDesc("Command sent inside a new shell tab for this launcher.")
      .addText((text) => {
        text.setPlaceholder(key === "custom" ? "npm run my-agent" : key);
        text.setValue(this.plugin.settings.commands[key]);
        text.onChange(async (value) => {
          this.plugin.settings.commands[key] = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

export default class EmbeddedAiTerminalPlugin extends Plugin {
  settings: EmbeddedTerminalSettings = structuredClone(DEFAULT_SETTINGS);

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
        void this.sendPathsToActiveSession([`${getVaultBase(this.app)}\\${file.path.replace(/\//g, "\\")}`]);
      },
    });

    this.app.workspace.onLayoutReady(() => {
      void this.ensureLeaf();
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_EMBEDDED_AI_TERMINAL);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...loaded,
      commands: {
        ...structuredClone(DEFAULT_SETTINGS.commands),
        ...(loaded?.commands ?? {}),
      },
    };

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
    await leaf.setViewState({ type: VIEW_TYPE_EMBEDDED_AI_TERMINAL, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async ensureLeaf(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_EMBEDDED_AI_TERMINAL).length > 0) {
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
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
