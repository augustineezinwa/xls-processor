# Architecture & Workflow Documentation

> **Project:** xcel-quotes-processor
> **Stack:** Next.js 16 · React 19 · TypeScript 5 · ExcelJS · Zustand + Immer · TanStack Virtual · jsPDF

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Upload Flow — Step by Step](#2-upload-flow--step-by-step)
3. [Backend: API Route](#3-backend-api-route)
4. [Parser Pipeline (10 Phases)](#4-parser-pipeline-10-phases)
   - 4.1 Cell Address Utilities (`cellAddress.ts`)
   - 4.2 Merge Cell Handler (`mergedCellHandler.ts`)
   - 4.3 Formula Graph Builder (`formulaExtractor.ts`)
   - 4.4 Row Classifier (`rowClassifier.ts`)
   - 4.5 Column Inferrer (`columnInferrer.ts`)
5. [Formula Engine](#5-formula-engine)
   - 5.1 Reference Parser (`refParser.ts`)
   - 5.2 Evaluator (`evaluator.ts`)
6. [React State Management](#6-react-state-management)
   - 6.1 Zustand Store (`useWorkbook.ts`)
   - 6.2 Formula Engine Hook (`useFormulaEngine.ts`)
7. [Table Rendering & Virtualization](#7-table-rendering--virtualization)
8. [Cell Editing Flow](#8-cell-editing-flow)
9. [Export Pipeline](#9-export-pipeline)
   - 9.1 Sheet PDF (`pdfExport.ts`)
   - 9.2 Contract PDF (`contractExport.ts`)
10. [Utility Functions](#10-utility-functions)
11. [TypeScript Type System](#11-typescript-type-system)
12. [Performance Optimizations Summary](#12-performance-optimizations-summary)
13. [Data Flow Diagram](#13-data-flow-diagram)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Client)                                           │
│                                                             │
│  DropZone → POST /api/parse-excel → UploadProgress         │
│                                                             │
│  Zustand Store (ParsedWorkbook + SheetMutation)             │
│       ↓                                                     │
│  SheetEditor → SpreadsheetTable (virtualized)               │
│       ↓                        ↓                            │
│  useFormulaEngine         EditableCell (memoized)           │
│       ↓                                                     │
│  recomputeFromEdit / recomputeAll → batchUpdateCells        │
│                                                             │
│  TableToolbar → exportSheetToPDF / CreateContractDialog     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Server (Node.js runtime, Next.js API Route)                │
│                                                             │
│  POST /api/parse-excel                                      │
│       ↓                                                     │
│  parseWorkbook()  ← ExcelJS reads .xlsx / .xls buffer      │
│       ↓                                                     │
│  parseSheet()  × N worksheets                               │
│       ↓                                                     │
│  buildFormulaGraph → classifyRows → inferColumns            │
│       ↓                                                     │
│  Returns ParsedWorkbook JSON to client                      │
└─────────────────────────────────────────────────────────────┘
```

The server and client share **no runtime**. The entire workbook is serialised to JSON once
and then owned exclusively by the client-side Zustand store. All subsequent edits and
formula recalculations happen in the browser.

---

## 2. Upload Flow — Step by Step

### Files involved
- `src/app/page.tsx` — state-machine root
- `src/components/upload/DropZone.tsx` — drag-and-drop UI + fetch
- `src/components/upload/UploadProgress.tsx` — progress indicator

### Step-by-step

```
User drops / selects file
        │
        ▼
DropZone.processFile(file: File)
  1. store.setStatus("uploading")          ← UI switches to UploadProgress
  2. new FormData(); fd.append("file", file)
  3. fetch("POST /api/parse-excel", fd)   ← multipart upload
  4. store.setStatus("parsing")            ← second progress step shown
  5. res.json() → ParseExcelResult
        │
        ├─ success=false → store.setStatus("error", message)
        │
        └─ success=true  → store.setWorkbook(data.workbook)
                                │
                                └─ store.status automatically becomes "ready"
                                   page.tsx renders <WorkbookViewer />
```

### `DropZone` configuration

| Property | Value |
|---|---|
| Accepted MIME types | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` |
| Extensions | `.xlsx`, `.xls` |
| Max files | 1 |
| Max size | 10 MB |

### `page.tsx` render matrix

| `store.status` | Component rendered |
|---|---|
| `"idle"` | `<DropZone />` |
| `"uploading"` or `"parsing"` | `<UploadProgress />` |
| `"error"` | Inline error card with retry button |
| `"ready"` | `<WorkbookViewer />` |

---

## 3. Backend: API Route

**File:** `src/app/api/parse-excel/route.ts`
**Runtime:** Node.js (`export const runtime = "nodejs"`)
**Timeout:** 30 seconds (`export const maxDuration = 30`)

### `POST(req: NextRequest): Promise<NextResponse>`

**Validation chain (short-circuits with error on failure):**

| Step | Check | Error code |
|---|---|---|
| 1 | Parse `FormData` from request | 400 |
| 2 | `file` field present and is `File` | 400 |
| 3 | Extension is `.xlsx` or `.xls` | 400 |
| 4 | File size > 0 | 400 |
| 5 | File size ≤ 10 MB | 400 |
| 6 | Convert to `Buffer` | 500 |
| 7 | `parseWorkbook()` succeeds | 422 / 500 |
| 8 | Parsed workbook has ≥ 1 sheet | 422 |

**Success response (HTTP 200):**
```json
{ "success": true, "workbook": { ...ParsedWorkbook } }
```

**Error response:**
```json
{ "success": false, "error": "...", "details": "..." }
```

**Special error detection:** If the parse error message contains `"password"`, `"encrypted"`,
or `"corrupt"`, a 422 is returned with a user-friendly message instead of a generic 500.

---

## 4. Parser Pipeline (10 Phases)

**File:** `src/lib/parser/index.ts`

### Entry point

```typescript
parseWorkbook(buffer: Buffer, filename: string): Promise<ParsedWorkbook>
```

Loads the Excel buffer with ExcelJS, then calls `parseSheet()` for every worksheet.

### `parseSheet(ws: ExcelJS.Worksheet, sheetIndex: number): ParsedSheet | null`

The core pipeline. Returns `null` for empty sheets.

---

### Phase 1 — Used Range Detection
```
Input:  ExcelJS Worksheet
Output: rowCount, colCount (returns null if either is 0)
```

### Phase 2 — Merge Region Parsing
```
Input:  ws.model.merges (string[], e.g. ["A1:E1", "B3:D3"])
Output: MergeRegion Map  (originAddress → {colSpan, rowSpan, coveredAddresses})
        MergeLookup Map  (every cell address → its MergeRegion)
```
See §4.2 for full details.

### Phase 3 — Raw Cell Extraction

Iterates `ws.eachRow()`. For every cell:

| Field | Source |
|---|---|
| `address` | `cell.address` |
| `rawValue` | `resolveRawValue(cell)` — handles formulas, rich-text, hyperlinks, dates |
| `formulaString` | `resolveFormulaString(cell)` — prepends `=` |
| `cachedResult` | `resolveCachedResult(cell)` — Excel's pre-computed value |
| `isBold` / `isItalic` | `cell.font.bold / .italic` |
| `backgroundColor` | `getArgbHex(cell.fill.fgColor)` — strips alpha, returns `#RRGGBB` or null |
| `fontColor` | `getArgbHex(cell.font.color)` |
| `numberFormat` | `cell.numFmt` |
| `text` | `cell.text` (display string from ExcelJS) |

`resolveRawValue` priority:
1. Formula cell → cached result (or null)
2. Rich text → joined plain string
3. Hyperlink → display text
4. Date → `toLocaleDateString()`
5. Unknown object → null

### Phase 4 — Formula Graph
```
Input:  [{address, formulaString}] for every formula cell
Output: FormulaMap (address → FormulaEntry with depth/axis/deps)
        DependencyGraph (cell address → formula addresses that reference it)
```
See §4.3 for full details.

### Phase 5 — Row Classification
```
Input:  rawRows, FormulaMap
Output: RowType[] — one type per row
```
See §4.4 for full details.

### Phase 6 — Header Row Identification

Among all rows typed `"header"`, selects the **last one that appears before the first
data/subtotal/total row**. This correctly handles sheets with a merged title row above
the actual column-label row.

### Phase 7 — Column Header Text Extraction

From the identified header row, reads cell text for every non-merge-child column. Falls
back to the column letter (`"A"`, `"B"`, …) if the header row is absent.

### Phase 8 — Column Sample Data Collection

For every non-header, non-blank row, collects raw values, number formats, formula flags,
and root-formula flags per column. Skipped for header/blank rows so they don't pollute
the numeric-ratio calculation.

### Phase 9 — Column Semantic Type Inference
```
Input:  ColumnSample[] (per-column stats)
Output: ParsedColumn[] with semanticType
```
See §4.5 for full details.

### Phase 10 — ParsedRow Assembly

For every raw row builds a `ParsedRow`:
- `isEditable = rowType ∈ {data, subtotal, total, unknown}`
- `cells[]` — one `ParsedCell` per column, padded to `effectiveColCount`
- Merge info: `isMergeOrigin`, `isMergeChild`, `colSpan`, `rowSpan` from MergeLookup
- `treeDepth` and `computationAxis` from FormulaMap

---

### 4.1 Cell Address Utilities (`src/lib/parser/cellAddress.ts`)

Pure functions; no dependencies.

| Function | Input | Output | Description |
|---|---|---|---|
| `colLetterToIndex(col)` | `"A"` … `"ZZ"` | `1` … `702` | Base-26 letter → 1-based index |
| `colIndexToLetter(index)` | `1` … `702` | `"A"` … `"ZZ"` | Reverse base-26 |
| `parseAddress(addr)` | `"B4"` / `"$D$10"` | `{col,row}` or `null` | Strips `$`, regex match |
| `buildAddress(col,row)` | `(2,4)` | `"B4"` | Inverse of parseAddress |
| `expandRange(range)` | `"D2:D10"` | `["D2","D3",…,"D10"]` | Row-major expansion |
| `extractCellRefs(formula)` | `"=SUM(D2:D10)*B4"` | `["D2",…,"D10","B4"]` | Expand ranges + single refs, deduped |
| `detectComputationAxis(addr,deps)` | `"E4", ["B4","C4"]` | `"row"` | All deps same row → row; cross-row → column; both → mixed |

All indices and row numbers are **1-based** throughout (matching Excel).

---

### 4.2 Merge Cell Handler (`src/lib/parser/mergedCellHandler.ts`)

| Function | Input | Output |
|---|---|---|
| `parseMergeRegions(merges: string[])` | `["A1:C3","F2:F10"]` | `Map<originAddr, MergeRegion>` |
| `buildMergeLookup(regionMap)` | Map from above | `Map<anyAddr, MergeRegion>` — every covered cell points to its region |

`MergeRegion`:
```typescript
{
  originAddress: string         // top-left cell
  colSpan: number
  rowSpan: number
  coveredAddresses: Set<string> // all cells including origin
}
```

**Why two structures?**
`parseMergeRegions` is keyed by origin for efficient region iteration.
`buildMergeLookup` is keyed by every covered cell for O(1) per-cell merge lookup during
Phase 3 and Phase 10.

---

### 4.3 Formula Graph Builder (`src/lib/parser/formulaExtractor.ts`)

#### `buildFormulaGraph(formulaCells)`
**Input:** `{address, formulaString}[]`
**Output:** `{formulaMap: FormulaMap, dependencyGraph: DependencyGraph}`

**5-step algorithm:**

```
Step 1  Build FormulaMap
        For each formula cell:
          - extractCellRefs(formulaString) → dependencies[]
          - detectComputationAxis(address, dependencies) → axis
          - Store: {address, formulaString, dependencies, depth:-1, dependents:[], isRoot:false}

Step 2  Build reverse map
        reverseMap: address → Set<formulaAddress>
        For each formula cell's dependency, add it to the set

Step 3  Identify roots
        Root = formula cell NOT in any reverseMap entry
        (Nothing depends on it — it IS the top-level total)
        Mark isRoot=true, enqueue for BFS

Step 4  BFS depth assignment (roots=0, leaves=deepest)
        - Queue initialised with all roots at depth 0
        - For each formula cell in queue, update depth if unvisited or
          current depth > new depth (shallower path wins)
        - Enqueue all dependencies that are themselves formula cells
        - Unvisited after BFS → depth=99 (disconnected / circular)

Step 5  Populate .dependents[]
        Reverse of dependencies: for each dep in a formula's deps,
        add the formula's address to dep's .dependents[]
```

#### `getAllTreeAddresses(formulaMap)`
Returns a `Set<string>` of every address that is either a formula cell or a dependency
of a formula. Used in Phase 5 to quickly check if a cell is "in the tree".

---

### 4.4 Row Classifier (`src/lib/parser/rowClassifier.ts`)

#### `classifyRows(rows, formulaMap, totalRows): RowType[]`

**Pre-computation (per row):**

| Stat | Description |
|---|---|
| `nonEmpty` | Cells with rawValue or formulaString (non-null) |
| `textCells` | Non-formula string cells |
| `numCells` | Non-formula number cells |
| `numericStringCells` | Text cells whose value parses as a number after stripping `$€£¥₱,()` |
| `formulaCells` | Cells with formulaString |
| `rootFormulaCell` | First formula cell with `isRoot=true` and `axis="column"` |
| `subtotalFormulaCell` | First non-root column-axis formula cell |
| `rowAxisOnlyFormulas` | All formula cells in row are row-axis (e.g., `=B4*C4`) |
| `isInTree` | Any cell's address exists in FormulaMap |

**Pass 1 — Formula-tree classification (priority order):**

```
blank    → nonEmpty.length === 0
total    → has rootFormulaCell
subtotal → has subtotalFormulaCell
data     → isInTree OR (has formulas AND all are row-axis)
section  → no numbers, no numeric strings, has text  ← text-only row
data     → has numbers OR has numeric string cells   ← plain numeric row
```

**Pass 2 — Header promotion:**
The last `"section"` row before the first data/subtotal/total row is upgraded to `"header"`.
All earlier section rows stay as section (merged title rows, company name rows, etc.).

**Pass 3 — Context reclassification:**
An `"unknown"` row sandwiched between two data/subtotal rows becomes `"data"`.

**Pass 4 — Fallback (account statements, unusual files):**
If zero editable rows (data/subtotal/total) were produced, all non-blank section/unknown rows
after the last header row are promoted to `"data"`. This ensures the file is always viewable
and editable rather than showing "0 items".

---

### 4.5 Column Inferrer (`src/lib/parser/columnInferrer.ts`)

#### `inferColumns(samples: ColumnSample[]): ParsedColumn[]`

**Input per column:**
```typescript
{
  index, letter, headerText, width,
  dataCellValues: (string|number|null)[]
  dataNumberFormats: (string|null)[]
  hasRootFormula: boolean
  formulaCellCount: number
}
```

**Numeric ratio calculation:**
```
adjustedNumericCount = count(typeof v === "number")
                     + count(formula cells with null result)
ratio = adjustedNumericCount / (nonEmpty + nullFormulaCount)
```

**Semantic type decision tree:**

```
ratio > 0.7  (high-numeric column)
    hasRootFormula                                     → "amount"
    hasPercentFmt OR header ∋ /percent|%|disc/         → "percentage"
    hasCurrencyFmt OR header ∋ /price|rate|cost/       → "unit_price"
    header ∋ /amount|total|value|ext|subtotal/         → "amount"
    header ∋ /qty|quantity|count|#|pcs/                → "quantity"
    default                                             → "amount"

ratio < 0.15 (text column)
    header ∋ /date|time|when|period/                   → "date"
    header ∋ /code|ref|sku|id|part/                    → "identifier"
    default                                             → "description"

0.15–0.7 (mixed)
    header ∋ /desc|name|item|product/                  → "description"
    header ∋ /code|ref|sku/                            → "identifier"
    header ∋ amount keywords OR hasRootFormula          → "amount"
    default                                             → "unknown"
```

`isNumeric = ratio > 0.5`

---

## 5. Formula Engine

### 5.1 Reference Parser (`src/lib/formulaEngine/refParser.ts`)

Pure functions; no external dependencies.

#### `expandRange(rangeStr: string): string[]`
Expands `"D2:D10"` → `["D2","D3",…,"D10"]` using base-26 column conversion.

#### `substituteRefs(formula, getValue): string`

**Purpose:** Convert an Excel formula into a JavaScript-evaluatable string expression.

**2-pass algorithm:**

```
Pass 1 — Ranges (right-to-left to preserve string indices)
  Regex: /\$?([A-Z]{1,3})\$?([0-9]+)\s*:\s*\$?([A-Z]{1,3})\$?([0-9]+)/gi
  For each match:
    expand range → addresses[]
    getValue(addr) for each → values[]
    filter nulls, quote strings
    replace with JS array: [v1,v2,v3,…]

Pass 2 — Single cells
  Regex: /\$?([A-Z]{1,3})\$?([0-9]+)/gi
  For each match:
    getValue(addr)
    null → "0", string → quoted, number → string-of-number
    replace in-place
```

**Example:**
```
Input:   "=SUM(D2:D10)*B4"    B4=5, D2..D10=[10,20,30,…]
Output:  "SUM([10,20,30,…])*5"
```

---

### 5.2 Evaluator (`src/lib/formulaEngine/evaluator.ts`)

#### `evaluateFormula(formulaString, getValue, formulajs): Promise<number|string|null>`

1. `substituteRefs(formula, getValue)` → JS expression string
2. Map Excel function names to `@formulajs/formulajs` implementations
   - Supported: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, IFERROR, SUMIF, COUNTIF, LEN, TRIM, UPPER, LOWER, CONCATENATE, TEXT, VALUE, ISBLANK, ISNUMBER, ISTEXT, ABS, SQRT, POWER, MOD, INT, CEILING, FLOOR, AND, OR, NOT, ROUNDUP, ROUNDDOWN
3. `new Function(fnNames, "use strict; try { return (expr); } catch(e) { return null; }")(...fnValues)`
4. Type coercion: `boolean → 0/1`, `Array → first element`, `non-finite → null`
5. Returns `null` on any error (formula errors treated as empty)

**Lazy loading:** `@formulajs/formulajs` is imported only on first call via `getFormulajs()`,
avoiding SSR issues since the library relies on browser globals.

#### `recomputeFromEdit(changedAddress, newValue, currentValues, formulaMap, dependencyGraph)`

**Input/Output:**
```
In:  changedAddress — cell just edited by user
     newValue       — the new user-entered value
     currentValues  — live snapshot of all cell values
Out: Record<address, value> — only the cells that changed (affected formulas)
```

**Algorithm — BFS upward propagation:**
```
1. values[changedAddress] = newValue
2. queue ← dependencyGraph[changedAddress] (direct formula dependents)
3. While queue not empty:
   a. Dequeue formulaAddr
   b. evaluateFormula(formulaAddr, getValue from values)
   c. values[formulaAddr] = result
   d. recomputed[formulaAddr] = result
   e. Enqueue dependents of formulaAddr (if not already enqueued)
4. Return recomputed
```

Complexity: O(d) where d = number of formulas transitively affected by the edit.

#### `recomputeAll(currentValues, formulaMap, deletedAddresses)`

**Input/Output:**
```
In:  currentValues    — full live snapshot
     formulaMap       — all formula entries with depth
     deletedAddresses — cells to treat as null
Out: Record<address, value> — all formula cell results
```

**Algorithm — topological sort (depth-descending):**
```
1. values ← copy of currentValues; null out deletedAddresses
2. Sort formula entries by depth DESC (deepest dependencies first)
3. For each formula (in sorted order):
   a. Every 50 formulas processed → yield event loop
      await new Promise(resolve => setTimeout(resolve, 0))
   b. evaluateFormula()
   c. values[addr] = result
4. Return all computed results
```

**Why depth-descending?** A row-axis formula `=B4*C4` (leaf, high depth) must be computed
before the column-axis total `=SUM(E2:E10)` (root, depth 0) that sums its results.

**Yield every 50 formulas:** Prevents main-thread blocking on 11,000-row sheets, keeping
the browser UI responsive during full recomputation.

---

## 6. React State Management

### 6.1 Zustand Store (`src/lib/hooks/useWorkbook.ts`)

Created with `create<WorkbookStore>()(immer(…))`.

**Store shape:**
```typescript
{
  workbook: ParsedWorkbook | null            // immutable parsed data
  mutations: Record<sheetId, SheetMutation>  // all user edits
  activeSheetIndex: number
  status: "idle" | "uploading" | "parsing" | "ready" | "error"
  errorMessage: string | null
  filename: string | null
}
```

**`SheetMutation` per sheet:**
```typescript
{
  cells: Record<address, value>  // cell overrides (edits)
  deletedRowIndices: Set<number> // soft-deleted rows
  editHistory: CellEdit[]        // undo-ready history
  resetVersion: number           // incremented on sheet reset
}
```

**Key actions:**

| Action | What it does |
|---|---|
| `setWorkbook(wb)` | Stores workbook, initialises empty SheetMutation for every sheet, sets status→ready |
| `updateCell(sheetId, addr, val, prev)` | Sets `mutations[sheetId].cells[addr]`, appends CellEdit to history |
| `batchUpdateCells(sheetId, updates)` | Bulk-sets many cell overrides (used after formula recompute) |
| `deleteRow(sheetId, rowIndex, addrs)` | Adds index to `deletedRowIndices`, nulls all cell overrides |
| `restoreRow(sheetId, rowIndex, addrs)` | Removes index from set, removes null overrides |
| `resetSheet(sheetId)` | Clears mutations, increments `resetVersion` (triggers SheetEditor remount) |
| `resetAll()` | Clears entire store → status→idle |

**Selectors (stable references, prevent unnecessary re-renders):**

| Selector | Returns |
|---|---|
| `useActiveSheet()` | `ParsedSheet` for current `activeSheetIndex` |
| `useSheetMutation(sheetId)` | `SheetMutation` or null |
| `useCellValue(sheetId, addr, original)` | Override value OR original |

**Immer middleware** allows mutations to be written as direct assignments
(`state.mutations[id].cells[addr] = val`) while producing immutable snapshots under the hood,
making every state update compatible with React's referential equality checks.

---

### 6.2 Formula Engine Hook (`src/lib/hooks/useFormulaEngine.ts`)

```typescript
function useFormulaEngine(sheet: ParsedSheet): {
  handleCellEdit(address, newValue, previousValue): Promise<void>
  handleRowDelete(rowIndex): Promise<void>
  handleRowRestore(rowIndex): Promise<void>
}
```

**`buildCurrentValues()`** (internal):
Constructs the full live value snapshot used by the formula engine:
```
For every cell in sheet.rows:
  base = cachedResult ?? rawValue
  Override with mutations.cells[addr] if present
```

**`handleCellEdit`:**
```
1. store.updateCell(addr, newValue)         ← immediate UI update
2. Check dependencyGraph[addr] → any dependents?
3. If yes: recomputeFromEdit(addr, newValue, currentValues, ...)
4. store.batchUpdateCells(recomputed)       ← propagate formula results
```

**`handleRowDelete`:**
```
1. store.deleteRow(rowIndex, addrs)
2. recomputeAll(currentValues, formulaMap, deletedAddresses)
3. store.batchUpdateCells(results)
```

**`handleRowRestore`:**
```
1. store.restoreRow(rowIndex, addrs)
2. Read FRESH store state (via ref) to get restored values
3. recomputeAll with empty deletedSet
4. store.batchUpdateCells(results)
```

The hook keeps a `mutationsRef` (always pointing to latest mutations) so async formula
callbacks read the correct current state, not a stale closure.

---

## 7. Table Rendering & Virtualization

**File:** `src/components/table/SpreadsheetTable.tsx`

### DOM structure
```html
<div ref="parentRef" style="maxHeight:75vh; overflowY:auto">
  <table>
    <colgroup>     <!-- fixed column widths -->
    <thead class="sticky top-0 z-20">
      <!-- ALL header-type rows, always in DOM -->
    </thead>
    <tbody>
      <tr style="height:Xpx" />    <!-- top spacer (virtual offset) -->
      <!-- ~20-30 visible rows only -->
      <tr style="height:Ypx" />    <!-- bottom spacer -->
    </tbody>
  </table>
</div>
```

### Virtualization (`@tanstack/react-virtual`)

```typescript
useVirtualizer({
  count: bodyRows.length,          // non-header rows
  getScrollElement: () => parentRef.current,
  estimateSize: () => 36,          // 36px per row
  overscan: 10,                    // 10 rows above/below viewport
})
```

- `virtualItems` — only the currently visible (+ overscan) rows
- `paddingTop` = `virtualItems[0].start` — height of all rows above viewport
- `paddingBottom` = `totalSize - lastItem.end` — height below viewport
- Two spacer `<tr>` elements maintain correct scroll height without rendering DOM nodes

**Result:** Only ~20–30 `<tr>` elements in the DOM at any time, regardless of sheet size.

### Memoization strategy

| Component / Value | Mechanism | Why |
|---|---|---|
| `EditableCell` | `React.memo` + custom comparator | Re-render only when own value, editability, or handler changes |
| `stableOnEdit` | `useCallback([handleCellEdit])` | Prevents memo invalidation on every parent render |
| `headerRows` / `bodyRows` | Computed from `visibleRows` split | Header rows stay in `<thead>`, body rows virtualised |

### Cell value resolution (priority order, consistent everywhere)

```
1. mutation.cells[address]  ← user edit wins
2. cell.cachedResult         ← Excel pre-computed formula result
3. cell.rawValue             ← static value
4. null                      ← unresolved formula (rendered as blank)
```

### Row styling

| Type | Classes |
|---|---|
| `header` | `bg-slate-800 text-white font-semibold text-xs uppercase tracking-wide sticky` |
| `data` | `hover:bg-slate-50/80 transition-colors` |
| `subtotal` | `bg-amber-50/60 font-medium` |
| `total` | `bg-blue-50 font-bold border-t-2 border-blue-300` |
| `section` | `bg-slate-100 italic text-slate-500` |
| `blank` | `h-2` (spacer) |
| deleted | `opacity-30 line-through bg-red-50` |

### Coloured background accessibility

`EditableCell` applies `cell.backgroundColor` as an inline style. When no explicit
`fontColor` is set, the text colour is derived via perceived luminance (ITU-R BT.601):

```typescript
luminance = (0.299·R + 0.587·G + 0.114·B) / 255
color = luminance < 0.55 ? "#ffffff" : "#1e293b"
```

Dark backgrounds → white text; light backgrounds → slate-800.

---

## 8. Cell Editing Flow

```
User double-clicks a cell (isEditable=true)
        │
        ▼
EditableCell.startEdit()
  - setIsEditing(true)
  - setEditBuffer(String(currentValue))
  - input rendered, focused, selected

User types / modifies value
  - setEditBuffer(e.target.value)

User presses Enter / Tab / clicks away
        │
        ▼
EditableCell.commitEdit()
  - setIsEditing(false)
  - parseInputValue(editBuffer)
      - "" → null
      - ends with "%" → divide by 100
      - parseFloat succeeds → number
      - otherwise → string
  - If value changed: onEdit(address, parsed, prev)
        │
        ▼
SpreadsheetTable.handleCellEdit(address, newValue, prevValue)
  → useFormulaEngine.handleCellEdit(address, newValue, prevValue)
      │
      ├─ store.updateCell() → immediate UI update via Zustand
      │
      └─ dependencyGraph[address] has dependents?
          ├─ No  → done
          └─ Yes → recomputeFromEdit() → BFS → store.batchUpdateCells()
```

**Key design:** The UI updates *immediately* from the store mutation. Formula propagation
happens asynchronously after, preventing any perceived lag on cell save.

---

## 9. Export Pipeline

### 9.1 Sheet PDF (`src/lib/export/pdfExport.ts`)

```typescript
exportSheetToPDF(sheet: ParsedSheet, mutation: SheetMutation | null, filename: string): void
```

**Orientation decision:**
```
sheet.columns.length >= 7  →  landscape A4  (297 × 210 mm, 257 mm usable)
sheet.columns.length  < 7  →  portrait A4   (210 × 297 mm, 170 mm usable)
```

**Column width distribution:**
```
totalCharWidth = sum of all column.width values
colWidth[i] = (column[i].width / totalCharWidth) * AVAILABLE_WIDTH_MM
```

**Content generated:**
1. Header line: filename (bold) + sheet name + generation date
2. jspdf-autotable table body:
   - Excluded: blank rows, deleted rows
   - Per-cell: resolved live value, number format applied, merge colspan
   - Per-row: fill/text/font from row type (same Tailwind → RGB palette)
3. No page numbers (single-page export of visible data)

**Cell value resolution** — same priority as screen: mutation → cachedResult → rawValue → null.

---

### 9.2 Contract PDF (`src/lib/export/contractExport.ts`)

```typescript
exportContractToPDF(options: {
  sheet, mutation, partyA, partyB, agreementDate, contractBody
}): void
```

**Sections generated in order:**

| Section | Content |
|---|---|
| Title | "CONTRACT AGREEMENT" centred, decorative underline |
| Date | Agreement date, centred |
| Parties | Party A (Supplier) and Party B (Client) in two columns |
| Schedule of Works | Full sheet table (same orientation logic as sheet PDF) |
| Terms & Conditions | `contractBody` text, line-wrapped to available width |
| Signatures | Two signature blocks with Name/Signature/Date blank lines |
| Footer | "Page N of M · contract-agreement" on every page |

**Layout adapts to orientation:** All x-coordinates (`centerX`, `rightSigX`) and widths
(`availableWidth`, `sigLineLen`) are derived dynamically from `doc.internal.pageSize.getWidth()`
rather than being hardcoded, so the layout is correct for both portrait and landscape.

---

## 10. Utility Functions

### `src/lib/utils/numberFormat.ts`

#### `formatCellValue(value, numberFormat, cachedResult?, formulaString?): string`

**Priority:** If `formulaString` present, use `cachedResult ?? value`.

| Input type | Logic |
|---|---|
| `null` / `""` | `""` |
| `boolean` | `"TRUE"` / `"FALSE"` |
| `string` | return as-is |
| `number`, format `%` | `(value × 100).toFixed(decimals) + "%"` |
| `number`, format `$£€` | Symbol + `toLocaleString` |
| `number`, format `yy/mm/dd` | `String(value)` (date serial) |
| `number`, format `0.00` | `toLocaleString` with parsed decimal count |
| `number`, format `,` | `toLocaleString` integer |
| `number`, default | Integer → `toLocaleString`; float → 2–4 decimal places |
| non-finite | `"#NUM!"` |

#### `parseInputValue(input: string): string | number | null`

| Input | Output |
|---|---|
| `""` | `null` |
| `"15%"` | `0.15` |
| `"1,234.56"` | `1234.56` |
| `"ABC"` | `"ABC"` |
| `"$500"` | `500` |

---

## 11. TypeScript Type System

All shared types are defined in `src/types/index.ts`.

```
ParsedWorkbook
  └─ sheets: ParsedSheet[]
       ├─ columns: ParsedColumn[]  (semanticType, letter, headerText, width)
       ├─ rows: ParsedRow[]
       │    └─ cells: ParsedCell[]
       │         (address, rawValue, displayValue, formulaString, cachedResult,
       │          isBold, isItalic, backgroundColor, fontColor, numberFormat,
       │          colSpan, rowSpan, isMergeOrigin, isMergeChild, treeDepth,
       │          computationAxis)
       ├─ formulaMap: FormulaMap         (address → FormulaEntry)
       ├─ dependencyGraph: DependencyGraph  (address → [formulaAddresses])
       ├─ headerRowIndex: number | null
       ├─ dataRowCount: number
       └─ columnCount: number

SheetMutation (client-side overlay, keyed by sheet ID in Zustand)
  ├─ cells: Record<address, value>
  ├─ deletedRowIndices: Set<number>
  ├─ editHistory: CellEdit[]
  └─ resetVersion: number
```

---

## 12. Performance Optimizations Summary

| Optimization | Location | Benefit |
|---|---|---|
| Row virtualization (TanStack Virtual) | `SpreadsheetTable.tsx` | ~30 DOM nodes instead of 55,000+ for 11k-row sheets |
| `React.memo` + custom comparator on `EditableCell` | `EditableCell.tsx` | Only re-renders when own value/editability changes |
| `useCallback` for `stableOnEdit` | `SpreadsheetTable.tsx` | Prevents memo invalidation cascade on parent re-render |
| `ScheduleTable` memoized in dialog | `CreateContractDialog.tsx` | Typing in Party A/B fields does not re-render the 11k-row table |
| `useMemo` for `colMap` (Map vs. Array.find) | `CreateContractDialog.tsx`, `SpreadsheetTable.tsx` | O(1) column lookup instead of O(n) per cell |
| `useMemo` for `filteredRows` | `CreateContractDialog.tsx` | Row filter runs only when sheet/mutation changes |
| Event-loop yield every 50 formulas | `evaluator.ts` / `recomputeAll` | Prevents UI freeze during bulk recompute |
| BFS propagation (not full recompute) on single edit | `evaluator.ts` / `recomputeFromEdit` | Only affected formula chain is recalculated |
| Depth-sorted topological order | `evaluator.ts` / `recomputeAll` | Leaves computed before roots; no redundant passes |
| Header rows in `<thead>` (sticky, outside virtual scroll) | `SpreadsheetTable.tsx` | Headers always visible; only body is virtualized |
| Lazy-load `@formulajs/formulajs` | `evaluator.ts` | Avoids SSR bundle size increase |
| Numeric-string detection in row classifier | `rowClassifier.ts` | Account statements with text-typed numbers classified correctly |
| Pass 4 fallback in row classifier | `rowClassifier.ts` | Exotic layouts never silently show "0 items" |

---

## 13. Data Flow Diagram

```
                         ┌──────────────┐
                         │   .xlsx file │
                         └──────┬───────┘
                                │ FormData POST
                                ▼
                    ┌─────────────────────┐
                    │  /api/parse-excel   │  (Node.js)
                    │                     │
                    │  ExcelJS.load()     │
                    │       ↓             │
                    │  parseSheet() ×N    │
                    │  ┌─────────────┐   │
                    │  │Phase 3: raw │   │
                    │  │Phase 4: graph│  │
                    │  │Phase 5: rows│   │
                    │  │Phase 9: cols│   │
                    │  └─────────────┘   │
                    └──────────┬──────────┘
                               │ JSON: ParsedWorkbook
                               ▼
              ┌────────────────────────────────┐
              │  Zustand Store                  │
              │  workbook: ParsedWorkbook (RO)  │
              │  mutations: {}  (mutable layer) │
              └────────────┬───────────────────┘
                           │
              ┌────────────▼───────────────────┐
              │  SheetEditor.tsx               │
              │  On mount: recomputeAll()      │
              │  → batchUpdateCells()          │
              └────────────┬───────────────────┘
                           │
              ┌────────────▼───────────────────┐
              │  SpreadsheetTable.tsx          │
              │  virtualizer → ~30 <tr>        │
              │  getLiveValue() per cell       │
              │    mutation → cached → raw     │
              └────────────┬───────────────────┘
                           │ onEdit callback
              ┌────────────▼───────────────────┐
              │  useFormulaEngine              │
              │  handleCellEdit()              │
              │  updateCell() [immediate]       │
              │  recomputeFromEdit() [BFS]     │
              │  batchUpdateCells() [results]  │
              └────────────────────────────────┘
                           │
              ┌────────────▼───────────────────┐
              │  Export                        │
              │  exportSheetToPDF()            │
              │  exportContractToPDF()         │
              │  → jsPDF + jspdf-autotable     │
              │  → landscape if ≥7 columns     │
              └────────────────────────────────┘
```
