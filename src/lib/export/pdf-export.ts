/**
 * PDF Export — generates a downloadable PDF of the current sheet state.
 *
 * Mirrors the on-screen visual hierarchy exactly:
 *   - Dark header row
 *   - Amber subtotal rows
 *   - Blue total row
 *   - Italic section rows (incl. merged cells)
 *   - White data rows
 *
 * Live cell values (user edits + formula recomputation) are sourced from
 * SheetMutation.cells, falling back to cached/raw values — the same priority
 * order used by getLiveValue() in SpreadsheetTable.
 *
 * Deleted rows are excluded (they're logically removed from the document).
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ParsedSheet, SheetMutation } from "@/types";
import { formatCellValue } from "@/lib/utils/number-format";

// ─── Row-type colors (Tailwind → RGB) ────────────────────────────────────────
const ROW_STYLES: Record<
  string,
  {
    fill: [number, number, number];
    text: [number, number, number];
    fontStyle: "bold" | "italic" | "normal";
  }
> = {
  header:  { fill: [30, 41, 59],    text: [255, 255, 255], fontStyle: "bold"   }, // slate-800 / white
  section: { fill: [241, 245, 249], text: [100, 116, 139], fontStyle: "italic" }, // slate-100 / slate-500
  subtotal:{ fill: [255, 251, 235], text: [30, 41, 59],    fontStyle: "bold"   }, // amber-50  / slate-800
  total:   { fill: [239, 246, 255], text: [30, 41, 59],    fontStyle: "bold"   }, // blue-50   / slate-800
  data:    { fill: [255, 255, 255], text: [30, 41, 59],    fontStyle: "normal" }, // white     / slate-800
  unknown: { fill: [255, 255, 255], text: [148, 163, 184], fontStyle: "normal" }, // white     / slate-400
};

// ─── Column alignment by semantic type ───────────────────────────────────────
type HAlign = "left" | "center" | "right";
function getHAlign(semanticType: string | undefined): HAlign {
  switch (semanticType) {
    case "quantity":
    case "unit_price":
    case "amount":
    case "percentage":
      return "right";
    case "identifier":
      return "center";
    default:
      return "left";
  }
}

// ─── Resolve the live display value for a cell ───────────────────────────────
// Priority mirrors getLiveValue() in SpreadsheetTable exactly.
function resolveCellValue(
  address: string,
  rawValue: string | number | boolean | null,
  cachedResult: string | number | null,
  formulaString: string | null,
  cellOverrides: Record<string, string | number | null>
): string | number | null {
  // 1. User mutation override (highest priority)
  if (address in cellOverrides) return cellOverrides[address];
  // 2. Cached formula result
  if (formulaString !== null && cachedResult !== null) return cachedResult;
  // 3. Plain cell raw value
  if (formulaString === null) return rawValue as string | number | null;
  // 4. Unresolved formula — show blank
  return null;
}

// ─── Main export function ─────────────────────────────────────────────────────
export function exportSheetToPDF(
  sheet: ParsedSheet,
  mutation: SheetMutation | null,
  filename: string
): void {
  const cellOverrides = mutation?.cells ?? {};
  const deletedRows   = mutation?.deletedRowIndices ?? new Set<number>();

  // ── Build jspdf-autotable body ──────────────────────────────────────────
  type CellDef = {
    content: string;
    colSpan?: number;
    styles: {
      fillColor: [number, number, number];
      textColor: [number, number, number];
      fontStyle: "bold" | "italic" | "normal";
      halign: HAlign;
      lineWidth: number;
      lineColor: [number, number, number];
    };
  };

  const tableBody: CellDef[][] = [];

  for (const row of sheet.rows) {
    // Skip blank spacer rows and user-deleted rows
    if (row.type === "blank") continue;
    if (deletedRows.has(row.index)) continue;

    const rowStyle = ROW_STYLES[row.type] ?? ROW_STYLES.data;
    const cells: CellDef[] = [];

    for (const cell of row.cells) {
      // Skip merge children — the origin cell handles colSpan
      if (cell.isMergeChild) continue;

      // Determine display text
      let content: string;
      if (row.type === "header") {
        // Header cells: use raw value directly (same as SpreadsheetTable)
        content = String(cell.rawValue ?? cell.displayValue ?? "");
      } else {
        const live = resolveCellValue(
          cell.address,
          cell.rawValue,
          cell.cachedResult,
          cell.formulaString,
          cellOverrides
        );
        content = formatCellValue(live, cell.numberFormat, live as number, null);
      }

      // Column alignment
      const colLetter = cell.address.match(/[A-Z]+/)?.[0] ?? "";
      const colDef = sheet.columns.find((c) => c.letter === colLetter);
      const halign = getHAlign(colDef?.semanticType);

      // Per-cell bold/italic overrides from Excel formatting
      const fontStyle: "bold" | "italic" | "normal" =
        cell.isBold   ? "bold"
        : cell.isItalic ? "italic"
        : rowStyle.fontStyle;

      cells.push({
        content,
        colSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        styles: {
          fillColor: rowStyle.fill,
          textColor: rowStyle.text,
          fontStyle,
          halign,
          lineWidth:  0.1,
          lineColor: [226, 232, 240], // slate-200
        },
      });
    }

    if (cells.length > 0) tableBody.push(cells);
  }

  if (tableBody.length === 0) return; // nothing to export

  // ── Orientation: landscape when the sheet has ≥7 columns ───────────────
  // Portrait A4:  210 mm total − 40 mm margins = 170 mm available
  // Landscape A4: 297 mm total − 40 mm margins = 257 mm available
  const useLandscape = sheet.columns.length >= 7;
  const orientation  = (useLandscape ? "landscape" : "portrait") as "landscape" | "portrait";
  const AVAILABLE_WIDTH_MM = useLandscape ? 257 : 170;

  // ── Proportional column widths ──────────────────────────────────────────
  const totalCharWidth = sheet.columns.reduce(
    (sum, c) => sum + Math.max(c.width ?? 8, 8),
    0
  );
  const columnStyles: Record<number, { cellWidth: number }> = {};
  sheet.columns.forEach((col, i) => {
    const proportion = Math.max(col.width ?? 8, 8) / totalCharWidth;
    columnStyles[i] = { cellWidth: Math.round(proportion * AVAILABLE_WIDTH_MM * 10) / 10 };
  });

  // ── Create PDF document ─────────────────────────────────────────────────
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });

  // Document title header
  const strippedName = filename.replace(/\.(xlsx|xls|xlsm|csv)$/i, "");
  const now = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(strippedName, 20, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Sheet: ${sheet.name}`, 20, 21);

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(`Generated: ${now}`, 20, 26);

  // ── Render table ────────────────────────────────────────────────────────
  // Provide a hidden head row so jspdf-autotable knows the column count
  // before encountering the first body row (which may have colSpan).
  const hiddenHead: string[][] = [
    Array.from({ length: sheet.columnCount }, () => ""),
  ];

  autoTable(doc, {
    head: hiddenHead,
    showHead: "never",          // hide the placeholder head row
    body: tableBody as unknown as string[][],
    startY: 30,
    theme: "plain",             // we control all styles per-cell
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      overflow: "linebreak",
    },
    columnStyles,
    margin: { left: 20, right: 20 },
  });

  // ── Save / download ─────────────────────────────────────────────────────
  doc.save(`${strippedName}.pdf`);
}
