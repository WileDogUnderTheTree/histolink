/**
 * 魏晋南北朝图谱的补足事件（只进人物图，不进时间轴）。
 *
 * 数据来源：docs/史脉_第一批_魏晋南北朝.md（30 位核心人物、约 60 条关系）。
 * 表中「共同参与事件」若与既有时间轴事件同题，person-graph.ts 直接复用时间轴事件 id；
 * 本文件只收录时间轴没有的事件，id 统一为 `weijin-*`，dynasty 表示其图谱分期归属
 * （曹魏归三国，作为西晋期的前史；东晋与前秦归东晋十六国；刘宋至北周归南北朝）。
 *
 * 年份为史书纪年：公元存正数、公元前存负数，不使用公元 0 年。
 * 事件描述据《晋书》《宋书》《梁书》《魏书》《北齐书》《周书》《隋书》等正史整理，
 * 保留出处括注；人物关系数据见 person-relations.ts。
 */
import type { TimelineEvent } from "./timeline-events";

export const WEIJIN_EVENTS: readonly TimelineEvent[] = [

  {
    id: "weijin-zhulin",
    title: "竹林之游",
    dynasty: "三国",
    year: 247,
    description:
      "嵇康、阮籍等同游山阳竹林，纵酒清谈，世称「竹林七贤」，开魏晋玄学之风。（据《晋书·嵇康传》）",
    participants: [
      "嵇康",
      "阮籍",
    ],
  },
  {
    id: "weijin-feicaofang",
    title: "司马师废曹芳",
    dynasty: "三国",
    year: 254,
    description:
      "司马师以魏帝曹芳与中书令李丰等谋图己，遂废曹芳为齐王，改立高贵乡公曹髦，皇权尽归司马氏。（据《晋书·景帝纪》）",
    participants: [
      "曹芳",
      "司马师",
    ],
  },
  {
    id: "weijin-simashi-zhuanquan",
    title: "司马师继掌魏政",
    dynasty: "三国",
    year: 254,
    description:
      "司马师于司马懿死后继掌魏政，以弟司马昭参预机密，兄弟相继专权，曹魏宗室益弱。（据《晋书·景帝纪》）",
    participants: [
      "司马师",
      "司马昭",
    ],
  },
  {
    id: "weijin-dazui",
    title: "阮籍大醉拒婚",
    dynasty: "三国",
    year: 258,
    description:
      "司马昭欲为子求娶阮籍之女，阮籍连日大醉六十日，使者不得言而止，藉此避祸。（据《晋书·阮籍传》）",
    participants: [
      "阮籍",
      "司马昭",
    ],
  },
  {
    id: "weijin-shmaohuan",
    title: "成济弑曹髦，立曹奂",
    dynasty: "三国",
    year: 260,
    description:
      "魏帝曹髦不甘坐废，率左右讨司马昭，太子舍人成济受贾充之命弑帝于阙下；司马昭另立曹奂为帝，改元景元。（据《晋书·文帝纪》）",
    participants: [
      "曹奂",
      "司马昭",
    ],
  },
  {
    id: "weijin-fengjinwang",
    title: "司马昭封晋王",
    dynasty: "三国",
    year: 264,
    description:
      "司马昭灭蜀后进爵晋王、加九锡，立子司马炎为世子；次年昭卒，炎继晋王位，代魏之势已成。（据《晋书·文帝纪》）",
    participants: [
      "司马昭",
      "司马炎",
    ],
  },
  {
    id: "weijin-jingzhou",
    title: "羊祜经营荆州",
    dynasty: "西晋",
    year: 269,
    description:
      "羊祜都督荆州诸军事，镇襄阳，开屯田、绥远近，与吴将陆抗相持，为平吴积蓄粮械。（据《晋书·羊祜传》）",
    participants: [
      "羊祜",
      "司马炎",
    ],
  },
  {
    id: "weijin-taizifei",
    title: "立司马衷为太子，贾南风为妃",
    dynasty: "西晋",
    year: 272,
    description:
      "武帝立痴愚之子司马衷为皇太子，聘贾充女贾南风为妃；贾氏妒而多权诈，为后来贾后专政之始。（据《晋书·后妃传》）",
    participants: [
      "司马炎",
      "司马衷",
      "贾南风",
    ],
  },
  {
    id: "weijin-yanglu",
    title: "羊祜陆抗荆州对峙",
    dynasty: "西晋",
    year: 272,
    description:
      "羊祜与吴将陆抗隔江对峙，互赠药酒不疑，各守疆界，时称「羊陆之交」。（据《晋书·羊祜传》）",
    participants: [
      "羊祜",
      "陆抗",
    ],
  },
  {
    id: "weijin-doufu",
    title: "石崇王恺斗富",
    dynasty: "西晋",
    year: 285,
    description:
      "石崇与王恺争豪斗富，晋武帝助恺犹不能胜；蜡代薪、锦步障五十里，折射西晋奢靡之风。（据《晋书·石崇传》）",
    participants: [
      "王恺",
      "石崇",
      "司马炎",
    ],
  },
  {
    id: "weijin-erlu",
    title: "二陆入洛",
    dynasty: "西晋",
    year: 289,
    description:
      "陆机、陆云兄弟自吴入洛阳，以文才倾动京师，张华叹为「二俊」，时称「二陆」。（据《晋书·陆机传》）",
    participants: [
      "陆云",
      "陆机",
    ],
  },
  {
    id: "weijin-wenji",
    title: "祖逖刘琨闻鸡起舞",
    dynasty: "西晋",
    year: 289,
    description:
      "祖逖与刘琨俱为司州主簿，同寝，闻荒鸡鸣即起舞，相约以功业相期。（据《晋书·祖逖传》）",
    participants: [
      "刘琨",
      "祖逖",
    ],
  },
  {
    id: "weijin-jingu",
    title: "金谷二十四友之游",
    dynasty: "西晋",
    year: 296,
    description:
      "石崇筑金谷园，与潘岳、陆机等结「金谷二十四友」，依附权臣贾谧，诗酒唱和。（据《晋书·石崇传》）",
    participants: [
      "潘岳",
      "石崇",
    ],
  },
  {
    id: "weijin-zhongliu",
    title: "祖逖中流击楫",
    dynasty: "东晋十六国",
    year: 313,
    description:
      "祖逖请缨北伐，元帝仅给千人粮饷；逖渡江于中流击楫誓曰「不能清中原而复济者，有如大江」。（据《晋书·祖逖传》）",
    participants: [
      "祖逖",
      "司马睿",
    ],
  },
  {
    id: "weijin-erwang",
    title: "二王书法并称",
    dynasty: "东晋十六国",
    year: 350,
    description:
      "王羲之、王献之父子俱善书，羲之号为「书圣」，献之承其家法，后世并称「二王」。（据《晋书·王羲之传》）",
    participants: [
      "王献之",
      "王羲之",
    ],
  },
  {
    id: "weijin-feiyinhao",
    title: "桓温逼废殷浩",
    dynasty: "东晋十六国",
    year: 354,
    description:
      "殷浩北伐无功，桓温上书数其罪，朝廷遂废殷浩为庶人，桓温独揽内外大权。（据《晋书·殷浩传》）",
    participants: [
      "桓温",
      "殷浩",
    ],
  },
  {
    id: "weijin-menshi",
    title: "桓温王猛扪虱而谈",
    dynasty: "东晋十六国",
    year: 354,
    description:
      "桓温北伐入关，王猛披褐诣见，扪虱而谈当世之务，旁若无人；温不能用，猛归前秦。（据《晋书·苻坚载记》）",
    participants: [
      "桓温",
      "王猛",
    ],
  },
  {
    id: "weijin-xiean-huanwen",
    title: "桓温辟谢安为司马",
    dynasty: "东晋十六国",
    year: 360,
    description:
      "谢安年四十余始出仕，应桓温之辟为司马；温卒后安执政，终成淝水之功。（据《晋书·谢安传》）",
    participants: [
      "桓温",
      "谢安",
    ],
  },
  {
    id: "weijin-zhiguo",
    title: "王猛辅秦治国",
    dynasty: "东晋十六国",
    year: 360,
    description:
      "苻坚用王猛，猛明法峻刑、抑豪强、劝农桑，前秦国富兵强，终并北方。（据《晋书·苻坚载记》）",
    participants: [
      "王猛",
      "苻坚",
    ],
  },
  {
    id: "weijin-beifu",
    title: "谢玄组建北府兵",
    dynasty: "东晋十六国",
    year: 377,
    description:
      "谢玄镇广陵，招募徐、兖流民为兵，号「北府兵」，后为淝水破秦主力。（据《晋书·谢玄传》）",
    participants: [
      "谢安",
      "谢玄",
    ],
  },
  {
    id: "weijin-xiexuan-beifa",
    title: "谢玄北伐中原",
    dynasty: "东晋十六国",
    year: 384,
    description:
      "淝水战后，谢玄率北府兵北伐，收复徐、兖、青、司、豫诸州，前锋刘牢之进抵黄河。（据《晋书·谢玄传》）",
    participants: [
      "谢玄",
      "刘牢之",
    ],
  },
  {
    id: "weijin-canhebei",
    title: "参合陂之战",
    dynasty: "东晋十六国",
    year: 395,
    description:
      "拓跋珪大破后燕慕容宝于参合陂，坑降卒数万；慕容垂病中闻败，惭愤而卒，后燕由此衰。（据《魏书·太祖纪》）",
    participants: [
      "慕容垂",
      "慕容宝",
      "拓跋珪",
    ],
  },
  {
    id: "weijin-wudoumi",
    title: "陶渊明不为五斗米折腰",
    dynasty: "东晋十六国",
    year: 405,
    description:
      "陶渊明为彭泽令，郡遣督邮至，吏请束带迎，渊明叹「不能为五斗米折腰」，遂解印归隐。（据《晋书·陶潜传》）",
    participants: [
      "檀道济",
      "陶渊明",
    ],
  },
  {
    id: "weijin-guiyin",
    title: "陶渊明归隐终老",
    dynasty: "南北朝",
    year: 420,
    description:
      "刘裕代晋建宋，陶渊明隐居柴桑，躬耕自足，著诗文自娱，卒于元嘉四年。（据《宋书·隐逸传》）",
    participants: [
      "刘裕",
      "陶渊明",
    ],
  },
  {
    id: "weijin-yuanjia",
    title: "元嘉之治",
    dynasty: "南北朝",
    year: 424,
    description:
      "宋文帝刘义隆继位，改元元嘉，轻徭薄赋、劝学兴文，江左称治三十年。（据《宋书·文帝纪》）",
    participants: [
      "刘裕",
      "刘义隆",
    ],
  },
  {
    id: "weijin-linchao",
    title: "冯太后临朝称制",
    dynasty: "南北朝",
    year: 476,
    description:
      "献文帝欲禅位于叔父，冯太后鸩杀之，立孙拓跋宏为帝，以太皇太后临朝称制。（据《魏书·皇后传》）",
    participants: [
      "冯太后",
      "献文帝",
    ],
  },
  {
    id: "weijin-baipao",
    title: "白袍北伐",
    dynasty: "南北朝",
    year: 529,
    description:
      "梁武帝遣陈庆之护送元颢北还，庆之率七千白袍军自铚县至洛阳，连下三十二城。（据《梁书·陈庆之传》）",
    participants: [
      "萧衍",
      "陈庆之",
    ],
  },
  {
    id: "weijin-luoyang",
    title: "陈庆之败归南梁",
    dynasty: "南北朝",
    year: 529,
    description:
      "尔朱荣反攻洛阳，陈庆之孤军败退，渡河时遇洪流，仅以身免，白袍军尽没。（据《梁书·陈庆之传》）",
    participants: [
      "尔朱荣",
      "陈庆之",
    ],
  },
  {
    id: "weijin-shayuan",
    title: "沙苑之战",
    dynasty: "南北朝",
    year: 537,
    description:
      "高欢率二十万众攻西魏，宇文泰以万人伏于沙苑，大破之，东魏军弃甲而走。（据《周书·文帝纪》）",
    participants: [
      "高欢",
      "宇文泰",
    ],
  },
  {
    id: "weijin-liutiao",
    title: "苏绰六条诏书",
    dynasty: "南北朝",
    year: 541,
    description:
      "宇文泰以苏绰为度支尚书，颁六条诏书：先治心、敦教化、尽地利、擢贤良、恤狱讼、均赋役。（据《周书·苏绰传》）",
    participants: [
      "苏绰",
      "宇文泰",
    ],
  },
  {
    id: "weijin-bohaiwang",
    title: "高欢封渤海王",
    dynasty: "南北朝",
    year: 546,
    description:
      "高欢总揽东魏朝政，封渤海王，长子高澄为世子，继掌机要。（据《北齐书·神武纪》）",
    participants: [
      "高欢",
      "高澄",
    ],
  },
  {
    id: "weijin-houjing-pan",
    title: "侯景叛东魏奔梁",
    dynasty: "南北朝",
    year: 547,
    description:
      "高欢卒，侯景不服高澄，举兵叛，为慕容绍宗所破，遂以河南地降梁，梁武帝纳之。（据《梁书·侯景传》）",
    participants: [
      "侯景",
      "高澄",
    ],
  },
  {
    id: "weijin-beizhou-guanzhi",
    title: "西魏六官制",
    dynasty: "南北朝",
    year: 556,
    description:
      "宇文泰命苏绰、卢辩仿《周礼》建六官，至西魏末颁行，为北周官制所本。（据《周书·卢辩传》）",
    participants: [
      "卢辩",
      "苏绰",
      "宇文泰",
    ],
  },
  {
    id: "weijin-beizhou-waiqi",
    title: "杨坚以外戚辅政",
    dynasty: "南北朝",
    year: 578,
    description:
      "周宣帝即位，立杨丽华为皇后，杨坚以外戚进位上柱国；宣帝崩，坚受遗辅政，终代周建隋。（据《隋书·高祖纪》）",
    participants: [
      "杨坚",
      "宇文邕",
    ],
  },
];
