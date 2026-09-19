import {
  AssetStandardEngine,
  parseAssetsForStandards,
  type AssetForStandard,
  type BusinessStandard,
  type StandardSnapshot,
} from "./asset-standard-engine.js";

export interface StandardImprovement {
  fields: string[];
  roles: string[];
  variants: string[];
}

export interface StandardEvolutionCandidate {
  standard_id: string;
  status: "candidate";
  source_public_ids: string[];
  improvements: StandardImprovement;
  proposed_standard?: BusinessStandard;
  requires_review: true;
}

export interface StandardEvolutionNoChange {
  public_id: string;
  standard_id: string;
  reason: "no stronger reusable rule";
}

export interface StandardEvolutionReport {
  schema_version: "office-standard-evolution/v1";
  base_version: string;
  scanned_asset_count: number;
  candidates: StandardEvolutionCandidate[];
  no_change: StandardEvolutionNoChange[];
}

export interface PromotionControls {
  approvedBy: string;
  regressionPassed: boolean;
  rollbackVersion: string;
}

export interface StandardChangeRecord {
  schema_version: "office-standard-change/v1";
  from_version: string;
  to_version: string;
  rollback_version: string;
  approved_by: string;
  regression_passed: true;
  candidate_count: number;
  source_public_ids: string[];
}

export interface StandardPromotionResult {
  snapshot: StandardSnapshot;
  change_record: StandardChangeRecord;
}

/** Scans assets into reviewable candidates; it never mutates the active snapshot. */
export class StandardEvolutionService {
  scan(snapshot: StandardSnapshot, newAssets: readonly unknown[]): StandardEvolutionReport {
    validateSnapshotVersion(snapshot.version);
    const assets = parseAssetsForStandards(newAssets);
    const current = new Map(snapshot.standards.map((standard) => [standard.standard_id, standard]));
    const candidateById = new Map<string, StandardEvolutionCandidate>();
    const noChange: StandardEvolutionNoChange[] = [];

    for (const asset of assets) {
      const id = standardId(asset);
      const standard = current.get(id);
      const improvements = compareAsset(standard, asset);
      if (!hasImprovement(improvements)) {
        noChange.push({
          public_id: asset.public_id,
          standard_id: id,
          reason: "no stronger reusable rule",
        });
        continue;
      }

      const existing = candidateById.get(id);
      const proposedStandard = standard
        ? undefined
        : mergeProposedStandard(existing?.proposed_standard, distillSingleAsset(asset, snapshot.version));
      candidateById.set(id, {
        standard_id: id,
        status: "candidate",
        source_public_ids: sorted([...(existing?.source_public_ids ?? []), asset.public_id]),
        improvements: {
          fields: sorted([...(existing?.improvements.fields ?? []), ...improvements.fields]),
          roles: sorted([...(existing?.improvements.roles ?? []), ...improvements.roles]),
          variants: sorted([...(existing?.improvements.variants ?? []), ...improvements.variants]),
        },
        ...(proposedStandard ? { proposed_standard: proposedStandard } : {}),
        requires_review: true,
      });
    }

    return {
      schema_version: "office-standard-evolution/v1",
      base_version: snapshot.version,
      scanned_asset_count: assets.length,
      candidates: [...candidateById.values()].sort((left, right) =>
        left.standard_id.localeCompare(right.standard_id, "zh-CN")),
      no_change: noChange.sort((left, right) => left.public_id.localeCompare(right.public_id, "zh-CN")),
    };
  }

