import type { Terminal } from "@xterm/xterm";

export function getTerminalFontFamily(): string {
  return "var(--font-monospace), monospace";
}

export function getTerminalTheme(element: HTMLElement): NonNullable<Terminal["options"]["theme"]> {
  const doc = element.ownerDocument;
  const styles = doc.defaultView?.getComputedStyle(doc.body);
  const get = (name: string): string => styles?.getPropertyValue(name).trim() || "";
  const isDark = doc.body.classList.contains("theme-dark");

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
