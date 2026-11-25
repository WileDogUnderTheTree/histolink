/**
 * 自动生成，禁止手改（backend/scripts/ingest_graph_data.py）。
 *
 * 来源文档：史脉_V1.0.5.4_先秦早期扩充_夏商西周.md
 * 重新生成：python backend/scripts/ingest_graph_data.py
 * 校验：python backend/scripts/ingest_graph_data.py --check
 *
 * 生成内容：新事件 / 既有事件参与者增补 / 重要度覆盖 / 人物别名 / 人物 ID 固定 /
 * 人物关系与关系补丁 / 新图谱分期 / 名人堂。数据接线见 timeline-events.ts、
 * timeline-participants.ts、person-graph.ts、person-relations.ts。
 */
import type { Dynasty } from "./timeline-events";
import type { PersonRelationRecord } from "./person-relations";

export interface IngestedEventRecord {
  id: string;
  title: string;
  dynasty: Dynasty;
  year: number;
  date?: string;
  description: string;
  importance?: 1 | 2 | 3;
  isSpecial?: boolean;
}

export interface IngestedGraphEraSpec {
  id: string;
  label: string;
  dynasties: readonly Dynasty[];
  eventIds: readonly string[];
  defaultCenterPersonId: string;
}

export interface IngestedRelationPatch {
  pairKey: string;
  eventSummaries: Readonly<Record<string, string>>;
}

export const INGESTED_DOC_FILES: readonly string[] = ["史脉_V1.0.5.4_先秦早期扩充_夏商西周.md"];

