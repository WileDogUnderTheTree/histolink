// 用 TypeScript 编译器把前端数据模块转成 CommonJS 后加载，导出为 JSON 供分析/校验使用。
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TS_PATH = path.join(ROOT, "frontend", "node_modules", "typescript");
const ts = require(TS_PATH);

const cache = new Map();

function loadModule(filePath) {
  const absolute = path.resolve(filePath);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const source = fs.readFileSync(absolute, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: absolute,
  }).outputText;

  const module = { exports: {} };
  cache.set(absolute, module);
  const dir = path.dirname(absolute);
  const requireShim = (specifier) => {
    let target = path.resolve(dir, specifier);
    if (!target.endsWith(".ts")) target += ".ts";
    return loadModule(target);
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "require", "module", "__dirname", "__filename", output)(
    module.exports,
    requireShim,
    module,
    dir,
    absolute,
  );
  return module.exports;
}

const dataDir = path.join(ROOT, "frontend", "data");
const timeline = loadModule(path.join(dataDir, "timeline-events.ts"));
const participants = loadModule(path.join(dataDir, "timeline-participants.ts"));
const relations = loadModule(path.join(dataDir, "person-relations.ts"));
const weijin = loadModule(path.join(dataDir, "weijin-events.ts"));
const graph = loadModule(path.join(dataDir, "person-graph.ts"));

const payload = {
  events: timeline.TIMELINE_EVENTS,
  participantIndex: participants.EVENT_PARTICIPANTS,
  relations: relations.PERSON_RELATIONS,
  weijinEvents: weijin.WEIJIN_EVENTS,
  dynastyStartYears: timeline.DYNASTY_START_YEARS,
  dynastyGroups: timeline.DYNASTY_GROUPS,
  eras: graph.PERSON_GRAPH_ERAS.map((era) => ({
    id: era.id,
    label: era.label,
    dynasties: era.dynasties,
    defaultCenterPersonId: era.defaultCenterPersonId,
    nodes: era.graph.nodes.map((node) => ({
      name: node.name,
      degree: node.relatedPeople.length,
      eventCount: node.relatedEvents.length,
      eventIds: node.relatedEvents.map((event) => event.id),
      eventDynasties: [...new Set(node.relatedEvents.map((event) => event.dynasty))],
      minYear: Math.min(...node.relatedEvents.map((event) => event.year)),
      maxYear: Math.max(...node.relatedEvents.map((event) => event.year)),
    })),
    edges: era.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      hasRelation: Boolean(edge.relation),
      eventIds: edge.sharedEvents.map((event) => event.id),
    })),
  })),
  scopes: graph.PERSON_GRAPH_SCOPES.map((scope) => ({
    id: scope.id,
    label: scope.label,
    defaultCenterPersonId: scope.defaultCenterPersonId,
    nodes: scope.graph.nodes.map((node) => ({
      name: node.name,
      degree: node.relatedPeople.length,
      eventCount: node.relatedEvents.length,
      eventIds: node.relatedEvents.map((event) => event.id),
      eventDynasties: [...new Set(node.relatedEvents.map((event) => event.dynasty))],
      minYear: Math.min(...node.relatedEvents.map((event) => event.year)),
      maxYear: Math.max(...node.relatedEvents.map((event) => event.year)),
    })),
    edges: scope.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      hasRelation: Boolean(edge.relation),
      eventIds: edge.sharedEvents.map((event) => event.id),
    })),
  })),
  keyFigures: graph.KEY_FIGURES,
  aliases: graph.PERSON_NAME_ALIASES,
};

fs.mkdirSync(path.join(__dirname), { recursive: true });
fs.writeFileSync(path.join(__dirname, "data.json"), JSON.stringify(payload, null, 2), "utf8");
console.log(
  `events=${payload.events.length} relations=${payload.relations.length} eras=${payload.eras.length} scopes=${payload.scopes.length}`,
);
