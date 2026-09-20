import { z } from "zod";

const AssetForStandardSchema = z.object({
  public_id: z.string().min(1),
  display_name: z.string().min(1),
  canonical_title: z.string().min(1),
  intent: z.string().min(1),
  intent_name: z.string().min(1),
  industry: z.string().min(1),
  project_phase: z.string().min(1),
  roles: z.array(z.string().min(1)),
  purpose: z.string(),
  output: z.string(),
  field_names: z.array(z.string().min(1)),
  variant: z.string().min(1),
  variant_label: z.string().min(1),
  regulated: z.boolean(),
  compliance_review: z.string(),
  object_tags: z.array(z.string()),
  access_tier: z.enum(["free", "paid"]).optional(),
});

export type AssetForStandard = z.infer<typeof AssetForStandardSchema>;

export function parseAssetsForStandards(assets: readonly unknown[]): AssetForStandard[] {
  return assets.map((asset) => AssetForStandardSchema.parse(asset));
}

const NonEmptyStringArraySchema = z.array(z.string().min(1));

export const BusinessStandardSchema = z.object({
  standard_id: z.string().min(1),
  intent: z.string().min(1),
  intent_name: z.string().min(1),
  industry: z.string().min(1),
  required_fields: NonEmptyStringArraySchema,
  recommended_fields: NonEmptyStringArraySchema,
  roles: NonEmptyStringArraySchema,
  variants: NonEmptyStringArraySchema,
  project_phases: NonEmptyStringArraySchema,
  purposes: NonEmptyStringArraySchema,
  outputs: NonEmptyStringArraySchema,
  regulated: z.boolean(),
  compliance_reviews: NonEmptyStringArraySchema,
  source_asset_count: z.number().int().positive(),
}).strict().superRefine((standard, context) => {
  if (standard.standard_id !== standardId(standard.intent, standard.industry)) {
    context.addIssue({ code: "custom", message: "standard id does not match intent and industry" });
  }
  const recommended = new Set(standard.recommended_fields);
  if (standard.required_fields.some((field) => !recommended.has(field))) {
    context.addIssue({ code: "custom", message: "required fields must be recommended" });
  }
  for (const [name, values] of Object.entries({
    required_fields: standard.required_fields,
    recommended_fields: standard.recommended_fields,
    roles: standard.roles,
    variants: standard.variants,
    project_phases: standard.project_phases,
    purposes: standard.purposes,
    outputs: standard.outputs,
    compliance_reviews: standard.compliance_reviews,
  })) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `${name} must not contain duplicates` });
    }
  }
});

const StandardSnapshotSchema = z.object({
  schema_version: z.literal("office-asset-standards/v1"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u, "standard version must be semantic"),
  source_asset_count: z.number().int().nonnegative(),
  standards: z.array(BusinessStandardSchema),
}).strict().superRefine((snapshot, context) => {
  const ids = snapshot.standards.map((standard) => standard.standard_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "standard ids must be unique" });
  }
  const countedAssets = snapshot.standards.reduce((sum, standard) => sum + standard.source_asset_count, 0);
  if (countedAssets !== snapshot.source_asset_count) {
    context.addIssue({ code: "custom", message: "standard source counts must equal snapshot source count" });
  }
});

export type BusinessStandard = z.infer<typeof BusinessStandardSchema>;
export type StandardSnapshot = z.infer<typeof StandardSnapshotSchema>;

export function parseStandardSnapshot(input: unknown): StandardSnapshot {
  return StandardSnapshotSchema.parse(input);
}

export class AssetStandardEngine {
  private constructor(private readonly current: StandardSnapshot) {}

  static fromAssets(assets: readonly unknown[], version: string): AssetStandardEngine {
    if (!/^\d+\.\d+\.\d+$/u.test(version)) {
      throw new Error("standard version must be semantic");
    }
    const parsed = parseAssetsForStandards(assets);
    const ids = new Set<string>();
    for (const asset of parsed) {
      if (ids.has(asset.public_id)) {
        throw new Error(`duplicate public asset id: ${asset.public_id}`);
      }
      ids.add(asset.public_id);
    }

    const groups = new Map<string, AssetForStandard[]>();
    for (const asset of parsed) {
      const key = standardId(asset.intent, asset.industry);
      const current = groups.get(key) ?? [];
      current.push(asset);
      groups.set(key, current);
    }

    const standards = [...groups.entries()]
      .map(([id, group]) => distillStandard(id, group))
      .sort((left, right) => left.standard_id.localeCompare(right.standard_id, "zh-CN"));

    return new AssetStandardEngine({
      schema_version: "office-asset-standards/v1",
      version,
      source_asset_count: parsed.length,
      standards,
    });
  }

  static fromSnapshot(snapshot: unknown): AssetStandardEngine {
    return new AssetStandardEngine(parseStandardSnapshot(snapshot));
  }

  snapshot(): StandardSnapshot {
    return structuredClone(this.current);
  }

  find(intent: string, industry: string): BusinessStandard | null {
    const found = this.current.standards.find((standard) => standard.standard_id === standardId(intent, industry));
    return found ? structuredClone(found) : null;
  }
}

function distillStandard(id: string, assets: readonly AssetForStandard[]): BusinessStandard {
  const first = assets[0];
  if (!first) {
    throw new Error("cannot distill an empty asset group");
  }
  const fieldCounts = new Map<string, number>();
  for (const asset of assets) {
    for (const field of new Set(asset.field_names)) {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }
  const fields = sorted(fieldCounts.keys());
  return {
    standard_id: id,
    intent: first.intent,
    intent_name: first.intent_name,
    industry: first.industry,
    required_fields: fields.filter((field) => fieldCounts.get(field) === assets.length),
    recommended_fields: fields,
    roles: sorted(assets.flatMap((asset) => asset.roles)),
    variants: sorted(assets.map((asset) => asset.variant)),
    project_phases: sorted(assets.map((asset) => asset.project_phase)),
    purposes: sorted(assets.map((asset) => asset.purpose).filter(Boolean)),
    outputs: sorted(assets.map((asset) => asset.output).filter(Boolean)),
    regulated: assets.some((asset) => asset.regulated),
    compliance_reviews: sorted(assets.map((asset) => asset.compliance_review).filter(Boolean)),
    source_asset_count: assets.length,
  };
}

function standardId(intent: string, industry: string): string {
  return `${intent}::${industry}`;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
}
