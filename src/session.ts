import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { createTerminalBackend, type BackendDisposable, type TerminalBackend } from "./backend";
import { FileCitationAutocomplete } from "./citation";
import { formatDiagnosticContext } from "./diagnostics";
import { quotePath } from "./platform";
import { getTerminalFontFamily, getTerminalTheme } from "./theme";
import type EmbeddedAiTerminalPlugin from "./main";
import type { ProfileId, SavedSessionState } from "./types";
import type { TerminalView } from "./view";

export function makeSessionLabel(profileId: ProfileId, id: number): string {
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

export class TerminalSession {
  readonly containerEl: HTMLElement;
  readonly hostEl: HTMLElement;
  readonly statusEl: HTMLElement;
  readonly fitAddon = new FitAddon();
  readonly term: Terminal;
  readonly backend: TerminalBackend;
  readonly citationAutocomplete: FileCitationAutocomplete;
  name: string;
  hasActivity = false;
  private disposed = false;
  private hasReceivedOutput = false;
  private startupWarningTimer: number | null = null;
  private startupFrame: number | null = null;
  private startupCommandTimer: number | null = null;
  private fitTimer: number | null = null;
  private rendererAddon: { dispose(): void } | null = null;
  private rendererContextLossDisposable: { dispose(): void } | null = null;
  private rendererName = "DOM";
  private backendDataDisposable: BackendDisposable | null = null;
  private backendExitDisposable: BackendDisposable | null = null;
  private termDataDisposable: { dispose(): void } | null = null;

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
    this.statusEl = this.containerEl.createDiv({ cls: "vin-terminal-session-status" });
    const ownerWindow = this.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      throw new Error("The terminal document has no window.");
    }
    this.setStatus(`Starting ${this.name}...`);
    let terminal: Terminal | undefined;
    let backend: TerminalBackend | undefined;
    try {
      terminal = new Terminal({
        allowTransparency: false,
        convertEol: true,
        cursorBlink: this.plugin.settings.cursorBlink,
        customGlyphs: true,
        fontFamily: getTerminalFontFamily(),
        fontSize: this.plugin.settings.fontSize,
        fontWeight: "400",
        fontWeightBold: "700",
        letterSpacing: 0.15,
        lineHeight: 1.24,
        minimumContrastRatio: 1,
        rescaleOverlappingGlyphs: false,
        scrollback: 8000,
        theme: getTerminalTheme(this.containerEl),
      });
      this.term = terminal;
      this.term.loadAddon(this.fitAddon);
      this.term.open(this.hostEl);
      this.initializeRenderer();

      backend = createTerminalBackend(this.plugin, this.plugin.settings.backend, this.cwd);
      this.backend = backend;
      if (backend.isPty) {
        this.setStatus(`Starting ${this.name} (${backend.name})...`);
      } else {
        this.setStatus(`Pipe mode: no PTY; full-screen apps may not render correctly.`);
        this.plugin.recordDiagnostic({
          level: "warning",
          scope: "backend-selected",
          summary: `${this.name} is using ${backend.name}. Full-screen terminal apps may not render correctly.`,
          detail: "Install the platform-specific native bundle from the GitHub release for real PTY support.",
        });
      }

      this.citationAutocomplete = new FileCitationAutocomplete(
        this.plugin.app,
        this.term,
        (data) => this.backend.write(data),
        this.containerEl,
      );

      this.termDataDisposable = this.term.onData((data) => {
        this.citationAutocomplete.handleData(data);
        this.backend.write(data);
      });

      this.backendDataDisposable = this.backend.onData((data) => {
        if (!this.hasReceivedOutput) {
          this.hasReceivedOutput = true;
          this.clearStartupWarningTimer();
          this.statusEl.removeClass("is-visible");
          this.statusEl.empty();
        }
        this.term.write(data);
        if (this.view.activeSession !== this && !this.hasActivity) {
          this.hasActivity = true;
          this.view.renderTabs();
        }
      });

      this.backendExitDisposable = this.backend.onExit(({ exitCode }) => {
        if (this.disposed) {
          return;
        }

        this.term.write(`\r\n[process exited with code ${exitCode}]\r\n`);
        if (exitCode !== 0) {
          this.plugin.recordDiagnostic({
            level: "warning",
            scope: "process-exit",
            summary: `${this.name} exited with code ${exitCode}.`,
            detail: formatDiagnosticContext({
              profile: this.profileId,
              backend: this.backend.name,
              shellPath: this.plugin.settings.shellPath,
              shellArgs: this.plugin.settings.shellArgs,
              cwd: this.cwd,
              startupCommand: this.startupCommand,
            }),
          });
        }
      });

      this.installDropHandlers();
      this.startupWarningTimer = ownerWindow.setTimeout(() => {
        if (this.disposed || this.hasReceivedOutput) {
          return;
        }

        this.setStatus("Waiting for terminal output...");
        this.plugin.recordDiagnostic({
          level: "warning",
          scope: "session-startup",
          summary: `${this.name} started but has not produced output yet.`,
          context: {
            profile: this.profileId,
            pid: String(this.backend.pid),
            backend: this.backend.name,
            shellPath: this.plugin.settings.shellPath,
            shellArgs: this.plugin.settings.shellArgs,
            cwd: this.cwd,
            startupCommand: this.startupCommand,
          },
        });
      }, 2200);

      this.startupFrame = ownerWindow.requestAnimationFrame(() => {
        this.startupFrame = null;
        if (this.disposed) return;
        this.fit();
        this.focus();
        const startupLines = [
          ...this.plugin.settings.startupLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          ...this.startupCommand.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ];
        if (startupLines.length) {
          this.startupCommandTimer = ownerWindow.setTimeout(() => {
            this.startupCommandTimer = null;
            if (this.disposed) return;
            for (const line of startupLines) {
              this.sendText(line);
            }
          }, 80);
        }
      });

      this.fitTimer = ownerWindow.setTimeout(() => {
        this.fitTimer = null;
        if (!this.disposed) {
          this.fit();
        }
      }, 180);
    } catch (error) {
      this.clearStartupWarningTimer();
      backend?.dispose();
      terminal?.dispose();
      this.containerEl.remove();
      throw error;
    }
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

    const previousCols = this.term.cols;
    const previousRows = this.term.rows;
    this.fitAddon.fit();
    if (this.term.cols !== previousCols || this.term.rows !== previousRows) {
      this.backend.resize(this.term.cols, this.term.rows);
    }
  }

  show(): void {
    this.containerEl.addClass("is-active");
    this.fit();
    this.focus();
  }

  hide(): void {
    this.containerEl.removeClass("is-active");
  }

  updateTheme(): void {
    this.term.options.theme = getTerminalTheme(this.containerEl);
    this.term.options.fontSize = this.plugin.settings.fontSize;
    this.term.options.cursorBlink = this.plugin.settings.cursorBlink;
    this.term.clearTextureAtlas();
  }

  sendText(text: string, appendEnter = true): void {
    if (!text) {
      return;
    }

    if (this.disposed) return;
    this.backend.write(appendEnter ? `${text}\r` : text);
    this.focus();
  }

  sendFilePaths(paths: string[]): void {
    if (!paths.length) {
      return;
    }

    const escaped = paths.map((item) => quotePath(item)).join(" ");
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
    this.clearStartupWarningTimer();
    const view = this.containerEl.ownerDocument.defaultView;
    if (this.startupFrame !== null) view?.cancelAnimationFrame(this.startupFrame);
    if (this.startupCommandTimer !== null) view?.clearTimeout(this.startupCommandTimer);
    if (this.fitTimer !== null) view?.clearTimeout(this.fitTimer);
    this.backendDataDisposable?.dispose();
    this.backendExitDisposable?.dispose();
    this.termDataDisposable?.dispose();
    this.citationAutocomplete.destroy();
    this.rendererContextLossDisposable?.dispose();
    this.rendererAddon?.dispose();
    try {
      this.backend.dispose();
    } catch {
      // The process may have exited between the disposed check and kill.
    }
    this.term.dispose();
    this.containerEl.remove();
  }

  private setStatus(text: string): void {
    this.statusEl.empty();
    this.statusEl.setText(text);
    this.statusEl.addClass("is-visible");
  }

  private clearStartupWarningTimer(): void {
    if (this.startupWarningTimer !== null) {
      this.containerEl.ownerDocument.defaultView?.clearTimeout(this.startupWarningTimer);
      this.startupWarningTimer = null;
    }
  }

  private initializeRenderer(): void {
    this.rendererContextLossDisposable?.dispose();
    this.rendererContextLossDisposable = null;
    this.rendererAddon?.dispose();
    this.rendererAddon = null;
    this.rendererName = "DOM";

    let webglAddon: WebglAddon | null = null;
    try {
      const addon = new WebglAddon();
      webglAddon = addon;
      this.term.loadAddon(addon);
      this.rendererAddon = addon;
      this.rendererName = "WebGL";
      this.rendererContextLossDisposable = addon.onContextLoss(() => this.handleRendererContextLoss());
    } catch (webglError) {
      webglAddon?.dispose();
      this.rendererAddon = null;
      this.plugin.recordDiagnostic({
        level: "warning",
        scope: "renderer",
        summary: `${this.name} is using the DOM renderer.`,
        detail: `WebGL renderer was unavailable. ${String(webglError)}`,
      });
    }

    this.plugin.recordDiagnostic({
      level: "info",
      scope: "renderer",
      summary: `${this.name} is using the ${this.rendererName} renderer.`,
    });
  }

  private handleRendererContextLoss(): void {
    if (this.disposed) {
      return;
    }
    this.plugin.recordDiagnostic({
      level: "warning",
      scope: "renderer",
      summary: `${this.name} lost its accelerated renderer; restoring the terminal buffer.`,
    });
    this.initializeRenderer();
    this.term.refresh(0, this.term.rows - 1);
  }
}
