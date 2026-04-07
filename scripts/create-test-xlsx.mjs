/**
 * Creates a realistic materials/quote Excel file for testing.
 * Run: node scripts/create-test-xlsx.mjs
 */

import ExcelJS from "exceljs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../public/test-quote.xlsx");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Quote 001");

// ─── Column widths ────────────────────────────────────────────────────────────
ws.getColumn(1).width = 6;   // #
ws.getColumn(2).width = 32;  // Description
ws.getColumn(3).width = 8;   // Qty
ws.getColumn(4).width = 12;  // Unit Price
ws.getColumn(5).width = 14;  // Total

// ─── Helper: apply header style ──────────────────────────────────────────────
function headerStyle(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });
}

function totalStyle(cell) {
  cell.font = { bold: true, size: 10 };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD6E4F0" },
  };
  cell.border = {
    top: { style: "thin" },
    bottom: { style: "double" },
  };
}

// ─── Row 1: Title (merged) ────────────────────────────────────────────────────
const titleRow = ws.addRow(["MATERIALS QUOTATION - PROJECT ALPHA"]);
ws.mergeCells("A1:E1");
const titleCell = ws.getCell("A1");
titleCell.font = { bold: true, size: 13, color: { argb: "FF1E3A5F" } };
titleCell.alignment = { horizontal: "center" };

// ─── Row 2: Blank spacer ─────────────────────────────────────────────────────
ws.addRow([]);

// ─── Row 3: Headers ──────────────────────────────────────────────────────────
const hRow = ws.addRow(["#", "Description", "Qty", "Unit Price", "Total"]);
headerStyle(hRow);

// ─── Data rows (rows 4–12) ────────────────────────────────────────────────────
const items = [
  [1, "Structural Steel Beams (Grade 50)", 12, 485.00],
  [2, "Reinforced Concrete Mix (per m³)", 8, 210.50],
  [3, "Galvanized Roofing Sheets 0.5mm", 45, 32.75],
  [4, "PVC Conduit Pipes (20mm, per m)", 200, 1.80],
  [5, "Electrical Cable 6mm² (per m)", 350, 3.40],
  [6, "Distribution Board 12-way", 2, 890.00],
  [7, "LED Floodlights 100W", 8, 125.00],
  [8, "Water Supply Pipes HDPE 50mm (per m)", 80, 12.50],
  [9, "Ceramic Floor Tiles 600x600mm (per m²)", 120, 28.00],
];

const dataStartRow = 4;
items.forEach(([num, desc, qty, price], i) => {
  const rowNum = dataStartRow + i;
  const row = ws.addRow([num, desc, qty, price, null]);

  // E column = qty * price formula
  const totalCell = ws.getCell(`E${rowNum}`);
  totalCell.value = { formula: `C${rowNum}*D${rowNum}`, result: qty * price };
  totalCell.numFmt = "#,##0.00";

  // Format price column
  ws.getCell(`D${rowNum}`).numFmt = "#,##0.00";

  // Alternate row shading
  if (i % 2 === 0) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFB" },
      };
    });
  }

  row.height = 18;
});

// ─── Row 13: Blank ────────────────────────────────────────────────────────────
ws.addRow([]);

// ─── Row 14: Subtotal ─────────────────────────────────────────────────────────
const subtotalRow = 14;
ws.addRow([null, "Subtotal Materials", null, null, null]);
const subtotalCell = ws.getCell(`E${subtotalRow}`);
subtotalCell.value = {
  formula: `SUM(E4:E12)`,
  result: items.reduce((sum, [, , qty, price]) => sum + qty * price, 0),
};
subtotalCell.numFmt = "#,##0.00";
totalStyle(subtotalCell);
ws.getCell(`B${subtotalRow}`).font = { bold: true };

// ─── Row 15: VAT (15%) ───────────────────────────────────────────────────────
const vatRow = 15;
ws.addRow([null, "VAT (15%)", null, null, null]);
const vatCell = ws.getCell(`E${vatRow}`);
vatCell.value = { formula: `E${subtotalRow}*0.15`, result: null };
vatCell.numFmt = "#,##0.00";
ws.getCell(`B${vatRow}`).font = { bold: true };

// ─── Row 16: Discount ────────────────────────────────────────────────────────
const discountRow = 16;
ws.addRow([null, "Discount (5%)", null, null, null]);
const discountCell = ws.getCell(`E${discountRow}`);
discountCell.value = { formula: `E${subtotalRow}*-0.05`, result: null };
discountCell.numFmt = "#,##0.00";
ws.getCell(`B${discountRow}`).font = { bold: true };

// ─── Row 17: Grand Total ─────────────────────────────────────────────────────
const grandTotalRow = 17;
ws.addRow([null, "GRAND TOTAL", null, null, null]);
const grandTotalCell = ws.getCell(`E${grandTotalRow}`);
grandTotalCell.value = {
  formula: `E${subtotalRow}+E${vatRow}+E${discountRow}`,
  result: null,
};
grandTotalCell.numFmt = "#,##0.00";
grandTotalCell.font = { bold: true, size: 11 };
grandTotalCell.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};
grandTotalCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
ws.getCell(`B${grandTotalRow}`).font = { bold: true, size: 11 };

// ─── Second worksheet: Labour ─────────────────────────────────────────────────
const ws2 = wb.addWorksheet("Labour");
ws2.getColumn(1).width = 30;
ws2.getColumn(2).width = 10;
ws2.getColumn(3).width = 12;
ws2.getColumn(4).width = 14;

const lhRow = ws2.addRow(["Task", "Days", "Rate/Day", "Cost"]);
headerStyle(lhRow);

const labour = [
  ["Site Preparation & Excavation", 3, 850],
  ["Foundation & Concrete Works", 5, 1200],
  ["Steel Structure Erection", 4, 950],
  ["Roofing Installation", 3, 750],
  ["Electrical Wiring & Fixtures", 4, 680],
  ["Plumbing & Drainage", 3, 620],
  ["Tiling & Finishing", 5, 520],
];

labour.forEach(([task, days, rate], i) => {
  const rn = 2 + i;
  ws2.addRow([task, days, rate, null]);
  const costCell = ws2.getCell(`D${rn}`);
  costCell.value = { formula: `B${rn}*C${rn}`, result: days * rate };
  costCell.numFmt = "#,##0.00";
  ws2.getCell(`C${rn}`).numFmt = "#,##0.00";
});

ws2.addRow([]);
const lTotalRow = 10;
ws2.addRow(["Total Labour Cost", null, null, null]);
const lTotalCell = ws2.getCell(`D${lTotalRow}`);
lTotalCell.value = {
  formula: `SUM(D2:D8)`,
  result: labour.reduce((s, [, d, r]) => s + d * r, 0),
};
lTotalCell.numFmt = "#,##0.00";
lTotalCell.font = { bold: true };
ws2.getCell(`A${lTotalRow}`).font = { bold: true };

// ─── Save ─────────────────────────────────────────────────────────────────────
await wb.xlsx.writeFile(outPath);
console.log(`✅ Test file created: ${outPath}`);

// Print expected values for verification
const subTotal = items.reduce((sum, [, , qty, price]) => sum + qty * price, 0);
const vat = subTotal * 0.15;
const discount = subTotal * -0.05;
const grand = subTotal + vat + discount;

console.log("\nExpected values:");
console.log(`  Subtotal:    $${subTotal.toFixed(2)}`);
console.log(`  VAT (15%):  $${vat.toFixed(2)}`);
console.log(`  Discount:   $${discount.toFixed(2)}`);
console.log(`  Grand Total: $${grand.toFixed(2)}`);
