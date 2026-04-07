"use client";

import { useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ParsedSheet } from "@/types";
import { useSheetMutation } from "@/lib/hooks/useWorkbook";
import { useFormulaEngine } from "@/lib/hooks/useFormulaEngine";
import { EditableCell } from "./EditableCell";
import { RowActions } from "./RowActions";

interface SpreadsheetTableProps {
  sheet: ParsedSheet;
}

export function SpreadsheetTable({ sheet }: SpreadsheetTableProps) {
  const mutation = useSheetMutation(sheet.id);
  const { handleCellEdit, handleRowDelete, handleRowRestore } =
    useFormulaEngine(sheet);

  const deletedRows = mutation?.deletedRowIndices ?? new Set<number>();
  const cellOverrides = mutation?.cells ?? {};

  // Get the live value for a cell:
  //   1. User mutation override (highest priority)
  //   2. Cached formula result from parse (if present)
  //   3. Raw value (plain data cells)
  //   4. null (formula cell with no cached result — evaluator will fill it)
  const getLiveValue = (
    address: string,
    rawValue: string | number | boolean | null,
    cachedResult: string | number | null,
    formulaString: string | null
  ): string | number | null => {
    // Mutation override always wins
    if (address in cellOverrides) {
      return cellOverrides[address];
    }
    // Formula cell with a cached result from Excel
    if (formulaString !== null && cachedResult !== null) {
      return cachedResult;
    }
    // Plain cell
    if (formulaString === null) {
      return rawValue as string | number | null;
    }
    // Formula cell with NO cached result (result was null in the file)
    // Return null — the formula engine will compute it when triggered
    return null;
  };

  // Row type → visual style
  const rowStyle: Record<string, string> = {
    header:
      "bg-slate-800 text-white font-semibold text-xs uppercase tracking-wide",
    data: "hover:bg-slate-50/80 transition-colors",
    subtotal: "bg-amber-50/60 font-medium",
    total: "bg-blue-50 font-bold border-t-2 border-blue-300",
    section: "bg-slate-100 italic text-slate-500",
    blank: "h-2",
    unknown: "opacity-70",
  };

  // Column alignment based on semantic type
  const colAlign = (semanticType: string): string => {
    switch (semanticType) {
      case "quantity":
      case "unit_price":
      case "amount":
      case "percentage":
        return "text-right";
      case "identifier":
        return "text-center";
      default:
        return "text-left";
    }
  };

  // Build the full visibleRows list (with deleted status)
  const visibleRows = useMemo(
    () =>
      sheet.rows.map((row) => ({
        ...row,
        isDeleted: deletedRows.has(row.index),
      })),
    [sheet.rows, deletedRows]
  );

  // Split into header rows (always visible, sticky) and body rows (virtualized)
  const { headerRows, bodyRows } = useMemo(() => {
    const headerRows: typeof visibleRows = [];
    const bodyRows: typeof visibleRows = [];
    for (const row of visibleRows) {
      if (row.type === "header") headerRows.push(row);
      else bodyRows.push(row);
    }
    return { headerRows, bodyRows };
  }, [visibleRows]);

  // Stable onEdit callback — prevents EditableCell memo invalidation on re-renders
  const stableOnEdit = useCallback(
    (
      addr: string,
      newVal: string | number | null,
      prevVal: string | number | null
    ) => handleCellEdit(addr, newVal, prevVal),
    [handleCellEdit]
  );

  // ── Virtualizer ────────────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36, // estimated row height in px
    overscan: 10, // extra rows above/below viewport to keep mounted
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  // ── Row renderer helper ────────────────────────────────────────────────────
  const renderRow = (
    row: (typeof visibleRows)[number],
    key: number | string
  ) => {
    const rStyle = rowStyle[row.type] ?? "";
    const isDeleted = row.isDeleted;

    if (row.type === "blank") {
      return (
        <tr key={key} className="h-2">
          <td
            colSpan={sheet.columns.length + 1}
            className="border-0 bg-slate-50"
          />
        </tr>
      );
    }

    return (
      <tr
        key={key}
        className={`
          group relative
          ${rStyle}
          ${isDeleted ? "opacity-30 line-through bg-red-50" : ""}
          ${row.type === "header" ? "" : "border-b border-slate-100"}
        `}
      >
        {/* Row actions column */}
        <RowActions
          rowType={row.type}
          isDeleted={isDeleted}
          onDelete={() => handleRowDelete(row.index)}
          onRestore={() => handleRowRestore(row.index)}
        />

        {/* Data cells */}
        {row.cells.map((cell) => {
          // Skip merge children — the origin cell already has colSpan
          if (cell.isMergeChild) return null;

          const liveValue = getLiveValue(
            cell.address,
            cell.rawValue,
            cell.cachedResult,
            cell.formulaString
          );

          const colIdx = cell.address.match(/[A-Z]+/)?.[0] ?? "";
          const colDef = sheet.columns.find((c) => c.letter === colIdx);
          const alignClass = colAlign(colDef?.semanticType ?? "unknown");

          // Header rows render as th-style td (non-editable)
          if (row.type === "header") {
            return (
              <td
                key={cell.address}
                colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                className={`
                  px-2 py-2 border border-slate-600/30
                  text-xs font-semibold tracking-wide
                  ${alignClass}
                `}
              >
                {String(cell.rawValue ?? cell.displayValue ?? "")}
              </td>
            );
          }

          return (
            <EditableCell
              key={cell.address}
              cell={cell}
              currentValue={liveValue}
              isEditable={row.isEditable && !isDeleted}
              onEdit={stableOnEdit}
              className={alignClass}
            />
          );
        })}
      </tr>
    );
  };

  return (
    <div
      ref={parentRef}
      className="w-full overflow-auto rounded-xl border border-slate-200 shadow-sm"
      style={{ maxHeight: "75vh" }}
    >
      <table className="w-full border-collapse text-sm">
        {/* Column sizing hints */}
        <colgroup>
          {/* Actions column */}
          <col style={{ width: "80px", minWidth: "80px" }} />
          {sheet.columns.map((col) => (
            <col
              key={col.letter}
              style={{
                width: `${Math.max(col.width * 7, 80)}px`,
                minWidth: "60px",
              }}
            />
          ))}
        </colgroup>

        {/* Sticky column header rows — always in the DOM */}
        {headerRows.length > 0 && (
          <thead className="sticky top-0 z-20">
            {headerRows.map((row) => renderRow(row, `h-${row.index}`))}
          </thead>
        )}

        {/* Virtualized body — only ~20–30 rows in the DOM at any time */}
        <tbody>
          {/* Top spacer — represents rows above the virtual window */}
          {paddingTop > 0 && (
            <tr>
              <td
                colSpan={sheet.columns.length + 1}
                style={{ height: paddingTop, padding: 0 }}
              />
            </tr>
          )}

          {virtualItems.map((virtualRow) =>
            renderRow(bodyRows[virtualRow.index], virtualRow.index)
          )}

          {/* Bottom spacer — represents rows below the virtual window */}
          {paddingBottom > 0 && (
            <tr>
              <td
                colSpan={sheet.columns.length + 1}
                style={{ height: paddingBottom, padding: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>

      {sheet.rows.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p>This sheet appears to be empty.</p>
        </div>
      )}
    </div>
  );
}
