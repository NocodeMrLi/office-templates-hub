import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { runDeploymentPreflight } from "../../scripts/deployment-preflight.js";

describe("runDeploymentPreflight", () => {
  test("passes when required local deployment artifacts are present and consistent", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-pass-"));
    try {
      writeFileSync(join(dir, "cloudbase-bundle.json"), JSON.stringify({
        schema_version: "cloudbase-import-bundle/v1",
        summary: { templates: 2, codes: 0 },
      }));
      const templatesJsonl = [
        JSON.stringify({ _id: "tpl_1", public_id: "tpl_1" }),
        JSON.stringify({ _id: "tpl_2", public_id: "tpl_2" }),
      ].join("\n") + "\n";
      const codesJsonl = "";
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({
        schema_version: "cloudbase-import-export/v1",
        collections: [
          {
            name: "templates",
            file: "templates.json",
            format: "json_lines",
            count: 2,
            sha256: createHash("sha256").update(templatesJsonl).digest("hex"),
          },
          {
            name: "codes",
            file: "codes.json",
            format: "json_lines",
            count: 0,
            sha256: createHash("sha256").update(codesJsonl).digest("hex"),
          },
        ],
      }));
      writeFileSync(join(dir, "templates.json"), templatesJsonl);
      writeFileSync(join(dir, "codes.json"), codesJsonl);

      const report = runDeploymentPreflight({
        commitSha: "c".repeat(40),
        verifyPassed: true,
        dockerAvailable: false,
        bundlePath: join(dir, "cloudbase-bundle.json"),
        exportDir: dir,
        envExamplePath: ".env.example",
      });

      expect(report.passed).toBe(true);
      expect(report.checks).toContainEqual({ name: "git_commit_sha", passed: true, detail: "c".repeat(40) });
      expect(report.checks).toContainEqual({ name: "docker_available", passed: false, detail: "docker not installed; image build not verified locally", severity: "warning" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails when required import artifacts are missing", () => {
    const report = runDeploymentPreflight({
      commitSha: "not-a-sha",
      verifyPassed: false,
      dockerAvailable: false,
      bundlePath: "/missing/bundle.json",
      exportDir: "/missing/export",
      envExamplePath: ".env.example",
    });

    expect(report.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed && check.severity === "error").map((check) => check.name)).toEqual([
      "git_commit_sha",
      "pnpm_verify",
      "cloudbase_import_bundle",
      "cloudbase_export_manifest",
    ]);
  });
});
