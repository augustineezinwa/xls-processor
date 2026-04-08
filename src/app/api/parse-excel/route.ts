/**
 * POST /api/parse-excel
 *
 * Thin Hono app. All validation is handled by the validateUpload middleware
 * (Zod schema) and all processing is handled by the xlsController.
 *
 * IMPORTANT: runtime = "nodejs" is mandatory because ExcelJS depends on
 * Node.js built-ins (fs, stream, Buffer). The Edge Runtime cannot run ExcelJS.
 *
 * Hono apps implement the standard Fetch API (Request → Response), which is
 * directly compatible with Next.js App Router route handlers — no adapter needed.
 */

import { Hono } from "hono";
import { validateUpload } from "@/server/middlewares/validateUpload";
import { xlsController } from "@/server/controllers/xlsController";
import type { AppVariables } from "@/server/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const app = new Hono<{ Variables: AppVariables }>();

app.post("*", validateUpload, xlsController);

export const POST = (req: Request) => app.fetch(req);
