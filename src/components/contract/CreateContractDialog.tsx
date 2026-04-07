"use client";

import { useState } from "react";
import { X, Printer } from "lucide-react";
import type { ParsedSheet, SheetMutation } from "@/types";
import { formatCellValue } from "@/lib/utils/number-format";
import { exportContractToPDF } from "@/lib/export/contract-export";

// ─── Default contract body text ───────────────────────────────────────────────
const DEFAULT_CONTRACT_TEXT = `This Contract Agreement ("Agreement") is entered into as of the date specified above, between the Supplier/Provider and the Client/Buyer identified herein.

1. SCOPE OF WORK
The Supplier/Provider agrees to supply the materials and/or services listed in the Schedule of Works above, in accordance with the specifications and quantities detailed therein. All items shall meet the agreed quality standards.

2. PAYMENT TERMS
The Client/Buyer agrees to pay the total amount as specified in the Schedule of Works. A deposit of 50% is due upon signing this Agreement. The remaining balance is due within 30 days of delivery and final invoice, unless otherwise agreed in writing by both parties.

3. DELIVERY & INSTALLATION
All materials shall be delivered to the agreed project site within the timeframe confirmed at order. Risk of loss and title to materials shall transfer to the Client/Buyer upon delivery. The Supplier/Provider shall provide reasonable notice prior to delivery.

4. WARRANTIES
The Supplier/Provider warrants that all materials supplied shall conform to the specifications described in this Agreement and shall be free from material defects in workmanship and materials for a period of 12 months from the date of delivery. This warranty does not cover damage caused by misuse, improper installation, or modification by the Client/Buyer.

5. CHANGES & VARIATIONS
Any changes to the scope of work or materials must be agreed in writing by both parties before work proceeds. Additional costs arising from approved variations will be invoiced separately.

6. GOVERNING LAW
This Agreement shall be governed by and construed in accordance with the applicable laws of the jurisdiction in which the project is located. Any dispute arising out of or in connection with this Agreement shall first be subject to good-faith negotiation between the parties.

7. ENTIRE AGREEMENT
This document, together with any attached schedules, constitutes the entire agreement between the parties with respect to the subject matter herein. It supersedes all prior negotiations, representations, or agreements, whether written or oral.`;

// ─── Props ────────────────────────────────────────────────────────────────────
interface CreateContractDialogProps {
  sheet: ParsedSheet;
  mutation: SheetMutation | null;
  filename: string;
  onClose: () => void;
}

// ─── Cell value resolution (same priority as on-screen table) ─────────────────
function resolveLiveValue(
  address: string,
  rawValue: string | number | boolean | null,
  cachedResult: string | number | null,
  formulaString: string | null,
  cellOverrides: Record<string, string | number | null>
): string | number | null {
  if (address in cellOverrides) return cellOverrides[address];
  if (formulaString !== null && cachedResult !== null) return cachedResult;
  if (formulaString === null) return rawValue as string | number | null;
  return null;
}

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

