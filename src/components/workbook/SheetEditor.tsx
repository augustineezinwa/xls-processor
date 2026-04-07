"use client";

import { useEffect } from "react";
import type { ParsedSheet } from "@/types";
import { SpreadsheetTable } from "@/components/table/SpreadsheetTable";
import { TableToolbar } from "@/components/table/TableToolbar";
import { useWorkbookStore, useSheetMutation } from "@/lib/hooks/useWorkbook";
import { recomputeAll } from "@/lib/formula-engine";

interface SheetEditorProps {
  sheet: ParsedSheet;
}

/**
 * Runs a full recompute pass whenever the sheet is first mounted OR after a
 * reset, so formula cells whose cached result was null in the Excel file
 * (e.g. chains like VAT = Subtotal * 0.15) are evaluated and displayed.
 *
 * We key off `resetVersion` (incremented by resetSheet()) so the effect
 * re-fires after the user clicks "Reset changes".
 */
export function SheetEditor({ sheet }: SheetEditorProps) {
  const batchUpdateCells = useWorkbookStore((s) => s.batchUpdateCells);
  const mutation = useSheetMutation(sheet.id);
  const resetVersion = mutation?.resetVersion ?? 0;

  useEffect(() => {
    // Build the current values map from parsed sheet + any existing mutations
    const mutationCells = mutation?.cells ?? {};
    const values: Record<string, number | string | null> = {};

    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        if (cell.address in mutationCells) {
          values[cell.address] = mutationCells[cell.address];
        } else if (cell.formulaString !== null) {
          values[cell.address] = cell.cachedResult;
        } else {
          values[cell.address] = cell.rawValue as number | string | null;
        }
      }
    }

    // Only run the full recompute if there are formula cells with null cached
    // results that haven't been overridden in the mutation store yet.
    const hasUnresolved = Object.values(sheet.formulaMap).some((entry) => {
      return (
        (values[entry.address] === null ||
          values[entry.address] === undefined) &&
        !(entry.address in mutationCells)
      );
    });

    if (!hasUnresolved) return;

    recomputeAll(values, sheet.formulaMap, new Set()).then((recomputed) => {
      if (Object.keys(recomputed).length > 0) {
        batchUpdateCells(sheet.id, recomputed);
      }
    });
    // Re-run when the sheet changes identity OR when resetVersion increments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id, resetVersion]);

  return (
    <div className="flex flex-col h-full">
      <TableToolbar sheet={sheet} />
      <div className="flex-1 overflow-auto p-0">
        <SpreadsheetTable sheet={sheet} />
      </div>
    </div>
  );
}
