import type { DiagnosticEntry, DiagnosticLevel } from "./types";

export function formatDiagnosticTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function formatDiagnosticContext(context?: Record<string, string>): string {
  if (!context) {
    return "";
  }
  return Object.entries(context)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export class DiagnosticsStore {
  private diagnostics: DiagnosticEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  getEntries(): DiagnosticEntry[] {
    return [...this.diagnostics];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.diagnostics = [];
    this.notify();
  }

  record(input: {
    level: DiagnosticLevel;
    scope: string;
    summary: string;
    detail?: string;
    error?: unknown;
    context?: Record<string, string>;
  }): void {
    const detail = [input.detail, formatDiagnosticContext(input.context), input.error ? formatUnknownError(input.error) : ""]
      .filter((part) => part && part.trim().length > 0)
      .join("\n\n");
    this.diagnostics = [
      { id: this.nextId++, timestamp: Date.now(), level: input.level, scope: input.scope, summary: input.summary, detail },
      ...this.diagnostics,
    ].slice(0, 20);
    this.notify();
    const output = `[embedded-ai-terminal:${input.scope}] ${input.summary}\n${detail}`;
    if (input.level === "error") console.error(output);
    else if (input.level === "warning") console.warn(output);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
