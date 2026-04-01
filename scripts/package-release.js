const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const stageDir = path.join(releaseDir, "embedded-ai-terminal");
const zipPath = path.join(releaseDir, "embedded-ai-terminal.zip");

const filesToCopy = [
  "manifest.json",
  "main.js",
  "styles.css",
  "versions.json",
  "LICENSE",
  "README.md",
];

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

removeIfExists(stageDir);
removeIfExists(zipPath);
fs.mkdirSync(stageDir, { recursive: true });

for (const relativePath of filesToCopy) {
  copyRecursive(path.join(root, relativePath), path.join(stageDir, relativePath));
}

copyRecursive(path.join(root, "node_modules"), path.join(stageDir, "node_modules"));

execFileSync(
  "powershell.exe",
  [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "Compress-Archive -Path .\\embedded-ai-terminal -DestinationPath .\\embedded-ai-terminal.zip -Force",
  ],
  {
    cwd: releaseDir,
    stdio: "inherit",
  },
);

console.log(`Created ${zipPath}`);
