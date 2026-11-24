import { loadTsData } from "../scripts/lib/load-ts-data.mjs";
const { eventPool, TIMELINE_EVENTS, WEIJIN_EVENTS } = loadTsData();
const parenPattern = /（[^（）]*据[^（）]*）/g;

function stats(events, parser) {
  let withSource = 0;
  let entries = 0;
  const labels = new Set();
  for (const event of events) {
    const found = parser(event.description);
    if (!found.length) continue;
    withSource += 1;
    entries += found.length;
    for (const label of found) labels.add(label);
  }
  return { total: events.length, withSource, entries, labels: labels.size };
}

const simple = (text) => {
  const matches = text.match(parenPattern) ?? [];
  if (!matches.length) return [];
  return [...matches[matches.length - 1].matchAll(/《([^》]+)》/g)].map((m) => m[1]);
};
// 裴注引 视为 1 条（只取第一个书名）
const firstOnly = (text) => {
  const matches = text.match(parenPattern) ?? [];
  if (!matches.length) return [];
  const books = [...matches[matches.length - 1].matchAll(/《([^》]+)》/g)].map((m) => m[1]);
  return books.length ? [books[0]] : [];
};

console.log("all simple", stats(eventPool, simple));
console.log("all firstOnly", stats(eventPool, firstOnly));
console.log("timeline simple", stats(TIMELINE_EVENTS, simple));
console.log("weijin simple", stats(WEIJIN_EVENTS, simple));
