/**
 * Client-side formula evaluator.
 * Uses @formulajs/formulajs for Excel function implementations.
 * Performs BFS traversal of the dependency graph to recompute all
 * affected cells when a value is edited.
 */

import type { FormulaMap, DependencyGraph } from "@/types";
import { substituteRefs, expandRange } from "./ref-parser";

// Lazy-load formulajs to avoid SSR issues
let formulajsCache: Record<string, (...args: unknown[]) => unknown> | null = null;

async function getFormulajs() {
  if (!formulajsCache) {
    const fjs = await import("@formulajs/formulajs");
    formulajsCache = fjs as unknown as Record<string, (...args: unknown[]) => unknown>;
  }
  return formulajsCache;
}

/**
 * Evaluate a single formula string against the current values map.
 * Returns the computed result or null on error.
 */
export async function evaluateFormula(
  formulaString: string,
  getValue: (addr: string) => number | string | null,
  formulajs: Record<string, (...args: unknown[]) => unknown>
): Promise<number | string | null> {
  try {
    // Substitute all cell references with current values
    const expr = substituteRefs(formulaString, getValue);

    // Build a function that has access to formulajs functions
    // Map common Excel function names to formulajs equivalents
    const fnMap: Record<string, unknown> = {
      SUM: formulajs.SUM,
      AVERAGE: formulajs.AVERAGE,
      AVG: formulajs.AVERAGE,
      MIN: formulajs.MIN,
      MAX: formulajs.MAX,
      COUNT: formulajs.COUNT,
      COUNTA: formulajs.COUNTA,
      IF: formulajs.IF,
      ROUND: formulajs.ROUND,
      ROUNDUP: formulajs.ROUNDUP,
      ROUNDDOWN: formulajs.ROUNDDOWN,
      ABS: formulajs.ABS,
      SQRT: formulajs.SQRT,
      POWER: formulajs.POWER,
      MOD: formulajs.MOD,
      INT: formulajs.INT,
      CEILING: formulajs.CEILING,
      FLOOR: formulajs.FLOOR,
      SUMIF: formulajs.SUMIF,
      COUNTIF: formulajs.COUNTIF,
      IFERROR: formulajs.IFERROR,
      AND: formulajs.AND,
      OR: formulajs.OR,
      NOT: formulajs.NOT,
      LEN: formulajs.LEN,
      TRIM: formulajs.TRIM,
      UPPER: formulajs.UPPER,
      LOWER: formulajs.LOWER,
      CONCATENATE: formulajs.CONCATENATE,
      TEXT: formulajs.TEXT,
      VALUE: formulajs.VALUE,
      ISBLANK: formulajs.ISBLANK,
      ISNUMBER: formulajs.ISNUMBER,
      ISTEXT: formulajs.ISTEXT,
    };

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      ...Object.keys(fnMap),
      `"use strict"; try { return (${expr}); } catch(e) { return null; }`
    );

    const result = fn(...Object.values(fnMap));

    if (result === null || result === undefined) return null;
    if (typeof result === "number" && !isFinite(result)) return null;
    if (typeof result === "boolean") return result ? 1 : 0;
    if (typeof result === "number" || typeof result === "string") return result;

    // formulajs might return arrays for some functions
    if (Array.isArray(result)) return result[0] ?? null;

    return null;
  } catch {
    return null;
  }
}

/**
 * Recompute all formula cells affected by an edit to `changedAddress`.
 *
 * Algorithm:
 * 1. Update values[changedAddress] = newValue
 * 2. BFS upward through reverseDependencyGraph (who depends on this cell?)
 * 3. For each formula cell encountered, evaluate its formula
 * 4. Continue until roots are recomputed
 *
 * Returns: record of { address → newComputedValue } for all affected formula cells
 */
export async function recomputeFromEdit(
  changedAddress: string,
  newValue: number | string | null,
  currentValues: Record<string, number | string | null>,
  formulaMap: FormulaMap,
  dependencyGraph: DependencyGraph // reverseDep: plain cell → formula cells that use it
): Promise<Record<string, number | string | null>> {
  const formulajs = await getFormulajs();

  // Working copy of values — will be mutated as we recompute
  const values: Record<string, number | string | null> = {
    ...currentValues,
    [changedAddress]: newValue,
  };

  const recomputed: Record<string, number | string | null> = {};

  // BFS queue: formula cells to recompute
  const queue: string[] = [];
  const enqueued = new Set<string>();

  // Seed: formula cells that directly reference changedAddress
  const directDeps = dependencyGraph[changedAddress] ?? [];
  for (const dep of directDeps) {
    if (!enqueued.has(dep)) {
      queue.push(dep);
      enqueued.add(dep);
    }
  }

  while (queue.length > 0) {
    const addr = queue.shift()!;
    const entry = formulaMap[addr];
    if (!entry) continue;

    // Evaluate this formula
    const getValue = (a: string) => values[a] ?? null;
    const result = await evaluateFormula(entry.formulaString, getValue, formulajs);

    // Update working values
    values[addr] = result;
    recomputed[addr] = result;

    // Enqueue formula cells that depend on THIS cell (propagate upward)
    const upstreamDeps = dependencyGraph[addr] ?? [];
    for (const upstream of upstreamDeps) {
      if (!enqueued.has(upstream)) {
        queue.push(upstream);
        enqueued.add(upstream);
      }
    }
  }

  return recomputed;
}

/**
 * Recompute all formula cells in a sheet from scratch.
 * Used when a row is deleted (to recompute all affected sums).
 */
export async function recomputeAll(
  currentValues: Record<string, number | string | null>,
  formulaMap: FormulaMap,
  deletedAddresses: Set<string>
): Promise<Record<string, number | string | null>> {
  const formulajs = await getFormulajs();

  const values: Record<string, number | string | null> = { ...currentValues };

  // Null out deleted cells
  for (const addr of deletedAddresses) {
    values[addr] = null;
  }

  // Process formulas in topological order (leaves first, roots last)
  // Sort by depth descending (deepest = highest depth number = process first)
  const sortedFormulas = Object.values(formulaMap).sort((a, b) => b.depth - a.depth);

  const recomputed: Record<string, number | string | null> = {};

  for (let i = 0; i < sortedFormulas.length; i++) {
    const entry = sortedFormulas[i];
    if (deletedAddresses.has(entry.address)) continue;

    const getValue = (a: string): number | string | null => {
      if (deletedAddresses.has(a)) return null;
      return values[a] ?? null;
    };

    const result = await evaluateFormula(entry.formulaString, getValue, formulajs);
    values[entry.address] = result;
    recomputed[entry.address] = result;

    // Yield to the event loop every 50 formulas so the main thread can
    // process pointer/keyboard events and the UI stays responsive during
    // large recomputations (e.g. row deletion on an 11k-row sheet).
    if (i > 0 && i % 50 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return recomputed;
}
