import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const external = process.env.TEST_BASE_URL;
let server;
let exitCode = 1;
try {
  if (!external) {
    const cli = fileURLToPath(
      new URL("../node_modules/vite/bin/vite.js", import.meta.url),
    );
    server = spawn(
      process.execPath,
      [cli, "--host", "127.0.0.1", "--port", "4175", "--strictPort"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    for (let n = 0; ; n++) {
      if (server.exitCode !== null)
        throw new Error("Test server failed to start");
      try {
        const res = await fetch("http://127.0.0.1:4175");
        if (res.ok) break;
      } catch {}
      if (n >= 80) throw new Error("Test server readiness timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const runner = spawn(process.execPath, ["--test", "tests/browser.test.js"], {
    stdio: "inherit",
    env: { ...process.env, TEST_BASE_URL: external || "http://127.0.0.1:4175" },
  });
  exitCode = await new Promise((resolve, reject) => {
    runner.on("error", reject);
    runner.on("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
} finally {
  server?.kill();
}
process.exitCode = exitCode;