export const INGESTED_EVENT_RECORDS: readonly IngestedEventRecord[] = [
  {"id": "xia-qijianxiajuntaizhixiang-01", "title": "启建夏·钧台之享", "dynasty": "夏", "year": -2070, "description": "禹死后启继位，钧台之享大会诸侯，伯益避让，禅让制终结，世袭王权确立。（据《左传·昭公四年》；年代依夏商周断代工程推定）", "importance": 3},
  {"id": "xia-tushanzhihui-02", "title": "涂山之会", "dynasty": "夏", "year": -2070, "description": "禹涂山大会诸侯，执玉帛者万国，确立夏族共主地位，为夏朝建立奠基。（据《左传·哀公七年》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "xia-yufasanmiao-03", "title": "禹伐三苗", "dynasty": "夏", "year": -2070, "description": "禹率众征伐三苗，苗民溃散，夏族势力南扩，禹之威望益盛。（据《史记·夏本纪》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "xia-houyidaixia-04", "title": "后羿代夏", "dynasty": "夏", "year": -1985, "description": "后羿夺取夏政，自立代夏，史称\"因夏民以代夏政\"，太康流亡。（据《左传·襄公四年》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "xia-hanzhuocuanxia-05", "title": "寒浞篡夏", "dynasty": "夏", "year": -1980, "description": "后羿家臣寒浞杀羿篡位，烹而食之，代夏约四十年，夏统中绝。（据《左传·襄公四年》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "xia-xiajiebaozheng-06", "title": "夏桀暴政", "dynasty": "夏", "year": -1620, "description": "桀荒淫暴虐，筑倾宫瑶台，残害忠良，民心尽失，诸侯叛离，夏室危殆。（据《史记·夏本纪》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "shang-shangtangwangkaisanmian-01", "title": "商汤网开三面", "dynasty": "商", "year": -1610, "description": "汤出猎见人张网四面，令去其三，诸侯闻之归德，汤之仁政渐著。（据《史记·殷本纪》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "shang-tangfaweigukunwu-02", "title": "汤伐韦顾昆吾", "dynasty": "商", "year": -1605, "description": "汤依伊尹之谋，先伐韦、顾、昆吾等夏之属国，剪除夏之羽翼。（据《史记·殷本纪》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "shang-tangdaosanglin-03", "title": "汤祷桑林", "dynasty": "商", "year": -1590, "description": "汤克夏后大旱七年，以身为牲祷于桑林，雨乃降，天下归心。（据《吕氏春秋·顺民》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "shang-taijiafuwei-04", "title": "太甲复位", "dynasty": "商", "year": -1577, "description": "太甲悔过自新，伊尹迎之复位，作《太甲》训诫，太甲成商初贤君。（据《史记·殷本纪》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "shang-wudingzhengguifang-05", "title": "武丁征鬼方", "dynasty": "商", "year": -1240, "description": "武丁遣将征鬼方，三年克之，王后妇好亦统兵出征，商势达于西北。（据《竹书纪年》；年代依夏商周断代工程推定）", "importance": 2},
  {"id": "xizhou-zhouxuanwangzhongxing-01", "title": "周宣王中兴", "dynasty": "西周", "year": -827, "description": "宣王即位，任仲山甫等，征伐猃狁，复兴国势，西周暂获安宁。（据《史记·周本纪》）", "importance": 2},
  {"id": "xizhou-baosihuozhoufeidilishu-02", "title": "褒姒惑周·废嫡立庶", "dynasty": "西周", "year": -779, "description": "幽王宠褒姒，废申后及太子宜臼，立褒姒子伯服，埋西周亡国之祸。（据《国语·晋语》《史记·周本纪》）", "importance": 3},
];

export const INGESTED_EVENT_PARTICIPANTS: Readonly<Record<string, readonly string[]>> = {
  "shang-06": ["仲丁", "阳甲", "盘庚"],
  "shang-12": ["周武王"],
  "shang-14": ["箕子"],
  "shang-shangtangwangkaisanmian-01": ["商汤"],
  "shang-taijiafuwei-04": ["伊尹", "太甲"],
  "shang-tangdaosanglin-03": ["商汤"],
  "shang-tangfaweigukunwu-02": ["商汤", "伊尹"],
  "shang-wudingzhengguifang-05": ["武丁", "妇好"],
  "xia-01": ["舜", "禹"],
  "xia-06": ["夏启"],
  "xia-07": ["夏启"],
  "xia-hanzhuocuanxia-05": ["寒浞", "后羿"],
  "xia-houyidaixia-04": ["后羿", "太康", "寒浞"],
  "xia-qijianxiajuntaizhixiang-01": ["夏启", "伯益", "禹"],
  "xia-tushanzhihui-02": ["禹"],
  "xia-xiajiebaozheng-06": ["夏桀"],
  "xia-yufasanmiao-03": ["禹"],
  "xizhou-05": ["武庚"],
  "xizhou-12": ["周穆王", "祭公谋父"],
  "xizhou-16": ["召穆公", "周定公"],
  "xizhou-baosihuozhoufeidilishu-02": ["周幽王", "褒姒"],
  "xizhou-zhouxuanwangzhongxing-01": ["周宣王"],
};

export const INGESTED_IMPORTANCE_OVERRIDES: Readonly<Record<string, readonly [1 | 2 | 3 | null, 1 | 2 | 3]>> = {
  "shang-04": [null, 3],
  "shang-12": [null, 3],
  "shang-14": [null, 3],
  "xizhou-05": [null, 3],
  "xizhou-10": [null, 3],
};

export const INGESTED_PERSON_ALIASES: Readonly<Record<string, string>> = {
  "召公": "召穆公",
  "周公（周定公）": "周定公",
  "大禹": "禹",
  "桀": "夏桀",
};

export const INGESTED_PERSON_ID_PINS: Readonly<Record<string, string>> = {
  "仲丁": "p-shang-zhongding-01",
  "伯益": "p-xia-boyi-01",
  "召穆公": "p-zhaomugong-8694",
  "周公旦": "p-xizhou-zhougongdan-01",
  "周定公": "p-xizhou-zhoudinggong-01",
  "周武王": "p-zhouwuwang-1530",
  "周穆王": "p-xizhou-zhoumuwang-01",
  "商汤": "p-shangtang-c08b",
  "夏启": "p-xia-xiaqi-01",
  "夏桀": "p-xia-xiajie-01",
  "妇好": "p-shang-fuhao-01",
  "寒浞": "p-hanzhuo-6de2",
  "武庚": "p-xizhou-wugeng-01",
  "盘庚": "p-pangeng-a22c",
  "祭公谋父": "p-xizhou-jigongmoufu-01",
  "禹": "p-yu-53cd",
  "箕子": "p-jizi-1de8",
  "舜": "p-shun-3851",
  "阳甲": "p-shang-yangjia-01",
};

export const INGESTED_RELATIONS: readonly PersonRelationRecord[] = [
  {"a": "禹", "b": "伯益", "label": "君臣（禅让之争）", "description": "禹本荐伯益，启夺位，益退避，禅让制由此终结。", "eventSummaries": {"xia-qijianxiajuntaizhixiang-01": "禹本荐伯益，启夺位，益退避，禅让制由此终结。"}},
  {"a": "周厉王", "b": "召穆公", "label": "君臣（暴政谏诤）", "description": "厉王弭谤，召公谏防民之口甚于防川，不听，国人暴动。", "eventSummaries": {"xizhou-16": "厉王弭谤，召公谏防民之口甚于防川，不听，国人暴动。"}},
  {"a": "后羿", "b": "寒浞", "label": "君臣→篡逆", "description": "寒浞本羿之家臣，杀羿篡位，代夏约四十年。", "eventSummaries": {"xia-hanzhuocuanxia-05": "寒浞本羿之家臣，杀羿篡位，代夏约四十年。"}},
  {"a": "周公旦", "b": "武庚", "label": "敌对（平叛）", "description": "武庚联三监叛周复商，周公东征杀之。", "eventSummaries": {"xizhou-05": "武庚联三监叛周复商，周公东征杀之。"}},
  {"a": "周厉王", "b": "周定公", "label": "君臣（共和行政）", "description": "厉王奔彘，周召共和行政，中国确切纪年开始。", "eventSummaries": {"xizhou-16": "厉王奔彘，周召共和行政，中国确切纪年开始。"}},
  {"a": "周幽王", "b": "申侯", "label": "君臣→敌对（外戚引戎）", "description": "申侯因女申后被废，联犬戎攻镐京，杀幽王。", "eventSummaries": {"xizhou-22": "申侯因女申后被废，联犬戎攻镐京，杀幽王。"}},
  {"a": "周文王", "b": "周武王", "label": "父子（灭商遗志）", "description": "文王奠基翦商，武王克成父志，牧野灭商。", "eventSummaries": {"shang-12": "文王奠基翦商，武王克成父志，牧野灭商。"}},
  {"a": "商纣王", "b": "箕子", "label": "君臣（囚禁佯狂）", "description": "箕子谏纣不听，披发佯狂为奴，被囚。", "eventSummaries": {"shang-14": "箕子谏纣不听，披发佯狂为奴，被囚。"}},
  {"a": "夏启", "b": "太康", "label": "父子（失国之君）", "description": "启子太康失德畋猎，被后羿拒于洛水而失国。", "eventSummaries": {"xia-07": "启子太康失德畋猎，被后羿拒于洛水而失国。"}},
  {"a": "禹", "b": "夏启", "label": "父子（世袭开端）", "description": "禹传位于启，终结禅让制，开世袭王朝之始。", "eventSummaries": {"xia-qijianxiajuntaizhixiang-01": "禹传位于启，终结禅让制，开世袭王朝之始。"}},
  {"a": "武丁", "b": "妇好", "label": "夫妻（王后统兵）", "description": "妇好为武丁王后，统兵征伐，甲骨文有载。", "eventSummaries": {"shang-wudingzhengguifang-05": "妇好为武丁王后，统兵征伐，甲骨文有载。"}},
  {"a": "盘庚", "b": "阳甲", "label": "兄弟（继位平乱）", "description": "盘庚继阳甲位，迁都至殷，平息九世之乱。", "eventSummaries": {"shang-06": "盘庚继阳甲位，迁都至殷，平息九世之乱。"}},
  {"a": "鲧", "b": "禹", "label": "父子（治水相继）", "description": "鲧治水无功被殛，禹继父业治水成功，开夏之基业。", "eventSummaries": {"xia-01": "鲧治水无功被殛，禹继父业治水成功，开夏之基业。"}},
];

export const INGESTED_RELATION_PATCHES: readonly IngestedRelationPatch[] = [
  {"pairKey": "周幽王__褒姒", "eventSummaries": {"xizhou-baosihuozhoufeidilishu-02": "幽王宠褒姒，废申后及太子宜臼，立褒姒子伯服。"}},
];

export const INGESTED_GRAPH_ERAS: readonly IngestedGraphEraSpec[] = [
  {"id": "xia", "label": "夏", "dynasties": ["夏"], "eventIds": ["xia-01", "xia-02", "xia-03", "xia-04", "xia-05", "xia-06", "xia-07", "xia-08", "xia-09", "xia-10", "xia-11", "xia-12", "xia-13", "xia-hanzhuocuanxia-05", "xia-houyidaixia-04", "xia-qijianxiajuntaizhixiang-01", "xia-tushanzhihui-02", "xia-xiajiebaozheng-06", "xia-yufasanmiao-03"], "defaultCenterPersonId": "禹"},
  {"id": "shang", "label": "商", "dynasties": ["夏", "商"], "eventIds": ["shang-01", "shang-02", "shang-03", "shang-04", "shang-05", "shang-06", "shang-07", "shang-08", "shang-09", "shang-10", "shang-11", "shang-12", "shang-13", "shang-14", "shang-15", "shang-shangtangwangkaisanmian-01", "shang-taijiafuwei-04", "shang-tangdaosanglin-03", "shang-tangfaweigukunwu-02", "shang-wudingzhengguifang-05", "xia-01", "xia-02", "xia-03", "xia-04", "xia-05", "xia-06", "xia-07", "xia-08", "xia-09", "xia-10", "xia-11", "xia-12", "xia-13", "xia-hanzhuocuanxia-05", "xia-houyidaixia-04", "xia-qijianxiajuntaizhixiang-01", "xia-tushanzhihui-02", "xia-xiajiebaozheng-06", "xia-yufasanmiao-03"], "defaultCenterPersonId": "商汤"},
  {"id": "xizhou", "label": "西周", "dynasties": ["商", "西周"], "eventIds": ["shang-01", "shang-02", "shang-03", "shang-04", "shang-05", "shang-06", "shang-07", "shang-08", "shang-09", "shang-10", "shang-11", "shang-12", "shang-13", "shang-14", "shang-15", "shang-shangtangwangkaisanmian-01", "shang-taijiafuwei-04", "shang-tangdaosanglin-03", "shang-tangfaweigukunwu-02", "shang-wudingzhengguifang-05", "xizhou-01", "xizhou-02", "xizhou-03", "xizhou-04", "xizhou-05", "xizhou-06", "xizhou-07", "xizhou-08", "xizhou-09", "xizhou-10", "xizhou-11", "xizhou-12", "xizhou-13", "xizhou-14", "xizhou-15", "xizhou-16", "xizhou-17", "xizhou-18", "xizhou-19", "xizhou-20", "xizhou-21", "xizhou-22", "xizhou-baosihuozhoufeidilishu-02", "xizhou-zhouxuanwangzhongxing-01"], "defaultCenterPersonId": "周公旦"},
];

export const INGESTED_KEY_FIGURES: Readonly<Record<string, readonly string[]>> = {
  "商": ["商汤", "伊尹", "周文王", "商纣王", "周武王", "太甲", "姜子牙", "武丁"],
  "夏": ["禹", "后羿", "夏启", "夏桀", "寒浞", "舜", "商汤", "太康"],
  "西周": ["周公旦", "周武王", "周成王", "姜子牙", "周幽王", "召穆公", "周厉王", "周定公"],
};

export const INGESTED_ERA_TO_SCOPE: Readonly<Record<string, string>> = {
  "shang": "xianqin",
  "xia": "xianqin",
  "xizhou": "xianqin",
};
