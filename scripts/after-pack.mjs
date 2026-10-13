import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const directory = await realpath(context.appOutDir);
  const application = path.join(
    directory,
    `${context.packager.appInfo.productFilename}.app`,
  );
  if (
    !path.basename(application).endsWith(".app") ||
    !(await stat(application)).isDirectory()
  )
    throw new Error("macOS 构建应用路径无效。");
  // 签名前移除构建应用的文件元数据，避免 Finder 信息进入签名资源。
  await execute("xattr", ["-cr", application]);
}
