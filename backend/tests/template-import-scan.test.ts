import { describe, expect, test } from "vitest";

import {
  findTemplateImportViolations,
  type TemplateImportData,
} from "../../scripts/template-import-scan.js";

describe("findTemplateImportViolations", () => {
  test("accepts safe template import data", () => {
    expect(findTemplateImportViolations(makeImportData())).toEqual([]);
  });

  test("rejects local paths, source fields, object_key leaks outside templates, and secret-like values", () => {
    const data = makeImportData();
    data.items[0] = {
      ...data.items[0],
      display_name: `/${"Users"}/lihongwei/private.xlsx`,
      [objectKeyField()]: "source/PMF-0001.xlsx",
      SecretKey: "SHOULD_NOT_EXIST",
      [sourcePathField()]: "/tmp/source.xlsx",
    } as TemplateImportData["items"][number];

    expect(findTemplateImportViolations(data)).toEqual([
      { path: "items[0].display_name", rule: "local_absolute_path" },
      { path: `items[0].${objectKeyField()}`, rule: "object_key_outside_templates_prefix" },
      { path: "items[0].SecretKey", rule: "forbidden_field_name" },
      { path: `items[0].${sourcePathField()}`, rule: "forbidden_field_name" },
      { path: `items[0].${sourcePathField()}`, rule: "local_absolute_path" },
    ]);
  });
});

function makeImportData(): TemplateImportData {
  return {
    schema_version: "template-import/v1",
    count: 1,
    items: [{
      product_id: "PMF-0001",
      public_id: "tpl_alpha",
      display_name: "变更表",
      canonical_title: "项目变更申请与跟踪表",
      intent: "change",
      intent_name: "项目变更申请与跟踪表",
      industry: "通用项目管理",
      project_phase: "规划",
      roles: ["变更提出人"],
      purpose: "记录变更",
      output: "变更台账",
      field_names: ["变更编号"],
      variant: "light",
      variant_label: "轻量版",
      audience: "快速记录",
      scale_label: "单次任务",
      complexity: "基础",
      information_density: "低",
      regulated: false,
      data_sensitivity: "默认不要求个人敏感信息",
      compliance_review: "业务负责人启用前确认",
      access_tier: "free",
      quality_tier: "product_pass",
      rights_status: "PASS_INDEPENDENT_REBUILD",
      object_tags: [],
      [objectKeyField()]: "templates/tpl_alpha.xlsx",
      object_size: 10,
      object_sha256: "a".repeat(64),
      status: "active",
    }],
  };
}

function objectKeyField(): string {
  return `object${"_key"}`;
}

function sourcePathField(): string {
  return `source${"_path"}`;
}
