import type { RowType } from "@/types";
import type { FormulaMap } from "@/types";
import { parseAddress } from "./cell-address";

interface RawCell {
  address: string;
  rawValue: string | number | boolean | null;
  formulaString: string | null;
  isBold: boolean;
  text: string;
}

interface RawRow {
  rowNumber: number;
  cells: RawCell[];
}

/**
 * Classify each row using the formula dependency tree as the PRIMARY signal.
 * Keywords and formatting are used only as secondary tie-breakers.
 *
 * Classification priority:
 *  1. blank         → no non-empty cells
 *  2. header        → text-only row (no numerics, no formula deps), above first data row
 *  3. total         → contains a ROOT formula cell (depth = 0, column-axis)
 *  4. subtotal      → contains a column-axis formula cell at depth >= 1
 *  5. data          → is a leaf in the tree OR has row-axis formula cells (=B4*C4)
 *  6. section       → text-only row NOT before data rows (group label)
 *  7. unknown       → fallback
 */
export function classifyRows(rows: RawRow[], formulaMap: FormulaMap, totalRows: number): RowType[] {
  const types: RowType[] = new Array(rows.length).fill("unknown" as RowType);

  // Build a lookup: address → formula entry
  const addressToFormula = new Map(Object.entries(formulaMap));

  // Pre-compute per-row stats
  const rowStats = rows.map((row) => {
    // A cell is "non-empty" if it has a value OR if it has a formula (even with
    // a null cached result — the formula engine will compute it at runtime).
    const nonEmpty = row.cells.filter(
      (c) =>
        c.formulaString !== null ||
        (c.rawValue !== null && c.rawValue !== undefined && c.rawValue !== "")
    );
    // Text/number counts only from cells with actual raw values (not null-result formulas)
    const textCells = nonEmpty.filter(
      (c) => c.formulaString === null && typeof c.rawValue === "string"
    );
    const numCells = nonEmpty.filter(
      (c) => c.formulaString === null && typeof c.rawValue === "number"
    );
    const boldCells = nonEmpty.filter((c) => c.isBold);
    const formulaCells = nonEmpty.filter((c) => c.formulaString !== null);

    const rootFormulaCell = formulaCells.find((c) => {
      const entry = addressToFormula.get(c.address);
      return entry && entry.isRoot && entry.computationAxis === "column";
    });

    const subtotalFormulaCell = formulaCells.find((c) => {
      const entry = addressToFormula.get(c.address);
      return entry && !entry.isRoot && entry.computationAxis === "column";
    });

    const rowAxisOnlyFormulas = formulaCells.every((c) => {
      const entry = addressToFormula.get(c.address);
      return entry && entry.computationAxis === "row";
    });

    const isInTree = nonEmpty.some((c) => {
      return addressToFormula.has(c.address);
    });

    return {
      nonEmpty,
      textCells,
      numCells,
      boldCells,
      formulaCells,
      rootFormulaCell,
      subtotalFormulaCell,
      rowAxisOnlyFormulas,
      isInTree,
    };
  });

  // Find first and last data-likely row index (used for header detection)
  let firstDataRowIndex = -1;

  // ── Pass 1: Formula-tree-based classification ──────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const stats = rowStats[i];

    if (stats.nonEmpty.length === 0) {
      types[i] = "blank";
      continue;
    }

    if (stats.rootFormulaCell) {
      types[i] = "total";
      continue;
    }

    if (stats.subtotalFormulaCell) {
      types[i] = "subtotal";
      continue;
    }

    // Data: is leaf in tree, or has row-axis formulas (qty * price style)
    if (stats.isInTree || (stats.formulaCells.length > 0 && stats.rowAxisOnlyFormulas)) {
      types[i] = "data";
      if (firstDataRowIndex === -1) firstDataRowIndex = i;
      continue;
    }

    // All text → candidate for header or section
    if (stats.numCells.length === 0 && stats.textCells.length > 0) {
      // Will refine in pass 2
      types[i] = "section";
      continue;
    }

    // Has numbers but no formula refs → plain data row
    if (stats.numCells.length > 0) {
      types[i] = "data";
      if (firstDataRowIndex === -1) firstDataRowIndex = i;
      continue;
    }
  }

  // ── Pass 2: Promote text-only rows above first data row to "header" or keep as "section" ──
  // Rule: only the LAST text-only row immediately before the first data row becomes "header".
  // Any earlier text-only rows (e.g., merged title rows) stay as "section".
  if (firstDataRowIndex > 0) {
    // Find the last "section" row before firstDataRowIndex
    let lastSectionBeforeData = -1;
    for (let i = 0; i < firstDataRowIndex; i++) {
      if (types[i] === "section") {
        lastSectionBeforeData = i;
      }
    }

    if (lastSectionBeforeData >= 0) {
      // Promote only the last qualifying text-only row to "header"
      types[lastSectionBeforeData] = "header";
      // All earlier text-only rows remain "section" (merged titles, etc.)
    }
  }

  // ── Pass 3: Context-based reclassification of "unknown" rows ──────────────
  for (let i = 1; i < rows.length - 1; i++) {
    if (types[i] === "unknown") {
      const prev = types[i - 1];
      const next = types[i + 1];
      if ((prev === "data" || prev === "subtotal") && (next === "data" || next === "subtotal")) {
        types[i] = "data";
      }
    }
  }

  return types;
}
