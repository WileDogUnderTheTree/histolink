/* 校验 docs/史脉_第四批_元明清.md 的 68 行关系表是否被关系库完整覆盖。 */
const fs = require("node:fs");
const path = require("node:path");
const { PERSON_RELATION_INDEX, pairKey } = require("./.tmp-verify-relations/person-relations.js");

const docPath = path.join(__dirname, "..", "..", "docs", "史脉_第四批_元明清.md");
const markdown = fs.readFileSync(docPath, "utf8");
const rows = markdown
  .split(/\r?\n/)
  .filter((line) => line.startsWith("| ") && !line.startsWith("| :---") && !line.includes("所属朝代"))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
  .filter((cells) => cells.length === 6);

console.log("文档关系行数:", rows.length);

const pairSet = new Map();
for (const [dynasty, a, b, label, eventName] of rows) {
  const key = pairKey(a, b);
  pairSet.set(key, { dynasty, a, b, label, eventName });
}

console.log("唯一人物对:", pairSet.size);

const problems = [];
for (const [key, row] of pairSet) {
  const relation = PERSON_RELATION_INDEX.get(key);
  if (!relation) {
    problems.push(`关系库缺少：${row.a} × ${row.b}（${row.dynasty} / ${row.label}）`);
    continue;
  }
  if (Object.keys(relation.eventSummaries).length === 0) {
    problems.push(`关系缺少简述：${row.a} × ${row.b}`);
  }
}

console.log("关系库命中:", pairSet.size - problems.length, "/", pairSet.size);
if (problems.length > 0) {
  for (const problem of problems) console.log(" -", problem);
  process.exitCode = 1;
} else {
  console.log("ALL DOC ROWS COVERED");
}
