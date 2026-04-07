import type { FormulaEntry, FormulaMap, DependencyGraph, ComputationAxis } from "@/types";
import { extractCellRefs, detectComputationAxis } from "./cell-address";

interface RawFormulaCell {
  address: string;
  formulaString: string;
}

/**
 * Build the complete FormulaMap and DependencyGraph from raw formula cells.
 *
 * Algorithm:
 * 1. Build FormulaMap: each formula cell records its dependencies (what it reads)
 * 2. Build reverse DependencyGraph: for each plain cell, track which formula cells reference it
 * 3. Identify root formula cells (nothing depends on them — they ARE the totals)
 * 4. BFS from roots to assign depth (0=total, 1=subtotal, 2+=deeper)
 * 5. Populate .dependents on each FormulaEntry
 */
export function buildFormulaGraph(formulaCells: RawFormulaCell[]): {
  formulaMap: FormulaMap;
  dependencyGraph: DependencyGraph;
} {
  const formulaMap: FormulaMap = {};
  // reverseMap: address → set of formula addresses that reference it
  const reverseMap: Record<string, Set<string>> = {};

  // ── Step 1: Build FormulaMap ──────────────────────────────────────────────
  for (const { address, formulaString } of formulaCells) {
    const deps = extractCellRefs(formulaString);
    const axis: ComputationAxis = detectComputationAxis(address, deps);

    formulaMap[address] = {
      address,
      formulaString,
      dependencies: deps,
      dependents: [],     // filled below
      depth: -1,          // filled during BFS
      computationAxis: axis,
      isRoot: false,      // filled below
    };

    // Register reverse edges
    for (const dep of deps) {
      if (!reverseMap[dep]) reverseMap[dep] = new Set();
      reverseMap[dep].add(address);
    }
  }

  // ── Step 2: Build DependencyGraph (reverse: plain cell → formula cells) ──
  const dependencyGraph: DependencyGraph = {};
  for (const [dep, formulaAddrs] of Object.entries(reverseMap)) {
    dependencyGraph[dep] = Array.from(formulaAddrs);
  }

  // ── Step 3: Identify root formula cells ──────────────────────────────────
  // A root is a formula cell that is NOT in any other formula's dependency list.
  // i.e., reverseMap[rootAddr] is either empty or the root is not in reverseMap at all.
  const roots: string[] = [];
  for (const addr of Object.keys(formulaMap)) {
    const isReferenced = reverseMap[addr] && reverseMap[addr].size > 0;
    if (!isReferenced) {
      formulaMap[addr].isRoot = true;
      roots.push(addr);
    }
  }

  // ── Step 4: BFS from roots to assign depth ───────────────────────────────
  const queue: Array<{ addr: string; depth: number }> = roots.map((r) => ({
    addr: r,
    depth: 0,
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { addr, depth } = item;

    if (visited.has(addr)) continue;
    visited.has(addr); // no-op guard
    visited.add(addr);

    const entry = formulaMap[addr];
    if (!entry) continue;

    // Only update depth if not yet assigned or if this path gives a shallower depth
    if (entry.depth === -1 || depth < entry.depth) {
      entry.depth = depth;
    }

    // Enqueue formula deps (deps that are themselves formulas = subtotals)
    for (const dep of entry.dependencies) {
      if (formulaMap[dep] && !visited.has(dep)) {
        queue.push({ addr: dep, depth: depth + 1 });
      }
    }
  }

  // Any formula that was never visited (disconnected / circular) gets depth = 99
  for (const entry of Object.values(formulaMap)) {
    if (entry.depth === -1) entry.depth = 99;
  }

  // ── Step 5: Populate .dependents on each entry ───────────────────────────
  for (const [dep, formulaAddrs] of Object.entries(reverseMap)) {
    // dep might be a formula cell itself
    if (formulaMap[dep]) {
      formulaMap[dep].dependents = Array.from(formulaAddrs);
    }
  }

  return { formulaMap, dependencyGraph };
}

/**
 * Given a FormulaMap, return all cell addresses reachable from the roots
 * (i.e., every cell that is part of any computation tree).
 */
export function getAllTreeAddresses(formulaMap: FormulaMap): Set<string> {
  const inTree = new Set<string>();
  for (const entry of Object.values(formulaMap)) {
    inTree.add(entry.address);
    for (const dep of entry.dependencies) {
      inTree.add(dep);
    }
  }
  return inTree;
}
