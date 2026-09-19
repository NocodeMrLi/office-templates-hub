import { describe, expect, test } from "vitest";

import { SearchService } from "../src/domain/search-service.js";

const TEMPLATES = [
  {
    public_id: "tpl_risk_common",
    display_name: "项目风险登记表（标准版）",
    canonical_title: "项目风险登记表",
    intent: "risk_register",
    intent_name: "风险登记",
    industry: "通用项目管理",
    project_phase: "执行",
    roles: ["项目经理"],
    purpose: "记录项目风险",
    output: "风险台账",
    field_names: ["风险事项", "概率", "影响", "责任人"],
    access_tier: "free",
  },
  {
    public_id: "tpl_risk_construction",
    display_name: "工程风险登记表（进阶版）",
    canonical_title: "工程风险登记表",
    intent: "risk_register",
    intent_name: "风险登记",
    industry: "工程建设",
    project_phase: "执行",
    roles: ["项目经理"],
    purpose: "记录工程风险",
    output: "风险台账",
    field_names: ["风险事项", "施工阶段", "概率", "影响"],
    access_tier: "paid",
  },
  {
    public_id: "tpl_weekly_common",
    display_name: "项目周报（标准版）",
    canonical_title: "项目周报",
    intent: "progress_report",
    intent_name: "进度报告",
    industry: "通用项目管理",
    project_phase: "监控",
    roles: ["项目经理"],
    purpose: "汇报项目进度",
    output: "项目周报",
    field_names: ["本周进展", "下周计划"],
    access_tier: "free",
  },
] as const;

describe("SearchService", () => {
  test("returns one ranked recommendation without decrementing usage", () => {
    const service = new SearchService(TEMPLATES);

    const result = service.search({ query: "工程项目风险登记表", limit: 2 });

    expect(result.usage_decrement_allowed).toBe(false);
    expect(result.decision).toBe("recommend");
    expect(result.top_result?.public_id).toBe("tpl_risk_construction");
    expect(result.candidates.map((candidate) => candidate.public_id)).toEqual([
      "tpl_risk_construction",
      "tpl_risk_common",
    ]);
    expect(result.candidates[0]).toMatchObject({
      asset_scope: "public",
      availability: "public_free",
      match_reasons: expect.arrayContaining(["行业匹配", "意图匹配"]),
    });
  });

  test("does not filter public candidates by the legacy access tier", () => {
    const service = new SearchService(TEMPLATES);

    const result = service.search({ query: "工程项目风险登记表", limit: 5 });

    expect(result.candidates.map((candidate) => candidate.public_id)).toEqual([
      "tpl_risk_construction",
      "tpl_risk_common",
    ]);
    expect(result.top_result).toMatchObject({ asset_scope: "public", availability: "public_free" });
    expect(result.usage_decrement_allowed).toBe(false);
  });

  test("asks one clarification when no candidate reaches the confidence floor", () => {
    const service = new SearchService(TEMPLATES);

    const result = service.search({ query: "合同审批流程", limit: 3 });

    expect(result.decision).toBe("clarify");
    expect(result.top_result).toBeNull();
    expect(result.clarification).toEqual({
      question: "需要哪一类职场表格？",
      options: ["风险登记", "进度报告"],
    });
    expect(result.usage_decrement_allowed).toBe(false);
  });
});
