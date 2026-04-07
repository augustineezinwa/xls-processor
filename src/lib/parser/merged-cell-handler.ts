import { colLetterToIndex, colIndexToLetter, parseAddress } from "./cell-address";

export interface MergeRegion {
  originAddress: string;
  colSpan: number;
  rowSpan: number;
  // All addresses covered (including origin)
  coveredAddresses: Set<string>;
}

/**
 * Parse ExcelJS merged cell range strings (e.g. "A1:C3") into MergeRegion objects.
 * ExcelJS returns merges as an array of strings or as a model object.
 */
export function parseMergeRegions(
  merges: string[]
): Map<string, MergeRegion> {
  const regionMap = new Map<string, MergeRegion>(); // key = originAddress

  for (const mergeStr of merges) {
    const parts = mergeStr.split(":");
    if (parts.length !== 2) continue;

    const startAddr = parts[0].replace(/\$/g, "");
    const endAddr = parts[1].replace(/\$/g, "");

    const start = parseAddress(startAddr);
    const end = parseAddress(endAddr);
    if (!start || !end) continue;

    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);

    const originAddress = `${colIndexToLetter(minCol)}${minRow}`;
    const colSpan = maxCol - minCol + 1;
    const rowSpan = maxRow - minRow + 1;

    const coveredAddresses = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        coveredAddresses.add(`${colIndexToLetter(c)}${r}`);
      }
    }

    regionMap.set(originAddress, {
      originAddress,
      colSpan,
      rowSpan,
      coveredAddresses,
    });
  }

  return regionMap;
}

/**
 * Build a lookup from any cell address → its merge region (if any).
 */
export function buildMergeLookup(
  regionMap: Map<string, MergeRegion>
): Map<string, MergeRegion> {
  const lookup = new Map<string, MergeRegion>();
  for (const region of regionMap.values()) {
    for (const addr of region.coveredAddresses) {
      lookup.set(addr, region);
    }
  }
  return lookup;
}
