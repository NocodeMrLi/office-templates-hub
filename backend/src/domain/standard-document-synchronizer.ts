import { parseStandardSnapshot, type BusinessStandard, type StandardSnapshot } from "./asset-standard-engine.js";

const VARIANT_DESCRIPTIONS: Record<string, string> = {
  light: "轻量记录，只保留最小可用字段",
  standard: "标准业务执行版",
  advanced: "增加分析、复核或进阶管理",
  approval: "增加申请、审批、意见与结论链路",
  audit: "增加证据、变更和可追溯信息",
  review: "增加结果评价、经验教训和后续行动",
};

export function synchronizeStandardDocument(document: string, input: unknown): string {
  const snapshot = parseStandardSnapshot(input);
  let output = replaceExactlyOnce(
    document,
    /^> 当前基线：.*$/gmu,
    `> 当前基线：\`${snapshot.schema_version}\` / \`${snapshot.version}\`；${snapshot.source_asset_count} 份公共资产蒸馏为 ${snapshot.standards.length} 项结构化标准。`,
    "standard document baseline summary boundary is missing or duplicated",
  );
  output = replaceExactlyOnce(
    output,
    /^## 三、当前 .* 标准基线[\s\S]*?(?=^### 3\.4 常见横向字段)/gmu,
    renderBaseline(snapshot),
    "standard document statistics boundary is missing or duplicated",
  );
  output = replaceExactlyOnce(
    output,
    /当前 \d+ 项标准中有 \d+ 项只有 1 份资产支持/gu,
    `当前 ${snapshot.standards.length} 项标准中有 ${snapshot.standards.filter((item) => item.source_asset_count === 1).length} 项只有 1 份资产支持`,
    "standard document evidence summary boundary is missing or duplicated",
  );
  output = replaceExactlyOnce(
    output,
    /^## 十五、当前 .*标准索引[\s\S]*?^<!-- CURRENT_STANDARD_INDEX:END -->/gmu,
    renderIndex(snapshot),
    "standard document index boundary is missing or duplicated",
  );
  return output;
}

function renderBaseline(snapshot: StandardSnapshot): string {
  const sourceCounts = snapshot.standards.map((item) => item.source_asset_count);
  const recommendedCounts = snapshot.standards.map((item) => item.recommended_fields.length);
  const requiredCounts = snapshot.standards.map((item) => item.required_fields.length);
  const industries = countBy(snapshot.standards, (item) => item.industry)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));
  const variants = countValues(snapshot.standards.flatMap((item) => item.variants));
  const regulated = snapshot.standards.filter((item) => item.regulated).length;
  const intents = new Set(snapshot.standards.map((item) => item.intent)).size;

  return `## 三、当前 ${snapshot.version} 标准基线

### 3.1 总体统计

| 指标 | 当前值 |
|---|---:|
| 标准模式 | \`${snapshot.schema_version}\` |
| 标准版本 | \`${snapshot.version}\` |
| 来源公共资产 | ${snapshot.source_asset_count} |
| 结构化标准 | ${snapshot.standards.length} |
| 唯一业务意图 | ${intents} |
| 行业范围 | ${industries.length} |
| 受监管标准 | ${regulated} |
| 非监管标准 | ${snapshot.standards.length - regulated} |
| 单项标准来源资产数 | ${range(sourceCounts)} |
| 推荐字段数 | ${range(recommendedCounts)}，平均 ${average(recommendedCounts)} |
| 必需字段数 | ${range(requiredCounts)}，平均 ${average(requiredCounts)} |

### 3.2 行业覆盖

| 行业 | 标准数 |
|---|---:|
${industries.map((item) => `| ${escapeTable(item.name)} | ${item.count} |`).join("\n")}

### 3.3 变体体系

| 变体 | 含义 | 当前覆盖标准数 |
|---|---|---:|
${orderedVariants(variants).map(([name, count]) =>
    `| \`${escapeTable(name)}\` | ${VARIANT_DESCRIPTIONS[name] ?? "项目资产定义的其他变体"} | ${count} |`).join("\n")}

变体数量只表示当前资产事实中的覆盖，不表示每个标准都必须拥有全部变体。

`;
}

function renderIndex(snapshot: StandardSnapshot): string {
  const industries = [...new Set(snapshot.standards.map((item) => item.industry))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  let position = 0;
  const sections = industries.map((industry) => {
    const standards = snapshot.standards.filter((item) => item.industry === industry);
    const rows = standards.map((standard) => {
      position += 1;
      return renderIndexRow(position, standard);
    }).join("\n");
    return `### ${escapeTable(industry)}（${standards.length} 项）

| 序号 | 标准 ID | 业务名称 | 来源资产 | 必需字段 | 推荐字段 | 角色 | 变体 | 受监管 |
|---:|---|---|---:|---:|---:|---:|---:|---|
${rows}`;
  }).join("\n\n");
  return `## 十五、当前 ${snapshot.standards.length} 项标准索引

下表是 \`data/standards.public.json\` 的人类可读索引。完整的必需字段、推荐字段、角色、用途、交付物和合规复核以同版本 JSON 记录为准。

<!-- CURRENT_STANDARD_INDEX:START version=${snapshot.version} source_assets=${snapshot.source_asset_count} standards=${snapshot.standards.length} -->

${sections}

<!-- CURRENT_STANDARD_INDEX:END -->`;
}

function renderIndexRow(position: number, standard: BusinessStandard): string {
  return `| ${position} | \`${escapeTable(standard.standard_id)}\` | ${escapeTable(standard.intent_name)} | ${standard.source_asset_count} | ${standard.required_fields.length} | ${standard.recommended_fields.length} | ${standard.roles.length} | ${standard.variants.length} | ${standard.regulated ? "是" : "否"} |`;
}

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  replacement: string,
  errorMessage: string,
): string {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(errorMessage);
  return source.replace(pattern, replacement);
}

function countBy<T>(items: readonly T[], select: (item: T) => string): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = select(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function orderedVariants(counts: ReadonlyMap<string, number>): Array<[string, number]> {
  const preferred = Object.keys(VARIANT_DESCRIPTIONS).filter((name) => counts.has(name));
  const extra = [...counts.keys()].filter((name) => !(name in VARIANT_DESCRIPTIONS)).sort();
  return [...preferred, ...extra].map((name) => [name, counts.get(name) ?? 0]);
}

function range(values: readonly number[]): string {
  if (values.length === 0) return "0～0";
  return `${Math.min(...values)}～${Math.max(...values)}`;
}

function average(values: readonly number[]): string {
  if (values.length === 0) return "0.00";
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
