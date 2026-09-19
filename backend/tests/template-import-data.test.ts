import { describe, expect, test } from "vitest";

import { buildTemplateImportData } from "../../scripts/template-import-data.js";
import type { PublicCatalogForUpload, CosUploadManifest } from "../../scripts/cos-upload-manifest.js";

describe("buildTemplateImportData", () => {
  test("joins public catalog metadata with private COS object delivery fields", () => {
    const result = buildTemplateImportData({
      catalog: makeCatalog(),
      uploadManifest: makeUploadManifest(),
    });

    expect(result).toEqual({
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
        asset_scope: "public",
        quality_tier: "product_pass",
        rights_status: "PASS_INDEPENDENT_REBUILD",
        object_tags: [],
        object_key: "templates/tpl_alpha.xlsx",
        object_size: 10,
        object_sha256: "a".repeat(64),
        status: "active",
      }],
    });
  });

  test("rejects catalog items without matching uploaded COS object metadata", () => {
    const uploadManifest = makeUploadManifest();
    uploadManifest.items = [];
    uploadManifest.count = 0;

    expect(() => buildTemplateImportData({
      catalog: makeCatalog(),
      uploadManifest,
    })).toThrow("Missing upload manifest item for public_id tpl_alpha");
  });
});

function makeCatalog(): PublicCatalogForUpload {
  return {
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
    } as PublicCatalogForUpload["items"][number]],
  };
}

function makeUploadManifest(): CosUploadManifest {
  return {
    schema_version: "cos-upload-manifest/v1",
    source_schema_version: "3.2.0",
    source_base_dir: "/private/assets",
    object_prefix: "templates/",
    count: 1,
    total_size_bytes: 10,
    items: [{
      product_id: "PMF-0001",
      public_id: "tpl_alpha",
      display_name: "变更表",
      access_tier: "free",
      source_rel_path: "01-general/PMF-0001-变更表.xlsx",
      source_size: 10,
      source_sha256: "a".repeat(64),
      object_key: "templates/tpl_alpha.xlsx",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }],
  };
}
