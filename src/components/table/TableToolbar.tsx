"use client";

import { useState } from "react";
import { RotateCcw, FileSpreadsheet, Upload, FileDown, FileText } from "lucide-react";
import { useWorkbookStore, useSheetMutation } from "@/lib/hooks/useWorkbook";
import { exportSheetToPDF } from "@/lib/export/pdf-export";
import { CreateContractDialog } from "@/components/contract/CreateContractDialog";
import type { ParsedSheet } from "@/types";

interface TableToolbarProps {
  sheet: ParsedSheet;
}

export function TableToolbar({ sheet }: TableToolbarProps) {
  const resetSheet = useWorkbookStore((s) => s.resetSheet);
  const resetAll = useWorkbookStore((s) => s.resetAll);
  const filename = useWorkbookStore((s) => s.filename) ?? sheet.name;
  const mutation = useSheetMutation(sheet.id);
  const [isContractOpen, setIsContractOpen] = useState(false);

  const deletedCount = mutation?.deletedRowIndices.size ?? 0;
  const editCount = mutation?.editHistory.length ?? 0;
  const hasChanges = deletedCount > 0 || editCount > 0;

  const dataRowCount = sheet.dataRowCount;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 rounded-t-xl">
        {/* Left: sheet info */}
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
          <div>
            <span className="font-semibold text-slate-800 text-sm">{sheet.name}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-400">
                {dataRowCount} item{dataRowCount !== 1 ? "s" : ""}
              </span>
              {deletedCount > 0 && (
                <span className="text-xs text-red-500">· {deletedCount} deleted</span>
              )}
              {editCount > 0 && (
                <span className="text-xs text-amber-500">
                  · {editCount} edit{editCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {/* Reset sheet */}
          {hasChanges && (
            <button
              onClick={() => resetSheet(sheet.id)}
              className="
              flex items-center gap-1.5 px-3 py-1.5
              text-xs font-medium text-slate-600
              border border-slate-200 rounded-lg
              hover:bg-slate-50 hover:border-slate-300
              transition-colors
            "
              title="Reset all changes to this sheet"
            >
              <RotateCcw className="w-3 h-3" />
              Reset changes
            </button>
          )}

          {/* Create contract */}
          <button
            onClick={() => setIsContractOpen(true)}
            className="
            flex items-center gap-1.5 px-3 py-1.5
            text-xs font-medium text-slate-600
            border border-slate-200 rounded-lg
            hover:bg-slate-50 hover:border-slate-300
            transition-colors
          "
            title="Create a contract from this sheet"
          >
            <FileText className="w-3 h-3" />
            Create Contract
          </button>

          {/* Export current sheet as PDF */}
          <button
            onClick={() => exportSheetToPDF(sheet, mutation ?? null, filename)}
            className="
            flex items-center gap-1.5 px-3 py-1.5
            text-xs font-medium text-slate-600
            border border-slate-200 rounded-lg
            hover:bg-slate-50 hover:border-slate-300
            transition-colors
          "
            title="Download current sheet as PDF"
          >
            <FileDown className="w-3 h-3" />
            Export PDF
          </button>

          {/* Upload new file */}
          <button
            onClick={resetAll}
            className="
            flex items-center gap-1.5 px-3 py-1.5
            text-xs font-medium text-white
            bg-blue-600 rounded-lg
            hover:bg-blue-700
            transition-colors
          "
            title="Upload a new Excel file"
          >
            <Upload className="w-3 h-3" />
            New file
          </button>
        </div>
      </div>

      {/* Contract dialog — mounted outside the toolbar div so it can be full-screen */}
      {isContractOpen && (
        <CreateContractDialog
          sheet={sheet}
          mutation={mutation ?? null}
          filename={filename}
          onClose={() => setIsContractOpen(false)}
        />
      )}
    </>
  );
}
