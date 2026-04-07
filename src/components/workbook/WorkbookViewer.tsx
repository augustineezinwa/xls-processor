"use client";

import { useWorkbookStore, useActiveSheet } from "@/lib/hooks/useWorkbook";
import { SheetTabs } from "./SheetTabs";
import { SheetEditor } from "./SheetEditor";
import { FileSpreadsheet } from "lucide-react";

export function WorkbookViewer() {
  const workbook = useWorkbookStore((s) => s.workbook);
  const activeSheetIndex = useWorkbookStore((s) => s.activeSheetIndex);
  const activeSheet = useActiveSheet();

  if (!workbook || !activeSheet) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        <p>No workbook loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top header bar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
          <FileSpreadsheet className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-800 leading-none">
            {workbook.filename}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {workbook.sheets.length} sheet
            {workbook.sheets.length !== 1 ? "s" : ""} ·{" "}
            {activeSheet.dataRowCount} item
            {activeSheet.dataRowCount !== 1 ? "s" : ""} ·{" "}
            {Object.keys(activeSheet.formulaMap).length} formula
            {Object.keys(activeSheet.formulaMap).length !== 1 ? "s" : ""}{" "}
            detected
          </p>
        </div>

        {/* Formula legend */}
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-50 border border-blue-200" />
            Formula cell
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 border border-amber-200" />
            Subtotal
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-100 border border-blue-300" />
            Total
          </span>
        </div>
      </div>

      {/* Sheet tabs (hidden if only one sheet) */}
      <SheetTabs sheets={workbook.sheets} activeIndex={activeSheetIndex} />

      {/* Active sheet editor */}
      <div className="flex-1 overflow-hidden">
        <SheetEditor sheet={activeSheet} />
      </div>
    </div>
  );
}
