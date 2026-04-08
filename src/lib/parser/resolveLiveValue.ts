// ─── Cell value resolution (same priority as on-screen table) ─────────────────
// Get the live value for a cell:
//   1. User mutation override (highest priority)
//   2. Cached formula result from parse (if present)
//   3. Raw value (plain data cells)
//   4. null (formula cell with no cached result — evaluator will fill it)
export function resolveLiveValue(
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