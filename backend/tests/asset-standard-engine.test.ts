import { describe, expect, test } from "vitest";

import { AssetStandardEngine } from "../src/domain/asset-standard-engine.js";

const ASSETS = [
  {
    public_id: "tpl_risk_standard",
    display_name: "项目风险登记表（标准版）",
    canonical_title: "项目风险登记表",
    intent: "risk_register",
    intent_name: "风险登记",
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
    object_tags: ["风险"],
    access_tier: "paid",
  },
  {
    public_id: "tpl_risk_advanced",
    display_name: "项目风险登记表（进阶版）",
    canonical_title: "项目风险登记表",
    intent: "risk_register",
    intent_name: "风险登记",
    industry: "通用项目管理",
    project_phase: "执行",
    roles: ["项目经理", "风险责任人", "复核人"],
    purpose: "评估、应对并复核项目风险",
    output: "风险台账",
    field_names: ["风险事项", "概率", "影响", "责任人", "应对措施", "复核结论"],
    variant: "advanced",
    variant_label: "进阶版",
    regulated: false,
    compliance_review: "启用前确认",
    object_tags: ["风险", "复核"],
    access_tier: "free",
  },
] as const;

describe("AssetStandardEngine", () => {
  test("distills a versioned deterministic standard without carrying the legacy access tier", () => {
    const engine = AssetStandardEngine.fromAssets(ASSETS, "1.0.0");

    const snapshot = engine.snapshot();
    const standard = snapshot.standards[0];

    expect(snapshot).toMatchObject({
      schema_version: "office-asset-standards/v1",
      version: "1.0.0",
      source_asset_count: 2,
    });
    expect(standard).toMatchObject({
      standard_id: "risk_register::通用项目管理",
      intent: "risk_register",
      industry: "通用项目管理",
      required_fields: ["风险事项", "概率", "影响", "责任人"],
      recommended_fields: ["风险事项", "复核结论", "概率", "应对措施", "影响", "责任人"],
      roles: ["风险责任人", "复核人", "项目经理"],
      variants: ["advanced", "standard"],
      source_asset_count: 2,
    });
    expect(JSON.stringify(snapshot)).not.toContain("access_tier");
    expect(AssetStandardEngine.fromAssets([...ASSETS].reverse(), "1.0.0").snapshot()).toEqual(snapshot);
  });

  test("finds an industry standard by intent and fails closed for an unknown standard", () => {
    const engine = AssetStandardEngine.fromAssets(ASSETS, "1.0.0");

    expect(engine.find("risk_register", "通用项目管理")?.standard_id).toBe(
      "risk_register::通用项目管理",
    );
    expect(engine.find("unknown", "通用项目管理")).toBeNull();
  });

  test("rejects duplicate public asset IDs", () => {
    expect(() => AssetStandardEngine.fromAssets([ASSETS[0], ASSETS[0]], "1.0.0")).toThrow(
      "duplicate public asset id",
    );
  });
});
