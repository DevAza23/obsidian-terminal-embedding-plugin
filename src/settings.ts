import { App, PluginSettingTab, Setting } from "obsidian";
import { getShellDefaults, getVaultBase } from "./platform";
import type EmbeddedAiTerminalPlugin from "./main";
import type { EmbeddedTerminalSettings, ProfileId } from "./types";

export function createDefaultSettings(): EmbeddedTerminalSettings {
  const shell = getShellDefaults();
  return {
    shellPath: shell.shellPath,
    shellArgs: shell.shellArgs,
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
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSettings(loaded: unknown): EmbeddedTerminalSettings {
  const defaults = createDefaultSettings();
  const data = loaded && typeof loaded === "object" ? loaded as Record<string, unknown> : {};
  const commands = data.commands && typeof data.commands === "object" ? data.commands as Record<string, unknown> : {};
  const fontSize = typeof data.fontSize === "number" && Number.isFinite(data.fontSize) ? data.fontSize : defaults.fontSize;

  return {
    shellPath: stringSetting(data.shellPath, defaults.shellPath),
    shellArgs: stringSetting(data.shellArgs, defaults.shellArgs),
    defaultCwd: stringSetting(data.defaultCwd, defaults.defaultCwd),
    fontSize: Math.min(22, Math.max(11, fontSize)),
    cursorBlink: typeof data.cursorBlink === "boolean" ? data.cursorBlink : defaults.cursorBlink,
    startupLines: stringSetting(data.startupLines, defaults.startupLines),
    commands: {
      codex: stringSetting(commands.codex, defaults.commands.codex),
      claude: stringSetting(commands.claude, defaults.commands.claude),
      opencode: stringSetting(commands.opencode, defaults.commands.opencode),
      custom: stringSetting(commands.custom, defaults.commands.custom),
    },
  };
}

export class EmbeddedTerminalSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: EmbeddedAiTerminalPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Shell executable")
      .setDesc("Executable launched inside each tab.")
      .addText((text) => {
        text.setPlaceholder(getShellDefaults().shellPath);
        text.setValue(this.plugin.settings.shellPath);
        text.onChange(async (value) => {
          this.plugin.settings.shellPath = value.trim() || getShellDefaults().shellPath;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Shell args")
      .setDesc("Passed to the shell on startup.")
      .addText((text) => {
        text.setPlaceholder(getShellDefaults().shellArgs);
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
        slider.setLimits(11, 22, 1).setDynamicTooltip();
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

    new Setting(containerEl).setHeading().setName("Startup");
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

    new Setting(containerEl).setHeading().setName("Provider commands");
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
