import { accessSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface DeploymentPreflightOptions {
  commitSha: string;
  verifyPassed: boolean;
  dockerAvailable: boolean;
  bundlePath: string;
  exportDir: string;
  envExamplePath: string;
}

export interface DeploymentPreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity?: "error" | "warning";
}

export interface DeploymentPreflightReport {
  passed: boolean;
  checks: DeploymentPreflightCheck[];
}

interface CloudBaseBundleSummary {
  templates: number;
  codes: number;
}

interface CloudBaseBundleLike {
  schema_version?: unknown;
  summary?: Partial<CloudBaseBundleSummary>;
}

interface CloudBaseExportCollectionLike {
  name?: unknown;
  file?: unknown;
  count?: unknown;
  sha256?: unknown;
}

interface CloudBaseExportManifestLike {
  schema_version?: unknown;
  collections?: unknown;
}

export function runDeploymentPreflight(options: DeploymentPreflightOptions): DeploymentPreflightReport {
  const checks: DeploymentPreflightCheck[] = [];

  checks.push(validateCommitSha(options.commitSha));
  checks.push(validateVerifyPassed(options.verifyPassed));
  checks.push(validateBundle(options.bundlePath));

  const manifestCheck = validateExportManifest(options.exportDir);
  checks.push(manifestCheck.check);
  if (manifestCheck.manifest) {
    checks.push(...validateExportCollectionFiles(options.exportDir, manifestCheck.manifest));
  }

  checks.push(validateEnvExample(options.envExamplePath));
  checks.push(validateDocker(options.dockerAvailable));

  return {
    passed: checks.every((check) => check.passed || check.severity === "warning"),
    checks,
  };
}

function validateCommitSha(commitSha: string): DeploymentPreflightCheck {
  if (/^[0-9a-f]{40}$/u.test(commitSha)) {
    return { name: "git_commit_sha", passed: true, detail: commitSha };
  }
  return {
    name: "git_commit_sha",
    passed: false,
    detail: "expected a 40-character lowercase git commit SHA",
    severity: "error",
  };
}

function validateVerifyPassed(verifyPassed: boolean): DeploymentPreflightCheck {
  if (verifyPassed) {
    return { name: "pnpm_verify", passed: true, detail: "pnpm verify passed before deployment preflight" };
  }
  return {
    name: "pnpm_verify",
    passed: false,
    detail: "pnpm verify has not passed for this deployment candidate",
    severity: "error",
  };
}

function validateBundle(bundlePath: string): DeploymentPreflightCheck {
  try {
    const bundle = readJsonFile<CloudBaseBundleLike>(bundlePath);
    if (bundle.schema_version !== "cloudbase-import-bundle/v1") {
      throw new Error("schema_version is not cloudbase-import-bundle/v1");
    }
    const templates = bundle.summary?.templates;
    const codes = bundle.summary?.codes;
    if (!Number.isInteger(templates) || !Number.isInteger(codes)) {
      throw new Error("summary.templates and summary.codes must be integers");
    }
    return {
      name: "cloudbase_import_bundle",
      passed: true,
      detail: `bundle ready: templates=${templates}, codes=${codes}`,
    };
  } catch (error) {
    return {
      name: "cloudbase_import_bundle",
      passed: false,
      detail: readableError(error),
      severity: "error",
    };
  }
}

function validateExportManifest(exportDir: string): { check: DeploymentPreflightCheck; manifest?: CloudBaseExportManifestLike } {
  try {
    const manifest = readJsonFile<CloudBaseExportManifestLike>(join(exportDir, "manifest.json"));
    if (manifest.schema_version !== "cloudbase-import-export/v1") {
      throw new Error("schema_version is not cloudbase-import-export/v1");
    }
    if (!Array.isArray(manifest.collections)) {
      throw new Error("collections must be an array");
    }
    for (const collection of manifest.collections) {
      validateCollectionEntry(collection);
    }
    return {
      check: {
        name: "cloudbase_export_manifest",
        passed: true,
        detail: `manifest ready: collections=${manifest.collections.length}`,
      },
      manifest,
    };
  } catch (error) {
    return {
      check: {
        name: "cloudbase_export_manifest",
        passed: false,
        detail: readableError(error),
        severity: "error",
      },
    };
  }
}

function validateExportCollectionFiles(
  exportDir: string,
  manifest: CloudBaseExportManifestLike,
): DeploymentPreflightCheck[] {
  const collections = manifest.collections as CloudBaseExportCollectionLike[];
  return collections.map((collection) => {
    const file = String(collection.file);
    try {
      accessSync(join(exportDir, file));
      return {
        name: `cloudbase_export_file_${String(collection.name)}`,
        passed: true,
        detail: file,
      };
    } catch (error) {
      return {
        name: `cloudbase_export_file_${String(collection.name)}`,
        passed: false,
        detail: readableError(error),
        severity: "error",
      };
    }
  });
}

function validateEnvExample(envExamplePath: string): DeploymentPreflightCheck {
  try {
    const content = readFileSync(envExamplePath, "utf8");
    const requiredNames = [
      "DEVICE_SECRET_PEPPER",
      "CODE_SECRET_PEPPER",
      "RECOVERY_SECRET_PEPPER",
      "COS_SECRET_ID",
      "COS_SECRET_KEY",
      "COS_BUCKET",
      "COS_REGION",
      "COS_OBJECT_PREFIX",
    ];
    const missing = requiredNames.filter((name) => !content.includes(`${name}=`));
    if (missing.length > 0) {
      throw new Error(`missing env example keys: ${missing.join(", ")}`);
    }
    return { name: "env_example", passed: true, detail: envExamplePath };
  } catch (error) {
    return {
      name: "env_example",
      passed: false,
      detail: readableError(error),
      severity: "error",
    };
  }
}

function validateDocker(dockerAvailable: boolean): DeploymentPreflightCheck {
  if (dockerAvailable) {
    return { name: "docker_available", passed: true, detail: "docker is available for local image verification" };
  }
  return {
    name: "docker_available",
    passed: false,
    detail: "docker not installed; image build not verified locally",
    severity: "warning",
  };
}

function validateCollectionEntry(collection: unknown): asserts collection is CloudBaseExportCollectionLike {
  if (!isRecord(collection)) {
    throw new Error("collection entry must be an object");
  }
  if (collection.name !== "templates" && collection.name !== "codes") {
    throw new Error("collection name must be templates or codes");
  }
  if (typeof collection.file !== "string" || !collection.file.endsWith(".json")) {
    throw new Error(`collection ${String(collection.name)} file must be a JSON filename`);
  }
  if (!Number.isInteger(collection.count) || Number(collection.count) < 0) {
    throw new Error(`collection ${String(collection.name)} count must be a non-negative integer`);
  }
  if (typeof collection.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(collection.sha256)) {
    throw new Error(`collection ${String(collection.name)} sha256 must be 64 lowercase hex characters`);
  }
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: readonly string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${raw}`);
    }
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function requireArg(args: Record<string, string | boolean>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function detectDockerAvailable(): boolean {
  const result = spawnSync("docker", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = runDeploymentPreflight({
      commitSha: requireArg(args, "commit-sha"),
      verifyPassed: args["verify-passed"] === "true" || args["verify-passed"] === true,
      dockerAvailable: args["docker-available"] === undefined ? detectDockerAvailable() : args["docker-available"] === "true",
      bundlePath: requireArg(args, "bundle"),
      exportDir: requireArg(args, "export-dir"),
      envExamplePath: String(args["env-example"] ?? ".env.example"),
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(readableError(error));
    process.exitCode = 1;
  }
}
