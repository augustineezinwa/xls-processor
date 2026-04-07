"use client";

import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useWorkbookStore } from "@/lib/hooks/useWorkbook";

export function UploadProgress() {
  const status = useWorkbookStore((s) => s.status);

  const steps = [
    { id: "uploading", label: "Uploading file…" },
    { id: "parsing", label: "Parsing Excel & detecting formulas…" },
  ];

  const currentStep = steps.findIndex((s) => s.id === status);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg mb-6">
          <FileSpreadsheet className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-xl font-semibold text-slate-800 mb-2">Processing your file</h2>
        <p className="text-slate-400 text-sm mb-8">
          Analysing structure, formulas, and dependencies…
        </p>

        {/* Progress steps */}
        <div className="space-y-3 text-left">
          {steps.map((step, i) => {
            const isDone = i < currentStep;
            const isActive = i === currentStep;
            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-blue-50 border border-blue-200"
                    : isDone
                      ? "bg-green-50 border border-green-100"
                      : "bg-white border border-slate-100 opacity-40"
                }`}
              >
                {isActive ? (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                ) : isDone ? (
                  <span className="text-green-500 text-sm shrink-0">✓</span>
                ) : (
                  <span className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
                )}
                <span
                  className={`text-sm font-medium ${
                    isActive ? "text-blue-700" : isDone ? "text-green-700" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
