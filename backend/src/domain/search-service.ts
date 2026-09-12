export interface SearchableTemplate {
  public_id: string;
  display_name: string;
  canonical_title: string;
  intent: string;
  intent_name: string;
  industry: string;
  project_phase: string;
  roles: readonly string[];
  purpose: string;
  output: string;
  field_names: readonly string[];
  access_tier: "free" | "paid";
}

export interface SearchQuery {
  query: string;
  limit: number;
  industry?: string;
  accessTier?: "free" | "paid";
}

export interface SearchCandidate {
  public_id: string;
  display_name: string;
  intent_name: string;
  industry: string;
  access_tier: "free" | "paid";
  match_reasons: string[];
  score: number;
}

export interface SearchResult {
  decision: "recommend" | "clarify";
  usage_decrement_allowed: false;
  top_result: SearchCandidate | null;
  candidates: SearchCandidate[];
  clarification: { question: string; options: string[] } | null;
}

const RECOMMEND_CONFIDENCE_FLOOR = 3;

export class SearchService {
  constructor(private readonly templates: readonly SearchableTemplate[]) {}

  search(query: SearchQuery): SearchResult {
    const candidates = this.templates
      .filter((template) => query.industry === undefined || template.industry === query.industry)
      .filter((template) => query.accessTier === undefined || template.access_tier === query.accessTier)
      .map((template) => toCandidate(template, query.query))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.public_id.localeCompare(right.public_id))
      .slice(0, query.limit);

    const top = candidates[0] ?? null;
    if (!top || top.score < RECOMMEND_CONFIDENCE_FLOOR) {
      return {
        decision: "clarify",
        usage_decrement_allowed: false,
        top_result: null,
        candidates,
        clarification: {
          question: "需要哪一类职场表格？",
          options: unique(this.templates.map((template) => template.intent_name)).slice(0, 3),
        },
      };
    }

    return {
      decision: "recommend",
      usage_decrement_allowed: false,
      top_result: top,
      candidates,
      clarification: null,
    };
  }
}

function toCandidate(template: SearchableTemplate, query: string): SearchCandidate {
  const reasons: string[] = [];
  let score = 0;

  if (containsAny(query, [template.industry, ...industryAliases(template.industry)])) {
    score += template.industry === "通用项目管理" ? 2 : 5;
    reasons.push("行业匹配");
  }
  if (containsAny(query, [template.intent_name, template.intent, template.canonical_title, template.output])) {
    score += 3;
    reasons.push("意图匹配");
  }
  const fieldMatches = template.field_names.filter((field) => query.includes(field));
  if (fieldMatches.length > 0) {
    score += fieldMatches.length;
    reasons.push("字段匹配");
  }
  if (containsAny(query, [template.display_name, template.purpose, template.project_phase, ...template.roles])) {
    score += 1;
    reasons.push("场景匹配");
  }

  return {
    public_id: template.public_id,
    display_name: template.display_name,
    intent_name: template.intent_name,
    industry: template.industry,
    access_tier: template.access_tier,
    match_reasons: reasons,
    score,
  };
}

function containsAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => value.length > 0 && text.includes(value));
}

function industryAliases(industry: string): string[] {
  if (industry === "工程建设") {
    return ["工程", "施工", "建设"];
  }
  if (industry === "通用项目管理") {
    return ["通用"];
  }
  return [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
