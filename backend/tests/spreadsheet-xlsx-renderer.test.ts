import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";

import { SpreadsheetXlsxRenderer } from "../src/infrastructure/spreadsheet-xlsx-renderer.js";
import type { SpreadsheetSpecification } from "../src/domain/spreadsheet-quality-validator.js";

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
      { name: "状态", type: "enum", required: false, options: ["开放", "关闭"] },
    ],
    workflow: { roles: ["项目经理", "风险责任人"], steps: ["登记", "评估", "应对", "复核", "关闭"] },
    formulas: [],
    print: {
      orientation: "landscape",
      fit_to_width: 1,
      repeat_header_row: 2,
      freeze_pane: "A3",
      auto_filter: true,
    },
    compatibility: ["excel", "wps", "libreoffice"],
    regulated_notice: null,
    delivery_notes: ["启用前由业务负责人确认"],
  };
}

describe("SpreadsheetXlsxRenderer", () => {
  test("renders a validated three-sheet workbook with print and input controls", async () => {
    const buffer = await new SpreadsheetXlsxRenderer().render(makeSpecification());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["模板", "填写说明", "资产记录"]);
    const main = workbook.getWorksheet("模板");
    const record = workbook.getWorksheet("资产记录");
    expect(main?.getCell("A1").value).toBe("项目风险登记表");
    expect(main?.getRow(2).values).toEqual([undefined, "风险事项 *", "概率 *", "影响 *", "责任人 *", "状态"]);
    expect(main?.views[0]).toMatchObject({ state: "frozen", ySplit: 2 });
    expect(main?.autoFilter).toBe("A2:E102");
    expect(main?.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1 });
    expect(main?.getCell("E3").dataValidation).toMatchObject({ type: "list", allowBlank: true });
    expect(record?.state).toBe("hidden");
    expect(record?.getCell("B2").value).toBe("1.0.0");
  });

  test("refuses to render a specification that fails the quality gate", async () => {
    const invalid = makeSpecification();
    invalid.columns = [{ name: "事项", type: "text", required: true }];

    await expect(new SpreadsheetXlsxRenderer().render(invalid)).rejects.toThrow("quality gate failed");
  });

  test("moves row references without corrupting numeric constants in formulas", async () => {
    const specification = makeSpecification();
    specification.formulas = [{ target_column: "影响", expression: "=B2*0.2" }];

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await new SpreadsheetXlsxRenderer().render(specification) as never);

    expect(workbook.getWorksheet("模板")?.getCell("C3").value).toEqual({ formula: "B3*0.2" });
    expect(workbook.getWorksheet("模板")?.getCell("C10").value).toEqual({ formula: "B10*0.2" });
  });
});
