import type { Context } from "hono";
import { parseWorkbook } from "@/lib/parser";
import type { AppVariables } from "../types";


/**
 * Hono controller that converts the validated File into a ParsedWorkbook.
 *
 * Expects `c.var.uploadedFile` to be set by the validateUpload middleware.
 *
 * Responses:
 *   200  { success: true,  workbook: ParsedWorkbook }
 *   422  { success: false, error: "...", details?: "..." }  — unreadable / no sheets
 *   500  { success: false, error: "...", details?: "..." }  — buffer read / parse failure
 */
export async function xlsController(c: Context<{ Variables: AppVariables }>) {
  const file = c.get("uploadedFile");

  try {
    const buffer = await file
      .arrayBuffer()
      .then((bufferedArray) => Buffer.from(bufferedArray))
      .catch(() => {
        throw new FileParseError("Failed to read uploaded file.", 500);
      });

    const workbook = await parseWorkbook(buffer, file.name);

    if (workbook.sheets.length === 0) {
      return c.json({ success: false, error: "The workbook contains no readable sheets." }, 422);
    }

    return c.json({ success: true, workbook });

  } catch (err: unknown) {
    if (err instanceof FileParseError) {
      return c.json({ success: false, error: err.message, details: err.details }, err.statusCode);
    }

    const message = err instanceof Error ? err.message : "Unknown parsing error";

    if (
      message.includes("password") ||
      message.includes("encrypted") ||
      message.includes("corrupt")
    ) {
      return c.json(
        {
          success: false,
          error: "Cannot read this file. It may be password-protected or corrupted.",
          details: message,
        },
        422
      );
    }

    console.error("[parse-excel] Parsing failed:", err);
    return c.json(
      { success: false, error: "Failed to parse the Excel file.", details: message },
      500
    );
  }
}


/**
 * Internal tagged error that carries an HTTP status code and optional details.
 * Thrown inside the try block so the single catch can return the right response.
 */
class FileParseError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 422 | 500,
    public readonly details?: string
  ) {
    super(message);
    this.name = "FileParseError";
  }
}