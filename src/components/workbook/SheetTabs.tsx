"use client";

import { useWorkbookStore } from "@/lib/hooks/useWorkbook";
import type { ParsedSheet } from "@/types";

interface SheetTabsProps {
  sheets: ParsedSheet[];
  activeIndex: number;
}

export function SheetTabs({ sheets, activeIndex }: SheetTabsProps) {
  const setActiveSheet = useWorkbookStore((s) => s.setActiveSheet);

  if (sheets.length <= 1) return null;

  return (
    <div className="flex items-end gap-1 px-4 pt-4 pb-0 bg-slate-100 border-b border-slate-200 overflow-x-auto">
      {sheets.map((sheet, i) => (
        <button
          key={sheet.id}
          onClick={() => setActiveSheet(i)}
          className={`
            flex items-center gap-1.5 px-4 py-2 text-sm font-medium
            rounded-t-lg border border-b-0 whitespace-nowrap transition-colors
            ${
              i === activeIndex
                ? "bg-white border-slate-200 text-blue-700 shadow-sm"
                : "bg-slate-50 border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/70"
            }
          `}
        >
          {sheet.name}
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${
              i === activeIndex ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-400"
            }`}
          >
            {sheet.dataRowCount}
          </span>
        </button>
      ))}
    </div>
  );
}
