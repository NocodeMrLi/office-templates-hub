import type { RuntimeAppOptions } from "./runtime-app.js";

export interface RuntimeServerConfig {
  host: string;
  port: number;
  app: RuntimeAppOptions;
}

type Env = Record<string, string | undefined>;

const COS_ENV_KEYS = [
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION",
] as const;

export function readRuntimeConfigFromEnv(env: Env): RuntimeServerConfig {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: readInteger(env.PORT, "PORT", 8787, 1, 65_535),
    app: {
      devicePepper: requiredEnv(env, "DEVICE_SECRET_PEPPER"),
      codePepper: requiredEnv(env, "CODE_SECRET_PEPPER"),
      recoveryPepper: requiredEnv(env, "RECOVERY_SECRET_PEPPER"),
      ...readCosConfig(env),
    },
  };
}

function requiredEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readCosConfig(env: Env): Pick<RuntimeAppOptions, "cos"> | Record<string, never> {
  const present = COS_ENV_KEYS.filter((key) => Boolean(env[key]));
  if (present.length === 0) {
    return {};
  }
  if (present.length !== COS_ENV_KEYS.length) {
    const missing = COS_ENV_KEYS.filter((key) => !env[key]);
    throw new Error(`Incomplete COS configuration: missing ${missing.join(", ")}`);
  }

  return {
    cos: {
      secretId: requiredEnv(env, "COS_SECRET_ID"),
      secretKey: requiredEnv(env, "COS_SECRET_KEY"),
      bucket: requiredEnv(env, "COS_BUCKET"),
      region: requiredEnv(env, "COS_REGION"),
      objectPrefix: env.COS_OBJECT_PREFIX ?? "templates/",
      expiresSeconds: readInteger(env.COS_SIGN_EXPIRES_SECONDS, "COS_SIGN_EXPIRES_SECONDS", 300, 1, 604_800),
    },
  };
}

function readInteger(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
