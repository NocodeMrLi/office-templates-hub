export interface CatalogQuery {
  page: number;
  pageSize: number;
  industry?: string;
  accessTier?: "free" | "paid";
}

const PublicTemplateSchema = z.object({
  product_id: z.string().min(1),
  public_id: z.string().min(1),
  display_name: z.string().min(1),
  canonical_title: z.string().min(1),
  intent: z.string().min(1),
  intent_name: z.string().min(1),
  industry: z.string().min(1),
  project_phase: z.string().min(1),
  roles: z.array(z.string()),
  purpose: z.string(),
  output: z.string(),
  field_names: z.array(z.string()),
  variant: z.string(),
  variant_label: z.string(),
  audience: z.string(),
  scale_label: z.string(),
  complexity: z.string(),
  information_density: z.string(),
  regulated: z.boolean(),
  data_sensitivity: z.string(),
  compliance_review: z.string(),
  access_tier: z.enum(["free", "paid"]),
  quality_tier: z.literal("product_pass"),
  rights_status: z.literal("PASS_INDEPENDENT_REBUILD"),
  object_tags: z.array(z.string()),
});

const CatalogSourceSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(PublicTemplateSchema),
});

export type PublicTemplate = z.infer<typeof PublicTemplateSchema>;

export class CatalogService {
  private constructor(private readonly items: readonly PublicTemplate[]) {}

  static fromUnknown(source: unknown): CatalogService {
    const parsed = CatalogSourceSchema.parse(source);
    if (parsed.count !== parsed.items.length) {
      throw new Error("catalog count mismatch");
    }
    return new CatalogService(parsed.items);
  }

  list(query: CatalogQuery) {
    const filtered = this.items.filter((item) =>
      (query.industry === undefined || item.industry === query.industry)
      && (query.accessTier === undefined || item.access_tier === query.accessTier),
    );
    const start = (query.page - 1) * query.pageSize;
    return {
      items: filtered.slice(start, start + query.pageSize),
      pagination: {
        page: query.page,
        page_size: query.pageSize,
        total_items: filtered.length,
        total_pages: Math.ceil(filtered.length / query.pageSize),
      },
    };
  }
}
import { z } from "zod";
