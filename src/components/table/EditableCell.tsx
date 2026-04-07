"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { parseInputValue, formatCellValue } from "@/lib/utils/number-format";
import type { ParsedCell } from "@/types";

interface EditableCellProps {
  cell: ParsedCell;
  currentValue: string | number | null;
  isEditable: boolean;
  onEdit: (
    address: string,
    newValue: string | number | null,
    previousValue: string | number | null
  ) => void;
  style?: React.CSSProperties;
  className?: string;
}

function EditableCellInner({
  cell,
  currentValue,
  isEditable,
  onEdit,
  style,
  className = "",
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Displayed value
  const displayValue = formatCellValue(
    currentValue,
    cell.numberFormat,
    typeof currentValue === "number" ? currentValue : null,
    null // don't pass formula string — we already have the live value
  );

  const startEdit = useCallback(() => {
    if (!isEditable) return;
    // Show raw value in edit mode, not formatted
    const raw =
      currentValue === null ? "" : String(currentValue);
    setEditBuffer(raw);
    setIsEditing(true);
  }, [isEditable, currentValue]);

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    const parsed = parseInputValue(editBuffer);
    const prevValue = currentValue;
    if (parsed !== prevValue) {
      onEdit(cell.address, parsed, prevValue);
    }
  }, [editBuffer, currentValue, cell.address, onEdit]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditBuffer("");
  }, []);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  // Cell style from Excel formatting
  const cellStyle: React.CSSProperties = {
    fontWeight: cell.isBold ? "bold" : undefined,
    fontStyle: cell.isItalic ? "italic" : undefined,
    backgroundColor: cell.backgroundColor ?? undefined,
    color: cell.fontColor ?? undefined,
    ...style,
  };

  const isFormula = cell.formulaString !== null;
  const isEmpty = currentValue === null || currentValue === "";

  if (cell.isMergeChild) {
    return null; // Merged child cells render nothing; parent handles colSpan
  }

  return (
    <td
      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
      style={cellStyle}
      className={`
        relative border border-slate-200 text-sm
        ${isEditable ? "cursor-pointer group" : ""}
        ${isFormula ? "bg-blue-50/30" : ""}
        ${isEmpty ? "bg-transparent" : ""}
        ${className}
      `}
      onClick={!isEditing ? startEdit : undefined}
      title={isFormula ? `Formula: ${cell.formulaString}` : undefined}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={editBuffer}
          onChange={(e) => setEditBuffer(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="
            absolute inset-0 w-full h-full px-2 py-1
            text-sm font-inherit bg-white border-2 border-blue-500
            outline-none z-10 rounded-none
          "
        />
      ) : (
        <div
          className={`
            px-2 py-1.5 min-h-[2rem] flex items-center
            ${isEditable ? "group-hover:bg-slate-50" : ""}
          `}
        >
          <span className={isEmpty ? "text-slate-300 italic text-xs" : ""}>
            {isEmpty ? "" : displayValue}
          </span>

          {/* Formula indicator badge */}
          {isFormula && (
            <span
              className="ml-1 text-[9px] text-blue-400 font-mono opacity-60 shrink-0"
              title={cell.formulaString ?? ""}
            >
              ƒ
            </span>
          )}
        </div>
      )}
    </td>
  );
}

/**
 * Memoized EditableCell — only re-renders when its own value, editability,
 * or the stable onEdit callback changes.  This prevents the full-table
 * re-render cascade that fires on every cell mutation.
 */
export const EditableCell = memo(EditableCellInner, (prev, next) => {
  return (
    prev.currentValue === next.currentValue &&
    prev.isEditable === next.isEditable &&
    prev.onEdit === next.onEdit &&
    prev.cell.address === next.cell.address &&
    prev.className === next.className
  );
});
