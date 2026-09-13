import { describe, expect, test } from "vitest";

import { readRuntimeConfigFromEnv } from "../src/runtime-config.js";

describe("readRuntimeConfigFromEnv", () => {
  test("requires all pepper secrets", () => {
    expect(() => readRuntimeConfigFromEnv({})).toThrow("Missing required environment variable: DEVICE_SECRET_PEPPER");
  });

  test("allows local development without COS when no COS variables are set", () => {
    expect(readRuntimeConfigFromEnv({
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
    })).toEqual({
      host: "127.0.0.1",
      port: 8787,
      app: {
        devicePepper: "device-pepper",
        codePepper: "code-pepper",
        recoveryPepper: "recovery-pepper",
      },
    });
  });

  test("fails closed when only part of the COS configuration is present", () => {
    expect(() => readRuntimeConfigFromEnv({
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      COS_SECRET_ID: "secret-id",
      COS_BUCKET: "bucket-123",
      COS_REGION: "ap-guangzhou",
    })).toThrow("Incomplete COS configuration: missing COS_SECRET_KEY");
  });

  test("reads complete COS options with normalized numeric port and expiration", () => {
    expect(readRuntimeConfigFromEnv({
      HOST: "0.0.0.0",
      PORT: "8080",
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      COS_SECRET_ID: "secret-id",
      COS_SECRET_KEY: "secret-key",
      COS_BUCKET: "bucket-123",
      COS_REGION: "ap-guangzhou",
      COS_OBJECT_PREFIX: "templates/",
      COS_SIGN_EXPIRES_SECONDS: "600",
    })).toEqual({
      host: "0.0.0.0",
      port: 8080,
      app: {
        devicePepper: "device-pepper",
        codePepper: "code-pepper",
        recoveryPepper: "recovery-pepper",
        cos: {
          secretId: "secret-id",
          secretKey: "secret-key",
          bucket: "bucket-123",
          region: "ap-guangzhou",
          objectPrefix: "templates/",
          expiresSeconds: 600,
        },
      },
    });
  });

  test("reads PostgreSQL runtime options and rejects mixed database providers", () => {
    expect(readRuntimeConfigFromEnv({
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      POSTGRES_URL: "postgres://user:pass@example.test:5432/app",
      POSTGRES_SSL: "require",
    }).app.postgres).toEqual({
      connectionString: "postgres://user:pass@example.test:5432/app",
      ssl: true,
    });

    expect(() => readRuntimeConfigFromEnv({
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      CLOUDBASE_ENV_ID: "office-templates-dev",
      POSTGRES_URL: "postgres://user:pass@example.test:5432/app",
    })).toThrow("Configure either POSTGRES_URL or CLOUDBASE_ENV_ID, not both");
  });

  test("rejects invalid numeric deployment values", () => {
    expect(() => readRuntimeConfigFromEnv({
      PORT: "not-a-port",
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
    })).toThrow("PORT must be an integer between 1 and 65535");

    expect(() => readRuntimeConfigFromEnv({
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      COS_SECRET_ID: "secret-id",
      COS_SECRET_KEY: "secret-key",
      COS_BUCKET: "bucket-123",
      COS_REGION: "ap-guangzhou",
      COS_SIGN_EXPIRES_SECONDS: "0",
    })).toThrow("COS_SIGN_EXPIRES_SECONDS must be an integer between 1 and 604800");
  });
});
