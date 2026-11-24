import { loadTsData } from "../scripts/lib/load-ts-data.mjs";

const data = loadTsData();
const { eventPool, PERSON_NAME_ALIASES, PERSON_GRAPH_ERAS } = data;

const byName = new Map();
for (const event of eventPool) {
  for (const name of event.participants ?? []) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ id: event.id, dynasty: event.dynasty, year: event.year });
  }
}
console.log("eventPool", eventPool.length);
console.log("unique names", byName.size);
console.log("aliases", Object.keys(PERSON_NAME_ALIASES).length);
for (const name of ["梁太后", "刘崇", "朱熹", "李密"]) {
  console.log(name, JSON.stringify(byName.get(name)));
}
// 同名组（出现 >1 次的姓名按年份是否跨期粗看）
const dup = [...byName.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
console.log("names with >1 event", dup.length);
// 名称到 era 的覆盖
const eraNames = new Map(PERSON_GRAPH_ERAS.map((era) => [era.id, new Set(era.graph.nodes.map((n) => n.name))]));
const missing = [...byName.keys()].filter((name) => ![...eraNames.values()].some((set) => set.has(name)));
console.log("names not in any era graph", missing.length, missing.slice(0, 10));
// 无参与者的事件
console.log("events without participants", eventPool.filter((e) => (e.participants ?? []).length === 0).map((e) => e.id));
// 角色：事件 dynasty 分布样例
console.log("sample 梁太后 eras", PERSON_GRAPH_ERAS.filter((era) => era.graph.nodes.some((n) => n.name === "梁太后")).map((era) => era.id));
console.log("sample 刘崇 eras", PERSON_GRAPH_ERAS.filter((era) => era.graph.nodes.some((n) => n.name === "刘崇")).map((era) => era.id));
