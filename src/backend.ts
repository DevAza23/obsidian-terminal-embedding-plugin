import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { IDisposable } from "node-pty";
import type EmbeddedAiTerminalPlugin from "./main";
import { getPluginInstallDir, loadNodePty, parseArgs } from "./platform";
import type { BackendPreference } from "./types";

export interface TerminalBackend {
  readonly name: string;
  readonly isPty: boolean;
  readonly pid: number;
  onData(listener: (data: string) => void): BackendDisposable;
  onExit(listener: (event: BackendExitEvent) => void): BackendDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  dispose(): void;
  getErrorDetail?(): string;
}

export interface BackendExitEvent {
  readonly exitCode: number;
  readonly signal?: string;
}

export interface BackendDisposable {
  dispose(): void;
}

export interface BackendReadiness {
  readonly nativeAvailable: boolean;
  readonly pythonAvailable: boolean;
  readonly selectedBackend?: string;
  readonly selectedIsPty?: boolean;
  readonly commands: Record<"claude" | "codex" | "opencode", boolean>;
}

interface NodePtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): IDisposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): IDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const PYTHON_PTY_HELPER = String.raw`import errno
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import struct
import sys
import termios


def resize(fd, cols, rows):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def exit_code(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def main():
    shell = sys.argv[1]
    args = json.loads(sys.argv[2])
    cwd = sys.argv[3]
    cols = int(sys.argv[4])
    rows = int(sys.argv[5])
    if (os.path.isabs(shell) and not os.access(shell, os.X_OK)) or (not os.path.isabs(shell) and shutil.which(shell) is None):
        print(f"Shell executable '{shell}' could not be found or is not executable.", file=sys.stderr, flush=True)
        return 1
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe(shell, [shell] + args, os.environ)

    def terminate(signum, _frame):
        try:
            os.killpg(pid, signum)
        except ProcessLookupError:
            pass
        sys.exit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGHUP, terminate)
    resize(fd, cols, rows)
    input_buffer = b""
    stdin_open = True
    os.set_blocking(fd, False)
    os.set_blocking(sys.stdin.fileno(), False)
    while True:
        try:
            waited_pid, status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == pid:
                break
        except ChildProcessError:
            break

        readers = [fd]
        if stdin_open:
            readers.append(sys.stdin)
        ready, _, _ = select.select(readers, [], [], 0.05)
        if fd in ready:
            try:
                data = os.read(fd, 65536)
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EBADF):
                    raise
        if sys.stdin in ready:
            try:
                data = os.read(sys.stdin.fileno(), 65536)
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    data = None
                else:
                    stdin_open = False
                    data = None
            if data == b"":
                stdin_open = False
                try:
                    os.killpg(pid, 15)
                except ProcessLookupError:
                    pass
            elif data is not None:
                input_buffer += data
            while input_buffer:
                frame_type = input_buffer[:1]
                if frame_type == b"I":
                    if len(input_buffer) < 5:
                        break
                    length = struct.unpack("!I", input_buffer[1:5])[0]
                    if len(input_buffer) < 5 + length:
                        break
                    os.write(fd, input_buffer[5:5 + length])
                    input_buffer = input_buffer[5 + length:]
                elif frame_type == b"R":
                    if len(input_buffer) < 9:
                        break
                    cols, rows = struct.unpack("!II", input_buffer[1:9])
                    resize(fd, cols, rows)
                    input_buffer = input_buffer[9:]
                else:
                    input_buffer = input_buffer[1:]

    while True:
        try:
            data = os.read(fd, 65536)
            if not data:
                break
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except OSError as error:
            if error.errno in (errno.EIO, errno.EBADF):
                break
            raise
    os.close(fd)
    return exit_code(status)


if __name__ == "__main__":
    sys.exit(main())
`;

class NodePtyBackend implements TerminalBackend {
  readonly name = "Native node-pty";
  readonly isPty = true;

  constructor(private readonly process: NodePtyProcess) {}

  get pid(): number {
    return this.process.pid;
  }

  onData(listener: (data: string) => void): BackendDisposable {
    return this.process.onData(listener);
  }

  onExit(listener: (event: BackendExitEvent) => void): BackendDisposable {
    return this.process.onExit((event) => listener({ exitCode: event.exitCode, signal: event.signal?.toString() }));
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(): void {
    try {
      this.process.kill();
    } catch {
      // The process may already have exited.
    }
  }

  dispose(): void {
    this.kill();
  }
}

class ChildProcessBackend implements TerminalBackend {
  readonly isPty: boolean;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: BackendExitEvent) => void>();
  private readonly stdoutDecoder = new TextDecoder("utf-8");
  private readonly stderrDecoder = new TextDecoder("utf-8");
  private readonly forwardStderr: boolean;
  private stderrDetail = "";
  private exited = false;

