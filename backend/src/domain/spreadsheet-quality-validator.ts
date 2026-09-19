export interface SpreadsheetColumn {
  name: string;
  type: "text" | "number" | "date" | "percentage" | "enum";
  required: boolean;
  options?: string[];
}

export interface SpreadsheetSpecification {
  schema_version: "office-spreadsheet-spec/v1";
  title: string;
  sheet_name: string;
  source: {
    mode: "asset_adaptation" | "standard_generation";
    standard_id: string;
    standard_version: string;
    public_id?: string;
  };
  columns: SpreadsheetColumn[];
  workflow: { roles: string[]; steps: string[] };
  formulas: Array<{ target_column: string; expression: string }>;
  print: {
    orientation: "portrait" | "landscape";
    fit_to_width: number;
    repeat_header_row: number;
    freeze_pane: string;
    auto_filter: boolean;
  };
  compatibility: Array<"excel" | "wps" | "libreoffice">;
  regulated_notice: string | null;
  delivery_notes: string[];
}

export interface SpreadsheetQualityViolation {
  code:
    | "INVALID_TITLE"
    | "TOO_FEW_COLUMNS"
    | "DUPLICATE_COLUMN"
    | "MISSING_REQUIRED_FIELD"
    | "UNKNOWN_FORMULA_TARGET"
    | "UNSAFE_FORMULA"
    | "INCOMPLETE_WORKFLOW"
    | "INVALID_PRINT_SETUP"
    | "MISSING_COMPATIBILITY_TARGET"
    | "MISSING_REGULATED_NOTICE";
  path: string;
  message: string;
}

export interface SpreadsheetQualityResult {
  passed: boolean;
  violations: SpreadsheetQualityViolation[];
}

export class SpreadsheetQualityValidator {
  validate(
    specification: SpreadsheetSpecification,
    context: { requiredFields: readonly string[]; regulated: boolean },
  ): SpreadsheetQualityResult {
    const violations: SpreadsheetQualityViolation[] = [];
    if (specification.title.trim().length === 0 || specification.sheet_name.trim().length === 0) {
      violations.push({ code: "INVALID_TITLE", path: "title", message: "标题和工作表名称不能为空" });
    }
    if (specification.columns.length < 3) {
      violations.push({ code: "TOO_FEW_COLUMNS", path: "columns", message: "可交付表格至少需要三个字段" });
    }

    const columnNames = specification.columns.map((column) => column.name.trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const [index, name] of columnNames.entries()) {
      if (seen.has(name)) {
        violations.push({ code: "DUPLICATE_COLUMN", path: `columns[${index}]`, message: `字段重复：${name}` });
      }
      seen.add(name);
    }
    for (const requiredField of new Set(context.requiredFields)) {
      if (!seen.has(requiredField)) {
        violations.push({
          code: "MISSING_REQUIRED_FIELD",
          path: "columns",
          message: `缺少必需字段：${requiredField}`,
        });
      }
    }

    for (const [index, formula] of specification.formulas.entries()) {
      if (!seen.has(formula.target_column)) {
        violations.push({
          code: "UNKNOWN_FORMULA_TARGET",
          path: `formulas[${index}].target_column`,
          message: `公式目标字段不存在：${formula.target_column}`,
        });
      }
      if (!isSafeFormula(formula.expression)) {
        violations.push({
          code: "UNSAFE_FORMULA",
          path: `formulas[${index}].expression`,
          message: "公式包含外部引用、链接或不允许的调用",
        });
      }
    }

    if (specification.workflow.roles.length === 0 || specification.workflow.steps.length === 0) {
      violations.push({ code: "INCOMPLETE_WORKFLOW", path: "workflow", message: "角色和流程步骤不能为空" });
    }
    if (
      specification.print.fit_to_width !== 1
      || specification.print.repeat_header_row < 1
      || !/^[A-Z]+[1-9]\d*$/u.test(specification.print.freeze_pane)
      || !specification.print.auto_filter
    ) {
      violations.push({ code: "INVALID_PRINT_SETUP", path: "print", message: "打印、冻结或筛选设置不完整" });
    }
    for (const target of ["excel", "wps", "libreoffice"] as const) {
      if (!specification.compatibility.includes(target)) {
        violations.push({
          code: "MISSING_COMPATIBILITY_TARGET",
          path: "compatibility",
          message: `缺少兼容目标：${target}`,
        });
      }
    }
    if (context.regulated && !specification.regulated_notice?.includes("现行")) {
      violations.push({
        code: "MISSING_REGULATED_NOTICE",
        path: "regulated_notice",
        message: "受监管场景必须提示核对现行主管要求",
      });
    }
    return { passed: violations.length === 0, violations };
  }
}

function isSafeFormula(expression: string): boolean {
  const normalized = expression.trim().toUpperCase();
  if (!normalized.startsWith("=")) return false;
  return !normalized.includes("[")
    && !normalized.includes("HTTP://")
    && !normalized.includes("HTTPS://")
    && !normalized.includes("WEBSERVICE(")
    && !normalized.includes("HYPERLINK(");
}
