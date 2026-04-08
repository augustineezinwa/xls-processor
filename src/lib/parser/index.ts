/**
 * Server-side Excel parser.
 * Uses ExcelJS to extract all cell data, then builds:
 *   - Formula dependency graph (formula-first approach)
 *   - Row classifications (driven by graph position, not keywords)
 *   - Column semantic types
 *   - Merged cell metadata
 *
 * This file must only be imported in server contexts (API routes, server components).
 * ExcelJS uses Node.js built-ins (fs, stream, Buffer) and cannot run in the browser.
 */

import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import type { ParsedWorkbook, ParsedSheet, ParsedRow, ParsedCell, ComputationAxis } from "@/types";
import { buildFormulaGraph, getAllTreeAddresses } from "./formulaExtractor";
import { parseMergeRegions, buildMergeLookup } from "./mergedCellHandler";
import { classifyRows } from "./rowClassifier";
import { inferColumns } from "./columnInferrer";
import { colIndexToLetter, detectComputationAxis } from "./cellAddress";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveRawValue(cell: ExcelJS.Cell): string | number | boolean | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;

  if (typeof v === "object") {
    // Formula cell (with OR without cached result)
    // ExcelJS may omit the "result" key when result is null — treat as null
    if ("formula" in v || "sharedFormula" in v) {
      const fv = v as ExcelJS.CellFormulaValue;
      const result = "result" in fv ? fv.result : null;
      if (result === null || result === undefined) return null;
      if (typeof result === "object" && "error" in result) return null;
      return result as string | number | boolean;
    }

    // Rich text — join all runs into plain string
    if ("richText" in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    }

    // Hyperlink — use display text
    if ("text" in v) {
      const text = (v as ExcelJS.CellHyperlinkValue).text;
      return typeof text === "object"
        ? String((text as ExcelJS.CellRichTextValue).richText?.map((r) => r.text).join("") ?? "")
        : String(text ?? "");
    }

    // Date stored as object (shouldn't normally happen but be safe)
    if (v instanceof Date) {
      return v.toLocaleDateString();
    }

    // Date stored as object
    if (v instanceof Date) {
      return (v as Date).toLocaleDateString();
    }

    // Unknown object — return null instead of "[object Object]"
    return null;
  }

  return v as string | number | boolean;
}

function resolveCachedResult(cell: ExcelJS.Cell): number | string | null {
  const v = cell.value;
  if (!v || typeof v !== "object") return null;
  if (!("formula" in v) && !("sharedFormula" in v)) return null;
  const fv = v as ExcelJS.CellFormulaValue;
  if (!("result" in fv)) return null;
  const res = fv.result;
  if (res === null || res === undefined) return null;
  if (typeof res === "object" && "error" in res) return null;
  if (typeof res === "number" || typeof res === "string") return res;
  return null;
}

function resolveFormulaString(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (!v || typeof v !== "object") return null;
  if ("formula" in v) return `=${(v as ExcelJS.CellFormulaValue).formula}`;
  if ("sharedFormula" in v) return `=${(v as ExcelJS.CellSharedFormulaValue).sharedFormula}`;
  return null;
}

function formatDisplayValue(rawValue: string | number | boolean | null): string {
  if (rawValue === null || rawValue === undefined) return "";
  if (typeof rawValue === "number") {
    // Basic number formatting — preserve decimals up to 4 places
    return rawValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(rawValue);
}

function getArgbHex(color: Partial<ExcelJS.Color> | undefined): string | null {
  if (!color) return null;
  const argb = color.argb;
  if (!argb || argb === "FF000000" || argb === "FFFFFFFF") return null;
  return `#${argb.slice(2)}`; // strip alpha prefix
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function parseWorkbook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buffer: any,
  filename: string
): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets: ParsedSheet[] = [];

  for (let si = 0; si < wb.worksheets.length; si++) {
    const ws = wb.worksheets[si];
    const parsed = parseSheet(ws, si);
    if (parsed) sheets.push(parsed);
  }

  return {
    filename,
    parsedAt: new Date().toISOString(),
    sheets,
    activeSheetIndex: 0,
  };
}

