"use client";

import { useWorkbookStore } from "@/lib/hooks/useWorkbook";
import { DropZone } from "@/components/upload/DropZone";
import { UploadProgress } from "@/components/upload/UploadProgress";
import { WorkbookViewer } from "@/components/workbook/WorkbookViewer";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function Home() {
  const status = useWorkbookStore((s) => s.status);
  const errorMessage = useWorkbookStore((s) => s.errorMessage);
  const resetAll = useWorkbookStore((s) => s.resetAll);

  if (status === "idle") {
    return <DropZone />;
  }

  if (status === "uploading" || status === "parsing") {
    return <UploadProgress />;
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-red-50 p-6">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-100 mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            Failed to process file
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            {errorMessage ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={resetAll}
            className="
              inline-flex items-center gap-2 px-6 py-3
              bg-blue-600 text-white text-sm font-medium
              rounded-xl hover:bg-blue-700 transition-colors
            "
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  // status === "ready"
  return <WorkbookViewer />;
}
