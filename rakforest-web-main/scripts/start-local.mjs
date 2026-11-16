import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function probeInstance(port, fingerprint, fetcher = fetch) {
  try {
    const response = await fetcher(
      `http://127.0.0.1:${port}/api/local-instance`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (response.ok) {
      const data = await response.json();
      if (data.app === "rakforest-web" && data.fingerprint === fingerprint)
        return "same";
    }
  } catch {}
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve("occupied"));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve("free")));
  });
}
function openBrowser(url) {
  if (process.platform === "win32")
    spawn("explorer.exe", [url], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
}
export async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fingerprint = createHash("sha256")
    .update(process.platform === "win32" ? root.toLowerCase() : root)
    .digest("hex");
  const state = await probeInstance(3000, fingerprint);
  if (state === "same") {
    console.log("RakForest is already running: http://127.0.0.1:3000/login");
    openBrowser("http://127.0.0.1:3000/login");
    return;
  }
  if (state === "occupied") {
    console.error(
      "Port 3000 belongs to another process or an older server. Close that server manually before starting RakForest. No process was stopped.",
    );
    process.exitCode = 1;
    return;
  }
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  child.on("error", () => {
    console.error("Cannot start RakForest.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
