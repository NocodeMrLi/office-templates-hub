import { describe, expect, test } from "vitest";

import { OfficeSpreadsheetEngine } from "../src/domain/office-spreadsheet-engine.js";

const ASSETS = [
  {
    public_id: "tpl_risk_standard",
    display_name: "项目风险管理表",
    canonical_title: "项目风险管理表",
    intent: "risk_register",
    intent_name: "项目风险登记与应对表",
    industry: "通用项目管理",
    project_phase: "执行",
    roles: ["项目经理", "风险责任人"],
    purpose: "识别并跟踪项目风险",
    output: "风险台账",
    field_names: ["风险事项", "概率", "影响", "责任人"],
    variant: "standard",
    variant_label: "标准版",
    regulated: false,
    compliance_review: "启用前确认",
    object_tags: [],
    access_tier: "paid",
  },
  {
    public_id: "tpl_risk_construction",
    display_name: "工程风险登记表（进阶版）",
    canonical_title: "工程风险登记表",
    intent: "risk_register",
    intent_name: "项目风险登记与应对表",
    industry: "工程建设",
    project_phase: "执行",
    roles: ["项目经理", "施工负责人"],
    purpose: "识别并跟踪施工风险",
    output: "工程风险台账",
    field_names: ["风险事项", "施工阶段", "概率", "影响", "责任人"],
    variant: "advanced",
    variant_label: "进阶版",
    regulated: false,
    compliance_review: "启用前确认",
    object_tags: [],
    access_tier: "free",
  },
] as const;

describe("OfficeSpreadsheetEngine", () => {
  test("directly delivers an exact public asset without consulting the legacy tier", () => {
    const result = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0").resolve({
      query: "项目风险管理表",
    });

    expect(result).toMatchObject({
      decision: "direct_asset",
      asset: {
        public_id: "tpl_risk_standard",
        asset_scope: "public",
        availability: "public_free",
      },
      specification: null,
      quality: null,
    });
  });

  test("adapts the closest asset only when the industry and hard requirements are applicable", () => {
    const result = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0").resolve({
      query: "工程风险登记表，需要复核结论",
      industry: "工程建设",
      requiredFields: ["风险事项", "施工阶段", "复核结论"],
      roles: ["施工负责人"],
    });

    expect(result).toMatchObject({
      decision: "adapt_asset",
      asset: { public_id: "tpl_risk_construction" },
      specification: {
        source: { mode: "asset_adaptation", public_id: "tpl_risk_construction" },
      },
      quality: { passed: true, violations: [] },
    });
    expect(result.specification?.columns.map((column) => column.name)).toContain("复核结论");
  });

  test("generates from the shared standard when no existing asset safely covers the request", () => {
    const result = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0").resolve({
      query: "项目风险登记表",
      requiredFields: ["风险事项", "审批人", "审批结论", "关闭依据", "复核日期"],
    });

    expect(result).toMatchObject({
      decision: "generate_from_standard",
      standard: { standard_id: "risk_register::通用项目管理" },
      specification: { source: { mode: "standard_generation", standard_version: "1.0.0" } },
      quality: { passed: true, violations: [] },
    });
  });

  test("recognizes a natural-language request by meaningful Chinese phrase overlap", () => {
    const result = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0").resolve({
      query: "帮我做一份风险登记表",
    });

    expect(result.decision).toBe("adapt_asset");
    expect(result.standard?.standard_id).toBe("risk_register::通用项目管理");
  });

  test("clarifies an unsupported vague request instead of inventing a professional table", () => {
    const result = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0").resolve({ query: "帮我做个表" });

    expect(result).toMatchObject({
      decision: "clarify",
      specification: null,
      clarification: { question: expect.any(String) },
    });
  });

  test("returns a labelled draft only when requested and refuses unsupported regulated generation", () => {
    const engine = OfficeSpreadsheetEngine.fromAssets(ASSETS, "1.0.0");

    const draft = engine.resolve({ query: "帮我做个内部记录表", allowDraft: true });
    const refused = engine.resolve({ query: "生成法定医疗器械验收表", regulated: true });

    expect(draft).toMatchObject({
      decision: "draft",
      specification: { delivery_notes: expect.arrayContaining([expect.stringContaining("草案")]) },
    });
    expect(refused).toMatchObject({ decision: "refuse", specification: null });
  });
});
