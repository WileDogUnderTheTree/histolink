/**
 * 两人关系数据（人工校订）。
 *
 * 与事件库解耦：键是「人物对」，不是事件。图谱构建时按统一排序口径（`pairKey`）
 * 把关系挂到对应的关系边上；未收录的人物对不显示关系徽章，关系面板的事件简述
 * 自动回退到事件正文摘要（`TimelineEvent.description`）。
 *
 * 覆盖范围：
 * - V0.6.1：三国人物图全部 87 对关系、100 条「人物对—事件」简述。
 * - V0.6.2：三国图谱扩充，关系库 87 → 173 对、简述 202 条。
 * - V0.6.3：先秦（夏商西周）29 对、楚汉 24 对，关系库 173 → 226 对。
 * - V0.6.4：魏晋南北朝 86 对（《史脉_第一批_魏晋南北朝》解析 49 对 + 补全 37 对），
 *   覆盖西晋期 37/60 边、东晋十六国期 27/33 边、南北朝期 31/42 边、简阅魏晋 92/131 边；
 *   其余边由时间轴事件自然成边，面板回退事件正文摘要（与秦汉、春秋战国口径一致）。
 * - V0.7.2：隋唐与五代辽宋夏金 99 对（《史脉_第二/三批》解析，按人物对合并镜像行），
 *   关系库累计 411 对；各期覆盖见 README §5.2。
 * - V0.8.0：元明清 50 对（《史脉_第四批_元明清》68 行解析，按人物对合并镜像行与跨批重复对），
 *   关系库累计 461 对；元 9 / 明 21 / 清 20，其中「袁崇焕 × 努尔哈赤」跨明、清两期共用。
 * - V0.8.2：随 174 条新事件同步校订 179 对关系（宋辽夏金元明清及隋唐五代、南北朝），
 *   关系库累计 640 对；各期覆盖见 README §5.2。
 *
 * 写法约定：
 * - `label` 为关系定性，2—6 字（君臣 / 盟友 / 政敌 / 敌手 / 降将 …）。
 * - `description` 只给核心人物对写，1—2 句交代关系来龙去脉。
 * - `eventSummaries` 的键必须是该对人物共同参与的事件 id；按「这对人物」的视角写。
 */

export interface PersonRelationRecord {
  a: string;
  b: string;
  /** 关系定性，2—6 字。 */
  label: string;
  /** 关系来龙去脉，1—2 句（可选）。 */
  description?: string;
  /** 按事件 id 的「这对人物视角」事件简述。 */
  eventSummaries: Readonly<Record<string, string>>;
}

/** 挂到图谱边上的已解析关系（不含 a/b）。 */
export interface PersonRelation {
  label: string;
  description?: string;
  eventSummaries: Readonly<Record<string, string>>;
}

