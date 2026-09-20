import {
  AssetStandardEngine,
  parseAssetsForStandards,
  type AssetForStandard,
  type BusinessStandard,
  type StandardSnapshot,
} from "./asset-standard-engine.js";
import {
  SpreadsheetQualityValidator,
  type SpreadsheetQualityResult,
  type SpreadsheetSpecification,
} from "./spreadsheet-quality-validator.js";

export interface OfficeSpreadsheetRequest {
  query: string;
  industry?: string;
  requiredFields?: readonly string[];
  roles?: readonly string[];
  regulated?: boolean;
  allowDraft?: boolean;
}

export type OfficeSpreadsheetDecision =
  | "direct_asset"
  | "adapt_asset"
  | "generate_from_standard"
  | "clarify"
  | "draft"
  | "refuse";

export interface OfficeSpreadsheetResult {
  decision: OfficeSpreadsheetDecision;
  asset: {
    public_id: string;
    display_name: string;
    asset_scope: "public";
    availability: "public_free";
  } | null;
  standard: BusinessStandard | null;
  specification: SpreadsheetSpecification | null;
  quality: SpreadsheetQualityResult | null;
  clarification: { question: string; options: string[] } | null;
  rationale: string[];
}

export class OfficeSpreadsheetEngine {
  private readonly validator = new SpreadsheetQualityValidator();

  private constructor(
    private readonly assets: readonly AssetForStandard[],
    private readonly standards: AssetStandardEngine,
  ) {}

  static fromAssets(assets: readonly unknown[], version: string): OfficeSpreadsheetEngine {
    const parsed = parseAssetsForStandards(assets);
    return new OfficeSpreadsheetEngine(parsed, AssetStandardEngine.fromAssets(parsed, version));
  }

  static fromSnapshot(assets: readonly unknown[], snapshot: StandardSnapshot): OfficeSpreadsheetEngine {
    const parsed = parseAssetsForStandards(assets);
    const standards = AssetStandardEngine.fromSnapshot(snapshot);
    validateSnapshotAgainstAssets(parsed, standards.snapshot());
    return new OfficeSpreadsheetEngine(parsed, standards);
  }

  resolve(request: OfficeSpreadsheetRequest): OfficeSpreadsheetResult {
    const query = request.query.trim();
    const requiredFields = unique(request.requiredFields ?? []);
    const requestedRoles = unique(request.roles ?? []);
    const exact = this.assets.find((asset) =>
      normalize(asset.display_name) === normalize(query) || normalize(asset.canonical_title) === normalize(query));

    if (exact && meetsAll(exact.field_names, requiredFields) && meetsAll(exact.roles, requestedRoles)) {
      return {
        decision: "direct_asset",
        asset: publicAsset(exact),
        standard: this.findStandard(exact.intent, request.industry ?? exact.industry),
        specification: null,
        quality: null,
        clarification: null,
        rationale: ["业务题名精确匹配", "现有资产已通过发布质量门禁"],
      };
    }

    const intent = exact?.intent ?? inferIntent(query, this.assets);
    if (!intent) {
      if (request.regulated) {
        return emptyResult("refuse", ["受监管需求缺少可核验的资产或标准依据"]);
      }
      if (request.allowDraft) {
        const specification = makeDraftSpecification(query, this.standards.snapshot().version);
        return {
          decision: "draft",
          asset: null,
          standard: null,
          specification,
          quality: this.validator.validate(specification, { requiredFields: [], regulated: false }),
          clarification: null,
          rationale: ["未识别到可靠专业标准", "按用户要求仅输出明确标注的草案"],
        };
      }
      return {
        ...emptyResult("clarify", ["需求不足以确定业务意图"]),
        clarification: {
          question: "请补充表格的业务对象、使用角色和必须字段。",
          options: this.intentOptions(),
        },
      };
    }

    const standard = this.findStandard(intent, request.industry);
    if (!standard) {
      return request.regulated
        ? emptyResult("refuse", ["受监管需求没有可核验标准"])
        : {
            ...emptyResult("clarify", ["已识别业务意图，但没有适用行业标准"]),
            clarification: {
              question: "请确认适用行业或提供现行标准依据。",
              options: this.intentOptions(),
            },
          };
    }

    const candidate = this.bestCandidate(query, intent, request.industry, requestedRoles);
    const coverage = candidate ? coverageRatio(candidate.field_names, requiredFields) : 0;
    if (candidate && (requiredFields.length === 0 || coverage >= 0.5) && roleApplicable(candidate.roles, requestedRoles)) {
      const specification = makeSpecification({
        title: candidate.canonical_title,
        asset: candidate,
        standard,
        version: this.standards.snapshot().version,
        requiredFields,
        requestedRoles,
      });
      const quality = this.validator.validate(specification, {
        requiredFields,
        regulated: candidate.regulated || Boolean(request.regulated),
      });
      return quality.passed
        ? {
            decision: "adapt_asset",
            asset: publicAsset(candidate),
            standard,
            specification,
            quality,
            clarification: null,
            rationale: ["未找到完全满足附加要求的成品", "候选资产通过行业、角色和字段适用性门禁"],
          }
        : emptyResult("refuse", ["候选资产改造未通过质量门禁"]);
    }

    const specification = makeSpecification({
      title: `${standard.intent_name}表`,
      standard,
      version: this.standards.snapshot().version,
      requiredFields,
      requestedRoles,
    });
    const quality = this.validator.validate(specification, {
      requiredFields,
      regulated: standard.regulated || Boolean(request.regulated),
    });
    return quality.passed
      ? {
          decision: "generate_from_standard",
          asset: null,
          standard,
          specification,
          quality,
          clarification: null,
          rationale: ["没有现有资产安全覆盖关键约束", "使用同一版本化业务标准生成"],
        }
      : emptyResult("refuse", ["标准生成结果未通过质量门禁"]);
  }

