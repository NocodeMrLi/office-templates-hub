import { describe, expect, test } from "vitest";

import { AssetStandardEngine } from "../src/domain/asset-standard-engine.js";
import { synchronizeStandardDocument } from "../src/domain/standard-document-synchronizer.js";

const ASSET = {
  public_id: "tpl_risk_standard",
  display_name: "项目风险登记表",
  canonical_title: "项目风险登记表",
  intent: "risk_register",
  intent_name: "风险登记",
  industry: "通用项目管理",
  project_phase: "执行",
  roles: ["项目经理"],
  purpose: "识别风险",
  output: "风险台账",
  field_names: ["风险事项", "责任人"],
  variant: "standard",
  variant_label: "标准版",
  regulated: false,
  compliance_review: "启用前确认",
  object_tags: ["风险"],
} as const;

const DOCUMENT = `# 标准

> 当前基线：\`office-asset-standards/v1\` / \`0.0.1\`；9 份公共资产蒸馏为 9 项结构化标准。

## 三、当前 0.0.1 标准基线

### 3.1 总体统计

旧统计

### 3.2 行业覆盖

旧行业

### 3.3 变体体系

旧变体

变体数量只表示当前资产事实中的覆盖，不表示每个标准都必须拥有全部变体。

### 3.4 常见横向字段

保留人工规则。

当前 9 项标准中有 9 项只有 1 份资产支持。这些标准应作为后续新资产补强。

## 十五、当前 9 项标准索引

旧说明

<!-- CURRENT_STANDARD_INDEX:START version=0.0.1 source_assets=9 standards=9 -->

旧索引

<!-- CURRENT_STANDARD_INDEX:END -->
`;

describe("synchronizeStandardDocument", () => {
  test("deterministically updates snapshot statistics and the complete index while preserving manual rules", () => {
    const snapshot = AssetStandardEngine.fromAssets([ASSET], "2.0.0").snapshot();

    const synchronized = synchronizeStandardDocument(DOCUMENT, snapshot);

    expect(synchronized).toContain("`2.0.0`；1 份公共资产蒸馏为 1 项结构化标准");
    expect(synchronized).toContain("| 来源公共资产 | 1 |");
    expect(synchronized).toContain("| 通用项目管理 | 1 |");
    expect(synchronized).toContain("## 十五、当前 1 项标准索引");
    expect(synchronized).toContain("`risk_register::通用项目管理`");
    expect(synchronized).toContain("保留人工规则。");
    expect(synchronizeStandardDocument(synchronized, snapshot)).toBe(synchronized);
  });

  test("fails closed when required document boundaries are missing", () => {
    const snapshot = AssetStandardEngine.fromAssets([ASSET], "2.0.0").snapshot();

    expect(() => synchronizeStandardDocument("# incomplete", snapshot)).toThrow(
      "standard document baseline summary boundary is missing or duplicated",
    );
  });
});
