"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import { useWorkbookStore } from "@/lib/hooks/useWorkbook";
import type { ParseExcelResult } from "@/types";

export function DropZone() {
  const setStatus = useWorkbookStore((s) => s.setStatus);
  const setWorkbook = useWorkbookStore((s) => s.setWorkbook);
  const [localError, setLocalError] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      setLocalError(null);
      setStatus("uploading");

      const formData = new FormData();
      formData.append("file", file);

      try {
        setStatus("parsing");
        const res = await fetch("/api/parse-excel", {
          method: "POST",
          body: formData,
        });

        const data: ParseExcelResult = await res.json();

        if (!data.success) {
          setStatus("error", data.error);
          setLocalError(data.error);
          return;
        }

        setWorkbook(data.workbook);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error — please try again.";
        setStatus("error", message);
        setLocalError(message);
      }
    },
    [setStatus, setWorkbook]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        processFile(acceptedFiles[0]);
      }
    },
    [processFile]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    onDropRejected: (fileRejections) => {
      const reason = fileRejections[0]?.errors[0]?.message ?? "Invalid file";
      setLocalError(reason);
    },
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="w-full max-w-xl">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg mb-4">
            <FileSpreadsheet className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Excel Sheet Processor</h1>
          <p className="mt-2 text-slate-500 text-sm">
            Upload any Excel file — formulas, totals, and all data are auto-detected
          </p>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`
            relative border-2 border-dashed rounded-2xl p-12 cursor-pointer
            transition-all duration-200 text-center select-none
            ${
              isDragActive && !isDragReject
                ? "border-blue-500 bg-blue-50 scale-[1.01] shadow-md"
                : isDragReject
                  ? "border-red-400 bg-red-50"
                  : "border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-sm"
            }
          `}
        >
          <input {...getInputProps()} />

          <div className="flex flex-col items-center gap-4">
            <div
              className={`
              p-4 rounded-full transition-colors duration-200
              ${isDragActive && !isDragReject ? "bg-blue-100" : "bg-slate-100"}
            `}
            >
              <Upload
                className={`w-8 h-8 transition-colors duration-200 ${
                  isDragActive && !isDragReject ? "text-blue-600" : "text-slate-400"
                }`}
              />
            </div>

            {isDragActive ? (
              isDragReject ? (
                <p className="text-red-500 font-medium">Only .xlsx and .xls files are accepted</p>
              ) : (
                <p className="text-blue-600 font-semibold text-lg">Drop it here!</p>
              )
            ) : (
              <>
                <div>
                  <p className="text-slate-700 font-semibold text-base">
                    Drag & drop your Excel file here
                  </p>
                  <p className="text-slate-400 text-sm mt-1">
                    or{" "}
                    <span className="text-blue-600 font-medium underline underline-offset-2">
                      browse to upload
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="px-2 py-1 bg-slate-100 rounded">.xlsx</span>
                  <span className="px-2 py-1 bg-slate-100 rounded">.xls</span>
                  <span>up to 10 MB</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {localError && (
          <div className="mt-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Upload failed</p>
              <p className="text-xs mt-0.5 text-red-500">{localError}</p>
            </div>
          </div>
        )}

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          {[
            { icon: "🔍", label: "Auto-detect formulas" },
            { icon: "✏️", label: "Edit any cell" },
            { icon: "🔄", label: "Live total updates" },
          ].map((f) => (
            <div
              key={f.label}
              className="p-3 rounded-xl bg-white border border-slate-100 shadow-sm"
            >
              <div className="text-2xl mb-1">{f.icon}</div>
              <p className="text-xs text-slate-500 font-medium">{f.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
