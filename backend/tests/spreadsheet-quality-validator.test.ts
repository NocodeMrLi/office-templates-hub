import { describe, expect, test } from "vitest";

import {
  SpreadsheetQualityValidator,
  type SpreadsheetSpecification,
} from "../src/domain/spreadsheet-quality-validator.js";

function makeSpecification(): SpreadsheetSpecification {
  return {
    schema_version: "office-spreadsheet-spec/v1",
    title: "项目风险登记表",
    sheet_name: "模板",
    source: {
      mode: "standard_generation",
      standard_id: "risk_register::通用项目管理",
      standard_version: "1.0.0",
    },
    columns: [
      { name: "风险事项", type: "text", required: true },
      { name: "概率", type: "percentage", required: true },
      { name: "影响", type: "text", required: true },
      { name: "责任人", type: "text", required: true },
      { name: "风险等级", type: "text", required: false },
    ],
    workflow: {
      roles: ["项目经理", "风险责任人"],
      steps: ["登记", "评估", "应对", "复核", "关闭"],
    },
    formulas: [{ target_column: "风险等级", expression: "=IF(B2>=0.7,\"高\",\"一般\")" }],
    print: {
      orientation: "landscape",
      fit_to_width: 1,
      repeat_header_row: 2,
      freeze_pane: "A3",
      auto_filter: true,
    },
    compatibility: ["excel", "wps", "libreoffice"],
    regulated_notice: null,
    delivery_notes: ["启用前由业务负责人确认适用范围"],
  };
}

describe("SpreadsheetQualityValidator", () => {
  test("passes a complete standard-generated specification", () => {
    const result = new SpreadsheetQualityValidator().validate(makeSpecification(), {
      requiredFields: ["风险事项", "概率", "影响", "责任人"],
      regulated: false,
    });

    expect(result).toEqual({ passed: true, violations: [] });
  });

  test("fails closed on missing required fields, duplicate columns, and unsafe formulas", () => {
    const specification = makeSpecification();
    specification.columns = [
      { name: "风险事项", type: "text", required: true },
      { name: "风险事项", type: "text", required: false },
      { name: "影响", type: "text", required: true },
    ];
    specification.formulas = [{ target_column: "影响", expression: "=[external.xlsx]Sheet1!A1" }];

    const result = new SpreadsheetQualityValidator().validate(specification, {
      requiredFields: ["风险事项", "概率", "影响", "责任人"],
      regulated: false,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_COLUMN",
      "MISSING_REQUIRED_FIELD",
      "UNSAFE_FORMULA",
    ]));
  });

  test("requires an explicit current-requirements notice for regulated scenarios", () => {
    const result = new SpreadsheetQualityValidator().validate(makeSpecification(), {
      requiredFields: [],
      regulated: true,
    });

    expect(result).toMatchObject({
      passed: false,
      violations: [expect.objectContaining({ code: "MISSING_REGULATED_NOTICE" })],
    });
  });
});
