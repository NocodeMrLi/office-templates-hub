import { describe, expect, test } from "vitest";

import { CatalogService } from "../src/domain/catalog-service.js";

const SOURCE = {
  count: 3,
  items: [
    {
      product_id: "PMF-0001",
      public_id: "tpl_alpha000000001",
      display_name: "项目风险登记表（标准版）",
      canonical_title: "项目风险登记表",
      intent: "risk_register",
      intent_name: "风险登记",
      industry: "通用项目管理",
      project_phase: "执行",
      roles: ["项目经理"],
      purpose: "记录风险",
      output: "风险台账",
      field_names: ["风险事项", "责任人"],
      variant: "standard",
      variant_label: "标准版",
      audience: "项目团队",
      scale_label: "单项目",
      complexity: "标准",
      information_density: "中",
      regulated: false,
      data_sensitivity: "一般",
      compliance_review: "启用前确认",
      access_tier: "free",
      quality_tier: "product_pass",
      rights_status: "PASS_INDEPENDENT_REBUILD",
      object_tags: [],
      asset_id: "must-not-leak",
      final_rel: "/private/path.xlsx",
    },
    {
      product_id: "PMF-0002",
      public_id: "tpl_beta0000000002",
      display_name: "工程风险登记表（进阶版）",
      canonical_title: "工程风险登记表",
      intent: "risk_register",
      intent_name: "风险登记",
      industry: "工程建设",
      project_phase: "执行",
      roles: ["项目经理"],
      purpose: "记录工程风险",
      output: "风险台账",
      field_names: ["风险事项", "概率", "影响"],
      variant: "advanced",
      variant_label: "进阶版",
      audience: "项目团队",
      scale_label: "单项目",
      complexity: "进阶",
      information_density: "高",
      regulated: false,
      data_sensitivity: "一般",
      compliance_review: "启用前确认",
      access_tier: "paid",
      quality_tier: "product_pass",
      rights_status: "PASS_INDEPENDENT_REBUILD",
      object_tags: [],
    },
    {
      product_id: "PMF-0003",
      public_id: "tpl_gamma000000003",
      display_name: "项目周报（标准版）",
      canonical_title: "项目周报",
      intent: "progress_report",
      intent_name: "进度报告",
      industry: "通用项目管理",
      project_phase: "监控",
      roles: ["项目经理"],
      purpose: "汇报进展",
      output: "项目周报",
      field_names: ["本周进展", "下周计划"],
      variant: "standard",
      variant_label: "标准版",
      audience: "项目团队",
      scale_label: "单项目",
      complexity: "标准",
      information_density: "中",
      regulated: false,
      data_sensitivity: "一般",
      compliance_review: "启用前确认",
      access_tier: "free",
      quality_tier: "product_pass",
      rights_status: "PASS_INDEPENDENT_REBUILD",
      object_tags: [],
    },
  ],
};

describe("CatalogService", () => {
  test("paginates the public catalog and strips private fields", () => {
    const service = CatalogService.fromUnknown(SOURCE);

    const page = service.list({ page: 1, pageSize: 2 });

    expect(page.pagination).toEqual({ page: 1, page_size: 2, total_items: 3, total_pages: 2 });
    expect(page.items.map((item) => item.public_id)).toEqual(["tpl_alpha000000001", "tpl_beta0000000002"]);
    expect(JSON.stringify(page)).not.toContain("must-not-leak");
    expect(JSON.stringify(page)).not.toContain("private/path");
  });

  test("filters by industry and access tier before pagination", () => {
    const service = CatalogService.fromUnknown(SOURCE);

    const page = service.list({ page: 1, pageSize: 10, industry: "通用项目管理", accessTier: "free" });

    expect(page.items.map((item) => item.public_id)).toEqual(["tpl_alpha000000001", "tpl_gamma000000003"]);
    expect(page.pagination.total_items).toBe(2);
  });

  test("rejects a declared count that does not match the item set", () => {
    expect(() => CatalogService.fromUnknown({ ...SOURCE, count: 4 })).toThrow("catalog count mismatch");
  });
});
