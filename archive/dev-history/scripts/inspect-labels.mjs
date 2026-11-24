import { loadTsData } from "../scripts/lib/load-ts-data.mjs";

const { eventPool } = loadTsData();
const parenPattern = /（[^（）]*据[^（）]*）/g;
const labels = new Set();
const events = [];
for (const event of eventPool) {
  const matches = event.description.match(parenPattern) ?? [];
  if (!matches.length) continue;
  const last = matches[matches.length - 1];
  const found = [...last.matchAll(/《([^》]+)》/g)].map((m) => m[1]);
  for (const label of found) labels.add(label);
  if (found.length !== 1 || last.includes("裴注") || last.includes("年代依")) {
    events.push({ id: event.id, found, raw: last });
  }
}
const sorted = [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
console.log("labels", sorted.length);
for (const label of sorted) console.log(JSON.stringify(label));
console.log("--- unusual events ---");
for (const entry of events) console.log(entry.id, JSON.stringify(entry.found), JSON.stringify(entry.raw));
// 书名（按首个 · 切分）去重
const books = new Set([...labels].map((label) => label.split("·")[0]));
console.log("distinct books", books.size);
const odd = [...labels].filter((label) => /[，、；（）\s]/.test(label));
console.log("odd labels", odd);
