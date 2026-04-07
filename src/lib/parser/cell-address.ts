/**
 * Utilities for converting between Excel A1 notation and {row, col} indices.
 * All row/col values here are 1-based (matching ExcelJS conventions).
 */

/** Convert a column letter (A, B, ..., Z, AA, AB...) to a 1-based column index. */
export function colLetterToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64);
  }
  return result;
}

/** Convert a 1-based column index to a column letter. */
export function colIndexToLetter(index: number): string {
  let result = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

/**
 * Parse an A1-style cell address (with optional $ anchors) into {row, col} (1-based).
 * e.g. "B4" → { col: 2, row: 4 }, "$D$10" → { col: 4, row: 10 }
 */
export function parseAddress(addr: string): { col: number; row: number } | null {
  const match = addr.replace(/\$/g, "").match(/^([A-Z]{1,3})([1-9][0-9]*)$/i);
  if (!match) return null;
  return {
    col: colLetterToIndex(match[1].toUpperCase()),
    row: parseInt(match[2], 10),
  };
}

/** Build an A1 address from 1-based {row, col}. */
export function buildAddress(col: number, row: number): string {
  return `${colIndexToLetter(col)}${row}`;
}

/**
 * Expand a range reference like "D2:D10" into an array of individual cell addresses.
 * Handles cross-column ranges too, e.g. "A1:C3".
 */
export function expandRange(rangeStr: string): string[] {
  const parts = rangeStr.split(":");
  if (parts.length !== 2) return [];

  const start = parseAddress(parts[0]);
  const end = parseAddress(parts[1]);
  if (!start || !end) return [];

  const addresses: string[] = [];
  for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
    for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
      addresses.push(buildAddress(c, r));
    }
  }
  return addresses;
}

/**
 * Extract all cell references from a formula string.
 * Handles individual refs ("B4") and ranges ("D2:D10").
 * Returns individual addresses (ranges are expanded).
 */
export function extractCellRefs(formula: string): string[] {
  // Remove the leading "=" if present
  const expr = formula.startsWith("=") ? formula.slice(1) : formula;

  const addresses = new Set<string>();

  // Match range patterns first (e.g. D2:D10, $A$1:$C$3)
  const rangeRegex = /\$?([A-Z]{1,3})\$?([1-9][0-9]*)\s*:\s*\$?([A-Z]{1,3})\$?([1-9][0-9]*)/gi;
  const rangeMatches = expr.matchAll(rangeRegex);
  const rangeStrings = new Set<string>();

  for (const m of rangeMatches) {
    const rangeStr = `${m[1].toUpperCase()}${m[2]}:${m[3].toUpperCase()}${m[4]}`;
    rangeStrings.add(m[0]); // raw matched text to exclude from single-ref pass
    expandRange(rangeStr).forEach((addr) => addresses.add(addr));
  }

  // Remove range occurrences from expression before single-ref extraction
  let exprNoRanges = expr;
  for (const r of rangeStrings) {
    exprNoRanges = exprNoRanges.replace(r, " ");
  }

  // Match individual cell references
  const singleRegex = /\$?([A-Z]{1,3})\$?([1-9][0-9]*)/gi;
  for (const m of exprNoRanges.matchAll(singleRegex)) {
    addresses.add(`${m[1].toUpperCase()}${m[2]}`);
  }

  return Array.from(addresses);
}

/**
 * Detect computation axis from formula dependencies relative to the formula cell itself.
 * - "row"    → all deps are on the same row as the formula (e.g. =B4*C4)
 * - "column" → all deps are in the same column or span multiple rows (e.g. =SUM(D2:D10))
 * - "mixed"  → both
 * - "none"   → no deps (constant formula)
 */
export function detectComputationAxis(
  formulaAddr: string,
  deps: string[]
): "row" | "column" | "mixed" | "none" {
  if (deps.length === 0) return "none";

  const fParsed = parseAddress(formulaAddr);
  if (!fParsed) return "none";

  let sameRow = 0;
  let diffRow = 0;

  for (const dep of deps) {
    const parsed = parseAddress(dep);
    if (!parsed) continue;
    if (parsed.row === fParsed.row) {
      sameRow++;
    } else {
      diffRow++;
    }
  }

  if (sameRow > 0 && diffRow > 0) return "mixed";
  if (diffRow > 0) return "column";
  return "row";
}
