import type { ColumnSemanticType, ParsedColumn } from "@/types";

interface ColumnSample {
  index: number;   // 0-based
  letter: string;
  headerText: string;
  width: number;
  dataCellValues: Array<string | number | boolean | null>;
  dataNumberFormats: Array<string | null>;
  hasRootFormula: boolean; // if any cell in this column is a root formula cell
  formulaCellCount: number; // how many cells in this column are formula cells
}

/**
 * Infer the semantic type of each column from:
 *   1. numericRatio (proportion of numeric data cells)
 *   2. Header text regex hints
 *   3. Number format (currency "$" → amount/unit_price, "%" → percentage)
 *   4. Whether the column contains root formula cells
 */
export function inferColumns(samples: ColumnSample[]): ParsedColumn[] {
  return samples.map((col) => {
    const allValues = col.dataCellValues;
    const nonEmpty = allValues.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    const numericCount = nonEmpty.filter((v) => typeof v === "number").length;

    // Treat formula cells (even with null cached result) as numeric candidates.
    // A formula cell with null result is "unresolved" not "text".
    const nullFormulaCount = Math.max(
      0,
      col.formulaCellCount - nonEmpty.filter((v) => typeof v === "number").length
    );
    const adjustedNumericCount = numericCount + nullFormulaCount;
    const totalForRatio = nonEmpty.length + nullFormulaCount;
    const numericRatio =
      totalForRatio > 0 ? adjustedNumericCount / totalForRatio : 0;

    const header = col.headerText.toLowerCase().trim();
    const numFmts = col.dataNumberFormats.filter(Boolean) as string[];
    const hasCurrencyFmt = numFmts.some(
      (f) =>
        f.includes("$") ||
        f.includes("£") ||
        f.includes("€") ||
        f.toLowerCase().includes("curr")
    );
    const hasPercentFmt = numFmts.some((f) => f.includes("%"));

    let semanticType: ColumnSemanticType = "unknown";

    if (numericRatio > 0.7) {
      if (col.hasRootFormula) {
        semanticType = "amount";
      } else if (hasPercentFmt || /percent|%|disc/i.test(header)) {
        semanticType = "percentage";
      } else if (
        hasCurrencyFmt ||
        /price|rate|cost|unit\s*price|up|u\/price/i.test(header)
      ) {
        semanticType = "unit_price";
      } else if (/amount|total|value|ext|subtotal|sum/i.test(header)) {
        semanticType = "amount";
      } else if (
        /qty|quantity|count|no\.|#|units|pcs|pieces|ea\./i.test(header)
      ) {
        semanticType = "quantity";
      } else {
        // Default for numeric-heavy columns without clear header: amount
        semanticType = "amount";
      }
    } else if (numericRatio < 0.15) {
      if (/date|time|when|period/i.test(header)) {
        semanticType = "date";
      } else if (/code|ref|sku|id|no\.|item\s*#|part/i.test(header)) {
        semanticType = "identifier";
      } else {
        semanticType = "description";
      }
    } else {
      // Mixed column — use header and formula presence as hints
      if (/desc|name|item|product|material|service/i.test(header)) {
        semanticType = "description";
      } else if (/code|ref|sku/i.test(header)) {
        semanticType = "identifier";
      } else if (
        /amount|total|value|ext|subtotal|sum|price|rate|cost/i.test(header) ||
        col.hasRootFormula ||
        col.formulaCellCount > 0
      ) {
        // Column has formulas + numeric data → likely a computed amount
        semanticType = "amount";
      }
    }

    return {
      index: col.index,
      letter: col.letter,
      headerText: col.headerText || col.letter,
      semanticType,
      isNumeric: numericRatio > 0.5,
      width: col.width,
    } satisfies ParsedColumn;
  });
}
