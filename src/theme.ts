import type { Terminal } from "@xterm/xterm";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const ANSI_HUES = [0, 0, 120, 48, 220, 300, 185, 0];

export function getTerminalFontFamily(): string {
  return "var(--font-monospace), monospace";
}

export function contrastRatio(first: string, second: string): number {
  const left = parseColor(first);
  const right = parseColor(second);
  if (!left || !right) {
    return 1;
  }
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

export function getTerminalTheme(element: HTMLElement): NonNullable<Terminal["options"]["theme"]> {
  const doc = element.ownerDocument;
  const styles = doc.defaultView?.getComputedStyle(doc.body);
  const get = (name: string): string => styles?.getPropertyValue(name).trim() || "";
  const isDark = doc.body.classList.contains("theme-dark");
  const background = get("--background-primary") || (isDark ? "#101217" : "#ffffff");
  const foreground = get("--text-normal") || (isDark ? "#d7dae0" : "#20232a");
  const backgroundRgb = parseColor(background) ?? (isDark ? { r: 16, g: 18, b: 23 } : { r: 255, g: 255, b: 255 });
  const foregroundRgb = parseColor(foreground) ?? (isDark ? { r: 215, g: 218, b: 224 } : { r: 32, g: 35, b: 42 });
  const selectionBackground = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
  const selectionRgb = compositeSelection(backgroundRgb, isDark);
  const backgroundHsl = rgbToHsl(backgroundRgb);
  const foregroundHsl = rgbToHsl(foregroundRgb);
  const saturation = Math.max(0.55, Math.min(0.82, 0.62 + (foregroundHsl.s - 0.5) * 0.2));
  const accent = get("--text-accent") || get("--interactive-accent") || (isDark ? "#d7dae0" : "#20232a");
  const black = themedTone(foregroundHsl.h, Math.min(0.16, foregroundHsl.s), isDark
    ? Math.max(0.01, backgroundHsl.l - 0.06)
    : 0.1);
  const white = themedTone(foregroundHsl.h, Math.min(0.12, foregroundHsl.s), isDark
    ? Math.min(0.96, backgroundHsl.l + 0.88)
    : 0.94);
  const ansi = ANSI_HUES.map((hue, index) => {
    if (index === 0) {
      return black;
    }
    if (index === 7) {
      return white;
    }
    const baseLightness = isDark ? 0.62 : 0.48;
    return colorWithContrast(index === 0 ? 0 : saturation, hue, baseLightness, [backgroundRgb, selectionRgb], 4.5, isDark);
  });
  const bright = ANSI_HUES.map((hue, index) => {
    if (index === 7) {
      return themedTone(foregroundHsl.h, Math.min(0.08, foregroundHsl.s), isDark ? 0.98 : 0.98);
    }
    const baseLightness = index === 0 ? (isDark ? 0.46 : 0.42) : (isDark ? 0.76 : 0.36);
    return colorWithContrast(index === 0 ? 0 : saturation, hue, baseLightness, [backgroundRgb, selectionRgb], 4.5, isDark);
  });

  return {
    background,
    foreground,
    cursor: contrastRatio(accent, background) >= 3 ? accent : foreground,
    cursorAccent: background,
    selectionBackground,
    black: ansi[0],
    red: ansi[1],
    green: ansi[2],
    yellow: ansi[3],
    blue: ansi[4],
    magenta: ansi[5],
    cyan: ansi[6],
    white,
    brightBlack: bright[0],
    brightRed: bright[1],
    brightGreen: bright[2],
    brightYellow: bright[3],
    brightBlue: bright[4],
    brightMagenta: bright[5],
    brightCyan: bright[6],
    brightWhite: bright[7],
  };
}

function colorWithContrast(
  saturation: number,
  hue: number,
  baseLightness: number,
  backgrounds: Rgb[],
  floor: number,
  isDark: boolean,
): string {
  const candidates: number[] = [];
  for (let step = 0; step <= 100; step += 1) {
    candidates.push(isDark ? step / 100 : (100 - step) / 100);
  }
  candidates.sort((left, right) => Math.abs(left - baseLightness) - Math.abs(right - baseLightness));
  for (const lightness of candidates) {
    const color = hslToRgb(hue, saturation, lightness);
    if (backgrounds.every((background) => contrastRatio(rgbToHex(color), rgbToHex(background)) >= floor)) {
      return rgbToHex(color);
    }
  }
  return rgbToHex(hslToRgb(hue, saturation, baseLightness));
}

function themedTone(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(hslToRgb(hue, saturation, lightness));
}

function parseColor(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3) {
      return {
        r: parseInt(`${hex[0]}${hex[0]}`, 16),
        g: parseInt(`${hex[1]}${hex[1]}`, 16),
        b: parseInt(`${hex[2]}${hex[2]}`, 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)(%)?\s*,\s*([\d.]+)(%)?\s*,\s*([\d.]+)(%)?/i);
  if (rgb) {
    return {
      r: Number(rgb[1]) * (rgb[2] ? 2.55 : 1),
      g: Number(rgb[3]) * (rgb[4] ? 2.55 : 1),
      b: Number(rgb[5]) * (rgb[6] ? 2.55 : 1),
    };
  }
  return null;
}

function compositeSelection(background: Rgb, isDark: boolean): Rgb {
  const overlay = isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  return {
    r: overlay.r * 0.14 + background.r * 0.86,
    g: overlay.g * 0.14 + background.g * 0.86,
    b: overlay.b * 0.14 + background.b * 0.86,
  };
}

function luminance(color: Rgb): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function rgbToHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsl(color: Rgb): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360 / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}
