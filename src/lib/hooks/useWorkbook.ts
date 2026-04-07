"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Enable Immer's MapSet plugin so Set/Map mutations work inside Zustand immer middleware
enableMapSet();
import type { ParsedWorkbook, SheetMutation, AppStatus, CellEdit } from "@/types";

interface WorkbookStore {
  // Parsed workbook from the server — immutable after initial load
  workbook: ParsedWorkbook | null;
  // Mutable state layered on top: keyed by sheet id
  mutations: Record<string, SheetMutation>;
  activeSheetIndex: number;
  status: AppStatus;
  errorMessage: string | null;
  filename: string | null;

  // Actions
  setStatus: (status: AppStatus, error?: string) => void;
  setWorkbook: (wb: ParsedWorkbook) => void;
  setActiveSheet: (index: number) => void;

  // Cell editing
  updateCell: (
    sheetId: string,
    address: string,
    value: string | number | null,
    previousValue?: string | number | null
  ) => void;
  batchUpdateCells: (sheetId: string, updates: Record<string, string | number | null>) => void;

  // Row deletion
  deleteRow: (sheetId: string, rowIndex: number, rowAddresses: string[]) => void;
  restoreRow: (sheetId: string, rowIndex: number, rowAddresses: string[]) => void;

  // Reset
  resetSheet: (sheetId: string) => void;
  resetAll: () => void;
}

const initialMutation = (resetVersion = 0): SheetMutation => ({
  cells: {},
  deletedRowIndices: new Set<number>(),
  editHistory: [],
  resetVersion,
});

export const useWorkbookStore = create<WorkbookStore>()(
  immer((set) => ({
    workbook: null,
    mutations: {},
    activeSheetIndex: 0,
    status: "idle",
    errorMessage: null,
    filename: null,

    setStatus: (status, error) =>
      set((state) => {
        state.status = status;
        state.errorMessage = error ?? null;
      }),

    setWorkbook: (wb) =>
      set((state) => {
        state.workbook = wb;
        state.activeSheetIndex = 0;
        state.status = "ready";
        state.errorMessage = null;
        state.filename = wb.filename;

        // Initialize mutations for each sheet
        state.mutations = {};
        for (const sheet of wb.sheets) {
          state.mutations[sheet.id] = initialMutation();
        }
      }),

    setActiveSheet: (index) =>
      set((state) => {
        state.activeSheetIndex = index;
      }),

    updateCell: (sheetId, address, value, previousValue) =>
      set((state) => {
        if (!state.mutations[sheetId]) {
          state.mutations[sheetId] = initialMutation();
        }
        state.mutations[sheetId].cells[address] = value;

        const edit: CellEdit = {
          sheetId,
          address,
          newValue: value,
          previousValue: previousValue ?? null,
          timestamp: Date.now(),
        };
        state.mutations[sheetId].editHistory.push(edit);
      }),

    batchUpdateCells: (sheetId, updates) =>
      set((state) => {
        if (!state.mutations[sheetId]) {
          state.mutations[sheetId] = initialMutation();
        }
        for (const [addr, val] of Object.entries(updates)) {
          state.mutations[sheetId].cells[addr] = val;
        }
      }),

    deleteRow: (sheetId, rowIndex, rowAddresses) =>
      set((state) => {
        if (!state.mutations[sheetId]) {
          state.mutations[sheetId] = initialMutation();
        }
        state.mutations[sheetId].deletedRowIndices.add(rowIndex);
        // Null out all cell values in the deleted row
        for (const addr of rowAddresses) {
          state.mutations[sheetId].cells[addr] = null;
        }
      }),

    restoreRow: (sheetId, rowIndex, rowAddresses) =>
      set((state) => {
        if (!state.mutations[sheetId]) return;
        state.mutations[sheetId].deletedRowIndices.delete(rowIndex);
        // Remove the null overrides for the restored row
        for (const addr of rowAddresses) {
          if (state.mutations[sheetId].cells[addr] === null) {
            delete state.mutations[sheetId].cells[addr];
          }
        }
      }),

    resetSheet: (sheetId) =>
      set((state) => {
        // Preserve and increment resetVersion so SheetEditor re-runs its
        // initial recomputeAll pass (needed for null-cached-result formulas)
        const prev = state.mutations[sheetId]?.resetVersion ?? 0;
        state.mutations[sheetId] = initialMutation(prev + 1);
      }),

    resetAll: () =>
      set((state) => {
        state.workbook = null;
        state.mutations = {};
        state.activeSheetIndex = 0;
        state.status = "idle";
        state.errorMessage = null;
        state.filename = null;
      }),
  }))
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useActiveSheet() {
  return useWorkbookStore((s) => {
    if (!s.workbook) return null;
    return s.workbook.sheets[s.activeSheetIndex] ?? null;
  });
}

export function useSheetMutation(sheetId: string | undefined) {
  return useWorkbookStore((s) => (sheetId ? (s.mutations[sheetId] ?? null) : null));
}

/** Get the current live value for a cell (mutation override or original). */
export function useCellValue(
  sheetId: string | undefined,
  address: string,
  originalValue: string | number | null
): string | number | null {
  return useWorkbookStore((s) => {
    if (!sheetId) return originalValue;
    const mutation = s.mutations[sheetId];
    if (!mutation) return originalValue;
    if (address in mutation.cells) return mutation.cells[address];
    return originalValue;
  });
}
