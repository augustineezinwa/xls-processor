/**
 * Format a numeric value for display, attempting to mimic Excel number formatting.
 * Falls back to sensible defaults when the exact Excel format isn't parsed.
 */
export function formatCellValue(
  value: string | number | boolean | null,
  numberFormat: string | null,
  cachedResult?: string | number | null,
  formulaString?: string | null
): string {
  // If it's a formula cell, prefer the cached/computed result
  const displayValue = formulaString !== null ? (cachedResult ?? value) : value;

  if (displayValue === null || displayValue === undefined || displayValue === "") {
    return "";
  }

  if (typeof displayValue === "boolean") {
    return displayValue ? "TRUE" : "FALSE";
  }

  if (typeof displayValue === "string") {
    return displayValue;
  }

  if (typeof displayValue === "number") {
    if (!isFinite(displayValue)) return "#NUM!";

    // Try to use Excel number format hints
    if (numberFormat) {
      const fmt = numberFormat.toLowerCase();

      if (fmt.includes("%")) {
        // Percentage: Excel stores as decimal (0.15 = 15%)
        const pct = displayValue * 100;
        const decimals = (fmt.match(/0\.(0+)/) ?? [])[1]?.length ?? 2;
        return `${pct.toFixed(decimals)}%`;
      }

      if (fmt.includes("$") || fmt.includes("£") || fmt.includes("€")) {
        const symbol = fmt.includes("$")
          ? "$"
          : fmt.includes("£")
          ? "£"
          : "€";
        const decimals = (fmt.match(/0\.(0+)/) ?? [])[1]?.length ?? 2;
        return `${symbol}${displayValue.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
      }

      // Date-like format
      if (fmt.includes("yy") || fmt.includes("mm") || fmt.includes("dd")) {
        return String(displayValue);
      }

      // Explicit decimal places: "0.00", "#,##0.00", etc.
      const decimalMatch = fmt.match(/0\.(0+)/);
      if (decimalMatch) {
        const decimals = decimalMatch[1].length;
        return displayValue.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
      }

      // Integer with thousands separator
      if (fmt.includes(",") || fmt === "#,##0") {
        return displayValue.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
      }
    }

    // Default: smart formatting
    if (Number.isInteger(displayValue)) {
      return displayValue.toLocaleString();
    }

    return displayValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  return String(displayValue);
}

/** Parse a user-typed string into a numeric value if possible. */
export function parseInputValue(input: string): string | number | null {
  if (input.trim() === "") return null;

  // Remove currency symbols and commas
  const cleaned = input.replace(/[$£€,\s]/g, "");

  // Handle percentage input
  if (cleaned.endsWith("%")) {
    const num = parseFloat(cleaned.slice(0, -1));
    if (!isNaN(num)) return num / 100;
  }

  const num = parseFloat(cleaned);
  if (!isNaN(num) && cleaned !== "") return num;

  return input.trim();
}