  private findStandard(intent: string, industry?: string): BusinessStandard | null {
    if (industry) {
      const exact = this.standards.find(intent, industry);
      if (exact) return exact;
    }
    const common = this.standards.find(intent, "通用项目管理");
    if (common) return common;
    return this.standards.snapshot().standards.find((standard) => standard.intent === intent) ?? null;
  }

  private bestCandidate(
    query: string,
    intent: string,
    industry: string | undefined,
    roles: readonly string[],
  ): AssetForStandard | null {
    const candidates = this.assets
      .filter((asset) => asset.intent === intent)
      .filter((asset) => !industry || asset.industry === industry || asset.industry === "通用项目管理")
      .map((asset) => ({ asset, score: candidateScore(asset, query, industry, roles) }))
      .sort((left, right) => right.score - left.score || left.asset.public_id.localeCompare(right.asset.public_id));
    return candidates[0]?.asset ?? null;
  }

  private intentOptions(): string[] {
    return unique(this.assets.map((asset) => asset.intent_name)).slice(0, 3);
  }
}

function validateSnapshotAgainstAssets(assets: readonly AssetForStandard[], snapshot: StandardSnapshot): void {
  if (assets.length !== snapshot.source_asset_count) {
    throw new Error("active standard snapshot does not match catalog asset count");
  }
  const counts = new Map<string, number>();
  const publicIds = new Set<string>();
  for (const asset of assets) {
    if (publicIds.has(asset.public_id)) {
      throw new Error(`duplicate public asset id: ${asset.public_id}`);
    }
    publicIds.add(asset.public_id);
    const id = `${asset.intent}::${asset.industry}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const standard of snapshot.standards) {
    if (counts.get(standard.standard_id) !== standard.source_asset_count) {
      throw new Error(`active standard snapshot does not match catalog group: ${standard.standard_id}`);
    }
    counts.delete(standard.standard_id);
  }
  if (counts.size > 0) {
    throw new Error(`active standard snapshot is missing catalog group: ${counts.keys().next().value as string}`);
  }
}

function makeSpecification(options: {
  title: string;
  standard: BusinessStandard;
  version: string;
  requiredFields: readonly string[];
  requestedRoles: readonly string[];
  asset?: AssetForStandard;
}): SpreadsheetSpecification {
  const fields = unique([
    ...(options.asset?.field_names ?? options.standard.recommended_fields),
    ...options.requiredFields,
  ]);
  const required = new Set([...options.standard.required_fields, ...options.requiredFields]);
  const roles = unique([
    ...(options.asset?.roles ?? options.standard.roles),
    ...options.requestedRoles,
  ]);
  return {
    schema_version: "office-spreadsheet-spec/v1",
    title: options.title,
    sheet_name: "模板",
    source: {
      mode: options.asset ? "asset_adaptation" : "standard_generation",
      standard_id: options.standard.standard_id,
      standard_version: options.version,
      ...(options.asset ? { public_id: options.asset.public_id } : {}),
    },
    columns: fields.map((name) => ({ name, type: inferColumnType(name), required: required.has(name) })),
    workflow: { roles: roles.length > 0 ? roles : ["填写人"], steps: ["填写", "审核", "复核", "关闭"] },
    formulas: [],
    print: {
      orientation: fields.length > 8 ? "landscape" : "portrait",
      fit_to_width: 1,
      repeat_header_row: 2,
      freeze_pane: "A3",
      auto_filter: true,
    },
    compatibility: ["excel", "wps", "libreoffice"],
    regulated_notice: options.standard.regulated ? "仅供内部管理参考，启用前请核对现行主管要求。" : null,
    delivery_notes: ["基于公共资产标准生成或改造，启用前请由业务负责人确认适用范围。"],
  };
}

function makeDraftSpecification(query: string, version: string): SpreadsheetSpecification {
  return {
    schema_version: "office-spreadsheet-spec/v1",
    title: query || "办公记录表草案",
    sheet_name: "模板",
    source: { mode: "standard_generation", standard_id: "draft::generic", standard_version: version },
    columns: [
      { name: "事项", type: "text", required: true },
      { name: "负责人", type: "text", required: true },
      { name: "状态", type: "enum", required: true, options: ["未开始", "进行中", "已完成"] },
    ],
    workflow: { roles: ["填写人"], steps: ["填写", "确认", "完成"] },
    formulas: [],
    print: { orientation: "portrait", fit_to_width: 1, repeat_header_row: 2, freeze_pane: "A3", auto_filter: true },
    compatibility: ["excel", "wps", "libreoffice"],
    regulated_notice: null,
    delivery_notes: ["草案：缺少可核验专业依据，使用前必须补充并确认业务规则。"],
  };
}

function inferIntent(query: string, assets: readonly AssetForStandard[]): string | null {
  const scores = new Map<string, number>();
  for (const asset of assets) {
    let score = 0;
    if (query.includes(asset.canonical_title) || query.includes(asset.display_name)) score += 6;
    if (query.includes(asset.intent_name) || query.includes(asset.output)) score += 4;
    if (asset.object_tags.some((tag) => tag.length > 0 && query.includes(tag))) score += 2;
    if (asset.field_names.some((field) => query.includes(field))) score += 1;
    const phraseOverlap = bigramOverlap(query, [
      asset.display_name,
      asset.canonical_title,
      asset.intent_name,
      asset.purpose,
      asset.output,
    ]);
    if (phraseOverlap >= 2) score += phraseOverlap;
    if (score > 0) scores.set(asset.intent, Math.max(scores.get(asset.intent) ?? 0, score));
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!ranked[0] || (ranked[1] && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}

function bigramOverlap(query: string, candidates: readonly string[]): number {
  const queryBigrams = bigrams(query);
  if (queryBigrams.size === 0) return 0;
  let maximum = 0;
  for (const candidate of candidates) {
    const candidateBigrams = bigrams(candidate);
    let matches = 0;
    for (const token of queryBigrams) {
      if (candidateBigrams.has(token)) matches += 1;
    }
    maximum = Math.max(maximum, matches);
  }
  return maximum;
}

function bigrams(value: string): Set<string> {
  const normalized = value.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "").toLowerCase();
  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  return tokens;
}

function candidateScore(
  asset: AssetForStandard,
  query: string,
  industry: string | undefined,
  roles: readonly string[],
): number {
  let score = 0;
  if (industry && asset.industry === industry) score += 8;
  else if (asset.industry === "通用项目管理") score += 2;
  if (query.includes(asset.canonical_title) || query.includes(asset.display_name)) score += 6;
  if (asset.object_tags.some((tag) => query.includes(tag))) score += 2;
  score += roles.filter((role) => asset.roles.includes(role)).length * 2;
  return score;
}

function coverageRatio(available: readonly string[], required: readonly string[]): number {
  if (required.length === 0) return 1;
  return required.filter((field) => available.includes(field)).length / required.length;
}

function roleApplicable(available: readonly string[], requested: readonly string[]): boolean {
  return requested.length === 0 || requested.some((role) => available.includes(role));
}

function meetsAll(available: readonly string[], required: readonly string[]): boolean {
  return required.every((value) => available.includes(value));
}

function publicAsset(asset: AssetForStandard) {
  return {
    public_id: asset.public_id,
    display_name: asset.display_name,
    asset_scope: "public" as const,
    availability: "public_free" as const,
  };
}

function emptyResult(decision: "clarify" | "refuse", rationale: string[]): OfficeSpreadsheetResult {
  return {
    decision,
    asset: null,
    standard: null,
    specification: null,
    quality: null,
    clarification: null,
    rationale,
  };
}

function inferColumnType(name: string): "text" | "number" | "date" | "percentage" | "enum" {
  if (name.includes("日期") || name.includes("时间")) return "date";
  if (name.includes("概率") || name.includes("比例") || name.includes("百分比")) return "percentage";
  if (name.includes("数量") || name.includes("金额") || name.includes("成本")) return "number";
  if (name.includes("状态") || name.includes("结论")) return "enum";
  return "text";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, "").toLowerCase();
}
