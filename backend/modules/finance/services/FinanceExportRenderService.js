/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/FinanceExportRenderService.js
 *
 * STEP 7.4 — Finance Export Engine. Pure formatting layer — takes an
 * already-fetched, already-computed report shape ({title, columns,
 * rows, summaryLines}) and renders it into a file buffer/string. No DB
 * access, no calculation, no side effects — mirrors this codebase's
 * own "DTO layer does mapping only" discipline (e.g. modules/finance/
 * dto/revenue.dto.js's own header).
 *
 * New dependencies added for this step only: exceljs (XLSX) and
 * pdfkit (PDF) — neither existed in this codebase before (confirmed by
 * this step's own audit: no export/report-file library was present).
 * CSV and JSON need no library — hand-written/native, respectively.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/**
 * @param {{title:string, columns:{header:string,key:string}[], rows:object[], summaryLines?:string[]}} report
 * @returns {Promise<Buffer>}
 */
export const renderExcelBuffer = async ({ title, columns, rows, summaryLines = [] }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ZEMISH Finance Export Engine";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel sheet-name limit
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(c.header.length + 2, 14) }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) sheet.addRow(row);

  if (summaryLines.length) {
    sheet.addRow([]);
    for (const line of summaryLines) sheet.addRow([line]);
  }

  return workbook.xlsx.writeBuffer();
};

/**
 * @param {{columns:{header:string,key:string}[], rows:object[]}} report
 * @returns {string}
 */
export const renderCsvString = ({ columns, rows }) => {
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const s = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  return [header, ...lines].join("\r\n");
};

/**
 * @param {{title:string, columns:{header:string,key:string}[], rows:object[], summaryLines?:string[]}} report
 * @returns {Promise<Buffer>}
 */
export const renderPdfBuffer = ({ title, columns, rows, summaryLines = [] }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: columns.length > 6 ? "landscape" : "portrait" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666666").text(`Generated ${new Date().toISOString()} — ${rows.length} row(s)`);
    doc.moveDown(1);

    if (summaryLines.length) {
      doc.fontSize(10).fillColor("#000000");
      for (const line of summaryLines) doc.text(line);
      doc.moveDown(1);
    }

    // Simple table — a header row + one row per record. PDFKit has no
    // built-in table primitive; this hand-rolled fixed-column-width
    // layout is intentionally plain (readability over polish — a
    // finance export needs to be correct and legible, not decorative).
    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / columns.length;
    const startX = doc.page.margins.left;
    let y = doc.y;

    const drawRow = (values, { bold = false } = {}) => {
      doc.fontSize(8).font(bold ? "Helvetica-Bold" : "Helvetica");
      columns.forEach((c, i) => {
        const text = values[i] === null || values[i] === undefined ? "" : String(values[i]);
        doc.text(text, startX + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
      });
      y += 14;
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    drawRow(columns.map((c) => c.header), { bold: true });
    doc.moveTo(startX, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor("#cccccc").stroke();
    y += 4;

    for (const row of rows) drawRow(columns.map((c) => row[c.key]));

    doc.end();
  });
