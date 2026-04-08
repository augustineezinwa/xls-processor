"use client";

import { useCallback, useRef } from "react";
import type { ParsedSheet } from "@/types";
import { useWorkbookStore } from "./useWorkbook";
import { recomputeFromEdit, recomputeAll } from "@/lib/formulaEngine";

/**
 * React hook that wraps the formula engine for a single sheet.
 * Provides:
 *   - handleCellEdit: call when user edits a cell; recomputes all dependents
 *   - handleRowDelete: call when user deletes a row; nulls row values and recomputes
 */
export function useFormulaEngine(sheet: ParsedSheet) {
  const batchUpdateCells = useWorkbookStore((s) => s.batchUpdateCells);
  const updateCell = useWorkbookStore((s) => s.updateCell);
  const deleteRowStore = useWorkbookStore((s) => s.deleteRow);
  const restoreRowStore = useWorkbookStore((s) => s.restoreRow);
  const mutations = useWorkbookStore((s) => s.mutations[sheet.id]);

  // Keep a ref to the latest mutations.cells to avoid stale closures
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  /**
   * Build the current values map for the sheet:
   * starts from all cell rawValues, applies formula cachedResults as initial,
   * then overlays any user mutations.
   */
  const buildCurrentValues = useCallback((): Record<string, number | string | null> => {
    const values: Record<string, number | string | null> = {};

    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        // Use cachedResult for formula cells, rawValue for plain cells
        const baseValue =
          cell.formulaString !== null
            ? cell.cachedResult
            : (cell.rawValue as number | string | null);
        values[cell.address] = baseValue;
      }
    }

    // Overlay mutations
    const mutCells = mutationsRef.current?.cells ?? {};
    for (const [addr, val] of Object.entries(mutCells)) {
      values[addr] = val;
    }

    return values;
  }, [sheet]);

  /**
   * Called when the user edits a cell's value.
   * 1. Saves the new value
   * 2. BFS-recomputes all formula cells that transitively depend on this cell
   * 3. Batch-saves all recomputed cells
   */
  const handleCellEdit = useCallback(
    async (
      address: string,
      newValue: string | number | null,
      previousValue: string | number | null
    ) => {
      // 1. Save the direct edit
      updateCell(sheet.id, address, newValue, previousValue);

      // 2. If no formula depends on this cell, nothing more to do
      const directDeps = sheet.dependencyGraph[address];
      if (!directDeps || directDeps.length === 0) return;

      // 3. Build current values (including this edit)
      const currentValues = buildCurrentValues();
      currentValues[address] = newValue;

      // 4. Recompute all affected formula cells
      const recomputed = await recomputeFromEdit(
        address,
        newValue,
        currentValues,
        sheet.formulaMap,
        sheet.dependencyGraph
      );

      // 5. Batch-save all recomputed cells
      if (Object.keys(recomputed).length > 0) {
        batchUpdateCells(sheet.id, recomputed);
      }
    },
    [sheet, updateCell, batchUpdateCells, buildCurrentValues]
  );

  /**
   * Called when the user deletes a row.
   * 1. Records the row as deleted and nulls its cell values
   * 2. Recomputes all formulas that referenced cells in the deleted row
   */
  const handleRowDelete = useCallback(
    async (rowIndex: number) => {
      const row = sheet.rows[rowIndex];
      if (!row) return;

      const rowAddresses = row.cells.map((c) => c.address);

      // 1. Mark row as deleted in store
      deleteRowStore(sheet.id, rowIndex, rowAddresses);

      // 2. Build current values with deleted row nulled out
      const currentValues = buildCurrentValues();
      const deletedSet = new Set(rowAddresses);

      // 3. Recompute all formulas (full pass because any formula referencing
      //    any deleted cell is affected)
      const recomputed = await recomputeAll(currentValues, sheet.formulaMap, deletedSet);

      if (Object.keys(recomputed).length > 0) {
        batchUpdateCells(sheet.id, recomputed);
      }
    },
    [sheet, deleteRowStore, batchUpdateCells, buildCurrentValues]
  );

  /**
   * Restore a previously deleted row and recompute.
   *
   * We must NOT use buildCurrentValues() here because mutationsRef.current is
   * stale at this point — it still reflects the pre-restore state (nulled cells).
   * Instead we read the Zustand store directly after restoreRowStore() so we
   * get the freshly-updated cells map (with null overrides already removed).
   */
  const handleRowRestore = useCallback(
    async (rowIndex: number) => {
      const row = sheet.rows[rowIndex];
      if (!row) return;

      const rowAddresses = row.cells.map((c) => c.address);

      // 1. Restore the row in the store (removes null overrides synchronously)
      restoreRowStore(sheet.id, rowIndex, rowAddresses);

      // 2. Read FRESH store state immediately after the synchronous update
      const freshMutCells = useWorkbookStore.getState().mutations[sheet.id]?.cells ?? {};

      // 3. Build current values with fresh mutations overlaid
      const values: Record<string, number | string | null> = {};
      for (const r of sheet.rows) {
        for (const cell of r.cells) {
          const base =
            cell.formulaString !== null
              ? cell.cachedResult
              : (cell.rawValue as number | string | null);
          values[cell.address] = base;
        }
      }
      for (const [addr, val] of Object.entries(freshMutCells)) {
        values[addr] = val;
      }

      // 4. Full recompute with no deleted rows — overwrites any stale zeros
      const recomputed = await recomputeAll(values, sheet.formulaMap, new Set());

      if (Object.keys(recomputed).length > 0) {
        batchUpdateCells(sheet.id, recomputed);
      }
    },
    [sheet, restoreRowStore, batchUpdateCells]
  );

  return { handleCellEdit, handleRowDelete, handleRowRestore };
}
