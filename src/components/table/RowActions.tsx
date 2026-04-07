"use client";

import { Trash2, RotateCcw } from "lucide-react";
import type { RowType } from "@/types";

interface RowActionsProps {
  rowType: RowType;
  isDeleted: boolean;
  onDelete: () => void;
  onRestore: () => void;
}

const ROW_TYPE_BADGE: Record<RowType, { label: string; color: string }> = {
  header: { label: "HDR", color: "bg-slate-600 text-white" },
  data: { label: "ITEM", color: "bg-slate-100 text-slate-500" },
  subtotal: { label: "SUB", color: "bg-amber-100 text-amber-700" },
  total: { label: "TOT", color: "bg-blue-100 text-blue-700" },
  section: { label: "SEC", color: "bg-purple-100 text-purple-700" },
  blank: { label: "—", color: "bg-transparent text-slate-300" },
  unknown: { label: "?", color: "bg-slate-50 text-slate-400" },
};

export function RowActions({ rowType, isDeleted, onDelete, onRestore }: RowActionsProps) {
  const badge = ROW_TYPE_BADGE[rowType];

  return (
    <td className="w-20 px-1 py-1 border border-slate-200 bg-slate-50/80">
      <div className="flex items-center gap-1 justify-center">
        {/* Row type badge */}
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badge.color}`}
        >
          {badge.label}
        </span>

        {/* Delete / Restore action */}
        {isDeleted ? (
          <button
            onClick={onRestore}
            className="p-0.5 rounded text-green-600 hover:bg-green-50 transition-colors"
            title="Restore row"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        ) : (
          <button
            onClick={onDelete}
            className="p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Delete row"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </td>
  );
}