  constructor(
    protected readonly process: ChildProcessWithoutNullStreams,
    readonly name: string,
    isPty: boolean,
    forwardStderr = true,
  ) {
    this.isPty = isPty;
    this.forwardStderr = forwardStderr;
    this.process.stdout.on("data", (data: Buffer) => this.emitData(this.stdoutDecoder.decode(data, { stream: true })));
    this.process.stderr.on("data", (data: Buffer) => {
      const text = this.stderrDecoder.decode(data, { stream: true });
      if (this.forwardStderr) {
        this.emitData(text);
      } else {
        this.stderrDetail += text;
      }
    });
    this.process.on("error", (error) => {
      const detail = `${this.name} error: ${error.message}`;
      if (this.forwardStderr) {
        this.emitData(`\r\n[${detail}]\r\n`);
      } else {
        this.stderrDetail += `${detail}\n`;
      }
    });
    this.process.on("exit", (code, signal) => {
      this.emitData(this.stdoutDecoder.decode());
      const trailingStderr = this.stderrDecoder.decode();
      if (this.forwardStderr) {
        this.emitData(trailingStderr);
      } else {
        this.stderrDetail += trailingStderr;
      }
      this.exited = true;
      const event = { exitCode: code ?? 1, signal: signal ?? undefined };
      for (const listener of this.exitListeners) {
        listener(event);
      }
    });
  }

  getErrorDetail(): string {
    return this.stderrDetail.trim();
  }

  get pid(): number {
    return this.process.pid ?? -1;
  }

  onData(listener: (data: string) => void): BackendDisposable {
    this.dataListeners.add(listener);
    return {
      dispose: () => this.dataListeners.delete(listener),
    };
  }

  onExit(listener: (event: BackendExitEvent) => void): BackendDisposable {
    this.exitListeners.add(listener);
    return {
      dispose: () => this.exitListeners.delete(listener),
    };
  }

  write(data: string): void {
    if (!this.exited && !this.process.stdin.destroyed) {
      this.process.stdin.write(data);
    }
  }

  resize(_cols: number, _rows: number): void {
    // Pipe processes do not have a terminal window to resize.
  }

  kill(): void {
    if (this.exited) {
      return;
    }
    try {
      this.process.kill();
    } catch {
      // The process may already have exited.
    }
  }

  dispose(): void {
    this.dataListeners.clear();
    this.exitListeners.clear();
    this.process.stdout.removeAllListeners("data");
    this.process.stderr.removeAllListeners("data");
    this.process.removeAllListeners("error");
    this.process.removeAllListeners("exit");
    this.kill();
  }

  protected emitData(data: string): void {
    if (!data) {
      return;
    }
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }
}

class PythonPtyBackend extends ChildProcessBackend {
  constructor(process: ChildProcessWithoutNullStreams) {
    super(process, "Python PTY", true, false);
  }

  override write(data: string): void {
    const payload = Buffer.from(data, "utf8");
    const frame = Buffer.allocUnsafe(5 + payload.length);
    frame.write("I", 0, "ascii");
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);
    if (!this.process.stdin.destroyed) {
      this.process.stdin.write(frame);
    }
  }

  override resize(cols: number, rows: number): void {
    const frame = Buffer.allocUnsafe(9);
    frame.write("R", 0, "ascii");
    frame.writeUInt32BE(cols, 1);
    frame.writeUInt32BE(rows, 5);
    if (!this.process.stdin.destroyed) {
      this.process.stdin.write(frame);
    }
  }
}

function writePythonHelper(plugin: EmbeddedAiTerminalPlugin): string {
  const pluginDir = getPluginInstallDir(plugin);
  if (!pluginDir) {
    throw new Error("The plugin installation directory is unavailable.");
  }
  fs.mkdirSync(pluginDir, { recursive: true });
  const helperPath = nodePath.join(pluginDir, ".embedded-ai-terminal-pty.py");
  if (!fs.existsSync(helperPath) || fs.readFileSync(helperPath, "utf8") !== PYTHON_PTY_HELPER) {
    fs.writeFileSync(helperPath, PYTHON_PTY_HELPER, "utf8");
  }
  return helperPath;
}

let cachedPythonInterpreter: string | null | undefined;

function findPythonInterpreter(): string {
  if (cachedPythonInterpreter === null) {
    throw new Error("No Python interpreter with the pty module was found.");
  }
  if (cachedPythonInterpreter) {
    return cachedPythonInterpreter;
  }

  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(candidate, ["-c", "import pty"], { stdio: "ignore" });
    if (result.status === 0) {
      cachedPythonInterpreter = candidate;
      return cachedPythonInterpreter;
    }
  }
  cachedPythonInterpreter = null;
  throw new Error("No Python interpreter with the pty module was found.");
}

