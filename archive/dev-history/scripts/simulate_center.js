// 模拟 /graph 的切期中心保留逻辑，验证秦汉 / 三国不再串期。
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const ts = require(path.join(ROOT, "frontend", "node_modules", "typescript"));
const cache = new Map();
function load(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const out = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod);
  const dir = path.dirname(abs);
  new Function("exports", "require", "module", "__dirname", "__filename", out)(
    mod.exports,
    (s) => load(path.resolve(dir, s) + (s.endsWith(".ts") ? "" : ".ts")),
    mod,
    dir,
    abs,
  );
  return mod.exports;
}
const dataDir = path.join(ROOT, "frontend", "data");
const g = load(path.join(dataDir, "person-graph.ts"));
const eras = new Map(g.PERSON_GRAPH_ERAS.map((e) => [e.id, e]));
const qinhan = eras.get("qinhan");
const sanguo = eras.get("sanguo");
const qn = new Set(qinhan.graph.nodes.map((n) => n.name));
const sn = new Set(sanguo.graph.nodes.map((n) => n.name));
const overlap = [...qn].filter((n) => sn.has(n));
console.log("秦汉节点", qn.size, "三国节点", sn.size, "交集人物", overlap.length, overlap.slice(0, 20));

const keepCenterOr = (graph, prev, fallback) =>
  graph.nodes.some((node) => node.id === prev) ? prev : fallback;
console.log("三国中心曹操 → 秦汉：", keepCenterOr(qinhan.graph, "曹操", qinhan.defaultCenterPersonId));
console.log("秦汉中心刘邦 → 三国：", keepCenterOr(sanguo.graph, "刘邦", sanguo.defaultCenterPersonId));
console.log("秦汉默认中心在名人堂：", g.KEY_FIGURES["秦汉"].includes(qinhan.defaultCenterPersonId));
console.log("三国默认中心在名人堂：", g.KEY_FIGURES["三国"].includes(sanguo.defaultCenterPersonId));
console.log("秦汉名人堂全部在图中：", g.KEY_FIGURES["秦汉"].every((n) => qn.has(n)));
console.log("三国名人堂全部在图中：", g.KEY_FIGURES["三国"].every((n) => sn.has(n)));
