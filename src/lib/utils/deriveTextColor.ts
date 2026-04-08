/**
 * Return white or dark-slate text depending on the perceived luminance of a
 * hex background colour, ensuring WCAG-level contrast on any coloured cell.
 *
 * Formula: ITU-R BT.601 perceived brightness
 *   Y = (0.299·R + 0.587·G + 0.114·B) / 255
 * Threshold 0.55 gives white text on medium-to-dark colours and dark text on
 * pastels / light tints.
 */
export function deriveTextColor(bgHex: string): string {
    const r = parseInt(bgHex.slice(1, 3), 16);
    const g = parseInt(bgHex.slice(3, 5), 16);
    const b = parseInt(bgHex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.55 ? "#ffffff" : "#1e293b"; // white or slate-800
}