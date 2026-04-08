import { useRef, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ParsedSheet, SheetMutation } from "@/types";
import { formatCellValue } from "@/lib/utils/numberFormat";
import { resolveLiveValue } from "@/lib/parser/resolveLiveValue";

// ─── Row-type → Tailwind classes (mirrors SpreadsheetTable) ───────────────────
const ROW_CLASS: Record<string, string> = {
    header: "bg-slate-800 text-white text-xs font-semibold tracking-wide",
    section: "bg-slate-100 text-slate-500 italic text-sm",
    subtotal: "bg-amber-50 font-semibold text-sm",
    total: "bg-blue-50 font-bold text-sm border-t-2 border-blue-200",
    data: "bg-white text-sm",
    unknown: "bg-white text-slate-400 text-sm",
};


type HAlign = "left" | "center" | "right";
function colAlign(semanticType: string | undefined): HAlign {
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

// ─── Stable fallback so useMemo deps don't change on every render ─────────────
const EMPTY_DELETED = new Set<number>();



// ─── Schedule of Works table ──────────────────────────────────────────────────
// Extracted as a memoised component so that typing in the form fields (Party A,
// Party B, date, contract body) does NOT trigger a re-render of the table.
// Pairs with useVirtualizer so only ~20 rows are in the DOM at once regardless
// of sheet size, eliminating both the typing lag and the initial-render cost.
const ScheduleTable = memo(function ScheduleTable({
    sheet,
    mutation,
}: {
    sheet: ParsedSheet;
    mutation: SheetMutation | null;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const cellOverrides = mutation?.cells ?? {};

    // O(1) column lookup — avoids Array.find on every cell render
    const colMap = useMemo(() => new Map(sheet.columns.map((c) => [c.letter, c])), [sheet.columns]);

    // Filtered rows — recomputed only when sheet or mutation changes
    const filteredRows = useMemo(() => {
        const deleted = mutation?.deletedRowIndices ?? EMPTY_DELETED;
        return sheet.rows.filter((r) => r.type !== "blank" && !deleted.has(r.index));
    }, [sheet.rows, mutation]);

    // Virtualizer — identical pattern to SpreadsheetTable
    const rowVirtualizer = useVirtualizer({
        count: filteredRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 36,
        overscan: 10,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalSize = rowVirtualizer.getTotalSize();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
        virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

    return (
        <div
            ref={parentRef}
            className="rounded-xl border border-slate-200 overflow-auto mb-2"
            style={{ maxHeight: "40vh" }}
        >
            <table className="w-full border-collapse text-sm">
                <tbody>
                    {paddingTop > 0 && (
                        <tr>
                            <td style={{ height: paddingTop, padding: 0 }} />
                        </tr>
                    )}

                    {virtualItems.map((vRow) => {
                        const row = filteredRows[vRow.index];
                        const rowClass = ROW_CLASS[row.type] ?? ROW_CLASS.data;
                        return (
                            <tr key={row.index} className={`${rowClass} border-b border-slate-100 last:border-0`}>
                                {row.cells.map((cell) => {
                                    if (cell.isMergeChild) return null;

                                    const live = resolveLiveValue(
                                        cell.address,
                                        cell.rawValue,
                                        cell.cachedResult,
                                        cell.formulaString,
                                        cellOverrides
                                    );
                                    const display =
                                        row.type === "header"
                                            ? String(cell.rawValue ?? cell.displayValue ?? "")
                                            : formatCellValue(live, cell.numberFormat, live as number, null);

                                    const colLetter = cell.address.match(/[A-Z]+/)?.[0] ?? "";
                                    const align = colAlign(colMap.get(colLetter)?.semanticType);

                                    return (
                                        <td
                                            key={cell.address}
                                            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                                            className={`px-3 py-2 text-${align}`}
                                            style={{
                                                fontWeight: cell.isBold ? "bold" : undefined,
                                                fontStyle: cell.isItalic ? "italic" : undefined,
                                            }}
                                        >
                                            {display}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}

                    {paddingBottom > 0 && (
                        <tr>
                            <td style={{ height: paddingBottom, padding: 0 }} />
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
});

export default ScheduleTable;