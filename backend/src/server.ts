import { createRuntimeApp } from "./runtime-app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const app = await createRuntimeApp({
  devicePepper: requiredEnv("DEVICE_SECRET_PEPPER"),
  codePepper: requiredEnv("CODE_SECRET_PEPPER"),
  recoveryPepper: requiredEnv("RECOVERY_SECRET_PEPPER"),
});

await app.listen({ host, port });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
