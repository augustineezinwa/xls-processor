/**
 * Client-side formula reference parser.
 * Extracts cell addresses and ranges from Excel formula strings.
 * Also handles range expansion for formula evaluation.
 */

/** Expand a range like "D2:D10" into an array of addresses. */
export function expandRange(rangeStr: string): string[] {
  const parts = rangeStr.split(":");
  if (parts.length !== 2) return [];

  const parseAddr = (addr: string) => {
    const m = addr.replace(/\$/g, "").match(/^([A-Z]{1,3})([1-9][0-9]*)$/i);
    if (!m) return null;
    return {
      col: m[1].toUpperCase(),
      row: parseInt(m[2], 10),
    };
  };

  const colToNum = (col: string): number => {
    let n = 0;
    for (let i = 0; i < col.length; i++) {
      n = n * 26 + (col.charCodeAt(i) - 64);
    }
    return n;
  };

  const numToCol = (n: number): string => {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const start = parseAddr(parts[0]);
  const end = parseAddr(parts[1]);
  if (!start || !end) return [];

  const startCol = colToNum(start.col);
  const endCol = colToNum(end.col);

  const addresses: string[] = [];
  for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
    for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
      addresses.push(`${numToCol(c)}${r}`);
    }
  }
  return addresses;
}

/**
 * Given a formula string and a values map, substitute all cell references
 * with their current numeric/string values and return a JS-evaluatable expression.
 *
 * Handles:
 *   - Ranges: SUM(D2:D10) → passes array to function
 *   - Single refs: =B4*C4 → substituted inline
 *   - Mixed: =IF(B3>0, B3*C3, 0)
 */
export function substituteRefs(
  formula: string,
  getValue: (addr: string) => number | string | null
): string {
  // Strip leading "="
  let expr = formula.startsWith("=") ? formula.slice(1) : formula;

  // 1. Replace range references with arrays
  //    e.g. SUM(D2:D10) → SUM([10,20,30,...])
  const rangeRegex =
    /\$?([A-Z]{1,3})\$?([1-9][0-9]*)\s*:\s*\$?([A-Z]{1,3})\$?([1-9][0-9]*)/gi;

  const rangeMatches = Array.from(expr.matchAll(rangeRegex));

  // Replace from end to start to preserve indices
  for (let i = rangeMatches.length - 1; i >= 0; i--) {
    const m = rangeMatches[i];
    const rangeStr = `${m[1].toUpperCase()}${m[2]}:${m[3].toUpperCase()}${m[4]}`;
    const addrs = expandRange(rangeStr);
    const values = addrs
      .map((a) => getValue(a))
      .filter((v) => v !== null && v !== undefined)
      .map((v) => (typeof v === "string" ? `"${v}"` : String(v)));

    const replacement = `[${values.join(",")}]`;
    expr = expr.slice(0, m.index!) + replacement + expr.slice(m.index! + m[0].length);
  }

  // 2. Replace remaining single cell references
  const singleRegex = /\$?([A-Z]{1,3})\$?([1-9][0-9]*)/gi;
  expr = expr.replace(singleRegex, (_, col, row) => {
    const addr = `${col.toUpperCase()}${row}`;
    const val = getValue(addr);
    if (val === null || val === undefined) return "0";
    if (typeof val === "string") return `"${val}"`;
    return String(val);
  });

  return expr;
}
