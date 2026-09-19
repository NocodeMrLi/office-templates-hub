import ExcelJS from "exceljs";

import {
  SpreadsheetQualityValidator,
  type SpreadsheetSpecification,
} from "../domain/spreadsheet-quality-validator.js";

export class SpreadsheetXlsxRenderer {
  private readonly validator = new SpreadsheetQualityValidator();

  async render(specification: SpreadsheetSpecification): Promise<Buffer> {
    const quality = this.validator.validate(specification, {
      requiredFields: specification.columns.filter((column) => column.required).map((column) => column.name),
      regulated: specification.regulated_notice !== null,
    });
    if (!quality.passed) {
      throw new Error(`quality gate failed: ${quality.violations.map((violation) => violation.code).join(",")}`);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Office Templates Hub";
    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    workbook.calcProperties.fullCalcOnLoad = true;

    this.addMainSheet(workbook, specification);
    this.addInstructionsSheet(workbook, specification);
    this.addAssetRecordSheet(workbook, specification);

    const content = await workbook.xlsx.writeBuffer();
    return Buffer.from(content);
  }

  private addMainSheet(workbook: ExcelJS.Workbook, specification: SpreadsheetSpecification): void {
    const sheet = workbook.addWorksheet(safeSheetName(specification.sheet_name));
    const lastColumn = columnLetter(specification.columns.length);
    sheet.mergeCells(`A1:${lastColumn}1`);
    const title = sheet.getCell("A1");
    title.value = specification.title;
    title.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    sheet.getRow(1).height = 30;

    specification.columns.forEach((column, index) => {
      const cell = sheet.getCell(2, index + 1);
      cell.value = column.required ? `${column.name} *` : column.name;
      cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } };
      cell.border = thinBorder();
      sheet.getColumn(index + 1).width = column.type === "text" ? 20 : 14;
    });
    sheet.getRow(2).height = 32;

    for (let rowNumber = 3; rowNumber <= 102; rowNumber += 1) {
      specification.columns.forEach((column, index) => {
        const cell = sheet.getCell(rowNumber, index + 1);
        cell.border = thinBorder();
        cell.alignment = { vertical: "top", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        if (column.type === "date") cell.numFmt = "yyyy-mm-dd";
        if (column.type === "percentage") cell.numFmt = "0.00%";
        if (column.type === "number") cell.numFmt = "0.00";
        if (column.type === "enum" && column.options && column.options.length > 0) {
          cell.dataValidation = {
            type: "list",
            allowBlank: !column.required,
            formulae: [`"${column.options.join(",")}"`],
            showErrorMessage: true,
            errorTitle: "输入不在允许范围",
            error: `请选择：${column.options.join("、")}`,
          };
        }
      });
    }

    for (const formula of specification.formulas) {
      const index = specification.columns.findIndex((column) => column.name === formula.target_column);
      if (index < 0) continue;
      for (let rowNumber = 3; rowNumber <= 102; rowNumber += 1) {
        const cell = sheet.getCell(rowNumber, index + 1);
        cell.value = { formula: formulaForRow(formula.expression, rowNumber) };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
      }
    }

    sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 2, topLeftCell: specification.print.freeze_pane }];
    sheet.autoFilter = { from: "A2", to: `${lastColumn}102` };
    sheet.pageSetup = {
      orientation: specification.print.orientation,
      fitToPage: true,
      fitToWidth: specification.print.fit_to_width,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printArea: `A1:${lastColumn}102`,
      printTitlesRow: `${specification.print.repeat_header_row}:${specification.print.repeat_header_row}`,
    };
    sheet.headerFooter.oddHeader = "&C中文职场表格模板库 · 1300+";
    sheet.headerFooter.oddFooter = "&L办公表格 Skill&R第 &P 页 / 共 &N 页";
  }

  private addInstructionsSheet(workbook: ExcelJS.Workbook, specification: SpreadsheetSpecification): void {
    const sheet = workbook.addWorksheet("填写说明");
    sheet.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
    sheet.columns = [{ width: 18 }, { width: 90 }];
    const rows: Array<[string, string]> = [
      ["项目", specification.title],
      ["适用角色", specification.workflow.roles.join("、")],
      ["使用流程", specification.workflow.steps.join(" → ")],
      ["标准来源", `${specification.source.standard_id} @ ${specification.source.standard_version}`],
      ["必填字段", specification.columns.filter((column) => column.required).map((column) => column.name).join("、")],
      ["兼容目标", specification.compatibility.join("、")],
      ["使用边界", specification.delivery_notes.join("；")],
      ["监管提示", specification.regulated_notice ?? "无额外监管提示；仍需由业务负责人确认适用范围。"],
    ];
    sheet.addRows(rows);
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
      row.getCell(1).font = { bold: true };
      row.height = 30;
    });
  }

  private addAssetRecordSheet(workbook: ExcelJS.Workbook, specification: SpreadsheetSpecification): void {
    const sheet = workbook.addWorksheet("资产记录", { state: "hidden" });
    sheet.addRows([
      ["字段", "值"],
      ["标准版本", specification.source.standard_version],
      ["标准 ID", specification.source.standard_id],
      ["生成模式", specification.source.mode],
      ["公共资产 ID", specification.source.public_id ?? "标准生成"],
      ["规格版本", specification.schema_version],
    ]);
    sheet.state = "hidden";
  }
}

function formulaForRow(expression: string, rowNumber: number): string {
  return expression
    .slice(1)
    .replace(/\{row\}/gu, String(rowNumber))
    .replace(/(\$?[A-Z]{1,3}\$?)2\b/gu, `$1${rowNumber}`);
}

function safeSheetName(name: string): string {
  const sanitized = name.replace(/[\\/*?:[\]]/gu, "_").slice(0, 31);
  return sanitized || "模板";
}

function columnLetter(index: number): string {
  let current = index;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  return { top: side, left: side, bottom: side, right: side };
}
