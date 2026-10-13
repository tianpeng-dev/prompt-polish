import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin")
  throw new Error("macOS 安装包需要在 macOS 构建。");
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const workingRoot = path.join(root, ".work");
await mkdir(workingRoot, { recursive: true });
const working = await mkdtemp(path.join(workingRoot, "mac-package-"));
const image = path.join(working, "build.sparseimage");
const volume = path.join(working, "volume");
const temporary = path.join(working, "temporary");
await mkdir(volume);
await mkdir(temporary);
let attached = false;
let operationError;

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...globalThis.process.env, TMPDIR: temporary },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} 执行失败：${signal ?? code}`)),
    );
  });
}

try {
  await run("hdiutil", [
    "create",
    "-size",
    "2g",
    "-type",
    "SPARSE",
    "-fs",
    "APFS",
    "-volname",
    "PromptPolishBuild",
    image,
  ]);
  await run("hdiutil", ["attach", image, "-mountpoint", volume, "-nobrowse"]);
  attached = true;
  const output = path.join(volume, "release");
  await run(path.join(root, "node_modules", ".bin", "electron-builder"), [
    "--mac",
    "zip",
    "--arm64",
    "--publish",
    "never",
    `--config.directories.output=${output}`,
  ]);
  const application = path.join(output, "mac-arm64", "精炼台.app");
  const artifactName = `JingLianTai-${version}-mac-arm64.zip`;
  const artifact = path.join(output, artifactName);
  await run("bash", [
    path.join(root, "scripts", "verify-mac-distribution.sh"),
    application,
    artifact,
    volume,
  ]);
  await mkdir(path.join(root, "release"), { recursive: true });
  const stagedArtifact = path.join(root, "release", `.${artifactName}.staging`);
  await copyFile(artifact, stagedArtifact);
  await copyFile(
    `${artifact}.blockmap`,
    path.join(root, "release", `${artifactName}.blockmap`),
  );
  await run("bash", [
    path.join(root, "scripts", "verify-mac-distribution.sh"),
    application,
    stagedArtifact,
    volume,
  ]);
  await rename(stagedArtifact, path.join(root, "release", artifactName));
  console.log(`macOS 安装包：release/${artifactName}`);
} catch (error) {
  operationError = error;
}
try {
  if (attached) await run("hdiutil", ["detach", volume]);
  await rm(working, { recursive: true, force: true });
} catch (error) {
  if (operationError)
    throw new AggregateError(
      [operationError, error],
      "macOS 构建与资源清理失败。",
    );
  throw error;
}
if (operationError) throw operationError;
