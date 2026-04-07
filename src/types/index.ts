// ─── Row & Column Semantic Types ─────────────────────────────────────────────

export type RowType =
  | "header"   // column label row — text-only, typically near top
  | "data"     // individual line-item rows (plain values or row-axis formulas)
  | "subtotal" // intermediate aggregation (depth > 0 in formula tree)
  | "total"    // root of the formula dependency tree (depth = 0, column-axis)
  | "section"  // divider / group label — single merged cell spanning the row
  | "blank"    // empty spacer row
  | "unknown"; // could not be determined

export type ColumnSemanticType =
  | "description" // free text — product names, labels
  | "quantity"    // integer-like numeric
  | "unit_price"  // currency-like numeric per unit
  | "amount"      // computed or summed currency
  | "percentage"  // 0–100 or 0–1 range
  | "identifier"  // item codes, SKUs, ref numbers
  | "date"
  | "unknown";

export type ComputationAxis = "row" | "column" | "mixed" | "none";

// ─── Cell ─────────────────────────────────────────────────────────────────────

export interface ParsedCell {
  address: string;                      // canonical "A1", "B4", "AA12"
  rawValue: string | number | boolean | null;
  displayValue: string;                 // formatted for display
  formulaString: string | null;         // e.g. "=B4*C4" or "=SUM(D2:D10)"
  cachedResult: number | string | null; // ExcelJS pre-computed value
  isBold: boolean;
  isItalic: boolean;
  backgroundColor: string | null;       // hex ARGB or null
  fontColor: string | null;
  numberFormat: string | null;          // Excel format string
  colSpan: number;                      // 1 unless merge origin
  rowSpan: number;
  isMergeOrigin: boolean;
  isMergeChild: boolean;
  mergeOriginAddress: string | null;
  // Formula-tree metadata (populated during graph construction)
  treeDepth: number | null;             // 0 = root/total, 1 = subtotal, null = not in any tree
  computationAxis: ComputationAxis;
}

// ─── Column Metadata ──────────────────────────────────────────────────────────

export interface ParsedColumn {
  index: number;           // 0-based
  letter: string;          // "A", "B", "C", …
  headerText: string;      // text from the identified header row, or column letter
  semanticType: ColumnSemanticType;
  isNumeric: boolean;      // majority of data cells are numeric
  width: number;           // Excel column width in chars (approx pixels/7)
}

// ─── Row Metadata ─────────────────────────────────────────────────────────────

export interface ParsedRow {
  index: number;           // 0-based within the sheet
  excelRowNumber: number;  // 1-based Excel row number
  type: RowType;
  cells: ParsedCell[];     // one per column — length === ParsedSheet.columns.length
  isEditable: boolean;     // false for header/section/blank rows
  outlineLevel: number;    // Excel outline/grouping depth (0 = top level)
}

// ─── Formula Infrastructure ───────────────────────────────────────────────────

export interface FormulaEntry {
  address: string;
  formulaString: string;          // "=B4*C4"
  dependencies: string[];         // ["B4", "C4"] — what this formula reads
  dependents: string[];           // cells that depend ON this cell (reverse)
  depth: number;                  // 0 = root (total), 1 = subtotal, >1 = deeper
  computationAxis: ComputationAxis;
  isRoot: boolean;                // true if nothing depends on this cell
}

// address → FormulaEntry
export type FormulaMap = Record<string, FormulaEntry>;

// address → list of formula cell addresses that depend on it
export type DependencyGraph = Record<string, string[]>;

// ─── Sheet ────────────────────────────────────────────────────────────────────

export interface ParsedSheet {
  id: string;
  name: string;
  index: number;              // 0-based position in workbook
  columns: ParsedColumn[];
  rows: ParsedRow[];
  headerRowIndex: number | null;
  formulaMap: FormulaMap;
  dependencyGraph: DependencyGraph; // reverse: non-formula addr → formula addrs that use it
  columnCount: number;
  dataRowCount: number;
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

export interface ParsedWorkbook {
  filename: string;
  parsedAt: string;           // ISO timestamp
  sheets: ParsedSheet[];
  activeSheetIndex: number;
}

// ─── API Contract ─────────────────────────────────────────────────────────────

export interface ParseExcelResponse {
  success: true;
  workbook: ParsedWorkbook;
}

export interface ParseExcelError {
  success: false;
  error: string;
  details?: string;
}

export type ParseExcelResult = ParseExcelResponse | ParseExcelError;

// ─── Client-Side Mutable State ───────────────────────────────────────────────

export interface CellEdit {
  sheetId: string;
  address: string;
  newValue: string | number | null;
  previousValue: string | number | null;
  timestamp: number;
}

export interface SheetMutation {
  cells: Record<string, string | number | null>; // current live overrides
  deletedRowIndices: Set<number>;
  editHistory: CellEdit[];
  /** Incremented each time resetSheet() is called. SheetEditor watches this
   *  to know it should re-run the initial recomputeAll pass. */
  resetVersion: number;
}

export type AppStatus = "idle" | "uploading" | "parsing" | "ready" | "error";