function commandName(command: string): string {
  try {
    return parseArgs(command)[0] ?? "";
  } catch {
    return "";
  }
}

function commandAvailableAsync(plugin: EmbeddedAiTerminalPlugin, command: string): Promise<boolean> {
  const name = commandName(command);
  if (!name) {
    return Promise.resolve(false);
  }
  if (process.platform === "win32") {
    return spawnStatus("where.exe", [name]);
  }
  const shellArgs = parseArgs(plugin.settings.shellArgs);
  const quotedName = `'${name.replace(/'/g, "'\\''")}'`;
  return spawnStatus(plugin.settings.shellPath, [...shellArgs, "-c", `command -v ${quotedName}`], {
    cwd: plugin.settings.defaultCwd || process.cwd(),
  });
}

function spawnStatus(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { ...options, stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

let cachedPythonReadiness: boolean | undefined;

async function probePythonAvailable(): Promise<boolean> {
  if (cachedPythonReadiness !== undefined) {
    return cachedPythonReadiness;
  }
  const available = (await Promise.all(
    ["python3", "python"].map((candidate) => spawnStatus(candidate, ["-c", "import pty"])),
  )).some(Boolean);
  cachedPythonReadiness = available;
  return available;
}

export async function getBackendReadiness(
  plugin: EmbeddedAiTerminalPlugin,
  backend?: Pick<TerminalBackend, "name" | "isPty">,
): Promise<BackendReadiness> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  let nativeAvailable = false;
  try {
    loadNodePty(plugin);
    nativeAvailable = true;
  } catch {
    // Runtime probing is intentionally best effort.
  }

  let pythonAvailable = false;
  if (process.platform !== "win32") {
    pythonAvailable = await probePythonAvailable();
  }

  const [claude, codex, opencode] = await Promise.all([
    commandAvailableAsync(plugin, plugin.settings.commands.claude),
    commandAvailableAsync(plugin, plugin.settings.commands.codex),
    commandAvailableAsync(plugin, plugin.settings.commands.opencode),
  ]);
  return {
    nativeAvailable,
    pythonAvailable,
    selectedBackend: backend?.name,
    selectedIsPty: backend?.isPty,
    commands: {
      claude,
      codex,
      opencode,
    },
  };
}

function spawnPythonBackend(plugin: EmbeddedAiTerminalPlugin, cwd: string): TerminalBackend {
  if (process.platform === "win32") {
    throw new Error("Python PTY is only available on POSIX platforms.");
  }
  const interpreter = findPythonInterpreter();
  const helperPath = writePythonHelper(plugin);
  const child = spawn(
    interpreter,
    ["-u", helperPath, plugin.settings.shellPath, JSON.stringify(parseArgs(plugin.settings.shellArgs)), cwd, "80", "24"],
    {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return new PythonPtyBackend(child);
}

function spawnPipeBackend(plugin: EmbeddedAiTerminalPlugin, cwd: string): TerminalBackend {
  const child = spawn(plugin.settings.shellPath, parseArgs(plugin.settings.shellArgs), {
    cwd,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new ChildProcessBackend(child, "Pipe mode (no PTY)", false);
}

function spawnNodePtyBackend(plugin: EmbeddedAiTerminalPlugin, cwd: string): TerminalBackend {
  const nodePty = loadNodePty(plugin);
  const ptyProcess = nodePty.spawn(plugin.settings.shellPath, parseArgs(plugin.settings.shellArgs), {
    cols: 80,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
    name: "xterm-256color",
    rows: 24,
    ...(process.platform === "win32"
      ? {
          // Obsidian's renderer can reject worker_threads-backed ConPTY.
          // Force winpty on Windows to avoid startup failure inside Electron.
          useConpty: false,
        }
      : {}),
  }) as NodePtyProcess;
  return new NodePtyBackend(ptyProcess);
}

export function createTerminalBackend(plugin: EmbeddedAiTerminalPlugin, preference: BackendPreference, cwd: string): TerminalBackend {
  const candidates: Array<[string, () => TerminalBackend]> =
    preference === "node-pty"
      ? [["Native node-pty", () => spawnNodePtyBackend(plugin, cwd)]]
      : preference === "python"
        ? [["Python PTY", () => spawnPythonBackend(plugin, cwd)]]
        : preference === "pipe"
          ? [["Pipe mode (no PTY)", () => spawnPipeBackend(plugin, cwd)]]
          : [
              ["Native node-pty", () => spawnNodePtyBackend(plugin, cwd)],
              ["Python PTY", () => spawnPythonBackend(plugin, cwd)],
              ["Pipe mode (no PTY)", () => spawnPipeBackend(plugin, cwd)],
            ];

  const failures: string[] = [];
  for (const [name, create] of candidates) {
    try {
      return create();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to start a terminal backend. ${failures.join(" | ")}`);
}
