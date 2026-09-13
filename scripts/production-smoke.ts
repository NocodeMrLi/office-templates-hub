import { spawn } from "node:child_process";

const port = String(18_000 + Math.floor(Math.random() * 20_000));
const url = `http://127.0.0.1:${port}/api/health`;
const child = spawn(process.execPath, ["dist/backend/src/server.js"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    DEVICE_SECRET_PEPPER: "production-smoke-device-pepper",
    CODE_SECRET_PEPPER: "production-smoke-code-pepper",
    RECOVERY_SECRET_PEPPER: "production-smoke-recovery-pepper",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const output: string[] = [];
child.stdout.on("data", (chunk) => output.push(String(chunk)));
child.stderr.on("data", (chunk) => output.push(String(chunk)));

try {
  const health = await waitForHealth(url);
  console.log(JSON.stringify({
    passed: true,
    url,
    health,
  }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function waitForHealth(healthUrl: string): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`production server exited early with code ${child.exitCode}: ${output.join("")}`);
    }
    try {
      const response = await fetch(healthUrl);
      const body = await response.json() as unknown;
      if (response.status === 200) {
        return body;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`production health check failed: ${lastError}; server output: ${output.join("")}`);
}
