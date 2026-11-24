import { loadTsData } from "../scripts/lib/load-ts-data.mjs";

const { eventPool } = loadTsData();

const parenPattern = /（[^（）]*据[^（）]*）/g;
const wrappers = new Map();
let withSource = 0;
let without = [];
let bookCounts = new Map();
let separatorSamples = new Set();

for (const event of eventPool) {
  const desc = event.description;
  const matches = desc.match(parenPattern) ?? [];
  if (matches.length === 0) {
    without.push(event.id);
    continue;
  }
  withSource += 1;
  const last = matches[matches.length - 1];
  const books = [...last.matchAll(/《([^》]+)》/g)].map((m) => m[1]);
  bookCounts.set(books.length, (bookCounts.get(books.length) ?? 0) + 1);
  const structure = last.replace(/《[^》]+》/g, "《X》");
  wrappers.set(structure, (wrappers.get(structure) ?? 0) + 1);
  // 书名之间分隔符
  const between = last.replace(/^（据/, "").replace(/）$/, "");
  separatorSamples.add(between.replace(/《[^》]+》/g, "《X》"));
}

console.log("events", eventPool.length, "withSource", withSource, "without", without.length, without);
console.log("bookCounts", [...bookCounts.entries()]);
console.log("distinct wrappers", wrappers.size);
for (const [k, v] of [...wrappers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(v, JSON.stringify(k));
}
// 全部 185 个 label 里含 · 的比例
const labels = new Set();
for (const event of eventPool) {
  const matches = event.description.match(parenPattern) ?? [];
  if (!matches.length) continue;
  for (const m of matches[matches.length - 1].matchAll(/《([^》]+)》/g)) labels.add(m[1]);
}
console.log("labels", labels.size, "with dot", [...labels].filter((l) => l.includes("·")).length);
console.log([...labels].filter((l) => !l.includes("·")).slice(0, 20));
// 多本书的分隔符样例
const multi = [];
for (const event of eventPool) {
  const matches = event.description.match(parenPattern) ?? [];
  if (!matches.length) continue;
  const last = matches[matches.length - 1];
  if ([...last.matchAll(/《[^》]+》/g)].length > 1) multi.push(last);
}
console.log("multi samples", multi.slice(0, 8));
// 是否有 「据」出现在非末尾括注
let nonTail = 0;
for (const event of eventPool) {
  const matches = [...event.description.matchAll(parenPattern)];
  if (!matches.length) continue;
  const last = matches[matches.length - 1];
  const tail = event.description.slice(last.index + last[0].length);
  if (tail.trim().length > 0) {
    nonTail += 1;
    if (nonTail <= 10) console.log("nonTail", event.id, JSON.stringify(last[0]), JSON.stringify(tail));
  }
}
console.log("nonTail count", nonTail);
