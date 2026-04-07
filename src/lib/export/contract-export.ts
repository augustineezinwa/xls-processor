/**
 * Contract PDF Export
 *
 * Generates a formal contract agreement PDF that includes:
 *   - Party names and date of agreement
 *   - Schedule of Works (live sheet data with all user edits applied)
 *   - Editable terms & conditions body text
 *   - Signature blocks with clearly labelled blank lines
 *
 * Cell values use the same priority order as the on-screen table:
 *   mutation override → cached formula result → raw value → null
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ParsedSheet, SheetMutation } from "@/types";
import { formatCellValue } from "@/lib/utils/number-format";

// ─── Shared colour palette (Tailwind → RGB) ───────────────────────────────────
const C = {
  slate800: [30, 41, 59]   as [number, number, number],
  slate600: [71, 85, 105]  as [number, number, number],
  slate500: [100, 116, 139]as [number, number, number],
  slate200: [226, 232, 240]as [number, number, number],
  gray400:  [156, 163, 175]as [number, number, number],
  white:    [255, 255, 255]as [number, number, number],
  amber50:  [255, 251, 235]as [number, number, number],
  blue50:   [239, 246, 255]as [number, number, number],
  slate100: [241, 245, 249]as [number, number, number],
};

// ─── Row-type → PDF cell style ────────────────────────────────────────────────
const ROW_STYLES: Record<
  string,
  { fill: [number,number,number]; text: [number,number,number]; fontStyle: "bold"|"italic"|"normal" }
> = {
  header:   { fill: [30, 41, 59],    text: [255,255,255], fontStyle: "bold"   },
  section:  { fill: [241, 245, 249], text: [100,116,139], fontStyle: "italic" },
  subtotal: { fill: [255, 251, 235], text: [30, 41, 59],  fontStyle: "bold"   },
  total:    { fill: [239, 246, 255], text: [30, 41, 59],  fontStyle: "bold"   },
  data:     { fill: [255, 255, 255], text: [30, 41, 59],  fontStyle: "normal" },
  unknown:  { fill: [255, 255, 255], text: [148,163,184], fontStyle: "normal" },
};

type HAlign = "left" | "center" | "right";
function getHAlign(semanticType: string | undefined): HAlign {
  switch (semanticType) {
    case "quantity": case "unit_price": case "amount": case "percentage": return "right";
    case "identifier": return "center";
    default: return "left";
  }
}

function resolveCellValue(
  address: string,
  rawValue: string | number | boolean | null,
  cachedResult: string | number | null,
  formulaString: string | null,
  cellOverrides: Record<string, string | number | null>
): string | number | null {
  if (address in cellOverrides) return cellOverrides[address];
  if (formulaString !== null && cachedResult !== null) return cachedResult;
  if (formulaString === null) return rawValue as string | number | null;
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function drawDivider(doc: jsPDF, y: number) {
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(0.25);
  doc.line(20, y, 190, y);
}

function sectionHeading(doc: jsPDF, text: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.slate500);
  doc.text(text.toUpperCase(), 20, y);
}

// ─── Public interface ─────────────────────────────────────────────────────────
export interface ContractExportParams {
  sheet: ParsedSheet;
  mutation: SheetMutation | null;
  partyA: string;
  partyB: string;
  agreementDate: string;  // "YYYY-MM-DD"
  contractBody: string;
}

export function exportContractToPDF({
  sheet,
  mutation,
  partyA,
  partyB,
  agreementDate,
  contractBody,
}: ContractExportParams): void {
  const cellOverrides = mutation?.cells ?? {};
  const deletedRows   = mutation?.deletedRowIndices ?? new Set<number>();

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // ── 1. Header ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.slate800);
  doc.text("CONTRACT AGREEMENT", 105, 20, { align: "center" });

  // Decorative underline beneath title
  doc.setDrawColor(...C.slate200);
  doc.setLineWidth(0.4);
  doc.line(50, 23, 160, 23);

  // Date of agreement
  const formattedDate = agreementDate
    ? new Date(agreementDate + "T00:00:00").toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      })
    : "________________";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...C.slate600);
  doc.text(`Date of Agreement:  ${formattedDate}`, 105, 31, { align: "center" });

  // ── 2. Parties ─────────────────────────────────────────────────────────────
  let y = 42;
  drawDivider(doc, y);
  y += 7;
  sectionHeading(doc, "Parties", y);
  y += 6;

  const renderPartyLine = (label: string, value: string, yPos: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...C.slate500);
    doc.text(label, 20, yPos);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.slate800);
    doc.text(value || "________________________________", 20, yPos + 5.5);
  };

  renderPartyLine("Party A – Supplier / Provider", partyA, y);
  y += 13;
  renderPartyLine("Party B – Client / Buyer", partyB, y);
  y += 13;

  // ── 3. Schedule of Works ───────────────────────────────────────────────────
  drawDivider(doc, y);
  y += 7;
  sectionHeading(doc, "Schedule of Works", y);
  y += 4;

  // Build autotable body (same logic as pdf-export.ts)
  type CellDef = {
    content: string;
    colSpan?: number;
    styles: {
      fillColor: [number,number,number];
      textColor: [number,number,number];
      fontStyle: "bold"|"italic"|"normal";
      halign: HAlign;
      lineWidth: number;
      lineColor: [number,number,number];
    };
  };

  const tableBody: CellDef[][] = [];
  for (const row of sheet.rows) {
    if (row.type === "blank") continue;
    if (deletedRows.has(row.index)) continue;

    const rs = ROW_STYLES[row.type] ?? ROW_STYLES.data;
    const cells: CellDef[] = [];

    for (const cell of row.cells) {
      if (cell.isMergeChild) continue;

      let content: string;
      if (row.type === "header") {
        content = String(cell.rawValue ?? cell.displayValue ?? "");
      } else {
        const live = resolveCellValue(
          cell.address, cell.rawValue, cell.cachedResult,
          cell.formulaString, cellOverrides
        );
        content = formatCellValue(live, cell.numberFormat, live as number, null);
      }

      const colLetter = cell.address.match(/[A-Z]+/)?.[0] ?? "";
      const colDef    = sheet.columns.find(c => c.letter === colLetter);

      cells.push({
        content,
        colSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        styles: {
          fillColor: rs.fill,
          textColor: rs.text,
          fontStyle: cell.isBold ? "bold" : cell.isItalic ? "italic" : rs.fontStyle,
          halign: getHAlign(colDef?.semanticType),
          lineWidth: 0.1,
          lineColor: C.slate200,
        },
      });
    }
    if (cells.length > 0) tableBody.push(cells);
  }

  // Proportional column widths (170 mm available)
  const totalCharW = sheet.columns.reduce((s, c) => s + Math.max(c.width ?? 8, 8), 0);
  const colStyles: Record<number, { cellWidth: number }> = {};
  sheet.columns.forEach((col, i) => {
    colStyles[i] = { cellWidth: Math.round((Math.max(col.width ?? 8, 8) / totalCharW) * 170 * 10) / 10 };
  });

  // Hidden head row to fix column count (same technique as pdf-export.ts)
  const hiddenHead = [Array.from({ length: sheet.columnCount }, () => "")];

  autoTable(doc, {
    head: hiddenHead,
    showHead: "never",
    body: tableBody as unknown as string[][],
    startY: y,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 3.5, right: 3.5 }, overflow: "linebreak" },
    columnStyles: colStyles,
    margin: { left: 20, right: 20 },
  });

  // ── 4. Terms & Conditions ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // Auto-add page if needed
  const pageH = doc.internal.pageSize.getHeight();
  const checkY = (needed: number) => {
    if (y + needed > pageH - 20) { doc.addPage(); y = 20; }
  };

  checkY(20);
  drawDivider(doc, y);
  y += 7;
  sectionHeading(doc, "Terms & Conditions", y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.slate800);

  const lines = doc.splitTextToSize(contractBody, 170);
  for (const line of lines) {
    checkY(5);
    doc.text(line, 20, y);
    y += 4.5;
  }
  y += 3;

  // ── 5. Signatures ──────────────────────────────────────────────────────────
  checkY(55);
  drawDivider(doc, y);
  y += 7;
  sectionHeading(doc, "Signatures", y);
  y += 7;

  const sigBlocks: Array<{ x: number; label: string }> = [
    { x: 20,  label: "Supplier / Provider" },
    { x: 112, label: "Client / Buyer"      },
  ];

  const sigLines = ["Name", "Signature", "Date"];

  for (const block of sigBlocks) {
    // Block heading
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...C.slate600);
    doc.text(block.label, block.x, y);
  }
  y += 8;

  for (const lineName of sigLines) {
    for (const block of sigBlocks) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.slate500);
      doc.text(`${lineName}:`, block.x, y);

      // Underline
      doc.setDrawColor(...C.gray400);
      doc.setLineWidth(0.3);
      const lineStartX = block.x + 22;
      doc.line(lineStartX, y, lineStartX + 62, y);
    }
    y += 9;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const totalPages = (doc.internal as { getNumberOfPages?: () => number }).getNumberOfPages?.() ?? 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.gray400);
    doc.text(
      `Page ${p} of ${totalPages}  ·  contract-agreement`,
      105, pageH - 8, { align: "center" }
    );
  }

  doc.save("contract-agreement.pdf");
}
