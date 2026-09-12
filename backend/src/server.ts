import { createRuntimeApp } from "./runtime-app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const cos = readCosConfig();
const app = await createRuntimeApp({
  devicePepper: requiredEnv("DEVICE_SECRET_PEPPER"),
  codePepper: requiredEnv("CODE_SECRET_PEPPER"),
  recoveryPepper: requiredEnv("RECOVERY_SECRET_PEPPER"),
  ...(cos === undefined ? {} : { cos }),
});

await app.listen({ host, port });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readCosConfig() {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const bucket = process.env.COS_BUCKET;
  const region = process.env.COS_REGION;
  if (!secretId || !secretKey || !bucket || !region) {
    return undefined;
  }
  return {
    secretId,
    secretKey,
    bucket,
    region,
    objectPrefix: process.env.COS_OBJECT_PREFIX ?? "templates/",
    expiresSeconds: Number(process.env.COS_SIGN_EXPIRES_SECONDS ?? 300),
  };
}