// ─── Signature block ──────────────────────────────────────────────────────────
function SignatureBlock({ label }: { label: string }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-4">{label}</p>
      {["Name", "Signature", "Date"].map((field) => (
        <div key={field} className="mb-5">
          <div className="flex items-end gap-2">
            <span className="text-xs text-slate-500 w-20 shrink-0 pb-0.5">{field}:</span>
            <div className="flex-1 border-b border-slate-400" style={{ minWidth: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section divider ──────────────────────────────────────────────────────────
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-6">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">
        {children}
      </span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

// ─── Main dialog component ────────────────────────────────────────────────────
export function CreateContractDialog({
  sheet,
  mutation,
  filename,
  onClose,
}: CreateContractDialogProps) {
  const [partyA, setPartyA] = useState("");
  const [partyB, setPartyB] = useState("");
  const [agreementDate, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [contractBody, setBody] = useState(DEFAULT_CONTRACT_TEXT);

  const cellOverrides = mutation?.cells ?? {};
  const deletedRows = mutation?.deletedRowIndices ?? new Set<number>();

  const handlePrint = () => {
    exportContractToPDF({ sheet, mutation, partyA, partyB, agreementDate, contractBody });
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col">
        {/* Dialog header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Contract Agreement Preview</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Fill in the party details, edit the terms, then print to PDF.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable contract body */}
        <div className="overflow-y-auto flex-1 px-8 py-8">
          {/* ── Contract title ── */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">CONTRACT AGREEMENT</h1>
            <div className="mt-1 mx-auto w-48 h-0.5 bg-slate-200 rounded-full" />
          </div>

          {/* ── Date of agreement ── */}
          <div className="flex items-center justify-center gap-3 mb-2">
            <label className="text-sm text-slate-500">Date of Agreement:</label>
            <input
              type="date"
              value={agreementDate}
              onChange={(e) => setDate(e.target.value)}
              className="border-b border-slate-300 bg-transparent text-sm text-slate-800 focus:outline-none focus:border-blue-500 px-1 py-0.5"
            />
          </div>

          {/* ── Parties ── */}
          <SectionHeading>Parties</SectionHeading>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-2">
            {/* Party A */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Party A – Supplier / Provider
              </label>
              <input
                type="text"
                value={partyA}
                onChange={(e) => setPartyA(e.target.value)}
                placeholder="Enter supplier / provider name…"
                className="
                  w-full border-b-2 border-slate-200 bg-transparent
                  text-sm text-slate-800 font-medium
                  focus:outline-none focus:border-blue-400
                  placeholder:text-slate-300 py-1
                "
              />
            </div>
            {/* Party B */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Party B – Client / Buyer
              </label>
              <input
                type="text"
                value={partyB}
                onChange={(e) => setPartyB(e.target.value)}
                placeholder="Enter client / buyer name…"
                className="
                  w-full border-b-2 border-slate-200 bg-transparent
                  text-sm text-slate-800 font-medium
                  focus:outline-none focus:border-blue-400
                  placeholder:text-slate-300 py-1
                "
              />
            </div>
          </div>

          {/* ── Schedule of Works ── */}
          <SectionHeading>Schedule of Works</SectionHeading>

          <div className="rounded-xl border border-slate-200 overflow-hidden mb-2">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {sheet.rows
                  .filter((row) => row.type !== "blank" && !deletedRows.has(row.index))
                  .map((row) => {
                    const rowClass = ROW_CLASS[row.type] ?? ROW_CLASS.data;
                    return (
                      <tr
                        key={row.index}
                        className={`${rowClass} border-b border-slate-100 last:border-0`}
                      >
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
                          const colDef = sheet.columns.find((c) => c.letter === colLetter);
                          const align = colAlign(colDef?.semanticType);

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
              </tbody>
            </table>
          </div>

          {/* ── Terms & Conditions ── */}
          <SectionHeading>Terms &amp; Conditions</SectionHeading>

          <p className="text-[10px] text-slate-400 mb-2">
            You can edit the contract text below. Changes are reflected in the PDF.
          </p>
          <textarea
            value={contractBody}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            className="
              w-full rounded-lg border border-slate-200 bg-slate-50
              text-sm text-slate-700 leading-relaxed
              px-4 py-3 resize-y
              focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300
              font-mono
            "
          />

          {/* ── Signatures ── */}
          <SectionHeading>Signatures</SectionHeading>

          <p className="text-[10px] text-slate-400 mb-5">
            These lines appear blank in the printed contract — to be completed by hand.
          </p>

          <div className="flex gap-10">
            <SignatureBlock label="Supplier / Provider" />
            <div className="w-px bg-slate-200 shrink-0" />
            <SignatureBlock label="Client / Buyer" />
          </div>

          {/* Bottom padding so scroll doesn't clip content */}
          <div className="h-4" />
        </div>

        {/* ── Sticky footer ── */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-white rounded-b-2xl">
          <p className="text-xs text-slate-400">
            Based on <span className="font-medium text-slate-600">{filename}</span>
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Contract PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
