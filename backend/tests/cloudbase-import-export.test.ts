import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { CloudBaseImportBundle } from "../../scripts/cloudbase-import-bundle.js";
import { exportCloudBaseImportCollections } from "../../scripts/cloudbase-import-export.js";

describe("exportCloudBaseImportCollections", () => {
  test("writes per-collection JSON files plus a manifest with counts and sha256", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cloudbase-export-"));
    try {
      const result = exportCloudBaseImportCollections({
        bundle: makeBundle(),
        outDir,
      });

      expect(result).toEqual({
        out_dir: outDir,
        collections: [
          {
            name: "templates",
            file: "templates.json",
            count: 1,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          {
            name: "codes",
            file: "codes.json",
            count: 0,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
        manifest_file: "manifest.json",
      });
      expect(JSON.parse(readFileSync(join(outDir, "templates.json"), "utf8"))).toEqual([
        { _id: "tpl_alpha", public_id: "tpl_alpha", display_name: "变更表" },
      ]);
      expect(JSON.parse(readFileSync(join(outDir, "codes.json"), "utf8"))).toEqual([]);
      expect(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"))).toEqual({
        schema_version: "cloudbase-import-export/v1",
        source_schema_version: "cloudbase-import-bundle/v1",
        generated_at: "2026-09-13T04:00:00.000Z",
        collections: result.collections,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

function makeBundle(): CloudBaseImportBundle {
  return {
    schema_version: "cloudbase-import-bundle/v1",
    generated_at: "2026-09-13T04:00:00.000Z",
    collections: {
      templates: {
        count: 1,
        items: [{ _id: "tpl_alpha", public_id: "tpl_alpha", display_name: "变更表" }],
      },
      codes: {
        count: 0,
        items: [],
      },
    },
    summary: {
      templates: 1,
      codes: 0,
    },
  };
}
