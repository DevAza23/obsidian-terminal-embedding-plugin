import { App, TFile } from "obsidian";
import { Terminal } from "@xterm/xterm";
import type { CitationFile } from "./types";

export class FileCitationAutocomplete {
  private active = false;
  private query = "";
  private results: TFile[] = [];
  private selectedIndex = 0;
  private lastCharWasBracket = false;
  private dropdownEl: HTMLElement | null = null;
  private renderFrame: number | null = null;
  private cachedFiles: CitationFile[] | null = null;

  constructor(
    private readonly app: App,
    private readonly term: Terminal,
    private readonly writeToShell: (data: string) => void,
    private readonly containerEl: HTMLElement,
  ) {
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (!this.active) return true;
      if (event.type !== "keydown") return true;
      event.stopPropagation();

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
      if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey) {
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

      this.dismiss();
      return true;
    });
  }

  handleData(data: string): void {
    if (this.active) return;
    if (data.length > 1) {
      if (data.includes("[[")) this.activate();
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
    this.active = false;
    this.cachedFiles = null;
    this.term.attachCustomKeyEventHandler(() => true);
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    this.removeDropdown();
  }

  private activate(): void {
    this.active = true;
    this.query = "";
    this.selectedIndex = 0;
    this.cachedFiles = this.getFiles();
    this.updateResults();
  }

  private dismiss(): void {
    if (this.query) this.writeToShell(this.query);
    this.deactivate();
  }

  private accept(): void {
    const target = this.results[this.selectedIndex];
    this.writeToShell(`${target ? target.path.replace(/\.md$/i, "") : this.query}]]`);
    this.deactivate();
  }

  private deactivate(): void {
    this.active = false;
    this.query = "";
    this.results = [];
    this.cachedFiles = null;
    this.selectedIndex = 0;
    this.removeDropdown();
  }

  private updateResults(): void {
    const query = this.query.toLowerCase();
    const files = this.cachedFiles ?? [];
    if (!query) {
      this.results = files
        .slice()
        .sort((left, right) => right.mtime - left.mtime)
        .slice(0, 8)
        .map((item) => item.file);
      this.scheduleRender();
      return;
    }

    const prefix: CitationFile[] = [];
    const contains: CitationFile[] = [];
    for (const file of files) {
      if (file.basenameLower.startsWith(query) || file.pathLower.startsWith(query)) prefix.push(file);
      else if (file.basenameLower.includes(query) || file.pathLower.includes(query)) contains.push(file);
    }
    const ranked = [...prefix, ...contains];
    this.results = ranked.slice(0, 8).map((item) => item.file);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.results.length - 1));
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private getFiles(): CitationFile[] {
    return this.app.vault.getMarkdownFiles().map((file) => ({
      file,
      basenameLower: file.basename.toLowerCase(),
      pathLower: file.path.replace(/\.md$/i, "").toLowerCase(),
      mtime: file.stat.mtime,
    }));
  }

  private render(): void {
    if (!this.dropdownEl) this.dropdownEl = this.containerEl.createDiv({ cls: "vin-terminal-citation-dropdown" });
    this.dropdownEl.empty();
    this.dropdownEl.createDiv({ cls: "vin-terminal-citation-header", text: `[[${this.query}` });
    if (!this.results.length) {
      this.dropdownEl.createDiv({ cls: "vin-terminal-citation-empty", text: "No matching notes" });
      return;
    }
    const list = this.dropdownEl.createDiv({ cls: "vin-terminal-citation-list" });
    this.results.forEach((file, index) => {
      const item = list.createDiv({ cls: "vin-terminal-citation-item" });
      if (index === this.selectedIndex) item.addClass("is-selected");
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
