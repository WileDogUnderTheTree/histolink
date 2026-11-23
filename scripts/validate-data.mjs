#!/usr/bin/env node
/**
 * 《史脉》全量数据校验（V1.0.1：事件 / 图谱 / 关系 / 人物主数据 / 别名 / 锁文件 / docs）。
 *
 * 直接加载 frontend/data 下的 TypeScript 数据模块（用 TypeScript 编译器转译后执行），
 * 检查事件、图谱分期、人物关系三层数据的完整性与引用一致性，并输出全量统计。
 *
 * 运行：node scripts/validate-data.mjs
 * 失败时以非 0 退出码结束，便于 CI / 验收脚本串联。
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT, loadTsData, loadDataModule } from "./lib/load-ts-data.mjs";

const {
  TIMELINE_EVENTS,
  DYNASTY_START_YEARS,
  DYNASTY_GROUPS,
  importanceOf,
  EVENT_PARTICIPANTS: participantIndex,
  PERSON_RELATIONS,
  pairKey,
  WEIJIN_EVENTS,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  ERA_TO_SCOPE,
  SCOPE_TO_ERA,
  KEY_FIGURES,
  PERSON_NAME_ALIASES,
  eventPool,
  eventIndex,
} = loadTsData();

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
// ========== 1. 事件数据 ==========
const seenIds = new Set();
for (const event of eventPool) {
  const label = `事件 ${event.id}`;
  if (seenIds.has(event.id)) fail(`${label}：id 重复`);
  seenIds.add(event.id);
  if (!event.title?.trim()) fail(`${label}：缺少标题`);
  if (!event.description?.trim()) fail(`${label}：缺少简述`);
  if (!Number.isInteger(event.year) || event.year === 0) fail(`${label}：年份非法（${event.year}）`);
  if (!(event.dynasty in DYNASTY_START_YEARS)) fail(`${label}：朝代非法（${event.dynasty}）`);
  if (event.importance !== undefined && ![1, 2, 3].includes(event.importance)) {
    fail(`${label}：importance 非法（${event.importance}）`);
  }
  const participants = event.participants ?? [];
  if (!Array.isArray(participants)) fail(`${label}：participants 不是数组`);
  if (participants.some((p) => !p || p !== p.trim())) fail(`${label}：participants 含空名或首尾空白`);
  if (new Set(participants).size !== participants.length) fail(`${label}：participants 有重复人物`);
  if (!event.description.includes("据《")) warn(`${label}：简述缺少「据《…》」出处括注`);
}

const describedDynasties = new Set(TIMELINE_EVENTS.map((event) => event.dynasty));
for (const dynasty of Object.keys(DYNASTY_START_YEARS)) {
  if (!describedDynasties.has(dynasty)) fail(`朝代「${dynasty}」没有任何时间轴事件`);
}
for (const dynasty of describedDynasties) {
  if (!(dynasty in DYNASTY_START_YEARS)) fail(`时间轴出现未登记起始年的朝代「${dynasty}」`);
}

// 参与者索引与事件双查：有参与者的事件必须在索引里登记，反之亦然。
for (const event of TIMELINE_EVENTS) {
  const indexed = participantIndex[event.id];
  if (event.participants.length > 0 && !indexed) fail(`事件 ${event.id} 有参与者但未登记到 EVENT_PARTICIPANTS`);
  if (indexed && event.participants.length === 0) fail(`事件 ${event.id} 登记了参与者但事件为空`);
  if (indexed && indexed.join("|") !== event.participants.join("|")) {
    fail(`事件 ${event.id} 的参与者与索引不一致`);
  }
}
for (const eventId of Object.keys(participantIndex)) {
  if (!eventIndex.has(eventId)) fail(`EVENT_PARTICIPANTS 含不存在的事件 id：${eventId}`);
}

// 每朝事件数。
const perDynasty = new Map();
for (const event of TIMELINE_EVENTS) {
  perDynasty.set(event.dynasty, (perDynasty.get(event.dynasty) ?? 0) + 1);
}

// ========== 2. 图谱分期 / 断代 ==========
const allGraphs = [...PERSON_GRAPH_ERAS, ...PERSON_GRAPH_SCOPES];
const globalNodeNames = new Set();
const edgeKeySet = new Set();

for (const era of allGraphs) {
  const label = `图谱「${era.label}」(${era.id})`;
  const { nodes, edges } = era.graph;
  if (nodes.length === 0) fail(`${label}：没有任何人物节点`);
  if (edges.length === 0) fail(`${label}：没有任何关系边`);
  if (!nodes.some((node) => node.name === era.defaultCenterPersonId)) {
    fail(`${label}：默认中心人物「${era.defaultCenterPersonId}」不在图中`);
  }

  const nodeNames = new Set();
  for (const node of nodes) {
    if (nodeNames.has(node.name)) fail(`${label}：人物节点重复（${node.name}）`);
    nodeNames.add(node.name);
    globalNodeNames.add(node.name);
    if (node.relatedEvents.length === 0) fail(`${label}：人物「${node.name}」没有任何关联事件`);
    if (node.relatedPeople.length === 0) fail(`${label}：孤儿节点「${node.name}」没有任何连线`);
    for (const person of node.relatedPeople) {
      if (!nodeNames.has(person)) {
        // 先收集，稍后统一检查（节点可能在后面才出现）。
      }
    }
    for (const reference of node.relatedEvents) {
      const event = eventIndex.get(reference.id);
      if (!event) fail(`${label}：人物「${node.name}」关联了不存在的事件 ${reference.id}`);
      else if (!event.participants.includes(node.name)) {
        fail(`${label}：人物「${node.name}」与事件 ${reference.id} 的参与者不一致`);
      }
    }
  }

  const edgeIds = new Set();
  const adjacency = new Map([...nodeNames].map((name) => [name, new Set()]));
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) fail(`${label}：关系边 id 重复（${edge.id}）`);
    edgeIds.add(edge.id);
    edgeKeySet.add(edge.id);
    if (edge.source === edge.target) fail(`${label}：自环边 ${edge.id}`);
    if (!nodeNames.has(edge.source) || !nodeNames.has(edge.target)) {
      fail(`${label}：悬空边 ${edge.id}（${edge.source} × ${edge.target}）`);
      continue;
    }
    if (edge.weight !== edge.sharedEvents.length) {
      fail(`${label}：边 ${edge.id} 的 weight 与共同事件数不一致`);
    }
    if (edge.sharedEvents.length === 0) fail(`${label}：边 ${edge.id} 没有共同事件`);
    for (const reference of edge.sharedEvents) {
      const event = eventIndex.get(reference.id);
      if (!event) fail(`${label}：边 ${edge.id} 引用了不存在的事件 ${reference.id}`);
      else if (!event.participants.includes(edge.source) || !event.participants.includes(edge.target)) {
        fail(`${label}：边 ${edge.id} 的事件 ${reference.id} 并非两人共同参与`);
      }
    }
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  // 双向一致性：节点的 relatedPeople 与边集合完全对应。
  for (const node of nodes) {
    const fromEdges = adjacency.get(node.name) ?? new Set();
    if (fromEdges.size !== node.relatedPeople.length) {
      fail(`${label}：人物「${node.name}」的 relatedPeople 与边不一致`);
      continue;
    }
    for (const person of node.relatedPeople) {
      if (!fromEdges.has(person)) fail(`${label}：人物「${node.name}」的 relatedPeople 含非邻接人物「${person}」`);
    }
  }
}

// 分期映射完整性。
const eraIds = new Set(PERSON_GRAPH_ERAS.map((era) => era.id));
const scopeIds = new Set(PERSON_GRAPH_SCOPES.map((scope) => scope.id));
for (const era of PERSON_GRAPH_ERAS) {
  const scopeId = ERA_TO_SCOPE[era.id];
  if (!scopeId || !scopeIds.has(scopeId)) fail(`ERA_TO_SCOPE 缺少或指向未知断代：${era.id} → ${scopeId}`);
}
for (const scopeId of Object.keys(ERA_TO_SCOPE)) {
  if (!eraIds.has(scopeId)) fail(`ERA_TO_SCOPE 含未知分期 id：${scopeId}`);
}
for (const scope of PERSON_GRAPH_SCOPES) {
  const eraId = SCOPE_TO_ERA[scope.id];
  if (!eraId || !eraIds.has(eraId)) fail(`SCOPE_TO_ERA 缺少或指向未知分期：${scope.id} → ${eraId}`);
}
for (const scopeId of Object.keys(SCOPE_TO_ERA)) {
  if (!scopeIds.has(scopeId)) fail(`SCOPE_TO_ERA 含未知断代 id：${scopeId}`);
}
// 分组与图谱断代对齐。
const groupIds = new Set(DYNASTY_GROUPS.map((group) => group.id));
const expectedScopeByGroup = new Map([
  ["xianqin", "xianqin"],
  ["qinhan", "qinhan"],
  ["sanguo", "sanguo"],
  ["weijin", "weijin"],
  ["suitang", "suitang"],
  ["wudaisong", "songliaojinxia"],
  ["yuanmingqing", "yuanmingqing"],
]);
for (const [groupId, scopeId] of expectedScopeByGroup) {
  if (!groupIds.has(groupId)) fail(`DYNASTY_GROUPS 缺少分组 ${groupId}`);
  if (!scopeIds.has(scopeId)) fail(`PERSON_GRAPH_SCOPES 缺少断代 ${scopeId}`);
}
for (const group of DYNASTY_GROUPS) {
  if (!expectedScopeByGroup.has(group.id)) fail(`新增断代「${group.label}」未配置对应的图谱断代`);
}

// ========== 3. 人物关系库 ==========
const relationKeys = new Set();
const labelWarnings = [];
for (const record of PERSON_RELATIONS) {
  const key = pairKey(record.a, record.b);
  const label = `关系「${record.a} × ${record.b}」`;
  if (record.a === record.b) fail(`${label}：两端相同`);
  if (relationKeys.has(key)) fail(`${label}：pairKey 重复`);
  relationKeys.add(key);
  if (!record.label?.trim()) fail(`${label}：缺少关系定性`);
  if (record.label.length > 8) labelWarnings.push(`${label}：定性过长（${record.label.length} 字）`);
  const summaries = Object.keys(record.eventSummaries ?? {});
  if (summaries.length === 0) fail(`${label}：没有任何事件简述`);
  // 两人共同参与的事件（全量池）。
  const shared = new Set();
  for (const event of eventPool) {
    if (event.participants.includes(record.a) && event.participants.includes(record.b)) shared.add(event.id);
  }
  for (const eventId of summaries) {
    if (!shared.has(eventId)) fail(`${label}：事件简述键 ${eventId} 不是两人的共同事件`);
  }
  if (!edgeKeySet.has(key)) fail(`${label}：未在任何图谱中成为关系边`);
}
if (labelWarnings.length > 0) warn(`有 ${labelWarnings.length} 条关系定性超过 8 字（历史数据，保留）：\n    ` + labelWarnings.slice(0, 5).join("\n    "));

// ========== 4. 名人堂与别名 ==========
const graphByLabel = new Map(allGraphs.map((graph) => [graph.label, graph.graph]));
for (const [label, names] of Object.entries(KEY_FIGURES)) {
  const graph = graphByLabel.get(label);
  if (!graph) {
    fail(`KEY_FIGURES 的分期标签「${label}」找不到对应图谱`);
    continue;
  }
  const namesInGraph = new Set(graph.nodes.map((node) => node.name));
  for (const name of names) {
    if (!namesInGraph.has(name)) fail(`名人堂「${label}」的人物「${name}」不在该期图谱中`);
  }
}
for (const [alias, target] of Object.entries(PERSON_NAME_ALIASES)) {
  if (!globalNodeNames.has(target)) fail(`别名「${alias}」指向的节点「${target}」不存在`);
}

// ========== 5. docs 数据文件 ==========
const DOC_FILES = ["01_先秦.md", "02_秦汉.md", "03_魏晋南北朝.md", "04_隋唐.md", "05_宋辽夏金.md", "06_元明清.md"];
let docRows = 0;
for (const name of DOC_FILES) {
  const file = path.join(ROOT, "docs", name);
  if (!fs.existsSync(file)) {
    fail(`docs 数据文件缺失：${name}`);
    continue;
  }
  const rows = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\|\s*[-:]/.test(line) && !line.includes("所属朝代"));
  docRows += rows.length;
  if (rows.length < 20) fail(`docs 数据文件 ${name} 行数异常（${rows.length}）`);
}

// ========== 2.1 分期隔离（V0.8.2.1 串期回归） ==========
// 每个细览分期的节点必须至少有一条事件锚定在该期「声明朝代」内；
// 并立政权的互见事件（如金期含南宋）要求 era.dynasties 同步登记，否则视为串期。
const erasById = new Map(PERSON_GRAPH_ERAS.map((era) => [era.id, era]));
for (const era of PERSON_GRAPH_ERAS) {
  const allowed = new Set(era.dynasties);
  for (const node of era.graph.nodes) {
    const anchored = node.relatedEvents.some((event) => allowed.has(event.dynasty));
    if (!anchored) {
      fail(
        `分期隔离：图谱「${era.label}」的人物「${node.name}」没有任何事件属于 ${era.dynasties.join(" / ")}`,
      );
    }
  }
}

// 秦汉 / 三国按年份切分：汉末群雄（188+）不得进入秦汉图，184 年前的东汉人物不得进入三国图。
const QIN_HAN_END_YEAR = 184;
const SANGUO_PRELUDE_START_YEAR = 188;
const qinhanEra = erasById.get("qinhan");
const sanguoEra = erasById.get("sanguo");
if (!qinhanEra || !sanguoEra) {
  fail("缺少秦汉或三国分期配置");
} else {
  for (const node of qinhanEra.graph.nodes) {
    if (!node.relatedEvents.some((event) => event.year <= QIN_HAN_END_YEAR)) {
      fail(
        `秦汉图谱串期：人物「${node.name}」只在 ${node.relatedEvents.map((event) => event.year).join("/")} 年事件中出现，已晚于 ${QIN_HAN_END_YEAR} 年`,
      );
    }
  }
  for (const name of ["曹操", "刘备", "孙权", "孙策", "吕布", "董卓", "袁绍", "诸葛亮", "关羽", "司马懿"]) {
    if (qinhanEra.graph.nodes.some((node) => node.name === name)) {
      fail(`秦汉图谱串期：三国人物「${name}」不应出现在秦汉图`);
    }
  }
  for (const node of sanguoEra.graph.nodes) {
    const anchored = node.relatedEvents.some(
      (event) => event.dynasty === "三国" || event.year >= SANGUO_PRELUDE_START_YEAR,
    );
    if (!anchored) {
      fail(`三国图谱串期：人物「${node.name}」没有任何三国或 ${SANGUO_PRELUDE_START_YEAR} 年后的事件`);
    }
  }
  for (const name of ["刘邦", "汉武帝", "秦始皇", "韩信", "卫青", "霍去病", "张良"]) {
    if (sanguoEra.graph.nodes.some((node) => node.name === name)) {
      fail(`三国图谱串期：秦汉人物「${name}」不应出现在三国图`);
    }
  }
  for (const name of ["曹操", "刘备", "孙权"]) {
    if (!sanguoEra.graph.nodes.some((node) => node.name === name)) {
      fail(`三国图谱缺少核心人物「${name}」`);
    }
  }
  if (!qinhanEra.graph.nodes.some((node) => node.name === "刘邦")) {
    fail("秦汉图谱缺少默认中心人物「刘邦」");
  }
}

// 默认中心必须与名人堂同一逻辑池：中心人物须出现在该期 KEY_FIGURES 配置中。
for (const graph of allGraphs) {
  const configured = KEY_FIGURES[graph.label];
  if (!configured) continue;
  if (!configured.includes(graph.defaultCenterPersonId)) {
    fail(
      `中心与名人堂不同步：图谱「${graph.label}」默认中心「${graph.defaultCenterPersonId}」不在 KEY_FIGURES 中`,
    );
  }
}

// ========== 7. 人物主数据（V1.0.1 / TC-02） ==========
const { PERSONS, PERSON_BY_ID } = loadDataModule("persons");
const { PERSON_ALIAS_TO_ID } = loadDataModule("person-aliases");
const { PERSON_SPLIT_RULES, PERSON_ALIAS_OVERRIDES } = loadDataModule("person-overrides");

const PERSON_ID_PATTERN = /^p-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$/;
const uniqueParticipantNames = new Set();
for (const event of eventPool) {
  for (const name of event.participants ?? []) uniqueParticipantNames.add(name);
}

const personsByName = new Map();
for (const person of PERSONS) {
  const bucket = personsByName.get(person.displayName) ?? [];
  bucket.push(person);
  personsByName.set(person.displayName, bucket);
}
const personsById = new Map();
const personAliasTargets = new Map();
for (const [alias, personId] of Object.entries(PERSON_ALIAS_TO_ID)) {
  personAliasTargets.set(alias, personId);
}
const eraById = new Map(PERSON_GRAPH_ERAS.map((era) => [era.id, era]));
const scopeById = new Map(PERSON_GRAPH_SCOPES.map((scope) => [scope.id, scope]));

for (const person of PERSONS) {
  const label = `人物「${person.displayName}」(${person.id})`;
  if (!PERSON_ID_PATTERN.test(person.id)) fail(`${label}：person_id 不符合正则 ${PERSON_ID_PATTERN}`);
  if (personsById.has(person.id)) fail(`${label}：person_id 重复`);
  personsById.set(person.id, person);
  if (PERSON_BY_ID.get(person.id) !== person) fail(`${label}：persons.ts 的 PERSON_BY_ID 索引不一致`);
  if (!(person.primaryDynasty in DYNASTY_START_YEARS)) fail(`${label}：primaryDynasty 非法（${person.primaryDynasty}）`);
  if (!person.dynasties.includes(person.primaryDynasty)) fail(`${label}：primaryDynasty 不在 dynasties 中`);
  for (const dynasty of person.dynasties) {
    if (!(dynasty in DYNASTY_START_YEARS)) fail(`${label}：dynasties 含非法朝代（${dynasty}）`);
  }
  if (!Number.isInteger(person.firstYear) || person.firstYear === 0) fail(`${label}：firstYear 非法（${person.firstYear}）`);
  if (!Number.isInteger(person.lastYear) || person.lastYear === 0) fail(`${label}：lastYear 非法（${person.lastYear}）`);
  if (person.firstYear > person.lastYear) fail(`${label}：firstYear(${person.firstYear}) > lastYear(${person.lastYear})`);
  if (person.eventIds.length === 0) fail(`${label}：没有任何关联事件`);
  if (new Set(person.eventIds).size !== person.eventIds.length) fail(`${label}：eventIds 有重复`);
  const allowedNames = new Set([person.displayName, ...person.aliases]);
  for (const eventId of person.eventIds) {
    const event = eventIndex.get(eventId);
    if (!event) {
      fail(`${label}：关联了不存在的事件 ${eventId}`);
      continue;
    }
    if (![...allowedNames].some((name) => event.participants.includes(name))) {
      fail(`${label}：事件 ${eventId} 并未把该人物（或其别名）列为参与者`);
    }
    if (event.year < person.firstYear || event.year > person.lastYear) {
      fail(`${label}：事件 ${eventId} 的年份 ${event.year} 超出 [${person.firstYear}, ${person.lastYear}]`);
    }
  }
  for (const eraId of person.eraIds) {
    const era = eraById.get(eraId);
    if (!era) {
      fail(`${label}：eraIds 含未知分期 ${eraId}`);
      continue;
    }
    const node = era.graph.nodes.find((item) => allowedNames.has(item.name));
    if (!node) fail(`${label}：声明属于分期 ${eraId}，但该期图中没有对应节点`);
    else if (!node.relatedEvents.some((reference) => person.eventIds.includes(reference.id))) {
      fail(`${label}：声明属于分期 ${eraId}，但该期节点与关联事件不相交`);
    }
  }
  for (const scopeId of person.scopeIds) {
    const scope = scopeById.get(scopeId);
    if (!scope) {
      fail(`${label}：scopeIds 含未知断代 ${scopeId}`);
      continue;
    }
    const node = scope.graph.nodes.find((item) => allowedNames.has(item.name));
    if (!node) fail(`${label}：声明属于断代 ${scopeId}，但该组图中没有对应节点`);
    else if (!node.relatedEvents.some((reference) => person.eventIds.includes(reference.id))) {
      fail(`${label}：声明属于断代 ${scopeId}，但该组节点与关联事件不相交`);
    }
  }
  for (const alias of person.aliases) {
    if (PERSON_NAME_ALIASES[alias] !== person.displayName) {
      fail(`${label}：aliases 含未指向本名的别名「${alias}」`);
    }
  }
}

if (PERSONS.length !== personsById.size) fail(`人物记录数不一致：${PERSONS.length} vs ${personsById.size}`);

// 每个事件参与者姓名必须能解析到 1 个 person_id（本名或别名）。
for (const name of uniqueParticipantNames) {
  const byName = personsByName.get(name) ?? [];
  const aliasTarget = personAliasTargets.get(name);
  const resolved = new Set(byName.map((person) => person.id));
  if (aliasTarget) resolved.add(aliasTarget);
  if (resolved.size === 0) fail(`事件参与者「${name}」没有映射到任何 person_id`);
  if (resolved.size > 1 && !PERSON_SPLIT_RULES.some((rule) => rule.displayName === name)) {
    fail(`事件参与者「${name}」映射到多个 person_id，但没有拆分裁决`);
  }
}

// 同名组：必须有拆分裁决、事件互斥且并集完整。
const sameNameGroups = [...personsByName.entries()].filter(([, bucket]) => bucket.length > 1);
for (const [displayName, bucket] of sameNameGroups) {
  const rule = PERSON_SPLIT_RULES.find((item) => item.displayName === displayName);
  if (!rule) {
    fail(`同名组「${displayName}」有 ${bucket.length} 条记录，但 person-overrides 缺少裁决`);
    continue;
  }
  if (rule.candidates.length !== bucket.length) {
    fail(`同名组「${displayName}」记录数 ${bucket.length} 与裁决候选数 ${rule.candidates.length} 不一致`);
  }
  const seen = new Set();
  for (const person of bucket) {
    if (!person.disambiguator.role) fail(`同名组「${displayName}」的 ${person.id} 缺少身份副标题 role`);
    for (const eventId of person.eventIds) {
      if (seen.has(eventId)) fail(`同名组「${displayName}」的事件 ${eventId} 被多条记录重复占用`);
      seen.add(eventId);
    }
  }
  const allEvents = new Set();
  for (const event of eventPool) {
    if (event.participants.includes(displayName)) allEvents.add(event.id);
  }
  for (const eventId of allEvents) {
    if (!seen.has(eventId)) fail(`同名组「${displayName}」的事件 ${eventId} 未被任何候选覆盖`);
  }
}
for (const rule of PERSON_SPLIT_RULES) {
  if (!personsByName.has(rule.displayName)) fail(`person-overrides：拆分规则「${rule.displayName}」没有生成对应人物记录`);
}
for (const alias of Object.keys(PERSON_ALIAS_OVERRIDES)) {
  if (!(alias in PERSON_NAME_ALIASES)) fail(`person-overrides：PERSON_ALIAS_OVERRIDES 含未登记别名「${alias}」`);
}

// 别名表：目标存在、不跨人、且与人物记录不冲突。
for (const [alias, personId] of Object.entries(PERSON_ALIAS_TO_ID)) {
  const target = personsById.get(personId);
  if (!target) {
    fail(`别名「${alias}」指向不存在的 person_id：${personId}`);
    continue;
  }
  if (!(alias in PERSON_NAME_ALIASES)) fail(`person-aliases：别名「${alias}」未在 PERSON_NAME_ALIASES 登记`);
  if (!target.aliases.includes(alias)) fail(`别名「${alias}」没有写进 ${personId} 的 aliases[]`);
  const byName = personsByName.get(alias) ?? [];
  if (byName.some((person) => person.id !== personId)) {
    fail(`别名「${alias}」与真实人物记录冲突（${byName.map((person) => person.id).join("、")}）`);
  }
}
for (const [alias, target] of Object.entries(PERSON_NAME_ALIASES)) {
  if (!(alias in PERSON_ALIAS_TO_ID)) fail(`PERSON_NAME_ALIASES 的别名「${alias}」→「${target}」未生成 person_aliases 映射`);
}

// ID 锁文件必须与当前记录一致（防止 ID 漂移）。
const LOCK_PATH = path.join(DATA_DIR, "locks", "person-ids.lock.json");
if (!fs.existsSync(LOCK_PATH)) {
  fail("缺少人物 ID 锁文件 frontend/data/locks/person-ids.lock.json");
} else {
  let lock = null;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  } catch (error) {
    fail(`人物 ID 锁文件不是合法 JSON：${error.message}`);
  }
  if (lock) {
    if (lock.schema_version !== "person-ids.v1") fail(`人物 ID 锁文件 schema_version 非法：${lock.schema_version}`);
    if (lock.person_count !== PERSONS.length) fail(`锁文件 person_count=${lock.person_count}，实际 ${PERSONS.length}`);
    const lockById = new Map((lock.persons ?? []).map((entry) => [entry.id, entry]));
    if (lockById.size !== PERSONS.length) fail("锁文件条目数与人物记录数不一致");
    for (const person of PERSONS) {
      const entry = lockById.get(person.id);
      if (!entry) {
        fail(`锁文件缺少人物 ${person.id}（ID 可能已漂移）`);
        continue;
      }
      if (entry.displayName !== person.displayName) fail(`锁文件 ${person.id} 的 displayName 不一致`);
      if (entry.firstYear !== person.firstYear) fail(`锁文件 ${person.id} 的 firstYear 不一致`);
      if (!/^[0-9a-f]{8}$/.test(entry.identityHash ?? "")) fail(`锁文件 ${person.id} 的 identityHash 非法`);
      lockById.delete(person.id);
    }
    for (const leftover of lockById.keys()) fail(`锁文件含已不存在的 person_id：${leftover}`);
  }
}

const personsWithoutEra = PERSONS.filter((person) => person.eraIds.length === 0).length;
const mergedAliasNameCount = Object.keys(PERSON_NAME_ALIASES).filter((alias) => uniqueParticipantNames.has(alias)).length;
const expectedPersonCount =
  uniqueParticipantNames.size - mergedAliasNameCount + PERSON_SPLIT_RULES.reduce((sum, rule) => sum + rule.candidates.length - 1, 0);
if (PERSONS.length !== expectedPersonCount) {
  fail(`人物记录数 ${PERSONS.length} 与推导值 ${expectedPersonCount}（姓名 ${uniqueParticipantNames.size} − 异名合并 ${mergedAliasNameCount} + 同名拆分）不一致`);
}
const aliasCount = Object.keys(PERSON_ALIAS_TO_ID).length;
if (aliasCount !== Object.keys(PERSON_NAME_ALIASES).length) fail(`别名映射数 ${aliasCount} 与 PERSON_NAME_ALIASES 条数不一致`);
// ========== 6. 统计输出 ==========
const importance3 = TIMELINE_EVENTS.filter((event) => importanceOf(event) === 3).length;
const describedEvents = TIMELINE_EVENTS.filter((event) => event.participants.length > 0).length;
const totalGraphEdges = allGraphs.reduce((sum, graph) => sum + graph.graph.edges.length, 0);
const totalGraphNodes = allGraphs.reduce((sum, graph) => sum + graph.graph.nodes.length, 0);
const uniqueEdgePairs = new Set(allGraphs.flatMap((graph) => graph.graph.edges.map((edge) => edge.id))).size;
const relationCoveredEdges = allGraphs.reduce(
  (sum, graph) => sum + graph.graph.edges.filter((edge) => edge.relation).length,
  0,
);

console.log("=".repeat(72));
console.log("《史脉》V1.0.1 全量数据校验");
console.log("=".repeat(72));
console.log(`时间轴事件：${TIMELINE_EVENTS.length} 条（其中 ${describedEvents} 条有明确参与人物）`);
console.log(`图谱补足事件（只进人物图）：${WEIJIN_EVENTS.length} 条`);
console.log(`重要度 = 3 的断代大势：${importance3} 条`);
console.log(`朝代覆盖：${Object.keys(DYNASTY_START_YEARS).length} 个朝代 / ${DYNASTY_GROUPS.length} 个大断代`);
console.log(`图谱：细览 ${PERSON_GRAPH_ERAS.length} 期 + 简阅 ${PERSON_GRAPH_SCOPES.length} 组，共 ${allGraphs.length} 张图`);
console.log(`图谱合计：${totalGraphNodes} 个节点位（含跨期重复）、${totalGraphEdges} 条边、去重人物对 ${uniqueEdgePairs} 对`);
console.log(`人物关系库：${PERSON_RELATIONS.length} 对，覆盖图谱边 ${relationCoveredEdges} 条`);
console.log(`docs 数据文件：${DOC_FILES.length} 份，共 ${docRows} 行核心事件（已去重合并）`);
console.log(`人物主数据：${PERSONS.length} 条（${uniqueParticipantNames.size} 个姓名；同名组 ${sameNameGroups.length}；无细览分期 ${personsWithoutEra} 条；别名 ${aliasCount} 条）`);
console.log("-".repeat(72));
console.log("分朝事件数：");
console.log(
  Object.entries(DYNASTY_START_YEARS)
    .map(([dynasty]) => `${dynasty} ${perDynasty.get(dynasty) ?? 0}`)
    .join(" · "),
);
console.log("-".repeat(72));
console.log("分图表（节点/边/关系覆盖）：");
for (const graph of allGraphs) {
  const covered = graph.graph.edges.filter((edge) => edge.relation).length;
  console.log(
    `  ${graph.id.padEnd(14)} ${String(graph.graph.nodes.length).padStart(4)} 节点  ` +
      `${String(graph.graph.edges.length).padStart(4)} 边  关系覆盖 ${covered}/${graph.graph.edges.length}`,
  );
}
console.log("=".repeat(72));

if (warnings.length > 0) {
  console.log(`\n⚠ 警告 ${warnings.length} 条：`);
  for (const message of warnings) console.log(`  - ${message}`);
}
if (errors.length > 0) {
  console.error(`\n✖ 校验失败，共 ${errors.length} 项：`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log("\n✓ ALL CHECKS PASSED：事件、图谱分期隔离、关系、别名、名人堂、docs 数据与人物主数据全部通过。");
