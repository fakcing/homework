// Counts type assertions (`x as T`, excluding `as const` and import/export aliases) and the non-null operator, and
// requires every one of them to be explained by a comment on the same or the previous line. Budget: fewer than 5.
import fs from "node:fs";
import path from "node:path";

const roots = ["shared/src", "server/src", "client/src"];
const BUDGET = 4;
const found = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith(".ts")) scan(full);
  }
};
function scan(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\*|\*)/.test(line)) return; // JSDoc / block comment lines
    const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    if (/^\s*(import|export)\b.*\bas\b/.test(code)) return;
    const hasAs = /\)\s+as\s+(?!const\b)\w|\w\s+as\s+(?!const\b)[A-Za-z_{([]/.test(code);
    const hasBang = /\w!(\.|\[|\)|;|,)/.test(code);
    if (hasAs || hasBang)
      found.push({
        file,
        line: i + 1,
        text: line.trim(),
        explained: /\/\//.test(line) || /\/\//.test(lines[i - 1] ?? ""),
      });
  });
}
roots.forEach(walk);
for (const f of found) console.log(`${f.explained ? "ok " : "!! "} ${f.file}:${f.line}  ${f.text}`);
console.log(`type assertions: ${found.length} (budget ${BUDGET})`);
if (found.length > BUDGET || found.some((f) => !f.explained)) process.exit(1);
