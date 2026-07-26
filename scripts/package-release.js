const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const platform = process.platform;
const arch = process.arch;
const bundleName = `embedded-ai-terminal-${platform}-${arch}`;
const stageDir = path.join(releaseDir, bundleName);
const zipPath = path.join(releaseDir, `${bundleName}.zip`);
const pluginFiles = ["manifest.json", "main.js", "styles.css"];

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyRuntimeTree(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) {
      copyRuntimeTree(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  if (source.endsWith(".map") || source.endsWith(".pdb") || /\.test\.js$/.test(source)) {
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyNodePtyRuntime() {
  const nodePtyDir = path.join(root, "node_modules", "node-pty");
  const destination = path.join(stageDir, "node_modules", "node-pty");
  if (!fs.existsSync(nodePtyDir)) {
    throw new Error("Unable to package release: install dependencies before packaging.");
  }

  copyRuntimeTree(path.join(nodePtyDir, "lib"), path.join(destination, "lib"));
  copyRecursive(path.join(nodePtyDir, "package.json"), path.join(destination, "package.json"));

  const buildNativeDir = path.join(nodePtyDir, "build", "Release");
  const prebuildDir = path.join(nodePtyDir, "prebuilds", `${platform}-${arch}`);
  const nativeDir = fs.existsSync(path.join(buildNativeDir, "pty.node")) ? buildNativeDir : prebuildDir;
  if (!fs.existsSync(nativeDir)) {
    throw new Error(`Unable to package release: no node-pty binary found for ${platform}-${arch}.`);
  }

  const relativeNativeDir = nativeDir === buildNativeDir
    ? path.join("build", "Release")
    : path.join("prebuilds", `${platform}-${arch}`);
  copyRuntimeTree(nativeDir, path.join(destination, relativeNativeDir));
}

removeIfExists(stageDir);
removeIfExists(zipPath);
fs.mkdirSync(stageDir, { recursive: true });

for (const relativePath of pluginFiles) {
  copyRecursive(path.join(root, relativePath), path.join(stageDir, relativePath));
}
copyNodePtyRuntime();

try {
  if (platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-Command", `Compress-Archive -Path .\\${bundleName} -DestinationPath .\\${path.basename(zipPath)} -Force`],
      { cwd: releaseDir, stdio: "inherit" },
    );
  } else {
    execFileSync("zip", ["-qr", zipPath, bundleName], { cwd: releaseDir, stdio: "inherit" });
  }
} catch (error) {
  throw new Error(
    `Unable to create release archive. Install the ${platform === "win32" ? "PowerShell Compress-Archive support" : "zip command"} and try again. ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

console.log(`Created ${zipPath}`);