  promote(
    snapshot: StandardSnapshot,
    report: StandardEvolutionReport,
    controls: PromotionControls,
  ): StandardPromotionResult {
    if (!controls.approvedBy.trim()) {
      throw new Error("review approval required");
    }
    if (!controls.regressionPassed) {
      throw new Error("regression must pass");
    }
    if (report.candidates.length === 0) {
      throw new Error("no standard candidate");
    }
    if (report.base_version !== snapshot.version) {
      throw new Error("evolution report is stale");
    }
    if (controls.rollbackVersion !== snapshot.version) {
      throw new Error("rollback version must equal the active version");
    }

    const promoted = structuredClone(snapshot);
    promoted.version = incrementPatch(snapshot.version);
    promoted.source_asset_count += report.scanned_asset_count;
    const standards = new Map(promoted.standards.map((standard) => [standard.standard_id, standard]));

    for (const candidate of report.candidates) {
      const current = standards.get(candidate.standard_id);
      if (current) {
        current.recommended_fields = sorted([...current.recommended_fields, ...candidate.improvements.fields]);
        current.roles = sorted([...current.roles, ...candidate.improvements.roles]);
        current.variants = sorted([...current.variants, ...candidate.improvements.variants]);
        current.source_asset_count += candidate.source_public_ids.length;
      } else {
        if (!candidate.proposed_standard) {
          throw new Error(`new standard candidate lacks source facts: ${candidate.standard_id}`);
        }
        standards.set(candidate.standard_id, structuredClone(candidate.proposed_standard));
      }
    }
    for (const noChange of report.no_change) {
      const current = standards.get(noChange.standard_id);
      if (current) current.source_asset_count += 1;
    }
    promoted.standards = [...standards.values()].sort((left, right) =>
      left.standard_id.localeCompare(right.standard_id, "zh-CN"));

    return {
      snapshot: promoted,
      change_record: {
        schema_version: "office-standard-change/v1",
        from_version: snapshot.version,
        to_version: promoted.version,
        rollback_version: controls.rollbackVersion,
        approved_by: controls.approvedBy.trim(),
        regression_passed: true,
        candidate_count: report.candidates.length,
        source_public_ids: sorted(report.candidates.flatMap((candidate) => candidate.source_public_ids)),
      },
    };
  }
}

function compareAsset(standard: BusinessStandard | undefined, asset: AssetForStandard): StandardImprovement {
  if (!standard) {
    return {
      fields: sorted(asset.field_names),
      roles: sorted(asset.roles),
      variants: [asset.variant],
    };
  }
  return {
    fields: difference(asset.field_names, standard.recommended_fields),
    roles: difference(asset.roles, standard.roles),
    variants: difference([asset.variant], standard.variants),
  };
}

function difference(values: readonly string[], existing: readonly string[]): string[] {
  const current = new Set(existing);
  return sorted(values.filter((value) => !current.has(value)));
}

function hasImprovement(improvement: StandardImprovement): boolean {
  return improvement.fields.length > 0 || improvement.roles.length > 0 || improvement.variants.length > 0;
}

function standardId(asset: AssetForStandard): string {
  return `${asset.intent}::${asset.industry}`;
}

function incrementPatch(version: string): string {
  validateSnapshotVersion(version);
  const parts = version.split(".").map(Number);
  return `${parts[0]}.${parts[1]}.${(parts[2] ?? 0) + 1}`;
}

function validateSnapshotVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("standard version must be semantic");
  }
}

function distillSingleAsset(asset: AssetForStandard, version: string): BusinessStandard {
  const standard = AssetStandardEngine.fromAssets([asset], version).snapshot().standards[0];
  if (!standard) throw new Error("new standard candidate could not be distilled");
  return standard;
}

function mergeProposedStandard(
  current: BusinessStandard | undefined,
  incoming: BusinessStandard,
): BusinessStandard {
  if (!current) return incoming;
  const incomingRequired = new Set(incoming.required_fields);
  return {
    ...current,
    required_fields: current.required_fields.filter((field) => incomingRequired.has(field)),
    recommended_fields: sorted([...current.recommended_fields, ...incoming.recommended_fields]),
    roles: sorted([...current.roles, ...incoming.roles]),
    variants: sorted([...current.variants, ...incoming.variants]),
    project_phases: sorted([...current.project_phases, ...incoming.project_phases]),
    purposes: sorted([...current.purposes, ...incoming.purposes]),
    outputs: sorted([...current.outputs, ...incoming.outputs]),
    regulated: current.regulated || incoming.regulated,
    compliance_reviews: sorted([...current.compliance_reviews, ...incoming.compliance_reviews]),
    source_asset_count: current.source_asset_count + incoming.source_asset_count,
  };
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
}
