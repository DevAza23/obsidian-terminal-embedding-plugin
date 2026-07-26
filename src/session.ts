import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { IPty, IDisposable } from "node-pty";
import { FileCitationAutocomplete } from "./citation";
import { formatDiagnosticContext } from "./diagnostics";
import { getTerminalFontFamily, loadNodePty, makeSessionLabel, parseArgs, quotePath } from "./platform";
import { getTerminalTheme } from "./theme";
import type EmbeddedAiTerminalPlugin from "./main";
import type { ProfileId, SavedSessionState } from "./types";
import type { TerminalView } from "./view";

export class TerminalSession {
  readonly containerEl: HTMLElement;
  readonly hostEl: HTMLElement;
  readonly statusEl: HTMLElement;
  readonly fitAddon = new FitAddon();
  readonly term: Terminal;
  readonly ptyProcess: IPty;
  readonly citationAutocomplete: FileCitationAutocomplete;
  name: string;
  hasActivity = false;
  private disposed = false;
  private hasReceivedOutput = false;
  private startupWarningTimer: number | null = null;
  private startupFrame: number | null = null;
  private startupCommandTimer: number | null = null;
  private fitTimer: number | null = null;
  private ptyDataDisposable: IDisposable | null = null;
  private ptyExitDisposable: IDisposable | null = null;
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
    this.setStatus(`Starting ${this.name}...`);
    try {
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
        theme: getTerminalTheme(this.containerEl),
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
        ...(process.platform === "win32"
          ? {
              // Obsidian's renderer can reject worker_threads-backed ConPTY.
              // Force winpty on Windows to avoid startup failure inside Electron.
              useConpty: false,
            }
          : {}),
      });

      this.citationAutocomplete = new FileCitationAutocomplete(
        this.plugin.app,
        this.term,
        (data) => this.ptyProcess.write(data),
        this.containerEl,
      );

      this.termDataDisposable = this.term.onData((data) => {
        this.citationAutocomplete.handleData(data);
        this.ptyProcess.write(data);
      });

      this.ptyDataDisposable = this.ptyProcess.onData((data) => {
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

      this.ptyExitDisposable = this.ptyProcess.onExit(({ exitCode }) => {
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
              shellPath: this.plugin.settings.shellPath,
              shellArgs: this.plugin.settings.shellArgs,
              cwd: this.cwd,
              startupCommand: this.startupCommand,
            }),
          });
        }
      });

      this.installDropHandlers();
      this.startupWarningTimer = window.setTimeout(() => {
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
            pid: String(this.ptyProcess.pid),
            shellPath: this.plugin.settings.shellPath,
            shellArgs: this.plugin.settings.shellArgs,
            cwd: this.cwd,
            startupCommand: this.startupCommand,
          },
        });
      }, 2200);

      this.startupFrame = requestAnimationFrame(() => {
        this.startupFrame = null;
        if (this.disposed) return;
        this.fit();
        this.focus();
        const startupLines = [
          ...this.plugin.settings.startupLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          ...this.startupCommand.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ];
        if (startupLines.length) {
          this.startupCommandTimer = window.setTimeout(() => {
            this.startupCommandTimer = null;
            if (this.disposed) return;
            for (const line of startupLines) {
              this.sendText(line);
            }
          }, 80);
        }
      });

      this.fitTimer = window.setTimeout(() => {
        this.fitTimer = null;
        if (!this.disposed) {
          this.fit();
        }
      }, 180);
    } catch (error) {
      this.clearStartupWarningTimer();
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

    this.fitAddon.fit();
    this.ptyProcess.resize(this.term.cols, this.term.rows);
    this.term.refresh(0, this.term.rows - 1);
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
    this.fit();
  }

  sendText(text: string, appendEnter = true): void {
    if (!text) {
      return;
    }

    if (this.disposed) return;
    this.ptyProcess.write(appendEnter ? `${text}\r` : text);
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
    if (this.startupFrame !== null) cancelAnimationFrame(this.startupFrame);
    if (this.startupCommandTimer !== null) window.clearTimeout(this.startupCommandTimer);
    if (this.fitTimer !== null) window.clearTimeout(this.fitTimer);
    this.ptyDataDisposable?.dispose();
    this.ptyExitDisposable?.dispose();
    this.termDataDisposable?.dispose();
    this.citationAutocomplete.destroy();
    try {
      this.ptyProcess.kill();
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
      window.clearTimeout(this.startupWarningTimer);
      this.startupWarningTimer = null;
    }
  }
}
