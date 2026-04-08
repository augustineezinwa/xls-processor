import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppVariables } from "../types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Zod schema for the multipart upload.
 *
 * Validation order (short-circuits at first failure):
 *   1. Field must be a File instance        → 400 "No file provided"
 *   2. File must not be empty              → 400 "Uploaded file is empty"
 *   3. File must be ≤ 10 MB               → 400 "File too large (X.X MB)"
 *   4. Extension must be .xlsx or .xls    → 400 "Unsupported file type"
 *
 * Note: dynamic error messages (steps 3 & 4) use .superRefine() because
 * Zod v4 no longer accepts a message-returning function in .refine().
 */
const UploadSchema = z.object({
  file: z
    .instanceof(File, {
      message: 'No file provided. Include a "file" field in the FormData.',
    })
    .refine((f) => f.size > 0, {
      message: "Uploaded file is empty.",
    })
    .superRefine((f, ctx) => {
      if (f.size > MAX_FILE_SIZE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.`,
        });
      }
    })
    .superRefine((f, ctx) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xls") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported file type ".${ext ?? "unknown"}". Only .xlsx and .xls are accepted.`,
        });
      }
    }),
});

/**
 * Hono middleware that validates the incoming multipart upload via Zod.
 *
 * On success  → attaches the validated File to c.var.uploadedFile and calls next()
 * On failure  → returns 400 JSON with the first Zod error message
 */
export const validateUpload = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { success: false, error: "Failed to parse request body as multipart/form-data" },
      400
    );
  }

  const result = UploadSchema.safeParse({ file: formData.get("file") });

  if (!result.success) {
    const error = result.error.issues[0]?.message ?? "Invalid upload";
    return c.json({ success: false, error }, 400);
  }

  c.set("uploadedFile", result.data.file);
  await next();
});
