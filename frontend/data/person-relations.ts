/**
 * 两人关系数据（人工校订）。
 *
 * 与事件库解耦：键是「人物对」，不是事件。图谱构建时按统一排序口径（`pairKey`）
 * 把关系挂到对应的关系边上；未收录的人物对不显示关系徽章，关系面板的事件简述
 * 自动回退到事件正文摘要（`TimelineEvent.description`）。
 *
 * 覆盖范围：
 * - V0.6.1：三国人物图全部 87 对关系、100 条「人物对—事件」简述。
 * - 秦汉、春秋战国留待 V0.6.3 数据补丁（只需往本文件追加记录，不动事件库）。
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
