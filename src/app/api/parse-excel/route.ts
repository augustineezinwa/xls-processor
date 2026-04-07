/**
 * POST /api/parse-excel
 *
 * Accepts a multipart/form-data upload containing an Excel file.
 * Returns a ParsedWorkbook JSON object with all sheets, rows, cells,
 * and the formula dependency graph.
 *
 * IMPORTANT: runtime = "nodejs" is mandatory because ExcelJS depends on
 * Node.js built-ins (fs, stream, Buffer). The Edge Runtime cannot run ExcelJS.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseWorkbook } from "@/lib/parser";

export const runtime = "nodejs";
export const maxDuration = 30;

const ACCEPTED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/octet-stream", // some browsers send this for xlsx
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function errorJson(status: number, error: string, details?: string) {
  return NextResponse.json({ success: false, error, details }, { status });
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorJson(400, "Failed to parse request body as multipart/form-data");
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return errorJson(400, "No file provided. Include a 'file' field in the FormData.");
  }

  const filename = file.name ?? "upload.xlsx";
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext !== "xlsx" && ext !== "xls") {
    return errorJson(400, `Unsupported file type ".${ext}". Only .xlsx and .xls are accepted.`);
  }

  if (file.size === 0) {
    return errorJson(400, "Uploaded file is empty.");
  }

  if (file.size > MAX_FILE_SIZE) {
    return errorJson(
      400,
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.`
    );
  }

  let buffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    return errorJson(500, "Failed to read uploaded file.");
  }

  try {
    const workbook = await parseWorkbook(buffer, filename);

    if (workbook.sheets.length === 0) {
      return errorJson(422, "The workbook contains no readable sheets.");
    }

    return NextResponse.json({ success: true, workbook });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown parsing error";

    if (
      message.includes("password") ||
      message.includes("encrypted") ||
      message.includes("corrupt")
    ) {
      return errorJson(
        422,
        "Cannot read this file. It may be password-protected or corrupted.",
        message
      );
    }

    console.error("[parse-excel] Parsing failed:", err);
    return errorJson(500, "Failed to parse the Excel file.", message);
  }
}