/** 与 `buildPersonGraph` 的边 id 口径一致：姓名排序后用 `__` 连接。 */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export const PERSON_RELATIONS: readonly PersonRelationRecord[] = [
  // ===== 汉末：外戚、宦官与董卓（189—192）=====
  {
    a: "汉灵帝",
    b: "何进",
    label: "君臣",
    description: "何进以外戚为大将军辅政；灵帝崩后谋诛宦官，反被张让等矫诏杀害。",
    eventSummaries: {
      "handong-dongzhuo": "灵帝崩，何进以大将军辅政，召外兵入京谋诛宦官，事泄被张让等矫杀。",
    },
  },
  {
    a: "汉灵帝",
    b: "袁绍",
    label: "君臣",
    eventSummaries: {
      "handong-dongzhuo": "灵帝崩后袁绍与何进谋诛宦官，率兵入宫尽杀宦者，朝政旋落董卓之手。",
    },
  },
  {
    a: "汉灵帝",
    b: "董卓",
    label: "君臣",
    eventSummaries: {
      "handong-dongzhuo": "灵帝崩，何进召董卓率西凉兵入洛；卓未至而进死，遂废少帝、专朝政。",
    },
  },
  {
    a: "汉灵帝",
    b: "刘协",
    label: "父子",
    eventSummaries: {
      "handong-dongzhuo": "灵帝崩，少帝即位；董卓入洛后废少帝，立陈留王刘协为献帝。",
    },
  },
  {
    a: "何进",
    b: "袁绍",
    label: "同谋",
    eventSummaries: {
      "handong-dongzhuo": "何进与袁绍合谋诛宦官，事泄进死，袁绍等率兵入宫尽诛宦者。",
    },
  },
  {
    a: "何进",
    b: "董卓",
    label: "召而未至",
    eventSummaries: {
      "handong-dongzhuo": "何进召董卓入京为援，卓未至而进已被宦官所杀，卓遂据洛阳。",
    },
  },
  {
    a: "何进",
    b: "刘协",
    label: "君臣",
    eventSummaries: {
      "handong-dongzhuo": "何进谋诛宦官未成而死，少帝与陈留王刘协出宫，旋被董卓掌控。",
    },
  },
  {
    a: "董卓",
    b: "袁绍",
    label: "政敌",
    description: "袁绍当面反对董卓废立，几乎被杀，出奔冀州；次年以关东联军盟主讨董。",
    eventSummaries: {
      "handong-dongzhuo": "董卓议废少帝，袁绍力争不从，卓欲杀之，绍出奔冀州。",
      "handong-liandong": "袁绍为关东联军盟主与董卓对峙，董卓焚洛阳、挟帝西迁。",
    },
  },
  {
    a: "董卓",
    b: "王允",
    label: "政敌",
    eventSummaries: {
      "handong-dongzhuo-death": "王允结连吕布，于未央宫刺杀董卓，暴尸于市。",
    },
  },
  {
    a: "董卓",
    b: "吕布",
    label: "义父子→反目",
    description: "董卓待吕布如子，然性刚褊，曾以手戟掷之；吕布因私怨与王允合谋，手刃董卓。",
    eventSummaries: {
      "handong-dongzhuo-death": "吕布应王允之谋，于宫门刺杀义父董卓；李傕、郭汜旋攻长安。",
    },
  },
  {
    a: "董卓",
    b: "李傕",
    label: "部将",
    eventSummaries: {
      "handong-dongzhuo-death": "董卓被诛，部将李傕、郭汜合兵攻陷长安，为卓复仇。",
    },
  },
  {
    a: "董卓",
    b: "郭汜",
    label: "部将",
    eventSummaries: {
      "handong-dongzhuo-death": "董卓被诛后，郭汜随李傕攻长安，杀王允、逐吕布。",
    },
  },
  {
    a: "董卓",
    b: "曹操",
    label: "政敌",
    eventSummaries: {
      "handong-liandong": "曹操散家财起兵讨董，与袁绍等会于酸枣，联军观望不进。",
    },
  },
  {
    a: "董卓",
    b: "刘协",
    label: "拥立",
    eventSummaries: {
      "handong-dongzhuo": "董卓废少帝，立刘协为献帝，自为相国，专断朝政。",
      "handong-liandong": "关东联军讨董，董卓挟献帝西迁长安，焚洛阳宫室。",
    },
  },
  {
    a: "袁绍",
    b: "曹操",
    label: "旧友→死敌",
    description: "二人少时相交；官渡一战定河北归属，袁绍败后病死，曹操尽收其地。",
    eventSummaries: {
      "handong-liandong": "袁绍、曹操同起关东联军讨董，联军各怀异心，旋散。",
      "handong-guandu": "袁绍十万众南下，曹操烧乌巢粮草，袁军大溃，河北归曹。",
    },
  },
  {
    a: "袁绍",
    b: "刘协",
    label: "名义君臣",
    eventSummaries: {
      "handong-dongzhuo": "袁绍反对废立、出奔冀州，刘协仍被董卓立为帝。",
      "handong-liandong": "袁绍以讨董为名起兵，献帝时在董卓掌握之中。",
    },
  },
  {
    a: "王允",
    b: "吕布",
    label: "同谋",
    eventSummaries: {
      "handong-dongzhuo-death": "王允说动吕布共诛董卓；后李傕、郭汜攻长安，吕布败走。",
    },
  },
  {
    a: "王允",
    b: "李傕",
    label: "仇敌",
    eventSummaries: {
      "handong-dongzhuo-death": "李傕、郭汜攻破长安，王允被杀，关中复乱。",
    },
  },
  {
    a: "王允",
    b: "郭汜",
    label: "仇敌",
    eventSummaries: {
      "handong-dongzhuo-death": "郭汜随李傕攻长安，王允遇害。",
    },
  },
  {
    a: "吕布",
    b: "李傕",
    label: "仇敌",
    eventSummaries: {
      "handong-dongzhuo-death": "吕布守长安，为李傕、郭汜所败，东走投袁绍。",
    },
  },
  {
    a: "吕布",
    b: "郭汜",
    label: "仇敌",
    eventSummaries: {
      "handong-dongzhuo-death": "吕布与郭汜战于长安城下，兵败出逃。",
    },
  },
  {
    a: "李傕",
    b: "郭汜",
    label: "同党→相攻",
    eventSummaries: {
      "handong-dongzhuo-death": "李傕、郭汜合力攻下长安，旋因争权互相攻杀，关中残破。",
    },
  },

  // ===== 曹操与汉廷（190—220）=====
  {
    a: "曹操",
    b: "毛玠",
    label: "君臣",
    eventSummaries: {
      "handong-caocao-emperor": "毛玠献「奉天子以令不臣」之策，曹操采之，迎献帝都许。",
    },
  },
  {
    a: "毛玠",
    b: "刘协",
    label: "君臣",
    eventSummaries: {
      "handong-caocao-emperor": "毛玠劝曹操迎帝，献帝遂自洛阳迁都于许。",
    },
  },
  {
    a: "曹操",
    b: "刘协",
    label: "君臣→挟制",
    description: "曹操迎献帝都许，奉天子以令诸侯；终其身献帝未能亲政，220 年其子曹丕受禅代汉。",
    eventSummaries: {
      "handong-liandong": "联军讨董时曹操为一路诸侯，献帝尚在董卓手中。",
      "handong-caocao-emperor": "曹操迎献帝都许，自为大将军，挟天子以令诸侯。",
      "handong-han-fall": "曹操卒后，子曹丕受献帝禅让称帝，东汉亡。",
    },
  },
  {
    a: "曹操",
    b: "曹丕",
    label: "父子",
    eventSummaries: {
      "handong-han-fall": "曹操卒，曹丕嗣魏王，旋受汉禅称帝，改元黄初。",
    },
  },
  {
    a: "曹丕",
    b: "刘协",
    label: "禅代",
    eventSummaries: {
      "handong-han-fall": "曹丕受献帝禅让，称帝建魏，东汉一百九十六年而亡。",
    },
  },

  // ===== 赤壁与孙刘联盟（208）=====
  {
    a: "曹操",
    b: "孙权",
    label: "敌手",
    description: "赤壁一战曹操南下受挫，终其世未能渡江；南北分立之势由此奠定。",
    eventSummaries: {
      "handong-chibi": "曹操南下荆州，孙权遣周瑜联刘备迎击，火攻破曹，操北还。",
    },
  },
  {
    a: "曹操",
    b: "刘备",
    label: "对手",
    description: "煮酒论英雄后刘备借机脱身；赤壁联手抗曹，此后终生为敌。",
    eventSummaries: {
      "handong-chibi": "曹操南下，刘备与孙权结盟，赤壁火攻破曹，三分之势由此奠定。",
      "hanmo-07": "下邳之战，刘备从曹操征吕布，合力灭之。",
    },
  },
  {
    a: "曹操",
    b: "周瑜",
    label: "敌手",
    eventSummaries: {
      "handong-chibi": "周瑜统吴军火攻，大破曹操水军于赤壁。",
    },
  },
  {
    a: "曹操",
    b: "黄盖",
    label: "敌手",
    eventSummaries: {
      "handong-chibi": "黄盖诈降，纵火焚曹操战船，曹军大溃。",
    },
  },
  {
    a: "孙权",
    b: "刘备",
    label: "盟友→反目",
    description: "赤壁结盟共破曹操，后因荆州归属生隙；222 年夷陵一战联盟彻底破裂。",
    eventSummaries: {
      "handong-chibi": "孙刘联军赤壁破曹，奠定三分之势。",
      "sanguo-02": "刘备为关羽复仇伐吴，夷陵为陆逊所破，孙刘联盟破裂。",
    },
  },
  {
    a: "孙权",
    b: "周瑜",
    label: "君臣",
    description: "周瑜与孙策为总角之交，孙权事之如兄；赤壁以周瑜为大都督。",
    eventSummaries: {
      "handong-chibi": "孙权拜周瑜为大都督，统军破曹操于赤壁。",
      "hanmo-09": "孙策遇刺临终，以孙权相托，周瑜与张昭同受顾命。",
    },
  },
  {
    a: "孙权",
    b: "黄盖",
    label: "君臣",
    eventSummaries: {
      "handong-chibi": "黄盖为孙权部将，献诈降火攻之策，赤壁破曹。",
    },
  },
  {
    a: "刘备",
    b: "周瑜",
    label: "盟友",
    eventSummaries: {
      "handong-chibi": "赤壁之战周瑜统兵，刘备军配合，共破曹操。",
    },
  },
  {
    a: "刘备",
    b: "黄盖",
    label: "盟友",
    eventSummaries: {
      "handong-chibi": "黄盖火攻曹军，刘备军乘势追击，共破曹操。",
    },
  },
  {
    a: "周瑜",
    b: "黄盖",
    label: "同僚",
    eventSummaries: {
      "handong-chibi": "黄盖为周瑜部将，诈降纵火，赤壁大破曹军。",
    },
  },

  // ===== 蜀汉：托孤与南征（221—225）=====
  {
    a: "刘备",
    b: "诸葛亮",
    label: "君臣（鱼水）",
    description: "三顾茅庐后诸葛亮为刘备谋划三分；刘备托孤时谓「君可自取」，蜀汉政事尽付之。",
    eventSummaries: {
      "sanguo-01": "刘备称帝，以诸葛亮为丞相，总揽政务。",
      "sanguo-03": "刘备白帝托孤，令诸葛亮辅刘禅，谓「君可自取」。",
      "hanmo-19": "刘备称汉中王，诸葛亮与马超等同上表劝进。",
    },
  },
  {
    a: "刘备",
    b: "刘禅",
    label: "父子",
    eventSummaries: {
      "sanguo-01": "刘备称帝，立刘禅为皇太子。",
      "sanguo-03": "刘备崩于白帝城，刘禅继位，诸葛亮辅政。",
    },
  },
  {
    a: "刘备",
    b: "张飞",
    label: "恩若兄弟",
    description: "史称关羽、张飞「为之御侮」，刘备与二人恩若兄弟；张飞后为部将所害。",
    eventSummaries: {
      "sanguo-01": "刘备称帝，张飞为车骑将军，领司隶校尉，封西乡侯。",
      "hanmo-04": "袁术攻徐州，张飞守下邳为吕布所败，刘备军势大挫。",
    },
  },
  {
    a: "刘备",
    b: "李严",
    label: "君臣",
    eventSummaries: {
      "sanguo-03": "刘备托孤，以李严为中都护，与诸葛亮同受遗诏。",
    },
  },
  {
    a: "刘备",
    b: "陆逊",
    label: "敌手",
    eventSummaries: {
      "sanguo-02": "陆逊坚守不战，火攻破刘备连营四十余，刘备退守白帝。",
    },
  },
  {
    a: "刘禅",
    b: "张飞",
    label: "姻亲",
    eventSummaries: {
      "sanguo-01": "刘备称帝，立刘禅为太子、张飞为车骑将军；张飞二女后先后为刘禅皇后。",
    },
  },
  {
    a: "诸葛亮",
    b: "刘禅",
    label: "君臣（相父）",
    description: "刘备托孤后诸葛亮辅政十一年，刘禅「政事无巨细，咸决于亮」。",
    eventSummaries: {
      "sanguo-01": "刘备称帝，诸葛亮为丞相，辅太子刘禅。",
      "sanguo-03": "刘备崩，诸葛亮受遗诏辅佐刘禅，开府治事。",
    },
  },
  {
    a: "诸葛亮",
    b: "张飞",
    label: "同僚",
    eventSummaries: {
      "sanguo-01": "同佐刘备称帝：诸葛亮为丞相，张飞为车骑将军。",
    },
  },
  {
    a: "诸葛亮",
    b: "李严",
    label: "同僚→政敌",
    eventSummaries: {
      "sanguo-03": "诸葛亮与李严同受托孤之命；后李严运粮误事，被废为民。",
    },
  },
  {
    a: "李严",
    b: "刘禅",
    label: "君臣",
    eventSummaries: {
      "sanguo-03": "李严受遗诏辅政，与诸葛亮共佐刘禅。",
    },
  },
  {
    a: "诸葛亮",
    b: "孟获",
    label: "攻心",
    eventSummaries: {
      "sanguo-04": "诸葛亮南征，纳「攻心为上」之策，降孟获而抚其众，南中遂定。",
    },
  },

  // ===== 北伐与街亭（228—234）=====
  {
    a: "诸葛亮",
    b: "马谡",
    label: "师徒",
    description: "诸葛亮器重马谡，南征采其「攻心」之策；街亭违令致败，亮挥泪斩之。",
    eventSummaries: {
      "sanguo-05": "马谡舍水上山，为张郃所破；诸葛亮斩马谡、自贬三等。",
    },
  },
  {
    a: "诸葛亮",
    b: "赵云",
    label: "君臣",
    eventSummaries: {
      "sanguo-05": "赵云、邓芝出箕谷为疑兵，失利后退保，诸葛亮自贬。",
    },
  },
  {
    a: "诸葛亮",
    b: "张郃",
    label: "敌将",
    eventSummaries: {
      "sanguo-05": "张郃破马谡于街亭，诸葛亮首次北伐无功而返。",
    },
  },
  {
    a: "张郃",
    b: "马谡",
    label: "敌将",
    eventSummaries: {
      "sanguo-05": "张郃围山断水，大破马谡于街亭。",
    },
  },
  {
    a: "张郃",
    b: "赵云",
    label: "敌将",
    eventSummaries: {
      "sanguo-05": "赵云出箕谷失利，张郃同期破马谡，蜀军全线退兵。",
    },
  },
  {
    a: "赵云",
    b: "马谡",
    label: "同僚",
    eventSummaries: {
      "sanguo-05": "街亭、箕谷两路俱败，赵云敛众固守，马谡失守要地。",
    },
  },
  {
    a: "诸葛亮",
    b: "司马懿",
    label: "宿敌",
    description: "五丈原相持百余日，诸葛亮病卒；蜀人谚曰「死诸葛走生仲达」。",
    eventSummaries: {
      "sanguo-07": "诸葛亮屯五丈原与司马懿相持，病卒军中，司马懿不敢追。",
    },
  },
  {
    a: "姜维",
    b: "诸葛亮",
    label: "师徒",
    eventSummaries: {
      "sanguo-07": "姜维随诸葛亮北伐，亮卒后依遗命退军，继其北伐之志。",
    },
  },
  {
    a: "姜维",
    b: "司马懿",
    label: "敌手",
    eventSummaries: {
      "sanguo-07": "五丈原对峙，姜维随诸葛亮与司马懿相持，亮卒后退军。",
    },
  },

  // ===== 荆州之争（219）=====
  {
    a: "关羽",
    b: "曹仁",
    label: "敌将",
    eventSummaries: {
      "handong-fanchang": "关羽围曹仁于樊城，水淹七军，威震华夏。",
    },
  },
  {
    a: "关羽",
    b: "于禁",
    label: "降将",
    eventSummaries: {
      "handong-fanchang": "汉水暴涨，于禁七军皆没，降于关羽。",
    },
  },
  {
    a: "关羽",
    b: "吕蒙",
    label: "敌手",
    description: "关羽北伐时吕蒙称病、白衣渡江袭取江陵，关羽后路尽失，败走麦城。",
    eventSummaries: {
      "handong-fanchang": "吕蒙白衣渡江袭取江陵，关羽退保麦城，西走被擒杀。",
    },
  },
  {
    a: "关羽",
    b: "陆逊",
    label: "敌手",
    eventSummaries: {
      "handong-fanchang": "陆逊代吕蒙守陆口，卑辞骄关羽，助吕蒙袭取荆州。",
    },
  },
  {
    a: "关羽",
    b: "孙权",
    label: "盟友→反目",
    description: "孙刘曾以荆州为盟，后孙权遣吕蒙袭取荆州、擒杀关羽，联盟彻底破裂。",
    eventSummaries: {
      "handong-fanchang": "孙权遣吕蒙袭荆州，关羽败亡，荆州归吴。",
    },
  },
  {
    a: "孙权",
    b: "吕蒙",
    label: "君臣",
    eventSummaries: {
      "handong-fanchang": "孙权用吕蒙之策，白衣渡江袭取荆州。",
    },
  },
  {
    a: "孙权",
    b: "陆逊",
    label: "君臣→猜忌",
    description: "陆逊为孙权破刘备、任上大将军；后卷入二宫之争，屡遭责让，愤恚而卒。",
    eventSummaries: {
      "handong-fanchang": "孙权用陆逊佐吕蒙袭取荆州。",
      "sanguo-02": "陆逊为大都督，夷陵火攻破刘备。",
      "sanguo-06": "孙权称帝，以陆逊为上大将军。",
    },
  },
  {
    a: "孙权",
    b: "曹仁",
    label: "临时同盟",
    eventSummaries: {
      "handong-fanchang": "孙权向曹操称臣，与曹仁等南北呼应共图关羽。",
    },
  },
  {
    a: "吕蒙",
    b: "陆逊",
    label: "同僚",
    eventSummaries: {
      "handong-fanchang": "吕蒙称病还建业，陆逊代守陆口，合谋袭取荆州。",
    },
  },
  {
    a: "吕蒙",
    b: "曹仁",
    label: "各为其主",
    eventSummaries: {
      "handong-fanchang": "曹仁守樊城牵制关羽，吕蒙乘虚袭取荆州，二事相合。",
    },
  },
  {
    a: "陆逊",
    b: "曹仁",
    label: "各为其主",
    eventSummaries: {
      "handong-fanchang": "陆逊佐吕蒙袭荆州，曹仁被围于樊城，关羽首尾不能相顾。",
    },
  },
  {
    a: "于禁",
    b: "曹仁",
    label: "同僚",
    eventSummaries: {
      "handong-fanchang": "于禁率七军救樊城，与曹仁同守，终为关羽所破。",
    },
  },
  {
    a: "于禁",
    b: "吕蒙",
    label: "俘将",
    eventSummaries: {
      "handong-fanchang": "于禁降关羽后被囚江陵，吕蒙取荆州后释之。",
    },
  },
  {
    a: "于禁",
    b: "陆逊",
    label: "俘将",
    eventSummaries: {
      "handong-fanchang": "陆逊随吕蒙取荆州，于禁自囚中获释。",
    },
  },
  {
    a: "于禁",
    b: "孙权",
    label: "俘将",
    eventSummaries: {
      "handong-fanchang": "于禁为关羽所俘，孙权取荆州后礼送其归魏。",
    },
  },

  // ===== 魏晋权争（249—263）=====
  {
    a: "司马懿",
    b: "曹爽",
    label: "政敌",
    description: "曹爽排挤司马懿，懿称病避之；249 年趁其陪帝谒陵，闭城夺权，爽夷三族。",
    eventSummaries: {
      "sanguo-08": "司马懿闭洛阳城门、据武库，奏曹爽罪状，爽归罪自请，旋被夷三族。",
    },
  },
  {
    a: "司马懿",
    b: "曹芳",
    label: "君臣→篡权",
    eventSummaries: {
      "sanguo-08": "曹芳谒高平陵，司马懿乘机夺权，魏政尽归司马氏。",
    },
  },
  {
    a: "曹爽",
    b: "曹芳",
    label: "君臣",
    eventSummaries: {
      "sanguo-08": "曹爽陪曹芳谒高平陵，司马懿乘机闭城夺权。",
    },
  },
  {
    a: "司马昭",
    b: "钟会",
    label: "君臣→猜忌",
    description: "司马昭用钟会伐蜀，蜀亡后钟会谋据蜀自立，为部将所杀。",
    eventSummaries: {
      "sanguo-09": "钟会构陷嵇康「非汤武而薄周孔」，司马昭遂杀之。",
      "sanguo-10": "钟会灭蜀后谋反，为部将所杀。",
    },
  },
  {
    a: "司马昭",
    b: "邓艾",
    label: "君臣→猜忌",
    eventSummaries: {
      "sanguo-10": "司马昭遣邓艾伐蜀，艾功高，被钟会构陷收捕。",
    },
  },
  {
    a: "司马昭",
    b: "刘禅",
    label: "敌国",
    eventSummaries: {
      "sanguo-10": "司马昭决策伐蜀，刘禅出降，蜀汉亡。",
    },
  },
  {
    a: "司马昭",
    b: "姜维",
    label: "敌国",
    eventSummaries: {
      "sanguo-10": "姜维据剑阁拒钟会，闻刘禅出降乃降，谋复国事败被杀。",
    },
  },
  {
    a: "司马昭",
    b: "嵇康",
    label: "政敌",
    eventSummaries: {
      "sanguo-09": "司马昭以「非汤武而薄周孔」之罪杀嵇康，临刑奏《广陵散》。",
    },
  },
  {
    a: "嵇康",
    b: "钟会",
    label: "构陷",
    eventSummaries: {
      "sanguo-09": "钟会进谗构陷嵇康，致其被司马昭所杀。",
    },
  },
  {
    a: "邓艾",
    b: "钟会",
    label: "同僚→构陷",
    eventSummaries: {
      "sanguo-10": "钟会攻剑阁不下，邓艾偷渡阴平成功；钟会旋诬邓艾，艾被收捕。",
    },
  },
  {
    a: "邓艾",
    b: "刘禅",
    label: "降君",
    eventSummaries: {
      "sanguo-10": "邓艾破绵竹、下成都，刘禅出降，蜀汉亡。",
    },
  },
  {
    a: "钟会",
    b: "刘禅",
    label: "敌将",
    eventSummaries: {
      "sanguo-10": "钟会攻剑阁，蜀亡后谋反，为部将所杀。",
    },
  },
  {
    a: "姜维",
    b: "钟会",
    label: "降将",
    eventSummaries: {
      "sanguo-10": "姜维降钟会，谋借钟会之乱复国，事败被杀。",
    },
  },
  {
    a: "姜维",
    b: "邓艾",
    label: "宿敌",
    eventSummaries: {
      "sanguo-10": "邓艾破成都，姜维退保剑阁，蜀汉亡。",
    },
  },
  {
    a: "姜维",
    b: "刘禅",
    label: "君臣",
    eventSummaries: {
      "sanguo-10": "刘禅降魏，敕姜维降钟会，姜维谋复国未成。",
    },
  },

  // ===== 第 5 批（V0.6.2 汉末群雄扩充），新增 86 对 =====

  // ----- 孙吴：孙坚、孙策与江东旧部 -----
  {
    a: "孙坚",
    b: "孙策",
    label: "父子",
    description: "孙坚长子孙策，父死时年十七；后依袁术讨还父兵，渡江开创江东基业。",
    eventSummaries: {
      "hanmo-01": "孙坚战死岘山，长子孙策扶柩归葬，后依袁术领父部曲。",
    },
  },
  {
    a: "孙坚",
    b: "袁术",
    label: "同盟",
    eventSummaries: {
      "hanmo-01": "袁术遣孙坚攻刘表，孙坚战死岘山，其部曲后归子孙策。",
    },
  },
  {
    a: "孙坚",
    b: "刘表",
    label: "仇敌",
    description: "孙坚奉袁术之命攻荆州，死于刘表部将黄祖军士之手，孙刘两家由是结仇。",
    eventSummaries: {
      "hanmo-01": "孙坚围襄阳，为刘表部将黄祖军士射杀于岘山。",
    },
  },
  {
    a: "孙策",
    b: "袁术",
    label: "依附→决裂",
    description: "孙策借袁术之力起家，羽翼既成即与之决裂，终成江东之主。",
    eventSummaries: {
      "hanmo-01": "孙策扶父柩依袁术，求得父兵以自立。",
      "hanmo-03": "孙策以袁术所予父兵渡江，平定江东诸郡。",
      "hanmo-05": "袁术称帝，孙策与之绝，转而上表曹操。",
    },
  },
  {
    a: "孙策",
    b: "周瑜",
    label: "总角之交",
    description: "二人总角之交，周瑜以兄事孙策；孙策临终托孤，周瑜遂与孙权共掌江东。",
    eventSummaries: {
      "hanmo-03": "孙策渡江，周瑜率兵来会，共破刘繇。",
      "hanmo-09": "孙策临终以弟孙权相托，周瑜与张昭同受托孤之任。",
    },
  },
  {
    a: "孙策",
    b: "太史慈",
    label: "招降",
    description: "孙策擒太史慈而释之，太史慈感其义遂归心，为江东名将。",
    eventSummaries: {
      "hanmo-03": "孙策破刘繇，擒太史慈而释用之，太史慈遂降。",
    },
  },
  {
    a: "太史慈",
    b: "袁术",
    label: "名义旧主",
    eventSummaries: {
      "hanmo-03": "袁术以兵助孙策渡江，太史慈时为刘繇将，战败归孙策。",
    },
  },
  {
    a: "周瑜",
    b: "袁术",
    label: "旧主→弃之",
    eventSummaries: {
      "hanmo-03": "周瑜弃袁术所授居巢长，率兵归孙策，共平江东。",
    },
  },
  {
    a: "周瑜",
    b: "太史慈",
    label: "同僚",
    eventSummaries: {
      "hanmo-03": "孙策渡江，周瑜率兵来会，太史慈归附，三人共定江东。",
    },
  },
  {
    a: "孙策",
    b: "孙权",
    label: "兄弟",
    description: "孙策长孙权七岁，遇刺后以江东基业传弟，孙吴由是再传。",
    eventSummaries: {
      "hanmo-09": "孙策遇刺临终，以印绶付弟孙权，托张昭、周瑜辅之。",
    },
  },
  {
    a: "孙策",
    b: "曹操",
    label: "名义同盟",
    eventSummaries: {
      "hanmo-05": "袁术称帝，孙策与之绝并上表曹操，曹操表其为讨逆将军。",
    },
  },
  {
    a: "孙策",
    b: "刘表",
    label: "世仇",
    eventSummaries: {
      "hanmo-01": "孙策父孙坚死于刘表部将之手，孙策承父之仇，后与刘表对峙江东。",
    },
  },
  {
    a: "孙权",
    b: "甘宁",
    label: "君臣",
    eventSummaries: {
      "handong-chibi": "甘宁归孙权后随周瑜拒曹操于赤壁，为江东骁将。",
    },
  },
  {
    a: "周瑜",
    b: "甘宁",
    label: "同僚",
    eventSummaries: {
      "handong-chibi": "甘宁随周瑜拒曹操于乌林，赤壁火攻破曹。",
    },
  },
  {
    a: "甘宁",
    b: "黄盖",
    label: "同僚",
    eventSummaries: {
      "handong-chibi": "甘宁、黄盖同为周瑜部将，赤壁火攻大破曹军。",
    },
  },
  {
    a: "曹操",
    b: "甘宁",
    label: "敌手",
    eventSummaries: {
      "handong-chibi": "赤壁之战，甘宁随周瑜火攻，曹操败退北还。",
    },
  },
  {
    a: "刘备",
    b: "甘宁",
    label: "联军同袍",
    eventSummaries: {
      "handong-chibi": "赤壁时甘宁属孙刘联军，与刘备军并肩破曹。",
    },
  },

  // ----- 官渡：曹魏谋臣武将 -----
  {
    a: "曹操",
    b: "荀彧",
    label: "君臣（王佐）",
    description: "荀彧去袁绍而归曹操，为其定策迎天子、守根本；官渡危局中一书坚曹操之志。",
    eventSummaries: {
      "handong-guandu": "官渡相持，荀彧书劝曹操坚守，谓「此用奇之时，不可失也」。",
    },
  },
  {
    a: "曹操",
    b: "郭嘉",
    label: "君臣（奇佐）",
    description: "郭嘉由荀彧荐于曹操，善断成败；官渡前定「十胜十败」之论，坚曹操破袁之志。",
    eventSummaries: {
      "handong-guandu": "郭嘉陈「十胜十败」之论，坚曹操与袁绍决战之志。",
    },
  },
  {
    a: "荀彧",
    b: "郭嘉",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "荀彧荐郭嘉于曹操，官渡时二人同参军谋。",
    },
  },
  {
    a: "荀彧",
    b: "袁绍",
    label: "旧主→弃之",
    eventSummaries: {
      "handong-guandu": "荀彧原事袁绍，度其不能成大事而去，官渡时各为其主。",
    },
  },
  {
    a: "郭嘉",
    b: "袁绍",
    label: "旧主→弃之",
    eventSummaries: {
      "handong-guandu": "郭嘉少时曾见袁绍，度其难成，遂去；官渡时佐曹操破绍。",
    },
  },
  {
    a: "关羽",
    b: "曹操",
    label: "降将→恩义",
    description: "关羽降汉不降曹，斩颜良以报厚遇，终封金挂印归刘备，义名传世。",
    eventSummaries: {
      "handong-guandu": "关羽为曹操所擒，随军斩颜良报恩，后封金挂印归刘备。",
    },
  },
  {
    a: "关羽",
    b: "袁绍",
    label: "敌将",
    eventSummaries: {
      "handong-guandu": "关羽于白马斩袁绍大将颜良，解官渡前哨之围。",
    },
  },
  {
    a: "关羽",
    b: "张辽",
    label: "同袍之谊",
    eventSummaries: {
      "handong-guandu": "白马之役，张辽与关羽同为先锋，共破袁军。",
    },
  },
  {
    a: "关羽",
    b: "荀彧",
    label: "同殿之臣",
    eventSummaries: {
      "handong-guandu": "官渡之战，荀彧守许都、关羽在前线斩颜良，同属曹操一方。",
    },
  },
  {
    a: "关羽",
    b: "郭嘉",
    label: "同殿之臣",
    eventSummaries: {
      "handong-guandu": "官渡之战，郭嘉参帷幄、关羽斩颜良，同属曹操一方。",
    },
  },
  {
    a: "关羽",
    b: "徐晃",
    label: "同袍→敌将",
    eventSummaries: {
      "handong-guandu": "官渡之战，关羽与徐晃同属曹操一方。",
      "handong-fanchang": "襄樊之战，徐晃率军救曹仁，破关羽于四冢。",
    },
  },

  // ----- 曹魏：下邳、宛城、潼关 -----
  {
    a: "曹操",
    b: "张辽",
    label: "君臣（降将）",
    description: "张辽本吕布部将，下邳降曹后为五子良将之首，官渡白马之功最著。",
    eventSummaries: {
      "hanmo-07": "下邳城破，吕布部将张辽降曹操，曹操释而用之。",
      "handong-guandu": "官渡之战，张辽与关羽同解白马之围，斩袁绍大将颜良。",
    },
  },
  {
    a: "吕布",
    b: "张辽",
    label: "旧主→降曹",
    eventSummaries: {
      "hanmo-07": "张辽为吕布部将，下邳被围时先降曹操，吕布旋败亡。",
    },
  },
  {
    a: "张辽",
    b: "刘备",
    label: "同殿之臣",
    eventSummaries: {
      "hanmo-07": "下邳之役刘备从曹操征吕布，张辽降后与之同列曹营。",
    },
  },
  {
    a: "张辽",
    b: "夏侯惇",
    label: "同僚",
    eventSummaries: {
      "hanmo-07": "下邳之战，夏侯惇从曹操征吕布，张辽降后同为曹营名将。",
    },
  },
  {
    a: "张辽",
    b: "荀彧",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "官渡之战，荀彧守许、张辽解白马围，同佐曹操。",
    },
  },
  {
    a: "张辽",
    b: "郭嘉",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "官渡之战，郭嘉参军谋、张辽为先锋，共破袁绍。",
    },
  },
  {
    a: "张辽",
    b: "徐晃",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "官渡之战，张辽解白马围、徐晃烧粮车，同为曹营名将。",
    },
  },
  {
    a: "张辽",
    b: "袁绍",
    label: "敌将",
    eventSummaries: {
      "handong-guandu": "张辽为曹军先锋破袁绍于官渡，斩其大将颜良。",
    },
  },
  {
    a: "曹操",
    b: "夏侯惇",
    label: "君臣（宗亲）",
    description: "夏侯惇与曹操为宗族兄弟，自陈留起兵即相随，为曹魏元从第一将。",
    eventSummaries: {
      "hanmo-07": "夏侯惇从曹操征吕布于下邳，为流矢所中。",
    },
  },
  {
    a: "刘备",
    b: "夏侯惇",
    label: "同殿之臣",
    eventSummaries: {
      "hanmo-07": "下邳之役，刘备与夏侯惇同从曹操征吕布。",
    },
  },
  {
    a: "吕布",
    b: "夏侯惇",
    label: "敌将",
    eventSummaries: {
      "hanmo-07": "下邳之战，夏侯惇从征吕布，吕布败亡。",
    },
  },
  {
    a: "吕布",
    b: "曹操",
    label: "敌手",
    eventSummaries: {
      "hanmo-07": "曹操围下邳，吕布被擒缢杀，陈宫、高顺皆死。",
    },
  },
  {
    a: "吕布",
    b: "张飞",
    label: "敌手",
    eventSummaries: {
      "hanmo-04": "吕布袭下邳，张飞败走，刘备妻子被掳。",
    },
  },
  {
    a: "吕布",
    b: "袁术",
    label: "盟友→反目",
    eventSummaries: {
      "hanmo-04": "袁术攻刘备于徐州，吕布乘虚袭下邳，旋又辕门射戟为两家解斗。",
    },
  },
  {
    a: "刘备",
    b: "吕布",
    label: "仇敌→同讨",
    eventSummaries: {
      "hanmo-04": "袁术攻刘备，吕布乘虚袭下邳，掳其妻子。",
      "hanmo-07": "下邳之战，刘备从曹操征吕布，吕布败亡。",
    },
  },
  {
    a: "刘备",
    b: "袁术",
    label: "敌手",
    eventSummaries: {
      "hanmo-04": "袁术遣军攻刘备于徐州，刘备求和于吕布以自保。",
    },
  },
  {
    a: "张飞",
    b: "袁术",
    label: "敌手",
    eventSummaries: {
      "hanmo-04": "袁术攻徐州，张飞守下邳为吕布所败，刘备军势大挫。",
    },
  },
  {
    a: "曹操",
    b: "袁术",
    label: "敌国",
    eventSummaries: {
      "hanmo-05": "袁术称帝寿春，曹操会诸侯讨之，术势自此衰。",
    },
  },
  {
    a: "曹操",
    b: "典韦",
    label: "君臣（护卫）",
    description: "典韦为曹操亲卫，力能扛鼎；宛城之变以身当门，护曹操脱险而死。",
    eventSummaries: {
      "hanmo-06": "张绣夜袭曹营，典韦力战死门，曹操仅以身免。",
    },
  },
  {
    a: "张绣",
    b: "典韦",
    label: "仇敌",
    eventSummaries: {
      "hanmo-06": "张绣降而复叛，夜袭曹营，典韦战死于营门。",
    },
  },
  {
    a: "曹操",
    b: "张绣",
    label: "降将",
    eventSummaries: {
      "hanmo-06": "张绣先降曹操，因曹操纳其婶母而叛，夜袭曹营。",
    },
  },
  {
    a: "曹操",
    b: "许褚",
    label: "君臣（护卫）",
    eventSummaries: {
      "hanmo-15": "潼关之战，许褚从曹操渡渭，被甲执刀护卫，马超不敢近。",
    },
  },
  {
    a: "许褚",
    b: "马超",
    label: "敌将",
    eventSummaries: {
      "hanmo-15": "潼关阵前，许褚瞋目视马超，马超疑而不敢动。",
    },
  },
  {
    a: "曹操",
    b: "马超",
    label: "世仇",
    description: "马超起兵反曹，潼关败走；曹操后杀其父马腾、灭其三族，两家仇深。",
    eventSummaries: {
      "hanmo-15": "马超联军反曹，曹操渡渭筑城，大破关西联军。",
    },
  },
  {
    a: "徐晃",
    b: "曹操",
    label: "君臣",
    eventSummaries: {
      "handong-guandu": "徐晃从曹操破袁绍，烧其运粮车，以功封都亭侯。",
    },
  },
  {
    a: "徐晃",
    b: "袁绍",
    label: "敌将",
    eventSummaries: {
      "handong-guandu": "徐晃原为杨奉部将，归曹操后于官渡破袁绍。",
    },
  },
  {
    a: "徐晃",
    b: "荀彧",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "官渡之战，荀彧守许都、徐晃在前线破敌，同佐曹操。",
    },
  },
  {
    a: "徐晃",
    b: "郭嘉",
    label: "同僚",
    eventSummaries: {
      "handong-guandu": "郭嘉参官渡军谋，徐晃烧袁绍粮车，共成破袁之局。",
    },
  },
  {
    a: "徐晃",
    b: "曹仁",
    label: "同僚",
    eventSummaries: {
      "handong-fanchang": "襄樊之战，徐晃率新兵救曹仁，内外合击破关羽。",
    },
  },
  {
    a: "徐晃",
    b: "于禁",
    label: "同僚",
    eventSummaries: {
      "handong-fanchang": "于禁七军没于关羽，徐晃继进救樊城，同属曹营。",
    },
  },
  {
    a: "徐晃",
    b: "吕蒙",
    label: "各为其主",
    eventSummaries: {
      "handong-fanchang": "吕蒙袭取荆州，徐晃破关羽于樊城，关羽后路尽失。",
    },
  },
  {
    a: "徐晃",
    b: "陆逊",
    label: "各为其主",
    eventSummaries: {
      "handong-fanchang": "陆逊佐吕蒙袭荆州，徐晃救樊城，关羽首尾不能相顾。",
    },
  },
  {
    a: "徐晃",
    b: "孙权",
    label: "各为其主",
    eventSummaries: {
      "handong-fanchang": "襄樊之战，孙权称臣于曹操，徐晃救樊城，关羽腹背受敌。",
    },
  },

  // ----- 蜀汉：入蜀、汉中 -----
  {
    a: "刘备",
    b: "庞统",
    label: "君臣",
    description: "庞统号「凤雏」，随刘备入蜀为军师中郎将，取益州之谋多出其手，惜中流矢早卒。",
    eventSummaries: {
      "hanmo-14": "庞统随刘备入蜀，劝取益州，为军师中郎将。",
      "hanmo-17": "刘备围雒城，庞统率众攻城，中流矢卒。",
    },
  },
  {
    a: "刘备",
    b: "法正",
    label: "君臣（谋主）",
    description: "法正原为刘璋属下，迎刘备入蜀后倒戈，为刘备取益州、定汉中的谋主。",
    eventSummaries: {
      "hanmo-14": "法正奉刘璋命迎刘备，旋即归心，为刘备谋取益州。",
      "hanmo-16": "刘备围成都，法正为内应，刘璋出降。",
      "hanmo-18": "定军山之役，法正谋据险要，黄忠因而斩夏侯渊。",
    },
  },
  {
    a: "刘璋",
    b: "法正",
    label: "旧主→叛",
    eventSummaries: {
      "hanmo-14": "法正奉刘璋命迎刘备，旋即劝刘备取益州。",
      "hanmo-16": "刘璋出降，法正为刘备谋主。",
    },
  },
  {
    a: "刘璋",
    b: "庞统",
    label: "敌手",
    eventSummaries: {
      "hanmo-14": "庞统随刘备入蜀，力主取刘璋而代之。",
    },
  },
  {
    a: "刘璋",
    b: "马超",
    label: "敌手",
    eventSummaries: {
      "hanmo-16": "马超引兵屯成都城下，刘璋震恐出降。",
    },
  },
  {
    a: "刘备",
    b: "刘璋",
    label: "主客→反目",
    description: "刘璋迎刘备入蜀拒张鲁，刘备反客为主，终取益州。",
    eventSummaries: {
      "hanmo-14": "刘璋迎刘备入蜀以拒张鲁，刘备反客为主，益州之争起。",
      "hanmo-16": "刘备围成都，刘璋出降，益州归刘备。",
    },
  },
  {
    a: "刘备",
    b: "马超",
    label: "君臣（降将）",
    eventSummaries: {
      "hanmo-16": "马超自汉中归刘备，引兵屯成都城下，刘璋震恐出降。",
      "hanmo-19": "马超领衔上表劝进，刘备称汉中王。",
    },
  },
  {
    a: "马超",
    b: "魏延",
    label: "同僚",
    eventSummaries: {
      "hanmo-19": "同列刘备汉中王劝进表：魏延督汉中、马超领左将军。",
    },
  },
  {
    a: "庞统",
    b: "法正",
    label: "同僚",
    eventSummaries: {
      "hanmo-14": "法正、庞统同为刘备入蜀谋主，并称俊杰。",
    },
  },
  {
    a: "法正",
    b: "马超",
    label: "同僚",
    eventSummaries: {
      "hanmo-16": "法正佐刘备受马超之降，共下成都。",
    },
  },
  {
    a: "法正",
    b: "黄忠",
    label: "同僚",
    eventSummaries: {
      "hanmo-18": "法正谋据定军山，黄忠乘高而下斩夏侯渊。",
    },
  },
  {
    a: "夏侯渊",
    b: "黄忠",
    label: "敌将",
    eventSummaries: {
      "hanmo-18": "定军山，黄忠乘高鼓噪而下，一战斩夏侯渊。",
    },
  },
  {
    a: "夏侯渊",
    b: "法正",
    label: "敌将",
    eventSummaries: {
      "hanmo-18": "法正谋据定军山，诱夏侯渊来争，黄忠因而斩之。",
    },
  },
  {
    a: "刘备",
    b: "黄忠",
    label: "君臣",
    eventSummaries: {
      "hanmo-18": "定军山之战，黄忠随刘备、法正斩夏侯渊，威震汉中。",
    },
  },
  {
    a: "刘备",
    b: "夏侯渊",
    label: "敌将",
    eventSummaries: {
      "hanmo-18": "夏侯渊守汉中，刘备、法正据定军山，黄忠斩渊。",
    },
  },
  {
    a: "刘备",
    b: "魏延",
    label: "君臣（破格）",
    description: "刘备称汉中王，越次拔魏延督汉中，一军皆惊；魏延果能守。",
    eventSummaries: {
      "hanmo-19": "刘备称汉中王，拔魏延为镇远将军、领汉中太守。",
    },
  },
  {
    a: "诸葛亮",
    b: "魏延",
    label: "君臣→分歧",
    description: "魏延为刘备所拔，诸葛亮北伐时二人于出兵方略多有分歧。",
    eventSummaries: {
      "hanmo-19": "诸葛亮与魏延同上表劝进刘备称汉中王。",
    },
  },
  {
    a: "诸葛亮",
    b: "马超",
    label: "同僚",
    eventSummaries: {
      "hanmo-19": "诸葛亮与马超同上表劝进刘备称汉中王。",
    },
  },

  // ----- 群雄、隐士与文士 -----
  {
    a: "刘备",
    b: "司马徽",
    label: "荐贤",
    eventSummaries: {
      "hanmo-10": "司马徽向刘备荐诸葛亮、庞统，称「卧龙」「凤雏」。",
    },
  },
  {
    a: "曹操",
    b: "蔡文姬",
    label: "故人之女",
    description: "蔡琰为蔡邕之女，汉末没入匈奴；曹操念与蔡邕旧交，以金璧赎归。",
    eventSummaries: {
      "hanmo-11": "曹操遣使以金璧赎蔡琰于匈奴，归而嫁于董祀。",
    },
  },
  {
    a: "曹操",
    b: "华佗",
    label: "医患→被杀",
    eventSummaries: {
      "hanmo-13": "曹操召华佗治头风，佗归家不返，被下狱拷死。",
    },
  },
  {
    a: "刘表",
    b: "曹操",
    label: "敌国→降",
    eventSummaries: {
      "hanmo-12": "曹操南征，刘表病卒，子刘琮举荆州降曹。",
    },
  },
  {
    a: "公孙瓒",
    b: "刘备",
    label: "同门→依附",
    eventSummaries: {
      "hanmo-02": "刘备与公孙瓒同师卢植，往依之，为其别部司马，后领平原相。",
    },
  },
  {
    a: "公孙瓒",
    b: "袁绍",
    label: "死敌",
    eventSummaries: {
      "hanmo-08": "袁绍围易京，公孙瓒自焚而死，幽州尽归袁绍。",
    },
  },
  {
    a: "刘表",
    b: "袁术",
    label: "敌对",
    eventSummaries: {
      "hanmo-01": "袁术遣孙坚攻刘表，孙坚战死，两家结怨。",
    },
  },

  // ===== V0.6.3：先秦（夏、商、西周）29 对 =====
  {
    a: "尧",
    b: "鲧",
    label: "君臣",
    eventSummaries: {
      "xia-01": "尧用鲧治水，九年而功不成，鲧被殛于羽山。",
    },
  },
  {
    a: "舜",
    b: "禹",
    label: "君臣（禅让）",
    description: "舜命禹继鲧治水，禹功成而受禅；「舜禹禅让」为后世儒家所称道。",
    eventSummaries: {
      "xia-02": "舜命禹继父治水，禹疏川导滞，十三年而水患平。",
      "xia-04": "舜禅位于禹，禹即天子位，夏朝建立。",
    },
  },
  {
    a: "后羿",
    b: "太康",
    label: "篡位",
    eventSummaries: {
      "xia-07": "太康失德，后羿因夏民以代夏政，太康失国。",
    },
  },
  {
    a: "寒浞",
    b: "少康",
    label: "仇敌",
    eventSummaries: {
      "xia-09": "寒浞杀后羿而篡其位，少康收夏众、灭寒浞，夏室中兴。",
    },
  },
  {
    a: "夏桀",
    b: "商汤",
    label: "敌国（革命）",
    description: "夏桀囚汤于夏台，汤归于亳后举兵伐桀，鸣条一战放桀于南巢，夏亡。",
    eventSummaries: {
      "xia-12": "夏桀暴虐，召汤而囚之于夏台，诸侯多叛。",
      "shang-02": "汤率诸侯伐桀于鸣条，夏师败绩。",
      "xia-13": "鸣条之战夏桀败走，夏亡，商汤代立。",
    },
  },
  {
    a: "商汤",
    b: "伊尹",
    label: "君臣（开国）",
    description: "伊尹以媵臣见汤，佐汤灭夏立商；汤崩后伊尹摄政，放太甲而终归其政。",
    eventSummaries: {
      "shang-01": "伊尹辅商汤修德用贤，为灭夏立商之谋主。",
      "shang-02": "伊尹佐商汤伐桀于鸣条，夏亡。",
      "shang-03": "汤践天子位，商朝建立，伊尹为相。",
      "xia-13": "鸣条之战，伊尹佐商汤破夏桀。",
    },
  },
  {
    a: "夏桀",
    b: "伊尹",
    label: "敌手",
    eventSummaries: {
      "shang-02": "伊尹佐商汤伐夏桀，鸣条之战夏师溃败。",
      "xia-13": "伊尹与商汤共灭夏桀。",
    },
  },
  {
    a: "伊尹",
    b: "太甲",
    label: "君臣（放逐还政）",
    eventSummaries: {
      "shang-04": "太甲不遵汤法，伊尹放之于桐宫，三年悔过乃迎归复位。",
    },
  },
  {
    a: "武丁",
    b: "傅说",
    label: "君臣",
    description: "武丁梦得贤人，求之于傅岩，得傅说，举以为相，殷道复兴。",
    eventSummaries: {
      "shang-08": "武丁举傅说为相，修德安民，殷道复兴，史称武丁中兴。",
    },
  },
  {
    a: "商纣王",
    b: "妲己",
    label: "宠妃",
    eventSummaries: {
      "shang-11": "纣王宠妲己，酒池肉林，炮烙之刑，诸侯离心。",
    },
  },
  {
    a: "商纣王",
    b: "比干",
    label: "君臣（死谏）",
    eventSummaries: {
      "shang-14": "比干强谏纣王，纣怒曰「吾闻圣人心有七窍」，剖而观之。",
    },
  },
  {
    a: "商纣王",
    b: "微子",
    label: "君臣（去殷）",
    eventSummaries: {
      "shang-14": "微子数谏不听，惧祸出奔，后归周封于宋。",
    },
  },
  {
    a: "比干",
    b: "微子",
    label: "同僚",
    eventSummaries: {
      "shang-14": "比干死谏、微子去殷，同为殷末三仁之列。",
    },
  },
  {
    a: "商纣王",
    b: "周文王",
    label: "君臣→囚",
    description: "文王为西伯而事纣，因崇侯虎之谗被囚羑里，获释后阴修德政，周势渐强。",
    eventSummaries: {
      "shang-10": "纣囚西伯昌于羑里，周人献美女良马乃得释。",
    },
  },
  {
    a: "周文王",
    b: "姜子牙",
    label: "君臣（太公遇文王）",
    description: "姜尚钓于渭水，文王载与俱归，立为师；文王、武王两世皆倚之。",
    eventSummaries: {
      "shang-13": "文王出猎渭水之滨，遇姜尚，与语大悦，载与俱归，尊为太公望。",
    },
  },
  {
    a: "商纣王",
    b: "姜子牙",
    label: "敌手",
    eventSummaries: {
      "xizhou-01": "牧野之战，姜尚佐武王伐纣，商军倒戈，纣自焚。",
    },
  },
  {
    a: "周武王",
    b: "姜子牙",
    label: "君臣（师尚父）",
    description: "姜尚为武王师，牧野之战亲率虎贲先陷阵，号称「师尚父」。",
    eventSummaries: {
      "shang-15": "武王观兵盟津，姜尚佐之，诸侯会者八百。",
      "xizhou-01": "牧野之战，姜尚率虎贲先登，商军倒戈，纣王自焚。",
      "xizhou-02": "周初封建，姜尚封于齐，与周室功臣并土。",
    },
  },
  {
    a: "商纣王",
    b: "周武王",
    label: "敌国（革命）",
    eventSummaries: {
      "xizhou-01": "武王伐纣，牧野一战商亡，纣王登鹿台自焚。",
    },
  },
  {
    a: "周武王",
    b: "周公旦",
    label: "兄弟（辅弼）",
    description: "周公旦为武王同母弟，佐武王克商；武王崩后摄政辅成王。",
    eventSummaries: {
      "xizhou-02": "武王封建诸侯，周公旦与太公望同受封土，周公封于鲁。",
    },
  },
  {
    a: "周公旦",
    b: "姜子牙",
    label: "同僚",
    eventSummaries: {
      "xizhou-02": "周初分封，周公旦封鲁、太公望封齐，并为周室柱石。",
    },
  },
  {
    a: "周武王",
    b: "箕子",
    label: "君臣（访贤）",
    eventSummaries: {
      "xizhou-03": "武王克商后访箕子，箕子陈《洪范》九畴，后封于朝鲜。",
    },
  },
  {
    a: "周公旦",
    b: "周成王",
    label: "叔侄（摄政）",
    description: "武王崩，成王年幼，周公摄政七年，东征平乱、营洛邑，而后还政。",
    eventSummaries: {
      "xizhou-04": "周公摄行政事，践阼代成王理国，以安周室。",
      "xizhou-06": "成康之际天下安宁，周公之制垂范后世。",
      "xizhou-08": "周公还政于成王，北面就臣位。",
      "xizhou-09": "周公营建洛邑，成王定鼎于郏鄏。",
    },
  },
  {
    a: "周公旦",
    b: "管叔",
    label: "兄弟→反目",
    eventSummaries: {
      "xizhou-05": "管叔疑周公不利于成王，与蔡叔、武庚作乱，周公东征诛之。",
    },
  },
  {
    a: "周公旦",
    b: "蔡叔",
    label: "兄弟→反目",
    eventSummaries: {
      "xizhou-05": "蔡叔与管叔同叛，周公东征，蔡叔被放逐。",
    },
  },
  {
    a: "管叔",
    b: "蔡叔",
    label: "同谋",
    eventSummaries: {
      "xizhou-05": "管叔、蔡叔挟武庚作乱，周公东征三年而定。",
    },
  },
  {
    a: "周公旦",
    b: "周康王",
    label: "君臣（辅政）",
    eventSummaries: {
      "xizhou-06": "周公制礼作乐，成王、康王相继守之，刑错四十余年不用。",
    },
  },
  {
    a: "周成王",
    b: "周康王",
    label: "父子",
    eventSummaries: {
      "xizhou-06": "成王崩，康王继位，天下安宁，史称成康之治。",
    },
  },
  {
    a: "周厉王",
    b: "共伯和",
    label: "代政",
    eventSummaries: {
      "xizhou-17": "厉王出奔，共伯和摄行天子事，号共和，为确切纪年之始。",
    },
  },
  {
    a: "周幽王",
    b: "褒姒",
    label: "夫妻（宠幸）",
    eventSummaries: {
      "xizhou-21": "幽王宠褒姒，废申后及太子，烽火戏诸侯，终致犬戎之祸。",
    },
  },

  // ===== V0.6.3：楚汉争霸 24 对 =====
  {
    a: "项梁",
    b: "项羽",
    label: "叔侄",
    description: "项梁为项羽季父，起兵会稽，项梁战死后项羽继领其众，遂有巨鹿之捷。",
    eventSummaries: {
      "qin-liubang-xiangliang": "项梁起兵于会稽，项羽从之；项梁渡江立楚怀王，为反秦盟主。",
    },
  },
  {
    a: "项梁",
    b: "刘邦",
    label: "同盟",
    eventSummaries: {
      "qin-liubang-xiangliang": "刘邦起于沛，往依项梁，项梁益其兵，使西略地。",
    },
  },
  {
    a: "范增",
    b: "项羽",
    label: "君臣（亚父）",
    description: "范增年七十事项梁，后为项羽谋主，项羽尊为「亚父」；鸿门之谋不用，终遭疑而去。",
    eventSummaries: {
      "xihan-hongmen": "范增劝项羽于鸿门宴上杀刘邦，项羽犹豫不决，刘邦脱身而去。",
    },
  },
  {
    a: "范增",
    b: "刘邦",
    label: "敌手",
    eventSummaries: {
      "xihan-hongmen": "范增数举玉玦示意项羽杀刘邦，又令项庄舞剑，终未得手。",
    },
  },
  {
    a: "范增",
    b: "项庄",
    label: "同谋",
    eventSummaries: {
      "xihan-hongmen": "范增召项庄舞剑，欲因击刘邦于坐。",
    },
  },
  {
    a: "范增",
    b: "项伯",
    label: "同僚→相左",
    eventSummaries: {
      "xihan-hongmen": "项伯夜驰告张良，又以身翼蔽刘邦，与范增之谋相左。",
    },
  },
  {
    a: "范增",
    b: "樊哙",
    label: "同席交锋",
    eventSummaries: {
      "xihan-hongmen": "樊哙带剑拥盾闯帐，力陈刘邦之功，范增之谋益不能行。",
    },
  },
  {
    a: "章邯",
    b: "周章",
    label: "敌手",
    eventSummaries: {
      "qin-zhanghan": "章邯赦骊山刑徒击周章军，周章败走，后自杀。",
    },
  },
  {
    a: "章邯",
    b: "陈胜",
    label: "敌手",
    eventSummaries: {
      "qin-zhanghan": "章邯破陈胜部将周章，又连破陈胜军，陈胜败亡。",
    },
  },
  {
    a: "章邯",
    b: "胡亥",
    label: "君臣",
    eventSummaries: {
      "qin-zhanghan": "秦二世赦骊山刑徒，命章邯击山东群盗，屡破之。",
    },
  },
  {
    a: "章邯",
    b: "赵歇",
    label: "敌手",
    eventSummaries: {
      "qin-julu-battle": "章邯围赵歇于巨鹿，诸侯救赵者皆壁观。",
    },
  },
  {
    a: "章邯",
    b: "王离",
    label: "同僚",
    eventSummaries: {
      "qin-julu-battle": "章邯、王离分统秦军围巨鹿，项羽破釜沉舟，王离被擒。",
    },
  },
  {
    a: "章邯",
    b: "苏角",
    label: "同僚",
    eventSummaries: {
      "qin-julu-battle": "巨鹿之战，秦将苏角战死，章邯退守棘原。",
    },
  },
  {
    a: "章邯",
    b: "项羽",
    label: "降将",
    description: "巨鹿之后章邯进退失据，率二十万众降项羽于殷墟，秦军主力尽没。",
    eventSummaries: {
      "qin-julu-battle": "项羽破釜沉舟，九战绝甬道，章邯退军，秦军大败。",
    },
  },
  {
    a: "陈平",
    b: "刘邦",
    label: "君臣（谋主）",
    description: "陈平自项羽处归汉，六出奇计安汉室：离间楚君臣、解白登之围、擒韩信、诛诸吕。",
    eventSummaries: {
      "xihan-yunmeng": "陈平献「伪游云梦」之策，刘邦因擒韩信于陈。",
      "xihan-baideng": "白登之围，陈平献秘计，使冒顿阏氏劝单于解围。",
    },
  },
  {
    a: "陈平",
    b: "韩信",
    label: "同僚→构陷",
    eventSummaries: {
      "xihan-yunmeng": "陈平为刘邦画策，伪游云梦，诱擒楚王韩信。",
    },
  },
  {
    a: "陈平",
    b: "钟离眛",
    label: "敌手",
    eventSummaries: {
      "xihan-yunmeng": "钟离眛亡命投韩信，汉以云梦之计索之，眛自刭。",
    },
  },
  {
    a: "陈平",
    b: "冒顿单于",
    label: "敌国",
    eventSummaries: {
      "xihan-baideng": "白登之围，陈平行秘计解围，汉与匈奴结和亲。",
    },
  },
  {
    a: "陈平",
    b: "刘敬",
    label: "同僚",
    eventSummaries: {
      "xihan-baideng": "刘敬使匈奴还，谏勿击，刘邦不听而困于白登；陈平亦在军中画策。",
    },
  },
  {
    a: "陈平",
    b: "韩王信",
    label: "敌国",
    eventSummaries: {
      "xihan-baideng": "韩王信降匈奴，引兵围刘邦于白登，陈平画策解围。",
    },
  },
  {
    a: "陈平",
    b: "吕后",
    label: "君臣（曲从）",
    eventSummaries: {
      "xihan-zhulv": "吕后崩，陈平、周勃合谋诛诸吕，迎立代王刘恒。",
    },
  },
  {
    a: "陈平",
    b: "刘襄",
    label: "政敌",
    eventSummaries: {
      "xihan-zhulv": "齐王刘襄举兵讨诸吕，陈平等不欲其入继，卒立代王。",
    },
  },
  {
    a: "陈平",
    b: "刘恒",
    label: "君臣",
    eventSummaries: {
      "xihan-zhulv": "陈平、周勃诛诸吕后，迎代王刘恒为文帝。",
    },
  },
  {
    a: "陈平",
    b: "周勃",
    label: "同僚",
    description: "陈平、周勃将相合谋，卒安刘氏；文帝时陈平让右丞相于周勃。",
    eventSummaries: {
      "xihan-zhulv": "陈平与太尉周勃合谋，尽诛诸吕，汉室复安。",
    },
  },

  // ===== V0.6.4：魏晋南北朝（据 docs/史脉_第一批_魏晋南北朝.md 解析；含 37 对补全关系）=====
  {
    a: "司马懿",
    b: "司马师",
    label: "父子（继业）",
    description: "司马师为司马懿长子，阴养死士三千散在人间；高平陵之变一夜集兵，助父夺权。",
    eventSummaries: {
      "sanguo-08": "司马懿发动高平陵之变诛曹爽，司马师参与预谋，奠定司马氏专魏基础。",
    },
  },
  {
    a: "司马师",
    b: "司马昭",
    label: "兄弟（传承）",
    description: "司马师无子，以司马昭次子司马攸为嗣，临终以大将军印授昭，兄弟相继专魏。",
    eventSummaries: {
      "weijin-simashi-zhuanquan": "司马师无子嗣，以司马昭次子司马攸为嗣，病逝后权力过渡至司马昭。",
    },
  },
  {
    a: "司马师",
    b: "曹芳",
    label: "权臣与废帝",
    eventSummaries: {
      "weijin-feicaofang": "司马师废黜魏帝曹芳，另立曹髦，进一步架空曹魏皇权。",
    },
  },
  {
    a: "司马昭",
    b: "司马炎",
    label: "父子（代魏）",
    description: "司马昭封晋王、立炎为世子；昭卒，炎继晋王位，旋受魏禅建晋。",
    eventSummaries: {
      "weijin-fengjinwang": "司马昭灭蜀后封晋王加九锡，为司马炎代魏称帝铺平道路。",
      "xijin-01": "司马炎逼曹奂禅位，建立西晋，改元泰始，终结曹魏。",
    },
  },
  {
    a: "司马昭",
    b: "曹奂",
    label: "权臣与傀儡",
    eventSummaries: {
      "weijin-shmaohuan": "司马昭部下成济弑魏帝曹髦，另立曹奂为傀儡皇帝。",
    },
  },
  {
    a: "嵇康",
    b: "阮籍",
    label: "文友（竹林七贤）",
    description: "同为竹林七贤领袖，嵇康刚直、阮籍放达；嵇康死后，阮籍佯狂避祸。",
    eventSummaries: {
      "weijin-zhulin": "嵇康与阮籍等游于竹林，崇尚清谈，开魏晋玄学之风。",
    },
  },
  {
    a: "阮籍",
    b: "司马昭",
    label: "避祸（醉酒）",
    eventSummaries: {
      "weijin-dazui": "司马昭欲与阮籍联姻，阮籍大醉六十日避之，司马昭无奈作罢。",
    },
  },
  {
    a: "司马炎",
    b: "羊祜",
    label: "君臣（灭吴）",
    description: "羊祜为武帝朝镇荆州重臣，临终荐杜预自代，平吴之策实由祜发。",
    eventSummaries: {
      "weijin-jingzhou": "羊祜镇守襄阳经营荆州，临终荐杜预继任，为西晋灭吴做准备。",
    },
  },
  {
    a: "司马炎",
    b: "贾南风",
    label: "婆媳（祸根）",
    description: "武帝为痴愚太子司马衷娶贾充女南风，贾氏妒悍多权，遂乱晋室。",
    eventSummaries: {
      "weijin-taizifei": "司马炎立痴愚太子司马衷，选贾南风为太子妃，埋下八王之乱祸根。",
    },
  },
  {
    a: "贾南风",
    b: "司马衷",
    label: "夫妻（专政）",
    description: "惠帝不慧，贾后专政近十年，终启八王之乱。",
    eventSummaries: {
      "xijin-03": "贾南风为司马衷皇后，帝痴愚，贾后擅权专政近十年。",
    },
  },
  {
    a: "贾南风",
    b: "司马伦",
    label: "政敌（被废）",
    description: "赵王司马伦矫诏废贾后、诛其党，旋自立为帝，八王之乱全面爆发。",
    eventSummaries: {
      "xijin-04": "赵王司马伦发动政变废杀贾南风，八王之乱由此全面爆发。",
    },
  },
  {
    a: "羊祜",
    b: "陆抗",
    label: "对手（德交）",
    description: "两人隔江对峙，互赠药酒不疑，交兵而不失礼，为后世所称。",
    eventSummaries: {
      "weijin-yanglu": "羊祜与东吴陆抗对峙荆州，以德服人互赠药酒，传为佳话。",
    },
  },
  {
    a: "羊祜",
    b: "杜预",
    label: "前后任（灭吴）",
    description: "羊祜临终举杜预自代；杜预依其方略，终成灭吴之功。",
    eventSummaries: {
      "xijin-02": "羊祜临终上《平吴疏》荐杜预，杜预后以此策灭东吴统一天下。",
    },
  },
  {
    a: "石崇",
    b: "王恺",
    label: "政敌（斗富）",
    description: "石崇与王恺争豪，武帝助恺犹不能胜，西晋奢靡之极。",
    eventSummaries: {
      "weijin-doufu": "石崇与王恺斗富，晋武帝暗助王恺仍败，折射西晋奢靡之风。",
    },
  },
  {
    a: "石崇",
    b: "潘岳",
    label: "文友（附权）",
    description: "潘岳依附贾谧，与石崇同为「金谷二十四友」；后同被孙秀所害。",
    eventSummaries: {
      "weijin-jingu": "石崇建金谷园，与潘岳等结\"金谷二十四友\"，依附贾谧。",
    },
  },
  {
    a: "陆机",
    b: "陆云",
    label: "兄弟（入洛）",
    description: "二陆入洛，文名冠世；同遇谗，同被害。",
    eventSummaries: {
      "weijin-erlu": "陆机、陆云兄弟自吴入洛阳，以文才名动京师，张华叹为\"二俊\"。",
    },
  },
  {
    a: "陆机",
    b: "司马颖",
    label: "君臣（冤杀）",
    description: "陆机受成都王司马颖之命都督前锋，兵败受谗，与弟陆云同被害。",
    eventSummaries: {
      "xijin-04": "陆机依附成都王司马颖，兵败被诬谋反，与弟陆云同遭冤杀。",
    },
  },
  {
    a: "王导",
    b: "司马睿",
    label: "君臣（开国）",
    description: "王导辅司马睿南渡建康，联合南北士族，时称「王与马，共天下」。",
    eventSummaries: {
      "dongjin-01": "王导辅佐司马睿南渡建康，联合南北士族建立东晋，\"王与马共天下\"。",
    },
  },
  {
    a: "王导",
    b: "王敦",
    label: "堂兄弟（平叛）",
    description: "王敦为王导从兄，起兵清君侧，王导率宗族待罪阙下；敦死后王氏仍盛。",
    eventSummaries: {
      "dongjin-02": "王敦以诛刘隗为名起兵，王导暗中周旋维护东晋，最终平定叛乱。",
    },
  },
  {
    a: "谢安",
    b: "谢玄",
    label: "叔侄（抗敌）",
    description: "谢安为叔、谢玄为侄；安举玄组建北府兵，并主持淝水军事，以少胜多。",
    eventSummaries: {
      "dongjin-07": "谢安命谢玄率北府兵迎敌，以八万兵力大败前秦百万大军。",
      "weijin-beifu": "谢玄在广陵招募流民组建北府兵，成为淝水之战破敌主力。",
    },
  },
  {
    a: "谢安",
    b: "苻坚",
    label: "对手（决战）",
    description: "淝水两岸决战：谢安坐镇建康，苻坚百万之众溃于八万北府兵。",
    eventSummaries: {
      "dongjin-07": "苻坚率百万大军南下，谢安镇定指挥，前秦军大败崩溃，北方再度分裂。",
    },
  },
  {
    a: "谢玄",
    b: "刘牢之",
    label: "上下级（先锋）",
    description: "刘牢之为谢玄麾下北府兵前锋，淝水之战率精兵突阵，北伐屡为先锋。",
    eventSummaries: {
      "weijin-xiexuan-beifa": "谢玄麾下刘牢之率精兵北伐，收复黄河以南大片土地。",
    },
  },
  {
    a: "桓温",
    b: "殷浩",
    label: "政敌（北伐）",
    description: "桓温与殷浩争权，殷浩北伐屡败，桓温借机上书废之，独揽朝政。",
    eventSummaries: {
      "weijin-feiyinhao": "桓温以北伐为由逼废殷浩，独揽东晋军政大权。",
    },
  },
  {
    a: "桓温",
    b: "王猛",
    label: "未用（访贤）",
    description: "王猛扪虱而谈，桓温奇其才而不敢用；猛遂归苻坚，佐前秦统一北方。",
    eventSummaries: {
      "weijin-menshi": "桓温北伐至关中，王猛扪虱而谈，桓温不能用，王猛后归前秦。",
    },
  },
  {
    a: "王羲之",
    b: "王献之",
    label: "父子（书法）",
    description: "羲之、献之父子俱善书，后世并称「二王」。",
    eventSummaries: {
      "weijin-erwang": "王羲之、王献之父子并称\"二王\"，影响中国书法千年。",
    },
  },
  {
    a: "王羲之",
    b: "谢安",
    label: "文友（集会）",
    description: "同游兰亭，羲之作《兰亭集序》，谢安与焉。",
    eventSummaries: {
      "dongjin-04": "王羲之与谢安等四十二人会于兰亭，作《兰亭集序》传世。",
    },
  },
  {
    a: "祖逖",
    b: "刘琨",
    label: "战友（立志）",
    description: "少时同寝，闻鸡起舞，相约以中原为念。",
    eventSummaries: {
      "weijin-wenji": "祖逖与刘琨少时同寝，闻鸡起舞，立志北伐中原收复失地。",
    },
  },
  {
    a: "祖逖",
    b: "司马睿",
    label: "君臣（北伐）",
    description: "祖逖请缨北伐，元帝仅给千人粮饷，逖中流击楫而渡。",
    eventSummaries: {
      "weijin-zhongliu": "祖逖请缨北伐，司马睿仅给千人粮饷，祖逖中流击楫渡江北伐。",
    },
  },
  {
    a: "陶渊明",
    b: "檀道济",
    label: "拒荐（归隐）",
    description: "檀道济为江州刺史，亲往劝陶渊明出仕，渊明以「不为五斗米折腰」辞之。",
    eventSummaries: {
      "weijin-wudoumi": "檀道济劝陶渊明出仕被拒，陶渊明辞彭泽令归隐田园。",
    },
  },
  {
    a: "陶渊明",
    b: "刘裕",
    label: "隐逸（易代）",
    description: "陶渊明归隐之际，刘裕代晋建宋，渊明以遗民自处，不复出仕。",
    eventSummaries: {
      "weijin-guiyin": "陶渊明归隐田园适逢刘裕代晋建宋，隐居著书终老。",
    },
  },
  {
    a: "苻坚",
    b: "王猛",
    label: "君臣（治国）",
    description: "苻坚得王猛，委以国政，猛整吏治、抑豪强，前秦遂强。",
    eventSummaries: {
      "dongjin-06": "苻坚重用王猛推行汉化改革，前秦迅速强大，统一北方。",
      "weijin-zhiguo": "王猛辅佐苻坚整顿吏治，推行汉化，前秦从弱小走向统一北方。",
    },
  },
  {
    a: "苻坚",
    b: "谢玄",
    label: "对手（决战）",
    description: "淝水之战，谢玄以八万北府兵破苻坚百万之众，前秦由盛转衰。",
    eventSummaries: {
      "dongjin-07": "苻坚率百万大军南下攻晋，谢玄以八万北府兵破之，前秦崩溃。",
    },
  },
  {
    a: "刘裕",
    b: "桓玄",
    label: "政敌（平叛）",
    description: "桓玄篡晋，刘裕起兵讨平、复安帝位，功望日隆，终代晋建宋。",
    eventSummaries: {
      "dongjin-09": "刘裕起兵讨灭篡位的桓玄，恢复东晋，后以此功代晋建宋。",
    },
  },
  {
    a: "刘裕",
    b: "刘义隆",
    label: "父子（继承）",
    description: "刘裕卒，太子刘义隆继位，改元元嘉，江左称治。",
    eventSummaries: {
      "weijin-yuanjia": "刘裕建立刘宋，其子刘义隆继位，开创\"元嘉之治\"。",
    },
  },
  {
    a: "萧衍",
    b: "侯景",
    label: "养虎为患（叛乱）",
    description: "梁武帝纳侯景之降，侯景旋反，攻陷台城，武帝饿死，江南残破。",
    eventSummaries: {
      "nanbeichao-08": "萧衍收降侯景，侯景反叛攻破建康，萧衍饿死台城，南梁由盛转衰。",
    },
  },
  {
    a: "萧衍",
    b: "陈庆之",
    label: "君臣（北伐）",
    description: "梁武帝遣陈庆之护送元颢北还，白袍军七千连下三十二城。",
    eventSummaries: {
      "weijin-baipao": "萧衍遣陈庆之护送元颢北归，七千白袍军连克三十二城。",
    },
  },
  {
    a: "陈庆之",
    b: "尔朱荣",
    label: "对手（交锋）",
    description: "陈庆之孤军入洛，尔朱荣反攻，庆之兵败渡河，仅以身免。",
    eventSummaries: {
      "weijin-luoyang": "陈庆之北伐遭北魏尔朱荣反攻，孤军深入终败退南归。",
    },
  },
  {
    a: "侯景",
    b: "高澄",
    label: "叛将（叛逃）",
    description: "侯景不服高澄，举河南叛，为东魏军所败，南奔梁朝。",
    eventSummaries: {
      "weijin-houjing-pan": "高欢死后侯景不服高澄，举兵叛乱被击败，南奔投靠萧衍。",
    },
  },
  {
    a: "拓跋珪",
    b: "慕容垂",
    label: "对手（争霸）",
    description: "参合陂一役，北魏大破后燕；慕容垂病中闻败，惭愤而卒。",
    eventSummaries: {
      "weijin-canhebei": "拓跋珪在参合陂大败后燕军，后燕由盛转衰，北魏奠定北方霸业。",
    },
  },
  {
    a: "拓跋珪",
    b: "拓跋嗣",
    label: "父子（继位）",
    description: "拓跋珪晚年暴虐被杀，拓跋嗣平乱继位，北魏遂安。",
    eventSummaries: {
      "dongjin-08": "拓跋珪建国号魏，晚年暴虐被杀，子拓跋嗣平乱继位。",
    },
  },
  {
    a: "冯太后",
    b: "孝文帝",
    label: "祖孙（改革）",
    description: "冯太后临朝称制，抚育拓跋宏，祖孙相继推行太和改制。",
    eventSummaries: {
      "nanbeichao-03": "冯太后临朝称制，与孝文帝推行班禄制、均田制，加速北魏汉化。",
    },
  },
  {
    a: "冯太后",
    b: "献文帝",
    label: "母子（权争）",
    description: "冯太后与献文帝争权，遂鸩杀之，立其孙拓跋宏。",
    eventSummaries: {
      "weijin-linchao": "冯太后逼献文帝禅位，以太皇太后身份临朝，掌控北魏朝政。",
    },
  },
  {
    a: "孝文帝",
    b: "拓跋恂",
    label: "父子（废储）",
    description: "孝文帝迁都洛阳，太子拓跋恂谋逃归平城，被废赐死。",
    eventSummaries: {
      "nanbeichao-04": "孝文帝迁都洛阳推行汉化，太子拓跋恂逃归平城，被废赐死。",
    },
  },
  {
    a: "高欢",
    b: "宇文泰",
    label: "对手（东西对峙）",
    description: "高欢、宇文泰分掌东西魏，沙苑、邙山屡战，终成东西对峙。",
    eventSummaries: {
      "nanbeichao-07": "高欢立元善见建东魏，宇文泰立元宝炬建西魏，北魏正式分裂。",
      "weijin-shayuan": "宇文泰以一万人马大败高欢二十万大军，巩固西魏。",
    },
  },
  {
    a: "高欢",
    b: "高澄",
    label: "父子（传承）",
    description: "高欢卒，高澄继掌东魏，未几遇刺，弟高洋遂代魏建齐。",
    eventSummaries: {
      "weijin-bohaiwang": "高欢总揽东魏大权封渤海王，长子高澄继掌朝政。",
    },
  },
  {
    a: "宇文泰",
    b: "苏绰",
    label: "君臣（改革）",
    description: "苏绰佐宇文泰行六条诏书、创府兵制，西魏由弱转强。",
    eventSummaries: {
      "weijin-liutiao": "苏绰辅佐宇文泰推行六条诏书，创立府兵制，奠定北周基业。",
    },
  },
  {
    a: "宇文邕",
    b: "宇文宪",
    label: "兄弟（灭齐）",
    description: "周武帝与弟宇文宪东征灭齐，宪功最高，后为宣帝所忌赐死。",
    eventSummaries: {
      "nanbeichao-10": "宇文邕与弟宇文宪率军攻灭北齐，统一北方。",
    },
  },
  {
    a: "宇文邕",
    b: "杨坚",
    label: "亲家（外戚）",
    description: "杨坚女为周宣帝皇后，坚以外戚辅政；宣帝崩，坚受遗诏辅幼主，终代周建隋。",
    eventSummaries: {
      "weijin-beizhou-waiqi": "宇文邕娶杨坚女为太子妃，杨坚由此势大，后篡周建隋。",
    },
  },
  {
    a: "苏绰",
    b: "卢辩",
    label: "同僚（制礼）",
    description: "苏绰、卢辩先后依《周礼》定六官，为北周制度所本。",
    eventSummaries: {
      "weijin-beizhou-guanzhi": "苏绰与卢辩共同仿《周礼》制定六官制度，影响后世官制。",
    },
  },
  {
    a: "司马师",
    b: "曹爽",
    label: "政敌（权争）",
    description: "曹爽排挤司马懿父子，司马师阴养死士；高平陵之变中司马师率众助父夺权，曹爽集团覆灭。",
    eventSummaries: {
      "sanguo-08": "司马师预谋高平陵之变，率死士控制洛阳，助父诛曹爽。",
    },
  },
  {
    a: "桓温",
    b: "谢安",
    label: "征辟（幕府）",
    description: "谢安四十余始出仕，应桓温之辟为司马；桓温卒后，谢安执政，力主抗秦。",
    eventSummaries: {
      "weijin-xiean-huanwen": "桓温镇姑孰，辟谢安为司马，谢安由此入仕。",
    },
  },
  {
    a: "苻坚",
    b: "苻融",
    label: "兄弟（宗室）",
    description: "苻融为苻坚之弟，淝水之战任前锋都督，战死阵中。",
    eventSummaries: {
      "dongjin-07": "苻融随苻坚南下，淝水阵前马倒被杀，秦军遂溃。",
    },
  },
  {
    a: "苻融",
    b: "谢安",
    label: "对手（淝水）",
    eventSummaries: {
      "dongjin-07": "苻融为秦军前锋，与谢安所遣北府兵决战于淝水，兵败身死。",
    },
  },
  {
    a: "苻融",
    b: "谢玄",
    label: "对手（淝水）",
    eventSummaries: {
      "dongjin-07": "谢玄率北府兵渡淝水突击，苻融马倒被杀，秦军大溃。",
    },
  },
  {
    a: "苻坚",
    b: "慕容暐",
    label: "敌国→降臣",
    eventSummaries: {
      "dongjin-06": "王猛破邺城，前燕亡，慕容暐被俘归前秦。",
    },
  },
  {
    a: "石勒",
    b: "刘曜",
    label: "对手（灭前赵）",
    eventSummaries: {
      "dongjin-03": "石勒与刘曜战于洛阳，俘刘曜、灭前赵，统一北方大部。",
    },
  },
  {
    a: "刘裕",
    b: "司马德宗",
    label: "君臣（讨玄）",
    eventSummaries: {
      "dongjin-09": "桓玄废安帝自立，刘裕起兵讨玄，安帝复位。",
    },
  },
  {
    a: "刘裕",
    b: "王镇恶",
    label: "君臣（北伐）",
    eventSummaries: {
      "dongjin-10": "刘裕北伐后秦，王镇恶率水军破潼关、入长安。",
    },
  },
  {
    a: "刘裕",
    b: "姚泓",
    label: "敌国（灭秦）",
    eventSummaries: {
      "dongjin-10": "后秦主姚泓出降，国亡；刘裕收复两京。",
    },
  },
  {
    a: "王羲之",
    b: "孙绰",
    label: "同游（兰亭）",
    eventSummaries: {
      "dongjin-04": "兰亭雅集，孙绰与王羲之同游赋诗，羲之作序。",
    },
  },
  {
    a: "谢安",
    b: "孙绰",
    label: "同游（兰亭）",
    eventSummaries: {
      "dongjin-04": "兰亭雅集四十二人，谢安、孙绰与王羲之同游。",
    },
  },
  {
    a: "司马炎",
    b: "曹奂",
    label: "禅代",
    eventSummaries: {
      "xijin-01": "司马炎受魏元帝曹奂禅让，代魏建晋。",
    },
  },
  {
    a: "司马炎",
    b: "王濬",
    label: "君臣（平吴）",
    eventSummaries: {
      "xijin-02": "王濬自益州顺流而下，破铁锁横江，直抵建业。",
    },
  },
  {
    a: "司马炎",
    b: "杜预",
    label: "君臣（平吴）",
    eventSummaries: {
      "xijin-02": "杜预继羊祜镇荆州，六路伐吴，克江陵。",
    },
  },
  {
    a: "司马炎",
    b: "孙皓",
    label: "敌国→降君",
    eventSummaries: {
      "xijin-02": "晋军六路并进，吴主孙皓出降，三国归晋。",
    },
  },
  {
    a: "司马炎",
    b: "杨骏",
    label: "君臣（外戚）",
    eventSummaries: {
      "xijin-03": "武帝崩，外戚杨骏受遗辅政，旋为贾后所诛。",
    },
  },
  {
    a: "杜预",
    b: "王濬",
    label: "同僚（平吴）",
    eventSummaries: {
      "xijin-02": "杜预取荆州、王濬下巴蜀，会师建业灭吴。",
    },
  },
  {
    a: "贾南风",
    b: "司马亮",
    label: "政敌",
    eventSummaries: {
      "xijin-04": "贾后使楚王玮杀汝南王亮，旋又以擅杀罪诛玮。",
    },
  },
  {
    a: "贾南风",
    b: "司马玮",
    label: "同谋→反目",
    eventSummaries: {
      "xijin-04": "贾后借楚王玮之手诛杨骏、亮、瓘，再杀玮以谢天下。",
    },
  },
  {
    a: "司马亮",
    b: "司马玮",
    label: "宗室（相攻）",
    eventSummaries: {
      "xijin-04": "司马玮受贾后之命杀司马亮，旋被贾后所杀。",
    },
  },
  {
    a: "司马炎",
    b: "石崇",
    label: "君臣（助恺）",
    eventSummaries: {
      "weijin-doufu": "武帝助王恺与石崇斗富，犹不能胜，西晋奢靡成风。",
    },
  },
  {
    a: "刘裕",
    b: "司马德文",
    label: "禅代",
    eventSummaries: {
      "nanbeichao-01": "刘裕受晋恭帝司马德文禅让，代晋建宋。",
    },
  },
  {
    a: "拓跋焘",
    b: "沮渠牧犍",
    label: "敌国（灭凉）",
    eventSummaries: {
      "nanbeichao-02": "北魏太武帝破姑臧，北凉主沮渠牧犍出降，北方统一。",
    },
  },
  {
    a: "尔朱荣",
    b: "元子攸",
    label: "权臣与皇帝",
    eventSummaries: {
      "nanbeichao-06": "尔朱荣立元子攸为孝庄帝，自居晋阳遥控朝政；后为帝所杀。",
    },
  },
  {
    a: "高欢",
    b: "元善见",
    label: "权臣与傀儡",
    eventSummaries: {
      "nanbeichao-07": "高欢立元善见为东魏孝静帝，迁都邺城，政由高氏。",
    },
  },
  {
    a: "宇文泰",
    b: "元宝炬",
    label: "权臣与傀儡",
    eventSummaries: {
      "nanbeichao-07": "宇文泰立元宝炬为西魏文帝，军国大政尽决于泰。",
    },
  },
  {
    a: "高洋",
    b: "元善见",
    label: "禅代",
    eventSummaries: {
      "nanbeichao-09": "高洋废东魏孝静帝元善见，自立为帝，国号齐。",
    },
  },
  {
    a: "宇文邕",
    b: "高纬",
    label: "敌国（灭齐）",
    eventSummaries: {
      "nanbeichao-10": "周武帝东征破邺城，北齐后主高纬出逃被俘。",
    },
  },
  {
    a: "宇文宪",
    b: "高纬",
    label: "敌将（灭齐）",
    eventSummaries: {
      "nanbeichao-10": "宇文宪率前锋克晋阳、入邺城，北齐亡。",
    },
  },
  {
    a: "杨坚",
    b: "宇文阐",
    label: "外戚→禅代",
    eventSummaries: {
      "nanbeichao-11": "杨坚受遗辅政，旋受周静帝宇文阐禅让，建隋。",
    },
  },
  {
    a: "杨坚",
    b: "韩擒虎",
    label: "君臣（灭陈）",
    eventSummaries: {
      "nanbeichao-12": "隋以韩擒虎为先锋渡江，克建康，俘陈后主。",
    },
  },
  {
    a: "杨坚",
    b: "贺若弼",
    label: "君臣（灭陈）",
    eventSummaries: {
      "nanbeichao-12": "贺若弼自广陵渡江，与韩擒虎会师建康，陈亡。",
    },
  },
  {
    a: "杨坚",
    b: "陈叔宝",
    label: "敌国→降君",
    eventSummaries: {
      "nanbeichao-12": "陈后主陈叔宝被俘，陈亡，南北复归一统。",
    },
  },
  {
    a: "司马炎",
    b: "司马衷",
    label: "父子",
    description: "司马衷为武帝次子，以痴愚闻名，仍被立为太子；即位后朝政尽落贾后之手。",
    eventSummaries: {
      "xijin-03": "武帝崩，太子司马衷即位；帝不慧，朝政遂乱。",
    },
  },
  {
    a: "孝文帝",
    b: "拓跋澄",
    label: "君臣（迁都）",
    description: "拓跋澄为任城王，孝文帝迁都洛阳时力赞其事，宗室异议始平。",
    eventSummaries: {
      "nanbeichao-04": "孝文帝托辞南伐、定都洛阳，拓跋澄赞成其事。",
    },
  },
  {
    a: "孝文帝",
    b: "李冲",
    label: "君臣（改制）",
    description: "李冲为中书令，佐冯太后、孝文帝定三长制、均田令，迁都后董理洛阳营建。",
    eventSummaries: {
      "nanbeichao-04": "孝文帝迁都洛阳，李冲主持新都营建与官制厘定。",
    },
  },

  // ===== V0.7.2：隋唐 / 五代辽宋夏金（据 docs 第二、三批关系表解析；新增 99 对）=====
  {
    a: "杨坚",
    b: "独孤伽罗",
    label: "夫妻（共治）",
    eventSummaries: {
      "sui-01": "独孤伽罗与杨坚并称\"二圣\"，共理朝政，推行均田制，统一南北。",
    },
  },
  {
    a: "杨坚",
    b: "杨广",
    label: "父子（亡国）",
    eventSummaries: {
      "sui-03": "杨坚废长子杨勇改立杨广为太子，埋下隋朝速亡祸根。",
      "sui-04": "杨广继位，有弑父之说，即位后大兴土木、三征高句丽。",
    },
  },
  {
    a: "杨坚",
    b: "高颎",
    label: "君臣（辅政）",
    eventSummaries: {
      "sui-02": "高颎为杨坚首席谋臣，策划灭陈战略，一举完成南北统一。",
      "sui-17": "高颎佐文帝定三省六部之制。",
    },
  },
  {
    a: "独孤伽罗",
    b: "杨勇",
    label: "婆媳（废储）",
    eventSummaries: {
      "sui-03": "独孤伽罗厌恶太子杨勇好色奢靡，促成杨坚废勇立广。",
    },
  },
  {
    a: "杨广",
    b: "宇文化及",
    label: "君臣（被弑）",
    eventSummaries: {
      "sui-06": "宇文化及在江都发动兵变，缢杀隋炀帝，隋朝灭亡。",
    },
  },
  {
    a: "杨广",
    b: "高颎",
    label: "君臣（杀贤）",
    eventSummaries: {
      "sui-05": "高颎反对杨广奢靡与征高句丽，以诽谤朝政罪被诛杀。",
    },
  },
  {
    a: "杨素",
    b: "杨坚",
    label: "君臣（功臣）",
    eventSummaries: {
      "sui-02": "杨素率水军顺江东下大破陈军，为隋灭陈立首功。",
      "sui-21": "杨素督造仁寿宫，役夫多死。",
    },
  },
  {
    a: "杨素",
    b: "杨广",
    label: "党附（夺嫡）",
    eventSummaries: {
      "sui-03": "杨素党附杨广，助其夺取太子之位，杨广即位后封楚国公。",
    },
  },
  {
    a: "宇文化及",
    b: "李密",
    label: "对手（败北）",
    eventSummaries: {
      "sui-08": "宇文化及北归遭李密截击大败，最终被窦建德擒杀。",
    },
  },
  {
    a: "李密",
    b: "翟让",
    label: "同僚（杀让）",
    eventSummaries: {
      "sui-07": "李密加入瓦岗军后势力渐大，杀首领翟让夺权，瓦岗由盛转衰。",
    },
  },
  {
    a: "李渊",
    b: "杨广",
    label: "君臣（起兵）",
    eventSummaries: {
      "sui-09": "李渊为隋太原留守，天下大乱后在李世民劝说下于晋阳起兵反隋。",
    },
  },
  {
    a: "李渊",
    b: "李世民",
    label: "父子（开国）",
    eventSummaries: {
      "tang-01": "李渊称帝建唐，李世民南征北战平定群雄，奠定唐朝基业。",
      "tang-04": "李世民发动玄武门之变，杀兄建成、弟元吉，逼李渊退位。",
    },
  },
  {
    a: "李世民",
    b: "魏徵",
    label: "君臣（纳谏）",
    eventSummaries: {
      "tang-05": "魏徵直言极谏二百余事，李世民从善如流，共创贞观盛世。",
    },
  },
  {
    a: "李世民",
    b: "李靖",
    label: "君臣（名将）",
    eventSummaries: {
      "tang-06": "李靖率三千骑夜袭阴山，灭东突厥，擒颉利可汗。",
    },
  },
  {
    a: "魏徵",
    b: "李建成",
    label: "谋士（旧主）",
    eventSummaries: {
      "tang-04": "魏徵原为太子李建成谋士，曾劝其早除李世民未被采纳。",
    },
  },
  {
    a: "房玄龄",
    b: "杜如晦",
    label: "同僚（房谋杜断）",
    eventSummaries: {
      "tang-05": "房玄龄善谋、杜如晦善断，并称\"房谋杜断\"，共掌贞观朝政。",
    },
  },
  {
    a: "房玄龄",
    b: "李世民",
    label: "君臣（谋臣）",
    eventSummaries: {
      "tang-02": "房玄龄自晋阳起兵即追随李世民，为秦王府核心谋臣。",
    },
  },
  {
    a: "杜如晦",
    b: "李世民",
    label: "君臣（谋臣）",
    eventSummaries: {
      "tang-04": "杜如晦为天策府从事，参与策划玄武门之变。",
    },
  },
  {
    a: "李靖",
    b: "李渊",
    label: "蒙赦（效力）",
    eventSummaries: {
      "tang-03": "李渊曾欲杀李靖，李世民力保，后李靖平定萧铣统一江南。",
    },
  },
  {
    a: "长孙无忌",
    b: "李世民",
    label: "舅甥（辅政）",
    eventSummaries: {
      "tang-04": "长孙无忌为李世民舅父，是策划玄武门之变的核心人物。",
    },
  },
  {
    a: "长孙无忌",
    b: "李治",
    label: "舅父（辅政）",
    eventSummaries: {
      "tang-08": "长孙无忌辅佐外甥李治即位，主持编纂《唐律疏议》。",
    },
  },
  {
    a: "武则天",
    b: "李世民",
    label: "才人与帝王（入宫）",
    eventSummaries: {
      "tang-07": "武则天十四岁入宫为太宗才人，太宗崩后入感业寺为尼。",
    },
  },
  {
    a: "武则天",
    b: "李治",
    label: "夫妻（称帝）",
    eventSummaries: {
      "tang-09": "武则天由高宗昭仪至皇后，后称帝建周，成为中国唯一女皇。",
    },
  },
  {
    a: "武则天",
    b: "狄仁杰",
    label: "君臣（国老）",
    eventSummaries: {
      "tang-10": "狄仁杰直言敢谏，武则天尊为\"国老\"，荐张柬之等数十人。",
    },
  },
  {
    a: "狄仁杰",
    b: "张柬之",
    label: "恩师（举荐）",
    eventSummaries: {
      "tang-11": "狄仁杰荐张柬之为相，张柬之后发动神龙政变恢复李唐。",
    },
  },
  {
    a: "李隆基",
    b: "太平公主",
    label: "姑侄（政争）",
    eventSummaries: {
      "tang-12": "李隆基联合太平公主诛韦后，后发动先天政变铲除太平公主势力。",
    },
  },
  {
    a: "李隆基",
    b: "姚崇",
    label: "君臣（开元之治）",
    eventSummaries: {
      "tang-13": "姚崇以\"十事要说\"为条件拜相，辅佐玄宗开启开元盛世。",
    },
  },
  {
    a: "李隆基",
    b: "安禄山",
    label: "君臣（养虎）",
    eventSummaries: {
      "tang-17": "玄宗宠信安禄山使其兼三镇节度使，终酿安史之乱，盛唐由盛转衰。",
    },
  },
  {
    a: "姚崇",
    b: "宋璟",
    label: "前后任（贤相）",
    eventSummaries: {
      "tang-13": "姚崇、宋璟相继为相，并称\"姚宋\"，共铸开元盛世。",
    },
  },
  {
    a: "宋璟",
    b: "李隆基",
    label: "君臣（继相）",
    eventSummaries: {
      "tang-13": "宋璟继姚崇为相，守法持正，选贤任能，延续开元治世。",
    },
  },
  {
    a: "李林甫",
    b: "李隆基",
    label: "君臣（权相）",
    eventSummaries: {
      "tang-14": "李林甫为相十九年，口蜜腹剑，排斥异己，致朝政日渐败坏。",
    },
  },
  {
    a: "李林甫",
    b: "安禄山",
    label: "互用（养患）",
    eventSummaries: {
      "tang-15": "李林甫建议用蕃将为边帅，安禄山由此坐大，终成大患。",
    },
  },
  {
    a: "杨国忠",
    b: "李隆基",
    label: "外戚（权相）",
    eventSummaries: {
      "tang-16": "杨国忠借从妹杨贵妃之宠得势为相，专权误国。",
    },
  },
  {
    a: "杨国忠",
    b: "安禄山",
    label: "政敌（逼反）",
    eventSummaries: {
      "tang-17": "杨国忠与安禄山争权，屡次奏其必反，加速安禄山起兵。",
    },
  },
  {
    a: "杨玉环",
    b: "李隆基",
    label: "宠妃（盛极而衰）",
    eventSummaries: {
      "tang-16": "李隆基宠杨玉环，杨氏一门显赫，重用杨国忠，朝政日非。",
      "tang-50": "马嵬驿禁军哗变，玄宗赐死杨贵妃。",
    },
  },
  {
    a: "杨玉环",
    b: "杨国忠",
    label: "从兄妹（外戚）",
    eventSummaries: {
      "tang-16": "杨玉环受宠，从兄杨国忠由此得势为相，外戚干政。",
    },
  },
  {
    a: "安禄山",
    b: "史思明",
    label: "同党（叛乱）",
    eventSummaries: {
      "tang-17": "安禄山与史思明同为胡将，联手发动安史之乱，颠覆盛唐。",
    },
  },
  {
    a: "安禄山",
    b: "郭子仪",
    label: "对手（平叛）",
    eventSummaries: {
      "tang-20": "郭子仪率军平叛，收复长安、洛阳，为平定安史之乱首功。",
    },
  },
  {
    a: "史思明",
    b: "李光弼",
    label: "对手（平叛）",
    eventSummaries: {
      "tang-22": "李光弼在河阳以少胜多大败史思明，遏制叛军攻势。",
    },
  },
  {
    a: "郭子仪",
    b: "李亨",
    label: "君臣（平叛）",
    eventSummaries: {
      "tang-20": "郭子仪率军收复长安、洛阳，封汾阳郡王，为平叛首功。",
    },
  },
  {
    a: "郭子仪",
    b: "李光弼",
    label: "同僚（并肩）",
    eventSummaries: {
      "tang-23": "郭子仪与李光弼并称名将，共同平定安史之乱。",
    },
  },
  {
    a: "张巡",
    b: "许远",
    label: "同僚（死守）",
    eventSummaries: {
      "tang-19": "张巡与许远率数千人死守睢阳十月，牵制叛军南下，城破殉国。",
    },
  },
  {
    a: "张巡",
    b: "安庆绪",
    label: "对手（死守）",
    eventSummaries: {
      "tang-19": "张巡以数千兵力死守睢阳，牵制叛军十余万，保全江淮。",
    },
  },
  {
    a: "颜真卿",
    b: "颜杲卿",
    label: "兄弟（抗叛）",
    eventSummaries: {
      "tang-18": "颜真卿与堂兄颜杲卿起兵抗击安禄山，河北十七郡响应。",
    },
  },
  {
    a: "颜真卿",
    b: "李亨",
    label: "君臣（忠臣）",
    eventSummaries: {
      "tang-17": "颜真卿坚守平原郡抗击叛军，成为唐朝忠义象征。",
    },
  },
  {
    a: "李泌",
    b: "李亨",
    label: "君臣（谋臣）",
    eventSummaries: {
      "tang-21": "李泌为肃宗谋臣，提出\"挫其锐、解其纷\"战略，谋划平叛全局。",
    },
  },
  {
    a: "李泌",
    b: "李适",
    label: "君臣（辅政）",
    eventSummaries: {
      "tang-26": "李泌历仕四朝，在德宗朝拜相，辅佐朝政至终。",
    },
  },
  {
    a: "李晟",
    b: "李适",
    label: "君臣（平叛）",
    eventSummaries: {
      "tang-25": "朱泚叛乱据长安，李晟率军收复长安，挽救唐朝危局。",
    },
  },
  {
    a: "李晟",
    b: "朱泚",
    label: "对手（平叛）",
    eventSummaries: {
      "tang-24": "朱泚叛乱称帝据长安，李晟孤军深入收复长安，击溃朱泚。",
    },
  },
  {
    a: "朱温",
    b: "唐昭宗",
    label: "权臣与废帝（篡唐）",
    eventSummaries: {
      "wudai-01": "朱温弑唐昭宗、废唐哀帝，建立后梁，终结唐朝，开启五代乱世。",
    },
  },
  {
    a: "朱温",
    b: "李存勖",
    label: "世仇（争霸）",
    eventSummaries: {
      "wudai-03": "朱温与河东李克用父子长期争霸，后梁终被李存勖所灭。",
      "wudai-22": "李存勖破梁夹寨，朱温叹服。",
    },
  },
  {
    a: "李存勖",
    b: "李嗣源",
    label: "义兄弟（继位）",
    eventSummaries: {
      "wudai-06": "李存勖因兵变被杀，义兄李嗣源被推举继位为后唐明宗。",
    },
  },
  {
    a: "李存勖",
    b: "郭崇韬",
    label: "君臣（谋臣）",
    eventSummaries: {
      "wudai-05": "郭崇韬为李存勖首席谋臣，助其灭梁灭蜀，后遭冤杀军心尽失。",
    },
  },
  {
    a: "石敬瑭",
    b: "李嗣源",
    label: "女婿与岳父（代唐）",
    eventSummaries: {
      "wudai-07": "石敬瑭为李嗣源女婿，借契丹之力灭后唐建后晋，自称\"儿皇帝\"。",
    },
  },
  {
    a: "石敬瑭",
    b: "耶律德光",
    label: "儿皇帝与父皇帝（割地）",
    eventSummaries: {
      "wudai-08": "石敬瑭向契丹割燕云十六州，认耶律德光为父，建后晋。",
      "liao-08": "耶律德光立石敬瑭为后晋帝，得燕云十六州。",
    },
  },
  {
    a: "郭威",
    b: "刘承祐",
    label: "权臣与废帝（代汉）",
    eventSummaries: {
      "wudai-09": "郭威受后汉隐帝猜忌，举兵反叛灭后汉，建后周。",
      "wudai-27": "隐帝逼反郭威，后汉亡。",
    },
  },
  {
    a: "郭威",
    b: "柴荣",
    label: "义父子（传位）",
    eventSummaries: {
      "wudai-10": "郭威无子，养内侄柴荣为嗣，临终传位，开启后周盛世。",
    },
  },
  {
    a: "柴荣",
    b: "赵匡胤",
    label: "君臣（代周）",
    eventSummaries: {
      "wudai-17": "高平之战赵匡胤力战有功，柴荣擢之于行伍；柴荣崩后赵匡胤代周建宋。",
    },
  },
  {
    a: "钱镠",
    b: "董昌",
    label: "部将（讨叛）",
    eventSummaries: {
      "tang-27": "董昌在越州称帝，钱镠奉诏讨灭之，据有两浙建吴越国。",
    },
  },
  {
    a: "钱镠",
    b: "朱温",
    label: "臣属（保境）",
    eventSummaries: {
      "wudai-02": "钱镠臣服后梁受封吴越王，以\"保境安民\"为国策，治理两浙。",
    },
  },
  {
    a: "李煜",
    b: "李璟",
    label: "父子（继承）",
    eventSummaries: {
      "wudai-11": "李煜继父李璟之位，国势日衰，终为北宋所灭。",
    },
  },
  {
    a: "李煜",
    b: "赵匡胤",
    label: "降君与帝王（亡国）",
    eventSummaries: {
      "wudai-12": "赵匡胤遣军灭南唐，李煜奉表投降，\"卧榻之侧岂容他人鼾睡\"。",
    },
  },
  {
    a: "耶律阿保机",
    b: "耶律德光",
    label: "父子（继业）",
    eventSummaries: {
      "liao-01": "阿保机统一契丹各部建辽，子德光继位后获燕云十六州。",
      "liao-07": "德光从征渤海，旋继位为太宗。",
    },
  },
  {
    a: "耶律阿保机",
    b: "述律平",
    label: "夫妻（临朝）",
    eventSummaries: {
      "liao-02": "述律平为阿保机皇后，阿保机死后临朝称制，以铁腕掌控辽朝。",
      "liao-04": "阿保机即可汗位，述律平为后佐其创业。",
    },
  },
  {
    a: "萧太后",
    b: "辽圣宗",
    label: "母子（临朝）",
    eventSummaries: {
      "beisong-06": "萧太后携辽圣宗南征，与宋订澶渊之盟，维持宋辽百年和平。",
      "liao-11": "圣宗年幼，萧太后摄政。",
    },
  },
  {
    a: "萧太后",
    b: "寇准",
    label: "对手（议和）",
    eventSummaries: {
      "beisong-06": "萧太后率军南下，宋方寇准力主亲征，双方订澶渊之盟。",
    },
  },
  {
    a: "赵匡胤",
    b: "赵普",
    label: "君臣（谋臣）",
    eventSummaries: {
      "beisong-02": "赵普献策\"杯酒释兵权\"，削夺武将兵权，奠定重文抑武格局。",
    },
  },
  {
    a: "赵光义",
    b: "赵匡胤",
    label: "兄弟（继位）",
    eventSummaries: {
      "beisong-03": "赵光义继兄之位有\"烛影斧声\"之疑，后灭北汉结束五代十国。",
    },
  },
  {
    a: "赵光义",
    b: "寇准",
    label: "君臣（器重）",
    eventSummaries: {
      "beisong-04": "赵光义器重寇准，称\"朕得寇准，如唐太宗之得魏徵\"。",
    },
  },
  {
    a: "赵普",
    b: "赵光义",
    label: "君臣（再相）",
    eventSummaries: {
      "beisong-05": "赵普再相辅佐赵光义，自谓\"半部《论语》治天下\"。",
    },
  },
  {
    a: "寇准",
    b: "赵恒",
    label: "君臣（亲征）",
    eventSummaries: {
      "beisong-06": "寇准力主宋真宗御驾亲征，宋军射杀辽将萧挞凛，双方议和订盟。",
      "beisong-19": "真宗从寇准议亲征澶州，宋军射杀萧挞凛。",
    },
  },
  {
    a: "范仲淹",
    b: "赵祯",
    label: "君臣（改革）",
    eventSummaries: {
      "beisong-07": "范仲淹上《答手诏条陈十事》推行新政，因守旧派反对而失败。",
    },
  },
  {
    a: "范仲淹",
    b: "韩琦",
    label: "同僚（边防）",
    eventSummaries: {
      "beisong-08": "范仲淹与韩琦共防西夏于陕西，整顿边防，并称\"韩范\"。",
    },
  },
  {
    a: "范仲淹",
    b: "狄青",
    label: "上下级（教导）",
    eventSummaries: {
      "beisong-08": "范仲淹教诲狄青读《左传》通兵法，狄青后成一代名将。",
    },
  },
  {
    a: "欧阳修",
    b: "范仲淹",
    label: "同僚（新政）",
    eventSummaries: {
      "beisong-07": "欧阳修支持范仲淹推行新政，作《朋党论》为新政辩护。",
    },
  },
  {
    a: "欧阳修",
    b: "赵祯",
    label: "君臣（文宗）",
    eventSummaries: {
      "beisong-09": "欧阳修为北宋文坛领袖，倡导古文运动，主修《新唐书》《新五代史》。",
    },
  },
  {
    a: "王安石",
    b: "赵顼",
    label: "君臣（变法）",
    eventSummaries: {
      "beisong-10": "王安石在宋神宗支持下推行新法，以富国强兵为目标。",
    },
  },
  {
    a: "王安石",
    b: "司马光",
    label: "政敌（新旧党争）",
    eventSummaries: {
      "beisong-11": "司马光坚决反对新法，王安石罢相后司马光执政尽废新法。",
    },
  },
  {
    a: "司马光",
    b: "赵顼",
    label: "君臣（修史）",
    eventSummaries: {
      "beisong-12": "司马光主编《资治通鉴》，宋神宗赐名作序，为编年体通史巨著。",
    },
  },
  {
    a: "苏轼",
    b: "王安石",
    label: "政敌（党争）",
    eventSummaries: {
      "beisong-13": "苏轼反对新法，因诗文被控谤讪新法，入狱百余日贬黄州。",
    },
  },
  {
    a: "苏轼",
    b: "赵顼",
    label: "君臣（贬谪）",
    eventSummaries: {
      "beisong-13": "苏轼因\"乌台诗案\"入狱，后贬黄州团练副使，写下前后《赤壁赋》。",
    },
  },
  {
    a: "狄青",
    b: "赵祯",
    label: "君臣（枢密使）",
    eventSummaries: {
      "beisong-14": "狄青以军功升至枢密使，为北宋武将任枢密使的唯一例外。",
    },
  },
  {
    a: "李元昊",
    b: "赵祯",
    label: "叛臣与帝王（立国）",
    eventSummaries: {
      "xixia-01": "李元昊脱离宋朝称帝建西夏，三败宋军，形成宋辽夏三足鼎立。",
      "xixia-08": "宋夏庆历和议，元昊称夏国主。",
    },
  },
  {
    a: "李元昊",
    b: "范仲淹",
    label: "对手（边争）",
    eventSummaries: {
      "xixia-02": "李元昊率西夏军屡犯宋境，范仲淹在陕西防御应对，互有胜负。",
    },
  },
  {
    a: "完颜阿骨打",
    b: "辽天祚帝",
    label: "叛臣与帝王（灭辽）",
    eventSummaries: {
      "liao-17": "阿骨打破宁江州，辽军败于出河店。",
    },
  },
  {
    a: "完颜阿骨打",
    b: "赵佶",
    label: "盟友转敌（海上之盟）",
    eventSummaries: {
      "beisong-15": "宋金结\"海上之盟\"约共灭辽，灭辽后金转而攻宋，致靖康之变。",
    },
  },
  {
    a: "完颜亮",
    b: "完颜亶",
    label: "篡位（弑君）",
    eventSummaries: {
      "jin-02": "完颜亮弑金熙宗完颜亶夺位，即位后迁都燕京，推行汉化。",
    },
  },
  {
    a: "完颜亮",
    b: "虞允文",
    label: "对手（败亡）",
    eventSummaries: {
      "jin-03": "完颜亮率大军攻宋，虞允文以弱军大败金军于采石，完颜亮后被部下所杀。",
    },
  },
  {
    a: "赵构",
    b: "岳飞",
    label: "君臣（猜忌）",
    eventSummaries: {
      "nansong-05": "赵构猜忌岳飞北伐，默许秦桧以\"莫须有\"罪名杀害岳飞。",
    },
  },
  {
    a: "赵构",
    b: "秦桧",
    label: "君臣（议和）",
    eventSummaries: {
      "nansong-04": "赵构倚秦桧与金议和，订绍兴和议，以称臣纳贡换半壁江山。",
    },
  },
  {
    a: "岳飞",
    b: "秦桧",
    label: "政敌（被害）",
    eventSummaries: {
      "nansong-05": "秦桧以\"莫须有\"罪名构陷岳飞，岳飞遇害，成为千古忠臣典范。",
      "nansong-14": "秦桧促高宗十二道金牌召还岳飞。",
    },
  },
  {
    a: "岳飞",
    b: "宗泽",
    label: "上下级（提携）",
    eventSummaries: {
      "nansong-01": "宗泽赏识岳飞才能多次举荐，岳飞由此崭露头角成为抗金名将。",
    },
  },
  {
    a: "韩世忠",
    b: "赵构",
    label: "君臣（保驾）",
    eventSummaries: {
      "nansong-02": "韩世忠在黄天荡阻击金军，赵构得以脱险，后拜枢密使。",
      "nansong-10": "韩世忠起兵讨苗刘，高宗复位。",
    },
  },
  {
    a: "韩世忠",
    b: "秦桧",
    label: "政敌（免祸）",
    eventSummaries: {
      "nansong-03": "韩世忠反对秦桧议和遭构陷，赵构念旧功免其死，世忠自此杜门谢客。",
    },
  },
  {
    a: "宗泽",
    b: "赵构",
    label: "君臣（忧愤）",
    eventSummaries: {
      "nansong-01": "宗泽力请赵构还都开封北伐中原，不被采纳，忧愤成疾，临终三呼\"过河\"。",
      "nansong-09": "宗泽留守汴京，屡疏请还都，高宗不纳。",
    },
  },
  {
    a: "辛弃疾",
    b: "耿京",
    label: "上下级（抗金）",
    eventSummaries: {
      "nansong-06": "辛弃疾年少参加耿京抗金义军，耿京被害后率五十骑闯金营擒叛徒南归。",
    },
  },
  {
    a: "辛弃疾",
    b: "韩侂胄",
    label: "君臣（北伐）",
    eventSummaries: {
      "nansong-07": "辛弃疾支持韩侂胄开禧北伐，遭闲置壮志未酬，临终高呼\"杀贼\"。",
    },
  },
  {
    a: "文天祥",
    b: "陆秀夫",
    label: "同僚（殉国）",
    eventSummaries: {
      "nansong-08": "文天祥兵败被俘拒不降元，陆秀夫负幼帝投海殉国，南宋覆亡。",
    },
  },
  {
    a: "文天祥",
    b: "赵昺",
    label: "君臣（殉国）",
    eventSummaries: {
      "nansong-08": "文天祥组织义军抗元，兵败被俘从容就义，作《正气歌》传世。",
    },
  },

  // ===== V0.8.0：元（据 docs/史脉_第四批_元明清.md 解析；13 行合并镜像后 9 对）=====
  {
    a: "成吉思汗",
    b: "窝阔台",
    label: "父子（继业）",
    eventSummaries: {
      "yuan-02": "成吉思汗统一蒙古后指定三子窝阔台为继承人，汗位由此传于第三子一系。",
    },
  },
  {
    a: "窝阔台",
    b: "耶律楚材",
    label: "君臣（汉法）",
    eventSummaries: {
      "yuan-03": "耶律楚材劝窝阔台行汉法、设十路课税所、止屠城，保护中原典章。",
    },
  },
  {
    a: "忽必烈",
    b: "伯颜",
    label: "君臣（灭宋）",
    eventSummaries: {
      "yuan-07": "伯颜率元军南下兵临临安，宋恭帝出降，忽必烈完成天下一统。",
    },
  },
  {
    a: "忽必烈",
    b: "八思巴",
    label: "君臣（帝师）",
    eventSummaries: {
      "yuan-05": "忽必烈封藏传佛教高僧八思巴为帝师，命创八思巴文统一蒙元文字。",
    },
  },
  {
    a: "成吉思汗",
    b: "耶律楚材",
    label: "君臣（征召）",
    eventSummaries: {
      "yuan-01": "成吉思汗征召耶律楚材随军西征，器重其占星之能与治国见识。",
    },
  },
  {
    a: "伯颜",
    b: "文天祥",
    label: "对手（交锋）",
    eventSummaries: {
      "yuan-08": "伯颜兵临临安，文天祥出使元营谈判被扣，后脱险南归继续抗元。",
      "nansong-25": "伯颜拘文天祥，文天祥脱归后继续抗元。",
    },
  },
  {
    a: "脱脱",
    b: "元顺帝",
    label: "君臣（修史）",
    eventSummaries: {
      "yuan-09": "脱脱任中书右丞相，主持编修辽、金、宋三史，又行至正新政。",
      "yuan-34": "脱脱当国更化，复科举、修三史。",
    },
  },
  {
    a: "脱脱",
    b: "贾鲁",
    label: "委任治河",
    eventSummaries: {
      "yuan-10": "脱脱用贾鲁之议，征民夫十七万塞黄河决口，功成而民困，红巾军起。",
    },
  },

  // ===== V0.8.0：明（据 docs/史脉_第四批_元明清.md 解析；26 行合并镜像后 21 对）=====
  {
    a: "朱元璋",
    b: "陈友谅",
    label: "对手（争霸）",
    eventSummaries: {
      "ming-01": "朱元璋在鄱阳湖以少胜多大败陈友谅，奠定统一南方、建立明朝之基。",
    },
  },
  {
    a: "朱元璋",
    b: "朱棣",
    label: "父子（传位）",
    eventSummaries: {
      "ming-03": "朱元璋传位于皇太孙朱允炆，四子朱棣后发动靖难之变夺位。",
    },
  },
  {
    a: "朱元璋",
    b: "刘基",
    label: "君臣（谋臣）",
    eventSummaries: {
      "ming-02": "刘基献策先灭陈友谅、再攻张士诚，助朱元璋扫平群雄、建立明朝。",
    },
  },
  {
    a: "朱棣",
    b: "建文帝",
    label: "叔侄（夺位）",
    eventSummaries: {
      "ming-04": "朱棣起兵靖难攻破南京，建文帝下落不明，朱棣即位并迁都北京。",
    },
  },
  {
    a: "朱棣",
    b: "郑和",
    label: "君臣（远航）",
    eventSummaries: {
      "ming-05": "朱棣遣郑和七下西洋，宣扬国威、开展朝贡贸易，航程远达东非。",
    },
  },
  {
    a: "郑和",
    b: "建文帝",
    label: "奉旨寻人",
    eventSummaries: {
      "ming-05": "朱棣疑建文帝流亡海外，遣郑和下西洋兼寻其踪迹，并宣威于诸国。",
    },
  },
  {
    a: "王阳明",
    b: "朱厚照",
    label: "君臣（平叛）",
    eventSummaries: {
      "ming-06": "王阳明以文臣身份仅用三十五日平定宁王朱宸濠叛乱，以心学著称。",
    },
  },
  {
    a: "王阳明",
    b: "朱熹",
    label: "思想对立",
    eventSummaries: {
      "ming-07": "王阳明反对朱熹「格物致知」外求说，提出「心即理」「知行合一」。",
    },
  },
  {
    a: "严嵩",
    b: "嘉靖帝",
    label: "君臣（权臣）",
    eventSummaries: {
      "ming-08": "严嵩谄事嘉靖帝，为首辅二十年，排斥异己，朝政败坏误国误民。",
    },
  },
  {
    a: "严嵩",
    b: "徐阶",
    label: "政敌（倒严）",
    eventSummaries: {
      "ming-09": "徐阶隐忍多年收集严嵩父子罪证，终使严嵩罢官抄家。",
    },
  },
  {
    a: "戚继光",
    b: "张居正",
    label: "上下级（蓟镇）",
    eventSummaries: {
      "ming-13": "张居正重用戚继光镇守蓟镇，修长城练戚家军，北疆十余年无战事。",
    },
  },
  {
    a: "戚继光",
    b: "俞大猷",
    label: "同僚（抗倭）",
    eventSummaries: {
      "ming-10": "戚继光与俞大猷并称抗倭名将，在东南沿海合力平定倭患。",
      "ming-34": "戚继光、俞大猷并力抗倭。",
    },
  },
  {
    a: "海瑞",
    b: "嘉靖帝",
    label: "直臣谏君",
    eventSummaries: {
      "ming-11": "海瑞上《治安疏》直斥嘉靖帝，言「天下人不直陛下久矣」，被下狱。",
    },
  },
  {
    a: "海瑞",
    b: "徐阶",
    label: "恩人反目",
    eventSummaries: {
      "ming-12": "徐阶曾救海瑞出狱，后海瑞任应天巡抚清查徐阶家族占田，不徇私情。",
    },
  },
  {
    a: "张居正",
    b: "万历帝",
    label: "师生与帝",
    eventSummaries: {
      "ming-14": "张居正为万历帝师，行考成法、一条鞭法，整顿吏治，史称「万历新政」。",
    },
  },
  {
    a: "袁崇焕",
    b: "崇祯帝",
    label: "君臣（冤杀）",
    eventSummaries: {
      "ming-16": "崇祯帝中后金反间计，以通敌罪凌迟袁崇焕，自毁抗金长城。",
      "ming-40": "崇祯中反间计，磔袁崇焕。",
    },
  },
  {
    a: "袁崇焕",
    b: "努尔哈赤",
    label: "对手（交锋）",
    eventSummaries: {
      "ming-15": "袁崇焕坚守宁远，以红夷大炮击退努尔哈赤大军，取得宁远大捷。",
    },
  },
  {
    a: "崇祯帝",
    b: "李自成",
    label: "对手（亡国）",
    eventSummaries: {
      "ming-17": "李自成大顺军攻破北京，崇祯帝自缢煤山，统治二百七十六年的明朝覆亡。",
    },
  },
  {
    a: "李自成",
    b: "吴三桂",
    label: "对手（败北）",
    eventSummaries: {
      "ming-18": "李自成招降吴三桂未果，吴三桂引清军入关，李自成于山海关大败。",
    },
  },
  {
    a: "郑成功",
    b: "郑芝龙",
    label: "父子（决裂）",
    eventSummaries: {
      "ming-19": "郑芝龙降清被执北上，郑成功率父旧部继续抗清，父子殊途。",
    },
  },
  {
    a: "郑成功",
    b: "永历帝",
    label: "君臣（复明）",
    eventSummaries: {
      "ming-20": "郑成功奉南明永历帝正朔，以金厦为基地抗清，后东征收复台湾。",
    },
  },

  // ===== V0.8.0：清（据 docs/史脉_第四批_元明清.md 解析；29 行合并镜像后 21 对，
  //        其中「袁崇焕 × 努尔哈赤」已随明批收录、两期共用，故本段新增 20 对）=====
  {
    a: "努尔哈赤",
    b: "皇太极",
    label: "父子（继业）",
    eventSummaries: {
      "qing-01": "努尔哈赤统一女真建后金，子皇太极继位后改国号为大清。",
    },
  },
  {
    a: "皇太极",
    b: "多尔衮",
    label: "兄弟（重用）",
    eventSummaries: {
      "qing-03": "皇太极重用多尔衮，在松锦之战中大败明军，奠定清军入关基础。",
    },
  },
  {
    a: "多尔衮",
    b: "吴三桂",
    label: "借力（入关）",
    eventSummaries: {
      "ming-18": "多尔衮趁吴三桂请降，率清军入山海关击溃李自成，定鼎北京。",
    },
  },
  {
    a: "多尔衮",
    b: "顺治帝",
    label: "叔侄（摄政）",
    eventSummaries: {
      "qing-05": "多尔衮为顺治帝摄政王独揽大权，死后遭顺治帝清算，毁墓鞭尸。",
    },
  },
  {
    a: "康熙帝",
    b: "鳌拜",
    label: "君臣（擒拿）",
    eventSummaries: {
      "qing-06": "康熙帝年少即位，设计擒获专权大臣鳌拜，亲掌朝政。",
      "qing-26": "鳌拜辅政专权，康熙帝后智擒之。",
    },
  },
  {
    a: "康熙帝",
    b: "吴三桂",
    label: "君臣转叛",
    eventSummaries: {
      "qing-07": "吴三桂等三藩叛乱，康熙帝历时八年平定，巩固国家统一。",
    },
  },
  {
    a: "康熙帝",
    b: "乾隆帝",
    label: "祖孙（盛世）",
    eventSummaries: {
      "qing-08": "康熙帝开创盛世基业，孙乾隆帝继之，形成「康乾盛世」百年繁荣。",
    },
  },
  {
    a: "雍正帝",
    b: "康熙帝",
    label: "父子（继位）",
    eventSummaries: {
      "qing-09": "雍正帝继康熙之位，推行摊丁入亩、火耗归公等改革，充实国库。",
    },
  },
  {
    a: "雍正帝",
    b: "乾隆帝",
    label: "父子（传位）",
    eventSummaries: {
      "qing-10": "雍正帝创立秘密立储制，传位皇四子弘历，为乾隆盛世奠定物质基础。",
    },
  },
  {
    a: "乾隆帝",
    b: "和珅",
    label: "君臣（贪腐）",
    eventSummaries: {
      "qing-11": "乾隆帝宠信和珅二十余年，和珅贪腐敛财无数，加速清朝由盛转衰。",
    },
  },
  {
    a: "林则徐",
    b: "道光帝",
    label: "君臣（禁烟）",
    eventSummaries: {
      "qing-12": "林则徐奉道光帝之命赴广东禁烟，虎门销烟两万余箱，引发鸦片战争。",
    },
  },
  {
    a: "林则徐",
    b: "琦善",
    label: "政敌（妥协）",
    eventSummaries: {
      "qing-13": "林则徐禁烟抗英，琦善接任后一味妥协，林则徐被革职查办流放。",
    },
  },
  {
    a: "洪秀全",
    b: "曾国藩",
    label: "对手（平叛）",
    eventSummaries: {
      "qing-14": "洪秀全建太平天国席卷半壁江山，曾国藩组建湘军历时十四年平定。",
      "qing-16": "曾国藩组建湘军攻克天京，历时十四年平定太平天国，封一等毅勇侯。",
    },
  },
  {
    a: "洪秀全",
    b: "杨秀清",
    label: "兄弟（内讧）",
    eventSummaries: {
      "qing-15": "杨秀清以「天父下凡」凌驾洪秀全之上，天京事变中被杀，太平天国由盛转衰。",
      "qing-40": "杨秀清专擅，洪秀全与之相疑。",
    },
  },
  {
    a: "曾国藩",
    b: "李鸿章",
    label: "师生（提携）",
    eventSummaries: {
      "qing-17": "曾国藩举荐李鸿章办团练，李鸿章继之以淮军和洋务，推动近代化。",
    },
  },
  {
    a: "曾国藩",
    b: "左宗棠",
    label: "同僚（并称）",
    eventSummaries: {
      "qing-16": "曾国藩与左宗棠并称晚清名臣，虽略有龃龉，仍共扶危局、平定太平天国。",
    },
  },
  {
    a: "李鸿章",
    b: "左宗棠",
    label: "政见相左",
    eventSummaries: {
      "qing-18": "李鸿章主海防、重北洋水师，左宗棠主塞防、力主收复新疆，政见相左。",
      "qing-19": "左宗棠抬棺西征收复新疆，与李鸿章海防塞防之争为晚清大政争。",
    },
  },
  {
    a: "李鸿章",
    b: "慈禧太后",
    label: "君臣（倚重）",
    eventSummaries: {
      "qing-20": "李鸿章长期受慈禧太后倚重，代签《马关条约》《辛丑条约》等不平等条约。",
    },
  },
  {
    a: "慈禧太后",
    b: "咸丰帝",
    label: "妃嫔与帝王",
    eventSummaries: {
      "qing-21": "慈禧为咸丰帝妃，咸丰死后发动辛酉政变、垂帘听政，掌权四十七年。",
    },
  },
  {
    a: "慈禧太后",
    b: "光绪帝",
    label: "太后囚帝",
    eventSummaries: {
      "qing-22": "光绪帝行戊戌变法，慈禧太后发动政变，幽其于瀛台，新政尽废。",
    },
  },


  // ===== V0.8.2 厚度对齐：新增人物关系（按事件去重合并）=====
  {
    a: "赵光义",
    b: "耶律休哥",
    label: "敌手",
    description: "高梁河一战，耶律休哥大破宋军，宋太宗仅以身免，此后宋辽攻守之势逆转。",
    eventSummaries: {
      "beisong-16": "宋军围幽州，耶律休哥率援军夹击，宋太宗大败南遁。",
    },
  },
  {
    a: "杨业",
    b: "耶律斜轸",
    label: "敌手",
    description: "雍熙北伐中杨业兵败被俘，耶律斜轸敬其忠勇而厚待之，杨业绝食三日而死。",
    eventSummaries: {
      "beisong-17": "杨业孤军被围，力竭为耶律斜轸所擒，不食而死。",
    },
  },
  {
    a: "赵光义",
    b: "曹彬",
    label: "君臣",
    description: "曹彬为雍熙北伐东路主帅，贪功冒进致军溃，战后贬官。",
    eventSummaries: {
      "beisong-17": "曹彬统东路军北进，粮道被断，岐沟关大败。",
    },
  },
  {
    a: "王小波",
    b: "李顺",
    label: "同党",
    description: "王小波战死后，李顺继领其众，攻占成都称大蜀王。",
    eventSummaries: {
      "beisong-18": "王小波中箭身亡，李顺继统义军攻取成都。",
    },
  },
  {
    a: "赵祯",
    b: "刘娥",
    label: "母子",
    description: "仁宗幼年即位，刘太后垂帘听政十一年，仁宗亲政后追尊生母李宸妃。",
    eventSummaries: {
      "beisong-20": "真宗崩，刘太后临朝，仁宗年少不得亲政。",
    },
  },
  {
    a: "范仲淹",
    b: "吕夷简",
    label: "政敌",
    description: "范仲淹以《百官图》直指吕夷简把持朝政，吕以朋党罪贬之，景祐党争由此起。",
    eventSummaries: {
      "beisong-21": "范仲淹上《百官图》讥吕夷简，被贬饶州。",
    },
  },
  {
    a: "包拯",
    b: "赵祯",
    label: "君臣",
    description: "包拯屡犯颜直谏，仁宗虽忤意而多纳其言，人称其刚正。",
    eventSummaries: {
      "beisong-22": "包拯权知开封府，执法不避权贵，仁宗嘉之。",
    },
  },
  {
    a: "欧阳修",
    b: "司马光",
    label: "政敌",
    description: "濮议中欧阳修主濮王称皇考，司马光主称皇伯，两派交章攻讦，士大夫分裂。",
    eventSummaries: {
      "beisong-23": "濮议起，欧阳修与司马光各执一说，朝争逾年。",
    },
  },
  {
    a: "王安石",
    b: "吕惠卿",
    label: "政敌",
    description: "吕惠卿本为王安石变法臂膀，后与安石争权，攻讦倾轧，新党内部亦裂。",
    eventSummaries: {
      "beisong-24": "王安石复相后与吕惠卿交恶，新党分裂。",
    },
  },
  {
    a: "赵顼",
    b: "李宪",
    label: "君臣",
    description: "神宗以内侍李宪督军伐夏，李宪虽有战功，然宦官统兵为时论所讥。",
    eventSummaries: {
      "beisong-25": "神宗五路伐夏，李宪率熙河路军深入。",
    },
  },
  {
    a: "徐禧",
    b: "梁太后",
    label: "敌手",
    description: "徐禧力主筑永乐城，梁太后集三十万军围之，城陷，徐禧死于是役。",
    eventSummaries: {
      "beisong-26": "梁太后围永乐城，城破，徐禧战死。",
    },
  },
  {
    a: "章惇",
    b: "苏轼",
    label: "政敌",
    description: "章惇与苏轼少为友，及章惇执政，力排元祐旧臣，苏轼累贬至儋州。",
    eventSummaries: {
      "beisong-27": "章惇当国，绍述新法，苏轼以元祐党人远贬。",
    },
  },
  {
    a: "赵佶",
    b: "蔡京",
    label: "君臣",
    description: "徽宗好书画花石，蔡京以逢迎得幸，四度为相，导帝于奢靡，朝政大坏。",
    eventSummaries: {
      "beisong-28": "徽宗即位，蔡京以书画逢迎入相专权。",
    },
  },
  {
    a: "蔡京",
    b: "苏轼",
    label: "政敌",
    description: "蔡京立党籍碑，苏轼名列其中，文集遭禁，天下士人侧目。",
    eventSummaries: {
      "beisong-29": "蔡京籍元祐党人，苏轼名在碑中，著作被禁。",
    },
  },
  {
    a: "宋江",
    b: "张叔夜",
    label: "敌手",
    description: "张叔夜知海州，设伏焚宋江舟，擒其副手，宋江遂降。",
    eventSummaries: {
      "beisong-30": "张叔夜设伏海州，焚舟擒将，宋江请降。",
    },
  },
  {
    a: "方腊",
    b: "童贯",
    label: "敌手",
    description: "童贯督十五万军南下镇压方腊，历时半年，方腊被俘送京处死。",
    eventSummaries: {
      "beisong-31": "童贯率军南下，方腊兵败被俘。",
    },
  },
  {
    a: "完颜宗望",
    b: "郭药师",
    label: "招降",
    description: "郭药师以常胜军降宋又叛降金，为金军向导，尽知宋虚实。",
    eventSummaries: {
      "beisong-32": "郭药师降金，引金军南下，燕山失守。",
    },
  },
  {
    a: "李纲",
    b: "赵桓",
    label: "君臣",
    description: "李纲力主死守，钦宗用之一时又罢之，和战不定，终致城破。",
    eventSummaries: {
      "beisong-33": "李纲守汴京挫金军，钦宗议和罢之。",
    },
  },
  {
    a: "赵佶",
    b: "赵桓",
    label: "父子",
    description: "徽宗禅位钦宗，靖康之变中父子同被金人掳往五国城，先后客死北地。",
    eventSummaries: {
      "beisong-34": "汴京城破，徽钦二帝同被金军掳走。",
    },
  },
  {
    a: "完颜宗翰",
    b: "完颜宗望",
    label: "同僚",
    description: "金军东西两路主帅，会师汴京城下，共成靖康之役。",
    eventSummaries: {
      "beisong-34": "宗翰、宗望两路合围汴京，俘宋二帝。",
    },
  },
  {
    a: "赵构",
    b: "李纲",
    label: "君臣",
    description: "高宗初立，召李纲为相，纲主战守，与黄潜善、汪伯彦不和，居相仅七十七日而罢。",
    eventSummaries: {
      "nansong-09": "高宗即位，李纲入相主战，旋遭罢免。",
    },
  },
  {
    a: "吴玠",
    b: "完颜宗弼",
    label: "敌手",
    description: "富平战后吴玠退保和尚原，次年大破兀术，金军西线受挫。",
    eventSummaries: {
      "nansong-11": "富平兵败，吴玠退守和尚原拒金。",
    },
  },
  {
    a: "吴玠",
    b: "吴璘",
    label: "兄弟",
    description: "吴玠、吴璘兄弟共守川陕，并称「二吴」，和尚原、仙人关皆以少胜多。",
    eventSummaries: {
      "nansong-12": "吴氏兄弟扼守和尚原，大破兀术。",
    },
  },
  {
    a: "岳飞",
    b: "牛皋",
    label: "部将",
    description: "牛皋为岳家军悍将，随岳飞收复襄阳六郡，后与岳飞同遇害。",
    eventSummaries: {
      "nansong-13": "牛皋从岳飞北征，连复襄阳六郡。",
    },
  },
  {
    a: "岳飞",
    b: "完颜宗弼",
    label: "敌手",
    description: "郾城、颍昌两战，岳家军连破金军精锐，兀术叹「撼山易，撼岳家军难」。",
    eventSummaries: {
      "nansong-14": "岳飞于郾城破拐子马，兀术大败。",
    },
  },
  {
    a: "岳云",
    b: "岳飞",
    label: "父子",
    description: "岳云随父征战，郾城之战率背嵬军陷阵，后与父同死风波亭。",
    eventSummaries: {
      "nansong-14": "岳云随岳飞北伐，郾城陷阵立功。",
    },
  },
  {
    a: "赵昚",
    b: "张浚",
    label: "君臣",
    description: "孝宗以张浚主持北伐，符离兵败后主和派得势，张浚罢相。",
    eventSummaries: {
      "nansong-15": "孝宗命张浚督师北伐，符离溃败。",
    },
  },
  {
    a: "赵昚",
    b: "汤思退",
    label: "君臣",
    description: "汤思退主和，力促隆兴和议，孝宗虽恶其怯而屈于形势。",
    eventSummaries: {
      "nansong-16": "汤思退主和议，宋金约为叔侄之国。",
    },
  },
  {
    a: "朱熹",
    b: "陆九渊",
    label: "论敌",
    description: "鹅湖之会朱陆各执一端，往复辩难，理学与心学自此分流。",
    eventSummaries: {
      "nansong-17": "鹅湖寺论学，朱熹与陆九渊不合。",
    },
  },
  {
    a: "吕祖谦",
    b: "朱熹",
    label: "友",
    description: "吕祖谦与朱熹、张栻并称「东南三贤」，其邀集促成鹅湖之会。",
    eventSummaries: {
      "nansong-17": "吕祖谦邀朱熹、陆九渊会于鹅湖。",
    },
  },
  {
    a: "韩侂胄",
    b: "朱熹",
    label: "政敌",
    description: "韩侂胄立伪学之禁，朱熹落职，门人遭斥逐，至嘉定年间始得昭雪。",
    eventSummaries: {
      "nansong-18": "韩侂胄禁伪学，朱熹落职，党人遭斥。",
    },
  },
  {
    a: "史弥远",
    b: "韩侂胄",
    label: "政敌",
    description: "史弥远结杨皇后，矫诏诛韩侂胄，函首送金以求和，遂专宋政。",
    eventSummaries: {
      "nansong-19": "史弥远诛韩侂胄，函首送金议和。",
    },
  },
  {
    a: "赵方",
    b: "孟宗政",
    label: "同僚",
    description: "赵方镇京湖，孟宗政守枣阳，协力拒金，屡挫南侵之师。",
    eventSummaries: {
      "nansong-20": "金军南侵，赵方、孟宗政协力拒守。",
    },
  },
  {
    a: "孟珙",
    b: "塔察儿",
    label: "盟友",
    description: "孟珙与蒙古将塔察儿分道攻蔡州，相约破城后分金哀宗骨以祭祖。",
    eventSummaries: {
      "nansong-21": "孟珙与塔察儿合围蔡州，共灭金。",
    },
  },
  {
    a: "孟珙",
    b: "金哀宗",
    label: "敌手",
    description: "孟珙率宋军攻蔡州，金哀宗自缢，金亡。",
    eventSummaries: {
      "nansong-21": "宋军攻破蔡州，金哀宗自缢。",
    },
  },
  {
    a: "王坚",
    b: "蒙哥",
    label: "敌手",
    description: "王坚守钓鱼城，蒙哥攻城不下，死于军中，蒙古攻宋之势顿挫。",
    eventSummaries: {
      "nansong-22": "蒙哥攻钓鱼城不克，死于城下。",
    },
  },
  {
    a: "伯颜",
    b: "吕文焕",
    label: "受降",
    description: "伯颜围襄阳五年，吕文焕力竭出降，元军遂顺江东下。",
    eventSummaries: {
      "nansong-23": "襄阳粮尽，吕文焕降于伯颜。",
    },
  },
  {
    a: "贾似道",
    b: "伯颜",
    label: "敌手",
    description: "贾似道督师丁家洲，一触即溃，南宋主力尽丧，临安遂不可守。",
    eventSummaries: {
      "nansong-24": "丁家洲宋军大溃，贾似道败逃。",
    },
  },
  {
    a: "谢太后",
    b: "赵㬎",
    label: "母子",
    description: "谢太后临朝，携幼帝赵㬎向元军奉表投降。",
    eventSummaries: {
      "nansong-25": "谢太后携恭帝出降，临安陷落。",
    },
  },
  {
    a: "文天祥",
    b: "张弘范",
    label: "敌手",
    description: "张弘范破五坡岭俘文天祥，逼其招降张世杰，天祥书《过零丁洋》以明志。",
    eventSummaries: {
      "nansong-26": "文天祥被张弘范所俘，作《过零丁洋》。",
    },
  },
  {
    a: "耶律阿保机",
    b: "耶律剌葛",
    label: "兄弟",
    description: "剌葛为阿保机之弟，屡次举兵争位，兵败后获赦，契丹可汗世选旧制由此废。",
    eventSummaries: {
      "liao-05": "剌葛三度作乱，阿保机平之，改行世袭。",
    },
  },
  {
    a: "耶律阿保机",
    b: "耶律突吕不",
    label: "君臣",
    description: "突吕不奉诏制契丹大字，辽之国书自此始。",
    eventSummaries: {
      "liao-06": "突吕不奉诏创制契丹大字。",
    },
  },
  {
    a: "耶律阿保机",
    b: "耶律倍",
    label: "父子",
    description: "阿保机以皇太子耶律倍为东丹王，镇渤海故地；倍让位于弟德光。",
    eventSummaries: {
      "liao-07": "灭渤海后以耶律倍为东丹王。",
    },
  },
  {
    a: "耶律璟",
    b: "述律平",
    label: "政敌",
    description: "述律平拥李胡争位，耶律璟即位后幽之祖州，辽室乃定。",
    eventSummaries: {
      "liao-09": "述律平谋立李胡，耶律璟平乱幽之。",
    },
  },
  {
    a: "耶律璟",
    b: "萧思温",
    label: "君臣",
    description: "穆宗遇弑，萧思温等拥立世宗之子耶律贤，是为景宗。",
    eventSummaries: {
      "liao-10": "穆宗被杀，萧思温拥立景宗。",
    },
  },
  {
    a: "萧太后",
    b: "韩德让",
    label: "君臣",
    description: "萧太后委韩德让总揽军政，韩氏尽心佐辽，位至大丞相。",
    eventSummaries: {
      "liao-11": "萧太后委政于韩德让，辽政修明。",
    },
  },
  {
    a: "辽圣宗",
    b: "韩德让",
    label: "君臣",
    description: "圣宗亲政后仍倚韩德让，行汉制、定律令，辽之制度大备。",
    eventSummaries: {
      "liao-12": "圣宗用韩德让行汉制，辽政大备。",
    },
  },
  {
    a: "耶律宗真",
    b: "萧耨斤",
    label: "母子",
    description: "萧耨斤为兴宗生母，专权后为兴宗所废，母子相争，辽室再乱。",
    eventSummaries: {
      "liao-13": "萧耨斤专权，兴宗废其太后之位。",
    },
  },
  {
    a: "耶律宗真",
    b: "李元昊",
    label: "敌手",
    description: "兴宗亲征西夏，河曲一战辽军先胜后败，兴宗单骑仅免，遂与夏和。",
    eventSummaries: {
      "liao-14": "辽夏河曲之战，兴宗先胜后败而和。",
    },
  },
  {
    a: "耶律洪基",
    b: "耶律重元",
    label: "叔侄",
    description: "重元为道宗叔父，谋夺帝位，滦河之变兵败自杀。",
    eventSummaries: {
      "liao-15": "耶律重元父子作乱，道宗讨平之。",
    },
  },
  {
    a: "沈括",
    b: "耶律洪基",
    label: "交涉",
    description: "沈括使辽议界，六会辽廷，援图据理力争，终以黄嵬山定界。",
    eventSummaries: {
      "liao-16": "沈括使辽议界，以黄嵬山定界。",
    },
  },
  {
    a: "辽天祚帝",
    b: "耶律大石",
    label: "君臣",
    description: "大石随天祚帝抗金，屡谏不听，后率部西走建西辽。",
    eventSummaries: {
      "liao-18": "天祚帝西逃，耶律大石随行抗金。",
    },
  },
  {
    a: "耶律大石",
    b: "萧斡里剌",
    label: "君臣",
    description: "萧斡里剌为西辽名将，佐大石西征中亚，建西辽基业。",
    eventSummaries: {
      "liao-19": "大石西迁，萧斡里剌佐其建国。",
    },
  },
  {
    a: "李继迁",
    b: "李德明",
    label: "父子",
    description: "李继迁卒后，子李德明继领党项，表宋求和，积蓄力以图大夏。",
    eventSummaries: {
      "xixia-03": "李继迁取灵州，李德明继其业。",
    },
  },
  {
    a: "李元昊",
    b: "李德明",
    label: "父子",
    description: "元昊继父业而改弦更张，弃宋赐姓，自称兀卒，终建西夏。",
    eventSummaries: {
      "xixia-04": "李德明卒，元昊继位改姓立制。",
    },
  },
  {
    a: "李元昊",
    b: "野利仁荣",
    label: "君臣",
    description: "野利仁荣为元昊谋主，创制西夏文，定礼乐官制。",
    eventSummaries: {
      "xixia-04": "元昊用野利仁荣创文字、立制度。",
      "xixia-05": "仁荣创西夏文，元昊颁行全国。",
    },
  },
  {
    a: "李元昊",
    b: "刘平",
    label: "敌手",
    description: "三川口之战刘平力战被俘，宋军大败，西夏声威大振。",
    eventSummaries: {
      "xixia-06": "元昊伏击三川口，俘刘平、石元孙。",
    },
  },
  {
    a: "李元昊",
    b: "任福",
    label: "敌手",
    description: "好水川之战任福中伏力战而死，宋军覆没，西夏乘胜南侵。",
    eventSummaries: {
      "xixia-07": "元昊诱敌好水川，任福战死。",
    },
  },
  {
    a: "梁太后",
    b: "高遵裕",
    label: "敌手",
    description: "梁太后坚壁清野，宋军围灵州不克，粮尽大溃，高遵裕仅以身免。",
    eventSummaries: {
      "xixia-09": "梁太后坚守灵州，宋军粮尽溃败。",
    },
  },
  {
    a: "李乾顺",
    b: "辽天祚帝",
    label: "盟友",
    description: "夏崇宗以宗室女嫁辽天祚帝，出兵援辽抗金，辽亡后转臣于金。",
    eventSummaries: {
      "xixia-10": "西夏援辽抗金，兵败后臣金。",
    },
  },
  {
    a: "成吉思汗",
    b: "李安全",
    label: "敌手",
    description: "蒙古围中兴府，夏襄宗纳女请和，西夏附蒙攻金，国势日蹙。",
    eventSummaries: {
      "xixia-11": "成吉思汗围中兴府，西夏请和。",
    },
  },
  {
    a: "成吉思汗",
    b: "李睍",
    label: "敌手",
    description: "蒙古军破中兴府，末帝李睍出降被杀，西夏亡。",
    eventSummaries: {
      "xixia-12": "蒙古灭夏，李睍出降被杀。",
    },
  },
  {
    a: "完颜阿骨打",
    b: "完颜吴乞买",
    label: "兄弟",
    description: "吴乞买为阿骨打之弟，后继位为金太宗，灭辽伐宋。",
    eventSummaries: {
      "jin-04": "阿骨打称帝，吴乞买为谙班勃极烈继统。",
    },
  },
  {
    a: "完颜阿骨打",
    b: "完颜希尹",
    label: "君臣",
    description: "完颜希尹为金初重臣，创制女真文字，佐阿骨打立国。",
    eventSummaries: {
      "jin-04": "希尹佐阿骨打建国，创女真文字。",
    },
  },
  {
    a: "完颜亮",
    b: "张浩",
    label: "君臣",
    description: "张浩奉诏营建中都，完颜亮迁都燕京，金之制度多由张浩裁定。",
    eventSummaries: {
      "jin-05": "完颜亮迁都燕京，张浩董其役。",
    },
  },
  {
    a: "完颜宗望",
    b: "赵桓",
    label: "敌手",
    description: "宗望围汴京，钦宗割三镇请和，金军退而宋廷和战不定。",
    eventSummaries: {
      "jin-06": "宗望围汴京，钦宗割地请和。",
    },
  },
  {
    a: "完颜宗翰",
    b: "张邦昌",
    label: "扶立",
    description: "宗翰立张邦昌为楚帝，邦昌畏惧南归，旋去帝号迎康王。",
    eventSummaries: {
      "jin-07": "金立张邦昌为楚帝，旋废。",
    },
  },
  {
    a: "完颜宗翰",
    b: "刘豫",
    label: "扶立",
    description: "宗翰主持册立刘豫为齐帝，以齐为金宋缓冲，后刘豫屡败被废。",
    eventSummaries: {
      "jin-08": "金立刘豫为齐帝，与宋对峙。",
    },
  },
  {
    a: "完颜雍",
    b: "完颜亮",
    label: "政敌",
    description: "完颜雍乘完颜亮南侵之机于辽阳称帝，完颜亮旋为部下所杀，雍入主中都。",
    eventSummaries: {
      "jin-09": "完颜雍辽阳称帝，完颜亮遇弑。",
    },
  },
  {
    a: "完颜永济",
    b: "成吉思汗",
    label: "敌手",
    description: "成吉思汗轻卫绍王无能，断然南下攻金，金之北疆遂溃。",
    eventSummaries: {
      "jin-10": "卫绍王即位，成吉思汗南下攻金。",
    },
  },
  {
    a: "成吉思汗",
    b: "完颜承裕",
    label: "敌手",
    description: "野狐岭之战蒙古以少胜多，完颜承裕大军溃散，金之精锐尽没。",
    eventSummaries: {
      "jin-11": "蒙古于野狐岭大破完颜承裕。",
    },
  },
  {
    a: "成吉思汗",
    b: "木华黎",
    label: "君臣",
    description: "木华黎为成吉思汗麾下名将，野狐岭率左翼冲阵，后受封太师国王经略中原。",
    eventSummaries: {
      "jin-11": "木华黎从征野狐岭，冲溃金军左翼。",
    },
  },
  {
    a: "完颜珣",
    b: "术虎高琪",
    label: "君臣",
    description: "术虎高琪专擅朝政，宣宗迁都汴京，弃河北于不顾，金势愈蹙。",
    eventSummaries: {
      "jin-12": "宣宗迁都汴京，术虎高琪专权。",
    },
  },
  {
    a: "成吉思汗",
    b: "完颜珣",
    label: "敌手",
    description: "蒙古破中都，金宣宗南迁后无力北顾，金之根本尽失。",
    eventSummaries: {
      "jin-13": "蒙古破中都，金室南迁苟安。",
    },
  },
  {
    a: "金哀宗",
    b: "完颜珣",
    label: "父子",
    description: "哀宗为宣宗第三子，即位后力图中兴，然金已三面受敌。",
    eventSummaries: {
      "jin-14": "哀宗即位，力图振作而国势难回。",
    },
  },
  {
    a: "拖雷",
    b: "完颜合达",
    label: "敌手",
    description: "三峰山之战拖雷以少胜多，金军主力尽丧，完颜合达战死。",
    eventSummaries: {
      "jin-15": "拖雷大破金军于三峰山，完颜合达战死。",
    },
  },
  {
    a: "崔立",
    b: "金哀宗",
    label: "叛臣",
    description: "崔立乘哀宗东走，以汴京城降蒙古，尽送金室宗属，金之根本遂绝。",
    eventSummaries: {
      "jin-16": "崔立以汴京城降蒙，金室宗属被掳。",
    },
  },
  {
    a: "纥石烈胡沙虎",
    b: "完颜永济",
    label: "叛臣",
    description: "胡沙虎弑卫绍王，立宣宗，旋为术虎高琪所杀，金室骨肉相残。",
    eventSummaries: {
      "jin-17": "胡沙虎弑卫绍王，拥立宣宗。",
    },
  },
  {
    a: "完颜宗弼",
    b: "赵构",
    label: "敌手",
    description: "兀术渡江追击，高宗浮海避难，金军北还时为韩世忠所阻于黄天荡。",
    eventSummaries: {
      "jin-18": "完颜宗弼渡江追高宗，高宗航海避之。",
    },
  },
  {
    a: "完颜宗弼",
    b: "刘锜",
    label: "敌手",
    description: "顺昌之战刘锜以少击众，大破兀术拐子马，金军南侵之势受挫。",
    eventSummaries: {
      "jin-19": "刘锜守顺昌，大破兀术。",
    },
  },
  {
    a: "拔都",
    b: "速不台",
    label: "同僚",
    description: "拔都统西征军，速不台为副，长驱东欧，战功最著。",
    eventSummaries: {
      "yuan-11": "拔都、速不台率军西征钦察、斡罗思。",
    },
  },
  {
    a: "窝阔台",
    b: "乃马真",
    label: "夫妻",
    description: "窝阔台崩后，乃马真后称制五年，政出多门，为汗位纷争埋下祸根。",
    eventSummaries: {
      "yuan-12": "窝阔台崩，乃马真后称制。",
    },
  },
  {
    a: "阔端",
    b: "萨迦班智达",
    label: "招抚",
    description: "阔端以凉州会盟招抚吐蕃，萨迦班智达致书诸部归附，吐蕃遂为蒙古属地。",
    eventSummaries: {
      "yuan-13": "阔端与萨迦班智达会盟，吐蕃归附。",
    },
  },
  {
    a: "蒙哥",
    b: "拔都",
    label: "盟友",
    description: "拔都力推蒙哥即位，蒙古汗位自此由窝阔台系转归拖雷系。",
    eventSummaries: {
      "yuan-14": "拔都推蒙哥即位，拖雷系得汗位。",
    },
  },
  {
    a: "忽必烈",
    b: "兀良合台",
    label: "君臣",
    description: "兀良合台为远征大理的先锋，平大理后留镇云南，屡征交趾。",
    eventSummaries: {
      "yuan-15": "兀良合台从忽必烈平大理，留镇云南。",
    },
  },
  {
    a: "旭烈兀",
    b: "蒙哥",
    label: "兄弟",
    description: "旭烈兀为蒙哥之弟，奉兄命西征，灭阿拔斯王朝，建伊儿汗国。",
    eventSummaries: {
      "yuan-16": "旭烈兀奉蒙哥命西征，破巴格达。",
    },
  },
  {
    a: "忽必烈",
    b: "阿里不哥",
    label: "政敌",
    description: "蒙哥死后忽必烈与阿里不哥各即汗位，争战四年，阿里不哥终降。",
    eventSummaries: {
      "yuan-17": "忽必烈与阿里不哥争汗位，内战四年。",
      "yuan-19": "阿里不哥请降，汗位之争终结。",
    },
  },
  {
    a: "忽必烈",
    b: "李璮",
    label: "叛臣",
    description: "李璮据济南反元，忽必烈调军讨平，事后尽收世侯兵权。",
    eventSummaries: {
      "yuan-18": "李璮据济南反，兵败身死。",
    },
  },
  {
    a: "忽必烈",
    b: "忻都",
    label: "君臣",
    description: "忻都统东路军征日，遇风涛败还，后又参与弘安之役。",
    eventSummaries: {
      "yuan-20": "忻都率军征日，遇台风败还。",
    },
  },
  {
    a: "郭守敬",
    b: "忽必烈",
    label: "君臣",
    description: "忽必烈命郭守敬改历，守敬制器实测，成《授时历》，行用三百余年。",
    eventSummaries: {
      "yuan-21": "忽必烈命郭守敬改历，成《授时历》。",
    },
  },
  {
    a: "郭守敬",
    b: "王恂",
    label: "同僚",
    description: "郭守敬主测验，王恂主推算，共成《授时历》。",
    eventSummaries: {
      "yuan-21": "郭守敬、王恂共修《授时历》。",
    },
  },
  {
    a: "范文虎",
    b: "忻都",
    label: "同僚",
    description: "范文虎统江南军、忻都统东路军再征日本，会师后遭飓风，全军覆没。",
    eventSummaries: {
      "yuan-22": "范文虎、忻都率军征日，遇飓风覆没。",
    },
  },
  {
    a: "忽必烈",
    b: "唆都",
    label: "君臣",
    description: "唆都奉命征占城，孤军深入，久战无功，后战死于安南。",
    eventSummaries: {
      "yuan-23": "唆都征占城不克，后战死安南。",
    },
  },
  {
    a: "脱欢",
    b: "陈兴道",
    label: "敌手",
    description: "脱欢征安南，陈兴道坚壁清野、伏击元军，元军疫病交加，被迫退兵。",
    eventSummaries: {
      "yuan-24": "脱欢征安南，为陈兴道所败。",
    },
  },
  {
    a: "忽必烈",
    b: "桑哥",
    label: "君臣",
    description: "桑哥以理财得幸，专权四年，后以赃罪下狱诛死。",
    eventSummaries: {
      "yuan-25": "桑哥以理财得幸，专权后被诛。",
    },
  },
  {
    a: "杨琏真迦",
    b: "桑哥",
    label: "同党",
    description: "杨琏真迦倚桑哥之势横行江南，盗宋陵事发，桑哥倒台后亦获罪。",
    eventSummaries: {
      "yuan-26": "杨琏真迦倚桑哥盗宋陵，后获罪。",
    },
  },
  {
    a: "忽必烈",
    b: "铁穆耳",
    label: "祖孙",
    description: "铁穆耳为忽必烈之孙，受遗诏即位，罢兵守成，元政稍安。",
    eventSummaries: {
      "yuan-27": "忽必烈崩，孙铁穆耳即位为成宗。",
    },
  },
  {
    a: "海山",
    b: "爱育黎拔力八达",
    label: "兄弟",
    description: "武宗、仁宗兄弟相约兄终弟及、叔侄相传，然仁宗后违约传子，元室继承之争复起。",
    eventSummaries: {
      "yuan-28": "武宗、仁宗兄弟授受，约兄终弟及。",
    },
  },
  {
    a: "爱育黎拔力八达",
    b: "李孟",
    label: "君臣",
    description: "李孟力主复科举，仁宗从之，元之取士之制始立。",
    eventSummaries: {
      "yuan-29": "仁宗用李孟议恢复科举。",
    },
  },
  {
    a: "铁失",
    b: "元英宗",
    label: "叛臣",
    description: "铁失纠集保守贵族弑英宗于南坡，迎立泰定帝，元室之乱愈烈。",
    eventSummaries: {
      "yuan-30": "铁失弑英宗于南坡，迎立泰定帝。",
    },
  },
  {
    a: "燕铁木儿",
    b: "元文宗",
    label: "君臣",
    description: "燕铁木儿以拥立之功专权，文宗倚之，明宗暴崩事涉嫌疑。",
    eventSummaries: {
      "yuan-31": "燕铁木儿拥立文宗，两都之战后明宗暴崩。",
    },
  },
  {
    a: "元文宗",
    b: "虞集",
    label: "君臣",
    description: "文宗好文雅，命虞集领修《经世大典》，元之文治于斯为盛。",
    eventSummaries: {
      "yuan-32": "文宗命虞集修《经世大典》。",
    },
  },
  {
    a: "元顺帝",
    b: "伯颜",
    label: "君臣",
    description: "伯颜拥立顺帝而专权，蔑视汉法，顺帝与脱脱定计逐之。",
    eventSummaries: {
      "yuan-33": "伯颜专权，顺帝与脱脱逐之。",
    },
  },
  {
    a: "伯颜",
    b: "脱脱",
    label: "政敌",
    description: "脱脱为伯颜之侄，反助顺帝逐伯颜，后行更化之政。",
    eventSummaries: {
      "yuan-33": "脱脱助顺帝逐伯颜。",
    },
  },
  {
    a: "韩山童",
    b: "刘福通",
    label: "同党",
    description: "韩山童倡言明王出世，刘福通佐之起兵，事泄山童被杀，福通继领其众。",
    eventSummaries: {
      "yuan-35": "韩山童、刘福通颍州起兵，红巾军兴。",
    },
  },
  {
    a: "郭子兴",
    b: "朱元璋",
    label: "翁婿",
    description: "郭子兴起兵濠州，朱元璋投其麾下，娶其养女马氏，渐掌兵权。",
    eventSummaries: {
      "yuan-36": "朱元璋投郭子兴，娶马氏，渐领其军。",
    },
  },
  {
    a: "朱元璋",
    b: "汤和",
    label: "同乡",
    description: "汤和与朱元璋同里，先投红巾军，邀元璋入伍，后为明开国名将。",
    eventSummaries: {
      "yuan-36": "汤和邀朱元璋投郭子兴军。",
    },
  },
  {
    a: "脱脱",
    b: "张士诚",
    label: "敌手",
    description: "脱脱围高邮，张士诚旦夕且下，会朝中劾其劳师，诏夺兵权，元军遂溃。",
    eventSummaries: {
      "yuan-37": "脱脱围高邮将克，被夺兵权，元军大溃。",
    },
  },
  {
    a: "刘福通",
    b: "韩林儿",
    label: "君臣",
    description: "刘福通奉韩林儿为小明王，建宋政权，红巾军诸部奉其号令。",
    eventSummaries: {
      "yuan-38": "刘福通迎韩林儿称小明王，国号宋。",
    },
  },
  {
    a: "徐达",
    b: "常遇春",
    label: "同僚",
    description: "徐达、常遇春并为明初北伐主帅，徐达持重、遇春骁勇，相得益彰。",
    eventSummaries: {
      "ming-21": "徐达、常遇春率军北伐，克大都。",
    },
  },
  {
    a: "徐达",
    b: "元顺帝",
    label: "敌手",
    description: "徐达破大都，元顺帝北走上都，元在中原的统治终结。",
    eventSummaries: {
      "ming-21": "徐达克大都，元顺帝北逃。",
    },
  },
  {
    a: "朱元璋",
    b: "胡惟庸",
    label: "君臣",
    description: "胡惟庸为明初最后一任丞相，以谋反罪被诛，朱元璋借机废相，皇权独揽。",
    eventSummaries: {
      "ming-22": "胡惟庸以谋反被诛，朱元璋废丞相。",
    },
  },
  {
    a: "沐英",
    b: "傅友德",
    label: "同僚",
    description: "沐英从傅友德平云南，后留镇其地，沐氏世守云南二百余年。",
    eventSummaries: {
      "ming-23": "沐英从傅友德平云南，留镇其地。",
    },
  },
  {
    a: "朱元璋",
    b: "蓝玉",
    label: "君臣",
    description: "蓝玉恃功骄横，朱元璋兴大狱诛之，牵连甚众，功臣宿将几尽。",
    eventSummaries: {
      "ming-24": "蓝玉以谋反被诛，牵连万五千人。",
    },
  },
  {
    a: "朱棣",
    b: "方孝孺",
    label: "君臣",
    description: "方孝孺为建文帝师，拒不草即位诏，被朱棣诛十族，士林震恸。",
    eventSummaries: {
      "ming-25": "方孝孺拒草诏，被朱棣诛十族。",
    },
  },
  {
    a: "朱棣",
    b: "本雅失里",
    label: "敌手",
    description: "朱棣五征漠北，首次出师即败本雅失里于斡难河，鞑靼远遁。",
    eventSummaries: {
      "ming-26": "朱棣亲征，败本雅失里于斡难河。",
    },
  },
  {
    a: "朱棣",
    b: "夏原吉",
    label: "君臣",
    description: "夏原吉主户部，佐永乐迁都、北征、下西洋诸役，调度有方。",
    eventSummaries: {
      "ming-27": "夏原吉佐永乐迁都、营建北京。",
    },
  },
  {
    a: "明英宗",
    b: "王振",
    label: "君臣",
    description: "英宗宠信宦官王振，从其亲征之议，致土木堡全军覆没。",
    eventSummaries: {
      "ming-28": "英宗从王振亲征，土木堡被俘。",
    },
  },
  {
    a: "明英宗",
    b: "也先",
    label: "敌手",
    description: "也先围英宗于土木堡，俘之北去，后挟以叩关。",
    eventSummaries: {
      "ming-28": "也先俘英宗于土木堡。",
    },
  },
  {
    a: "于谦",
    b: "景泰帝",
    label: "君臣",
    description: "于谦力主固守，拥立景帝以绝瓦剌要挟，督战九门，京师获全。",
    eventSummaries: {
      "ming-29": "于谦拥立景帝，督军守北京。",
    },
  },
  {
    a: "于谦",
    b: "也先",
    label: "敌手",
    description: "也先挟英宗至京师，于谦拒之，列阵九门，瓦剌攻城不克而退。",
    eventSummaries: {
      "ming-29": "也先挟英宗叩关，于谦击退之。",
    },
  },
  {
    a: "石亨",
    b: "于谦",
    label: "政敌",
    description: "石亨本受于谦荐用，后忌其功，乘景帝病笃发动夺门之变，害死于谦。",
    eventSummaries: {
      "ming-30": "石亨等发动夺门之变，杀于谦。",
    },
  },
  {
    a: "明武宗",
    b: "刘瑾",
    label: "君臣",
    description: "武宗委政于刘瑾，时称「立皇帝」，后因张永告发，凌迟处死。",
    eventSummaries: {
      "ming-31": "刘瑾专权，武宗后命凌迟处死。",
    },
  },
  {
    a: "嘉靖帝",
    b: "杨廷和",
    label: "君臣",
    description: "杨廷和以首辅力争大礼，嘉靖帝借张璁之力挫之，皇权大张。",
    eventSummaries: {
      "ming-32": "大礼议起，嘉靖帝挫杨廷和。",
    },
  },
  {
    a: "俺答汗",
    b: "嘉靖帝",
    label: "敌手",
    description: "俺答汗兵临北京，嘉靖帝束手，严嵩主闭城不战，任其饱掠而去。",
    eventSummaries: {
      "ming-33": "俺答汗逼北京，焚掠而去。",
    },
  },
  {
    a: "戚继光",
    b: "谭纶",
    label: "同僚",
    description: "谭纶巡抚浙江，力荐戚继光练兵抗倭，二人同心，浙倭遂平。",
    eventSummaries: {
      "ming-34": "谭纶荐戚继光练兵，台州九战九捷。",
    },
  },
  {
    a: "高拱",
    b: "张居正",
    label: "同僚",
    description: "高拱、张居正同在内阁，主持俺答封贡，北边获数十年之安。",
    eventSummaries: {
      "ming-35": "高拱、张居正主持俺答封贡。",
    },
  },
  {
    a: "李如松",
    b: "丰臣秀吉",
    label: "敌手",
    description: "李如松率明军援朝，平壤大捷，日军退守，终因丰臣秀吉之死而撤。",
    eventSummaries: {
      "ming-36": "李如松援朝，平壤大破日军。",
    },
  },
  {
    a: "邓子龙",
    b: "李舜臣",
    label: "盟友",
    description: "露梁海战中邓子龙与李舜臣并肩作战，俱战死，日军败退。",
    eventSummaries: {
      "ming-36": "邓子龙、李舜臣露梁海战俱殉。",
    },
  },
  {
    a: "李化龙",
    b: "杨应龙",
    label: "敌手",
    description: "李化龙督八路进剿播州，杨应龙兵败自焚，播州改土归流。",
    eventSummaries: {
      "ming-37": "李化龙平播州，杨应龙自焚。",
    },
  },
  {
    a: "努尔哈赤",
    b: "杨镐",
    label: "敌手",
    description: "萨尔浒之战努尔哈赤凭「凭尔几路来，我只一路去」之法，五日破明三路。",
    eventSummaries: {
      "ming-38": "努尔哈赤大破杨镐四路明军。",
    },
  },
  {
    a: "努尔哈赤",
    b: "杜松",
    label: "敌手",
    description: "杜松孤军深入，于萨尔浒山战死，明军西路军覆没。",
    eventSummaries: {
      "ming-38": "杜松战死萨尔浒，明军西路覆没。",
    },
  },
  {
    a: "王化贞",
    b: "熊廷弼",
    label: "政敌",
    description: "王化贞、熊廷弼经抚不和，一战而溃，二人皆论死，辽东不可复守。",
    eventSummaries: {
      "ming-39": "经抚不和，广宁失守。",
    },
  },
  {
    a: "皇太极",
    b: "袁崇焕",
    label: "敌手",
    description: "皇太极避宁锦坚城，绕道入塞，复行反间，借崇祯之手除袁崇焕。",
    eventSummaries: {
      "ming-40": "皇太极入塞行反间，袁崇焕下狱。",
    },
  },
  {
    a: "利玛窦",
    b: "徐光启",
    label: "友",
    description: "利玛窦与徐光启合译《几何原本》，徐光启受洗入教，西学东渐之始。",
    eventSummaries: {
      "ming-41": "利玛窦、徐光启合译《几何原本》。",
    },
  },
  {
    a: "李定国",
    b: "孔有德",
    label: "敌手",
    description: "李定国破桂林，孔有德自焚而死，清廷震动。",
    eventSummaries: {
      "qing-23": "李定国破桂林，孔有德自焚。",
    },
  },
  {
    a: "李定国",
    b: "尼堪",
    label: "敌手",
    description: "衡州之战李定国阵斩敬谨亲王尼堪，时称「两蹶名王」。",
    eventSummaries: {
      "qing-23": "李定国阵斩尼堪于衡州。",
    },
  },
  {
    a: "郑成功",
    b: "张煌言",
    label: "盟友",
    description: "郑成功与张煌言联师北伐，围南京，功败垂成，张煌言旋败死。",
    eventSummaries: {
      "qing-24": "郑成功、张煌言北伐，围南京而败。",
    },
  },
  {
    a: "郑成功",
    b: "揆一",
    label: "敌手",
    description: "郑成功围热兰遮城九月，荷兰总督揆一出降，台湾结束荷兰殖民统治。",
    eventSummaries: {
      "qing-25": "郑成功围热兰遮城，揆一请降。",
    },
  },
  {
    a: "孝庄太后",
    b: "康熙帝",
    label: "祖孙",
    description: "孝庄太后辅佐顺治、康熙两朝，康熙幼年赖其教养扶持。",
    eventSummaries: {
      "qing-26": "孝庄太后抚育康熙，稳定朝局。",
    },
  },
  {
    a: "施琅",
    b: "刘国轩",
    label: "敌手",
    description: "澎湖海战施琅大破刘国轩水师，郑氏主力尽丧，台湾遂降。",
    eventSummaries: {
      "qing-27": "施琅澎湖大破刘国轩，郑氏归降。",
    },
  },
  {
    a: "施琅",
    b: "郑克塽",
    label: "受降",
    description: "郑克塽奉表归降，施琅入台安民，台湾纳入清朝版图。",
    eventSummaries: {
      "qing-27": "施琅受郑克塽之降，收复台湾。",
    },
  },
  {
    a: "康熙帝",
    b: "萨布素",
    label: "君臣",
    description: "康熙帝命萨布素统黑龙江军围攻雅克萨，驱逐俄军，为尼布楚谈判奠基。",
    eventSummaries: {
      "qing-28": "萨布素奉康熙命围攻雅克萨。",
    },
  },
  {
    a: "索额图",
    b: "戈洛文",
    label: "交涉",
    description: "索额图与戈洛文往复谈判，划定中俄东段边界，立碑为界。",
    eventSummaries: {
      "qing-29": "索额图与戈洛文订《尼布楚条约》。",
    },
  },
  {
    a: "康熙帝",
    b: "噶尔丹",
    label: "敌手",
    description: "康熙帝三征噶尔丹，乌兰布通破其驼城，噶尔丹势蹙。",
    eventSummaries: {
      "qing-30": "康熙帝破噶尔丹驼城于乌兰布通。",
    },
  },
  {
    a: "费扬古",
    b: "噶尔丹",
    label: "敌手",
    description: "费扬古于昭莫多设伏，大破噶尔丹，噶尔丹仅以身免，旋自尽。",
    eventSummaries: {
      "qing-31": "费扬古昭莫多设伏，大破噶尔丹。",
    },
  },
  {
    a: "康熙帝",
    b: "岳钟琪",
    label: "君臣",
    description: "岳钟琪从征西藏，逐准噶尔军，后为雍正朝西陲重将。",
    eventSummaries: {
      "qing-32": "岳钟琪从征西藏，驱逐准军。",
    },
  },
  {
    a: "雍正帝",
    b: "鄂尔泰",
    label: "君臣",
    description: "鄂尔泰总督云贵，力主改土归流，雍正帝倾心委任，西南遂定。",
    eventSummaries: {
      "qing-33": "雍正用鄂尔泰改土归流，西南渐定。",
    },
  },
  {
    a: "年羹尧",
    b: "岳钟琪",
    label: "同僚",
    description: "年羹尧、岳钟琪分统大军平定青海，岳钟琪奇袭获胜，年羹尧旋以骄纵赐死。",
    eventSummaries: {
      "qing-34": "年羹尧、岳钟琪平定青海之乱。",
    },
  },
  {
    a: "乾隆帝",
    b: "兆惠",
    label: "君臣",
    description: "兆惠为平准、平回主帅，乾隆帝倚之，图形紫光阁。",
    eventSummaries: {
      "qing-35": "兆惠奉乾隆命平准噶尔。",
    },
  },
  {
    a: "兆惠",
    b: "波罗尼都",
    label: "敌手",
    description: "兆惠黑水营被围三月，卒破和卓军，波罗尼都败走巴达克山被杀。",
    eventSummaries: {
      "qing-36": "兆惠平大小和卓，定回疆。",
    },
  },
  {
    a: "乾隆帝",
    b: "马戛尔尼",
    label: "交涉",
    description: "马戛尔尼使华，以跪礼之争与通商之请触怒乾隆，清廷颁《敕谕》拒之。",
    eventSummaries: {
      "qing-37": "乾隆峻拒马戛尔尼通商之请。",
    },
  },
  {
    a: "嘉庆帝",
    b: "和珅",
    label: "君臣",
    description: "嘉庆帝即位即诛和珅，然白莲教之乱已起，十年始平，清朝元气大伤。",
    eventSummaries: {
      "qing-38": "白莲教起，嘉庆诛和珅而乱未已。",
    },
  },
  {
    a: "耆英",
    b: "璞鼎查",
    label: "交涉",
    description: "耆英与璞鼎查于南京下关江面英舰上签约，中国近代第一个不平等条约成立。",
    eventSummaries: {
      "qing-39": "耆英、璞鼎查订《南京条约》。",
    },
  },
  {
    a: "奕䜣",
    b: "额尔金",
    label: "交涉",
    description: "奕䜣留京议和，与英法订《北京条约》，圆明园已焚，国耻深重。",
    eventSummaries: {
      "qing-41": "奕䜣与额尔金订《北京条约》。",
    },
  },
  {
    a: "丁汝昌",
    b: "伊东祐亨",
    label: "敌手",
    description: "黄海海战丁汝昌率北洋舰队迎战伊东祐亨，威海卫被围，丁汝昌拒降自尽。",
    eventSummaries: {
      "qing-42": "丁汝昌拒降自尽，北洋水师覆没。",
    },
  },
  {
    a: "李鸿章",
    b: "伊藤博文",
    label: "交涉",
    description: "李鸿章赴马关与伊藤博文谈判，遇刺受伤仍签约，割台赔款，举国震愤。",
    eventSummaries: {
      "qing-43": "李鸿章与伊藤博文订《马关条约》。",
    },
  },
  {
    a: "孙中山",
    b: "黄兴",
    label: "同僚",
    description: "孙中山、黄兴并称「孙黄」，共创同盟会，领导辛亥革命。",
    eventSummaries: {
      "qing-44": "孙中山、黄兴领导辛亥革命。",
    },
  },
  {
    a: "孙中山",
    b: "袁世凯",
    label: "政敌",
    description: "孙中山让临时大总统位于袁世凯，袁旋称帝，二人终成政敌。",
    eventSummaries: {
      "qing-44": "孙中山让位袁世凯，袁后称帝。",
    },
  },
  {
    a: "隆裕太后",
    b: "袁世凯",
    label: "交涉",
    description: "隆裕太后主持退位之议，袁世凯以优待条件促成清帝逊位。",
    eventSummaries: {
      "qing-45": "隆裕太后颁退位诏，清亡。",
    },
  },
  {
    a: "汉文帝",
    b: "汉景帝",
    label: "父子",
    description: "文帝开创与民休息之政，景帝承之，轻徭薄赋，遂成文景之治。",
    eventSummaries: {
      "xihan-wenjing": "文帝、景帝相继休养生息，成文景之治。",
    },
  },
  {
    a: "汉文帝",
    b: "贾谊",
    label: "君臣",
    description: "贾谊上《治安策》，文帝虽未尽用而多采其言，汉政渐趋宽厚。",
    eventSummaries: {
      "xihan-wenjing": "贾谊上《治安策》，文帝纳其言。",
    },
  },
  {
    a: "汉武帝",
    b: "主父偃",
    label: "君臣",
    description: "主父偃献推恩之策，武帝行之，诸侯王国自析，不复能与中央抗衡。",
    eventSummaries: {
      "xihan-tuien": "主父偃献推恩令，武帝行之。",
    },
  },
  {
    a: "萧道成",
    b: "刘准",
    label: "君臣",
    description: "萧道成受宋顺帝刘准禅让，建南齐，刘宋亡。",
    eventSummaries: {
      "nanbeichao-13": "萧道成受刘准禅让，建南齐。",
    },
  },
  {
    a: "萧衍",
    b: "沈约",
    label: "君臣",
    description: "沈约力劝萧衍受禅，为梁开国佐命，后以忤旨忧惧而卒。",
    eventSummaries: {
      "nanbeichao-14": "沈约劝进，萧衍受禅建梁。",
    },
  },
  {
    a: "陈霸先",
    b: "王僧辩",
    label: "政敌",
    description: "陈霸先与王僧辩共平侯景，后袭杀僧辩，独揽梁政，终受禅建陈。",
    eventSummaries: {
      "nanbeichao-15": "陈霸先袭杀王僧辩，受禅建陈。",
    },
  },
  {
    a: "杨坚",
    b: "苏威",
    label: "君臣",
    description: "苏威与高颎共掌朝政，厘定律令、户籍，开皇之治赖之。",
    eventSummaries: {
      "sui-17": "苏威佐文帝厘定律令制度。",
    },
  },
  {
    a: "杨坚",
    b: "杨尚希",
    label: "君臣",
    description: "杨尚希上表言郡县过多、民少官多，文帝从之，废郡置州，冗官大省。",
    eventSummaries: {
      "sui-18": "杨尚希上表，隋废郡置州。",
    },
  },
  {
    a: "杨坚",
    b: "杨谅",
    label: "父子",
    description: "杨谅为文帝第五子，奉命东征高句丽，师出无功，后因谋反被废。",
    eventSummaries: {
      "sui-20": "杨谅奉父命征高句丽，无功而还。",
    },
  },
  {
    a: "杨广",
    b: "裴矩",
    label: "君臣",
    description: "裴矩承炀帝之意经营西域，撰《西域图记》，引诸国入朝，耗资甚巨。",
    eventSummaries: {
      "sui-22": "裴矩经营西域，撰《西域图记》。",
    },
  },
  {
    a: "李世民",
    b: "侯君集",
    label: "君臣",
    description: "侯君集灭高昌，功高而骄，后坐太子承乾谋反被诛。",
    eventSummaries: {
      "tang-46": "侯君集灭高昌，置安西都护府。",
    },
  },
  {
    a: "苏定方",
    b: "阿史那贺鲁",
    label: "敌手",
    description: "苏定方曳咥河以少胜多，追擒阿史那贺鲁，西突厥亡。",
    eventSummaries: {
      "tang-47": "苏定方擒阿史那贺鲁，西突厥亡。",
    },
  },
  {
    a: "刘仁轨",
    b: "扶余丰",
    label: "敌手",
    description: "白江口海战刘仁轨四战皆捷，焚倭船四百，扶余丰遁走，百济亡。",
    eventSummaries: {
      "tang-48": "刘仁轨白江口大破倭军，百济亡。",
    },
  },
  {
    a: "阿倍仲麻吕",
    b: "李隆基",
    label: "君臣",
    description: "阿倍仲麻吕留唐仕官，与李白、王维交游，玄宗朝官至秘书监。",
    eventSummaries: {
      "tang-49": "阿倍仲麻吕留唐仕官，玄宗礼遇之。",
    },
  },
  {
    a: "李存勖",
    b: "王镕",
    label: "盟友",
    description: "赵王王镕附晋，李存勖救赵破梁，河北诸镇遂多归晋。",
    eventSummaries: {
      "wudai-23": "李存勖救赵，柏乡大破梁军。",
    },
  },
  {
    a: "朱温",
    b: "朱友珪",
    label: "父子",
    description: "朱友珪弑父自立，旋为弟朱友贞讨诛，后梁内乱不已。",
    eventSummaries: {
      "wudai-24": "朱友珪弑朱温，旋为朱友贞所诛。",
    },
  },
  {
    a: "李嗣源",
    b: "冯道",
    label: "君臣",
    description: "明宗任冯道为相，冯道奏请刊刻九经，文化赖以保存。",
    eventSummaries: {
      "wudai-25": "明宗用冯道为相，刊刻九经。",
    },
  },
  {
    a: "李璟",
    b: "王延政",
    label: "敌手",
    description: "南唐元宗李璟遣军灭闽，王延政出降，闽地尽入南唐。",
    eventSummaries: {
      "wudai-26": "南唐灭闽，王延政出降。",
    },
  },
  {
    a: "李璟",
    b: "马希崇",
    label: "敌手",
    description: "楚国内乱，马希崇降南唐，南唐取湖南，然不能守，旋为周行逢所据。",
    eventSummaries: {
      "wudai-28": "南唐乘乱取楚，马希崇降。",
    },
  },
];

const relationIndex = new Map<string, PersonRelation>();
for (const record of PERSON_RELATIONS) {
  const key = pairKey(record.a, record.b);
  if (relationIndex.has(key)) {
    throw new Error(`人物关系重复收录：${record.a} × ${record.b}`);
  }
  relationIndex.set(key, {
    label: record.label,
    ...(record.description ? { description: record.description } : {}),
    eventSummaries: record.eventSummaries,
  });
}

/** 按 `pairKey(a, b)` 查询的已解析关系索引；图谱构建与面板共用。 */
export const PERSON_RELATION_INDEX: ReadonlyMap<string, PersonRelation> = relationIndex;
