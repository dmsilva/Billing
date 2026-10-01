import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const html = readFileSync(join(root, "legacy", "index.html"), "utf-8");

// Extract all <script> blocks
const scriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
let allJs = "";
let match;
while ((match = scriptRegex.exec(html)) !== null) {
  const content = match[1].trim();
  if (content && !content.startsWith("http")) {
    allJs += content + "\n";
  }
}

// Execute just the data declarations in a sandbox
const sandbox = {};
const dataExtract = `
  var DATA, ITEMS, CASH_INVOICES, ALL_CASH_DATA, BANK;
  ${allJs}
`;

// We need to extract only the const declarations, not the DOM-manipulating code
// Find each variable assignment
function extractVarValue(js, varName) {
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*`),
  ];
  for (const pattern of patterns) {
    const m = js.match(pattern);
    if (!m) continue;
    const start = m.index + m[0].length;

    // Find the matching end bracket/brace
    let depth = 0;
    let inString = false;
    let stringChar = null;
    let escape = false;

    for (let i = start; i < js.length; i++) {
      const ch = js[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }

      if (!inString) {
        if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
        if (ch === "[" || ch === "{") { depth++; continue; }
        if (ch === "]" || ch === "}") {
          depth--;
          if (depth === 0) {
            const raw = js.slice(start, i + 1);
            // For single-quoted strings, convert to double-quoted for JSON
            return raw;
          }
        }
      } else {
        if (ch === stringChar) { inString = false; continue; }
      }
    }
  }
  throw new Error(`Could not find ${varName}`);
}

// Use vm to safely evaluate JS expressions
function evalVar(js, varName) {
  const raw = extractVarValue(js, varName);
  const context = vm.createContext({});
  return vm.runInContext(`(${raw})`, context);
}

const DATA = evalVar(allJs, "DATA");
const ITEMS = evalVar(allJs, "ITEMS");
const CASH_INVOICES = evalVar(allJs, "CASH_INVOICES");
const ALL_CASH_DATA = evalVar(allJs, "ALL_CASH_DATA");

console.log(`DATA.transactions: ${DATA.transactions.length} records`);
console.log(`DATA.total_out: €${DATA.total_out}`);
console.log(`ITEMS: ${ITEMS.length} products`);
console.log(`CASH_INVOICES: ${CASH_INVOICES.length} invoices`);
console.log(`ALL_CASH_DATA: ${ALL_CASH_DATA.length} cash closes`);

// Verify integrity
if (ALL_CASH_DATA.length !== 819) {
  throw new Error(`Expected 819 cash closes, got ${ALL_CASH_DATA.length}`);
}
const check = ALL_CASH_DATA.find(r => r.date === "2026-07-02" && r.shift === "23h");
if (!check || Math.abs(check.money - 251.95) > 0.01) {
  throw new Error("Integrity check failed for 2026-07-02 23h");
}

// Verify Jan 1 data from the brief
const jan1_7h = ALL_CASH_DATA.find(r => r.date === "2026-01-01" && r.shift === "7h");
if (!jan1_7h || Math.abs(jan1_7h.money - 16) > 0.01 || Math.abs(jan1_7h.cv - 210.68) > 0.01) {
  throw new Error("Integrity check failed for 2026-01-01 7h");
}

console.log("All integrity checks passed.");

// Compute summary stats
const totalMoney = ALL_CASH_DATA.reduce((s, r) => s + r.money, 0);
const totalCV = ALL_CASH_DATA.reduce((s, r) => s + r.cv, 0);
const totalMB = ALL_CASH_DATA.reduce((s, r) => s + r.mb, 0);
const totalCityMB = ALL_CASH_DATA.reduce((s, r) => s + r.cityMB, 0);
console.log(`Cash totals: Money €${totalMoney.toFixed(2)}, CV €${totalCV.toFixed(2)}, MB €${totalMB.toFixed(2)}, CityMB €${totalCityMB.toFixed(2)}`);

const bankTotal = DATA.transactions.reduce((s, t) => s + t.valor, 0);
console.log(`Bank transactions total: €${bankTotal.toFixed(2)}`);

const cashInvTotal = CASH_INVOICES.reduce((s, t) => s + t.valor, 0);
console.log(`Cash invoices total: €${cashInvTotal.toFixed(2)}`);

const output = { DATA, ITEMS, CASH_INVOICES, ALL_CASH_DATA };
const outPath = join(root, "scripts", "legacy-data.json");
writeFileSync(outPath, JSON.stringify(output));
console.log(`Written to ${outPath} (${(readFileSync(outPath).length / 1024).toFixed(0)} KB)`);
