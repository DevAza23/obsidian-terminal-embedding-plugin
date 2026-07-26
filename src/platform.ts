import { App, FileSystemAdapter } from "obsidian";
import * as nodePath from "node:path";
import type EmbeddedAiTerminalPlugin from "./main";

export interface NodePtyModule {
  spawn: typeof import("node-pty")["spawn"];
}

export function getShellDefaults(): { shellPath: string; shellArgs: string } {
  if (process.platform === "win32") {
    return { shellPath: "powershell.exe", shellArgs: "-NoLogo" };
  }

  return {
    shellPath: process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh"),
    shellArgs: "",
  };
}

export function parseArgs(argsText: string): string[] {
  const args: string[] = [];
  const matcher = /[^\s"]+|"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(argsText)) !== null) {
    args.push(match[1] ?? match[0]);
  }

  return args;
}

export function quotePath(filePath: string): string {
  if (process.platform === "win32") {
    return `'${filePath.replace(/'/g, "''")}'`;
  }

  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

export function getVaultBase(app: App): string {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
}

function getPluginInstallDir(plugin: EmbeddedAiTerminalPlugin): string {
  const manifestDir = (plugin.manifest as { dir?: string }).dir ?? "";
  if (!manifestDir) {
    return "";
  }

  return nodePath.isAbsolute(manifestDir) ? manifestDir : nodePath.join(getVaultBase(plugin.app), manifestDir);
}

let cachedNodePty: NodePtyModule | null = null;

export function loadNodePty(plugin: EmbeddedAiTerminalPlugin): NodePtyModule {
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
    pluginDir ? nodePath.join(pluginDir, "node_modules", "node-pty") : "",
    pluginDir ? nodePath.join(pluginDir, "node_modules", "node-pty", "lib", "index.js") : "",
    "node-pty",
  ].filter(Boolean);

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      cachedNodePty = runtimeRequire(candidate) as NodePtyModule;
      return cachedNodePty;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Failed to load node-pty. Copy the plugin with its node_modules folder, or rebuild node-pty for Obsidian/Electron. ${failures.join(" | ")}`);
}