function parseSheet(ws: ExcelJS.Worksheet, sheetIndex: number): ParsedSheet | null {
  // ── Phase 1: Determine used range ─────────────────────────────────────────
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;

  if (rowCount === 0 || colCount === 0) return null;

  // ── Phase 2: Parse merged cell regions ───────────────────────────────────
  // ws.model.merges is the public ExcelJS API — returns string[] like ["A1:E1"]
  // _merges is keyed by origin address only (not range strings), so avoid it.
  const mergeStrings: string[] = (ws.model as { merges?: string[] }).merges ?? [];
  const mergeRegions = parseMergeRegions(mergeStrings);
  const mergeLookup = buildMergeLookup(mergeRegions);

  // ── Phase 3: Raw cell extraction ─────────────────────────────────────────
  // Track actual max column index used
  let maxColUsed = 0;

  interface RowData {
    rowNumber: number;
    // colIndex (1-based) → raw cell info
    cells: Map<
      number,
      {
        address: string;
        rawValue: string | number | boolean | null;
        formulaString: string | null;
        cachedResult: number | string | null;
        isBold: boolean;
        isItalic: boolean;
        backgroundColor: string | null;
        fontColor: string | null;
        numberFormat: string | null;
        text: string;
      }
    >;
    outlineLevel: number;
  }

  const rawRows: RowData[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const rowData: RowData = {
      rowNumber,
      cells: new Map(),
      outlineLevel: row.outlineLevel ?? 0,
    };

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > maxColUsed) maxColUsed = colNumber;

      const rawValue = resolveRawValue(cell);
      const formulaString = resolveFormulaString(cell);
      const cachedResult = formulaString ? resolveCachedResult(cell) : null;

      rowData.cells.set(colNumber, {
        address: cell.address,
        rawValue,
        formulaString,
        cachedResult,
        isBold: cell.font?.bold === true,
        isItalic: cell.font?.italic === true,
        backgroundColor: getArgbHex(cell.fill?.type === "pattern" ? cell.fill?.fgColor : undefined),
        fontColor: getArgbHex(cell.font?.color),
        numberFormat: typeof cell.numFmt === "string" ? cell.numFmt : null,
        text: cell.text ?? "",
      });
    });

    rawRows.push(rowData);
  });

  if (rawRows.length === 0) return null;

  // Determine actual max column count
  const effectiveColCount = Math.max(maxColUsed, 1);

  // ── Phase 4: Extract formula cells & build dependency graph ──────────────
  const formulaCellInputs: Array<{ address: string; formulaString: string }> = [];

  for (const row of rawRows) {
    for (const cellData of row.cells.values()) {
      if (cellData.formulaString) {
        formulaCellInputs.push({
          address: cellData.address,
          formulaString: cellData.formulaString,
        });
      }
    }
  }

  const { formulaMap, dependencyGraph } = buildFormulaGraph(formulaCellInputs);
  const treeAddresses = getAllTreeAddresses(formulaMap);

  // ── Phase 5: Classify rows ────────────────────────────────────────────────
  const rowInputs = rawRows.map((row) => ({
    rowNumber: row.rowNumber,
    cells: Array.from(row.cells.values()).map((c) => ({
      address: c.address,
      rawValue: c.rawValue,
      formulaString: c.formulaString,
      isBold: c.isBold,
      text: c.text,
    })),
  }));

  const rowTypes = classifyRows(rowInputs, formulaMap, rawRows.length);

  // ── Phase 6: Identify header row index ───────────────────────────────────
  // Use the LAST header-classified row before the first data row.
  // This correctly handles sheets where a merged title row precedes the
  // actual column-header row (e.g. "PROJECT ALPHA" above "#, Description, Qty…").
  const allHeaderIndices = rowTypes.map((t, i) => (t === "header" ? i : -1)).filter((i) => i >= 0);

  const firstDataIndex = rowTypes.findIndex(
    (t) => t === "data" || t === "subtotal" || t === "total"
  );

  // Among header rows that appear before the first data row, pick the last one.
  // If no data row found, take the last header row.
  let headerRowArrayIndex = -1;
  for (const hi of allHeaderIndices) {
    if (firstDataIndex === -1 || hi < firstDataIndex) {
      headerRowArrayIndex = hi; // keep updating → ends on the last qualifying header
    }
  }

  const headerRowNumber = headerRowArrayIndex >= 0 ? rawRows[headerRowArrayIndex].rowNumber : null;

  // ── Phase 7: Build column header texts ───────────────────────────────────
  const columnHeaders: Map<number, string> = new Map(); // colIndex(1-based) → text
  if (headerRowNumber !== null) {
    const hRow = rawRows.find((r) => r.rowNumber === headerRowNumber);
    if (hRow) {
      // Only use cells that are NOT merge-children (avoid duplicating merged titles)
      for (const [colNum, cell] of hRow.cells.entries()) {
        if (
          cell.address &&
          mergeLookup.get(cell.address)?.originAddress !== cell.address &&
          mergeLookup.has(cell.address)
        ) {
          // merge child — skip
          continue;
        }
        const text = cell.text || String(cell.rawValue ?? "");
        if (text.trim()) columnHeaders.set(colNum, text.trim());
      }
    }
  }

  // ── Phase 8: Gather column sample data for type inference ─────────────────
  const colSamples: Map<
    number,
    {
      values: Array<string | number | boolean | null>;
      numFmts: Array<string | null>;
      hasRootFormula: boolean;
      formulaCellCount: number;
    }
  > = new Map();

  for (let c = 1; c <= effectiveColCount; c++) {
    colSamples.set(c, {
      values: [],
      numFmts: [],
      hasRootFormula: false,
      formulaCellCount: 0,
    });
  }

  for (let ri = 0; ri < rawRows.length; ri++) {
    if (rowTypes[ri] === "header" || rowTypes[ri] === "blank") continue;
    const row = rawRows[ri];
    for (const [colNum, cell] of row.cells.entries()) {
      const sample = colSamples.get(colNum);
      if (!sample) continue;
      sample.values.push(cell.rawValue);
      sample.numFmts.push(cell.numberFormat);
      if (cell.formulaString) {
        sample.formulaCellCount++;
        const entry = formulaMap[cell.address];
        if (entry?.isRoot) sample.hasRootFormula = true;
      }
    }
  }

  // ── Phase 9: Infer column types ───────────────────────────────────────────
  const colWidth = (colNum: number) => {
    try {
      const col = ws.getColumn(colNum);
      return col.width ?? 12;
    } catch {
      return 12;
    }
  };

  const columns = inferColumns(
    Array.from({ length: effectiveColCount }, (_, i) => {
      const colNum = i + 1;
      const sample = colSamples.get(colNum) ?? {
        values: [],
        numFmts: [],
        hasRootFormula: false,
        formulaCellCount: 0,
      };
      return {
        index: i,
        letter: colIndexToLetter(colNum),
        headerText: columnHeaders.get(colNum) ?? colIndexToLetter(colNum),
        width: colWidth(colNum),
        dataCellValues: sample.values,
        dataNumberFormats: sample.numFmts,
        hasRootFormula: sample.hasRootFormula,
        formulaCellCount: sample.formulaCellCount,
      };
    })
  );

  // ── Phase 10: Build ParsedRows ────────────────────────────────────────────
  let dataRowCount = 0;

  const parsedRows: ParsedRow[] = rawRows.map((row, ri) => {
    const rowType = rowTypes[ri];
    const isEditable =
      rowType === "data" || rowType === "subtotal" || rowType === "total" || rowType === "unknown";

    if (rowType === "data") dataRowCount++;

    const cells: ParsedCell[] = Array.from({ length: effectiveColCount }, (_, ci) => {
      const colNum = ci + 1;
      const addr = `${colIndexToLetter(colNum)}${row.rowNumber}`;
      const cellData = row.cells.get(colNum);

      const mergeInfo = mergeLookup.get(addr);
      const isMergeOrigin = mergeInfo?.originAddress === addr;
      const isMergeChild = !!mergeInfo && mergeInfo.originAddress !== addr;

      const rawValue = cellData?.rawValue ?? null;
      const formulaString = cellData?.formulaString ?? null;
      const formulaEntry = formulaString ? formulaMap[addr] : null;

      let treeDepth: number | null = null;
      let computationAxis: ComputationAxis = "none";
      if (formulaEntry) {
        treeDepth = formulaEntry.depth;
        computationAxis = formulaEntry.computationAxis;
      } else if (treeAddresses.has(addr) && !formulaString) {
        // This cell is a dependency (leaf) but has no formula
        treeDepth = null;
        computationAxis = "none";
      }

      return {
        address: addr,
        rawValue,
        displayValue: formatDisplayValue(
          formulaString ? (cellData?.cachedResult ?? rawValue) : rawValue
        ),
        formulaString,
        cachedResult: cellData?.cachedResult ?? null,
        isBold: cellData?.isBold ?? false,
        isItalic: cellData?.isItalic ?? false,
        backgroundColor: cellData?.backgroundColor ?? null,
        fontColor: cellData?.fontColor ?? null,
        numberFormat: cellData?.numberFormat ?? null,
        colSpan: isMergeOrigin ? (mergeInfo?.colSpan ?? 1) : 1,
        rowSpan: isMergeOrigin ? (mergeInfo?.rowSpan ?? 1) : 1,
        isMergeOrigin,
        isMergeChild,
        mergeOriginAddress: isMergeChild ? (mergeInfo?.originAddress ?? null) : null,
        treeDepth,
        computationAxis,
      } satisfies ParsedCell;
    });

    return {
      index: ri,
      excelRowNumber: row.rowNumber,
      type: rowType,
      cells,
      isEditable,
      outlineLevel: row.outlineLevel,
    } satisfies ParsedRow;
  });

  return {
    id: randomUUID(),
    name: ws.name,
    index: sheetIndex,
    columns,
    rows: parsedRows,
    headerRowIndex: headerRowArrayIndex >= 0 ? headerRowArrayIndex : null,
    formulaMap,
    dependencyGraph,
    columnCount: effectiveColCount,
    dataRowCount,
  };
}
