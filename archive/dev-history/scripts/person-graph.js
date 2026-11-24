"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEY_FIGURES = exports.DEFAULT_GRAPH_CENTER_PERSON = exports.QIN_HAN_PERSON_GRAPH = exports.PERSON_GRAPH_ERAS = void 0;
exports.buildPersonGraph = buildPersonGraph;
const timeline_events_1 = require("./timeline-events");
const QIN_HAN_DYNASTIES = ["秦", "西汉", "东汉"];
const compareEvents = (left, right) => left.year - right.year || left.id.localeCompare(right.id);
const asEventReference = (event) => ({
    id: event.id,
    title: event.title,
    dynasty: event.dynasty,
    year: event.year,
});
/**
 * 将带 participants 的时间轴事件转换为人物节点和无向关系边。
 *
 * 同一个事件的全部参与者两两成边；边的 weight 为两人共同参与的事件数。
 * 某一（朝代）分期传入的 dynasties 决定数据集边界：跨朝代的同一人物只在该期出现。
 *
 * 预处理代价为 O(Σk²)，k 为单条事件的去重后参与者数；读取任意边的共同事件为 O(1)。
 */
function buildPersonGraph(events, dynasties = QIN_HAN_DYNASTIES) {
    const permittedDynasties = new Set(dynasties);
    const personEvents = new Map();
    const pairEvents = new Map();
    for (const event of events) {
        if (!permittedDynasties.has(event.dynasty))
            continue;
        if (event.year === 0) {
            throw new Error(`事件 ${event.id} 使用了非法年份 0。`);
        }
        const participants = [...new Set(event.participants.map((name) => name.trim()).filter(Boolean))];
        const eventReference = asEventReference(event);
        for (const person of participants) {
            const relatedEvents = personEvents.get(person) ?? [];
            relatedEvents.push(eventReference);
            personEvents.set(person, relatedEvents);
        }
        for (let sourceIndex = 0; sourceIndex < participants.length; sourceIndex += 1) {
            for (let targetIndex = sourceIndex + 1; targetIndex < participants.length; targetIndex += 1) {
                const [source, target] = [participants[sourceIndex], participants[targetIndex]].sort();
                const pairId = `${source}__${target}`;
                const sharedEvents = pairEvents.get(pairId) ?? [];
                sharedEvents.push(eventReference);
                pairEvents.set(pairId, sharedEvents);
            }
        }
    }
    const relatedPeople = new Map();
    const edges = [...pairEvents.entries()]
        .map(([id, sharedEvents]) => {
        const [source, target] = id.split("__");
        const sourceRelations = relatedPeople.get(source) ?? new Set();
        const targetRelations = relatedPeople.get(target) ?? new Set();
        sourceRelations.add(target);
        targetRelations.add(source);
        relatedPeople.set(source, sourceRelations);
        relatedPeople.set(target, targetRelations);
        return {
            id,
            source,
            target,
            weight: sharedEvents.length,
            sharedEvents: sharedEvents.sort(compareEvents),
        };
    })
        .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    const nodes = [...personEvents.entries()]
        .map(([name, relatedEvents]) => {
        const sortedEvents = relatedEvents.sort(compareEvents);
        return {
            id: name,
            name,
            // 以人物最后一次出现的事件所在朝代作为当前人物图的显示归属。
            dynasty: sortedEvents.at(-1)?.dynasty ?? "秦",
            relatedPeople: [...(relatedPeople.get(name) ?? [])].sort(),
            relatedEvents: sortedEvents,
        };
    })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return { nodes, edges };
}
/** 三个分期各自只构建一次；切换 Tab 时直接复用。 */
const ERA_GRAPHS = {
    chunqiu: buildPersonGraph(timeline_events_1.TIMELINE_EVENTS, ["春秋"]),
    zhanguo: buildPersonGraph(timeline_events_1.TIMELINE_EVENTS, ["战国"]),
    qinhan: buildPersonGraph(timeline_events_1.TIMELINE_EVENTS, QIN_HAN_DYNASTIES),
};
/** 人物图分期清单：选择器按此顺序展示，并各自提供默认中心人物。 */
exports.PERSON_GRAPH_ERAS = [
    {
        id: "chunqiu",
        label: "春秋",
        dynasties: ["春秋"],
        defaultCenterPersonId: "孔子",
        graph: ERA_GRAPHS.chunqiu,
    },
    {
        id: "zhanguo",
        label: "战国",
        dynasties: ["战国"],
        defaultCenterPersonId: "商鞅",
        graph: ERA_GRAPHS.zhanguo,
    },
    {
        id: "qinhan",
        label: "秦汉",
        dynasties: QIN_HAN_DYNASTIES,
        defaultCenterPersonId: "刘邦",
        graph: ERA_GRAPHS.qinhan,
    },
];
/** V0.4.1 兼容导出：秦汉人物图，默认中心人物为刘邦。 */
exports.QIN_HAN_PERSON_GRAPH = ERA_GRAPHS.qinhan;
exports.DEFAULT_GRAPH_CENTER_PERSON = "刘邦";
/**
 * V0.5.2 左侧「名人堂」快捷导航配置。
 *
 * 按分期标签给出该期代表性人物。页面渲染前会再用当期图数据过滤一次：
 * 名字写错或人物不在该期时只会被跳过，不会导致页面报错。
 * 每期人数可自由增删（建议 6—8 位）。
 */
exports.KEY_FIGURES = {
    春秋: ["齐桓公", "晋文公", "孔子", "老子", "管仲"],
    战国: ["商鞅", "秦孝公", "孙膑", "苏秦", "白起"],
    秦汉: ["秦始皇", "刘邦", "项羽", "汉武帝", "张良"],
};
