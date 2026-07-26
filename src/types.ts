import type { TFile } from "obsidian";

export type ProfileId = "shell" | "codex" | "claude" | "opencode" | "custom";
export type BackendPreference = "auto" | "node-pty" | "python" | "pipe";

export interface SavedSessionState {
  id: number;
  name: string;
  cwd: string;
  profileId: ProfileId;
  startupCommand: string;
}

export interface ViewStatePayload {
  sessions: SavedSessionState[];
  activeId: number | null;
  nextId: number;
}

export type DiagnosticLevel = "error" | "warning" | "info";

export interface DiagnosticEntry {
  id: number;
  timestamp: number;
  level: DiagnosticLevel;
  scope: string;
  summary: string;
  detail: string;
}

export interface EmbeddedTerminalSettings {
  shellPath: string;
  shellArgs: string;
  backend: BackendPreference;
  defaultCwd: string;
  fontSize: number;
  cursorBlink: boolean;
  startupLines: string;
  commands: Record<Exclude<ProfileId, "shell">, string>;
}

export interface CitationFile {
  file: TFile;
  basenameLower: string;
  pathLower: string;
  mtime: number;
}
