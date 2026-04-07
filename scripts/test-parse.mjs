import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, "../public/test-quote.xlsx");

const fileBuffer = readFileSync(filePath);
const blob = new Blob([fileBuffer], {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const formData = new FormData();
formData.append("file", blob, "test-quote.xlsx");

console.log("Testing /api/parse-excel...\n");

const res = await fetch("http://localhost:3000/api/parse-excel", {
  method: "POST",
  body: formData,
});

const data = await res.json();

if (!data.success) {
  console.error("ERROR:", data.error, data.details ?? "");
  process.exit(1);
}

const wb = data.workbook;
console.log(`✅ Workbook parsed: ${wb.filename}`);
console.log(`   Sheets: ${wb.sheets.length}`);

for (const sheet of wb.sheets) {
  console.log(`\n══════════════════════════════`);
  console.log(`  Sheet: "${sheet.name}"`);
  console.log(`  Columns (${sheet.columns.length}):`);
  for (const col of sheet.columns) {
    console.log(
      `    ${col.letter} — "${col.headerText}" [${col.semanticType}]`
    );
  }

  console.log(`\n  Rows (${sheet.rows.length}):`);
  for (const row of sheet.rows) {
    const nonEmpty = row.cells.filter(
      (c) => c.rawValue !== null || c.formulaString
    );
    if (nonEmpty.length === 0 && row.type === "blank") continue;
    const preview = nonEmpty
      .slice(0, 3)
      .map(
        (c) =>
          `[${c.address}=${
            c.formulaString ? `formula(${c.cachedResult ?? "?"})` : c.rawValue
          }]`
      )
      .join(" ");
    console.log(`    Row ${row.index} [${row.type}]: ${preview}`);
  }

  const formulaEntries = Object.values(sheet.formulaMap);
  console.log(`\n  Formula cells (${formulaEntries.length}):`);
  for (const f of formulaEntries) {
    const flag = f.isRoot ? "🔴 ROOT" : `  depth:${f.depth}`;
    console.log(`    ${flag} ${f.address} = ${f.formulaString}`);
    console.log(
      `          axis:${f.computationAxis} | deps:[${f.dependencies.slice(0, 5).join(",")}${f.dependencies.length > 5 ? "..." : ""}]`
    );
  }
}
