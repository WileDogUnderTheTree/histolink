# 引用结构化复核（V1.0.1 / TC-03）

> 本文件由 `scripts/extract-sources.mjs` 生成，随数据一起提交。
> 生成口径与校验口径共用 `scripts/lib/parse-sources.mjs`，不存在两套正则。

## 1. 总览

- 事件总数：896 条（时间轴 862 + 图谱补足 34）
- 有引用的事件：895 条；彩蛋（无引用）：1 条
- 引用条目：1182 条（其中 657 条事件 1 本书，238 条事件 2 本书）
- 书目标签：411 个；书目（按首个「·」切分）：119 种
- 括注尾注（如「年代依夏商周断代工程推定」）：75 条
- 特殊解析：裴注引 1 条（按 1 条引用计，见 §4）

> **与任务卡的口径差异**：任务卡记录「书目标签 185 种」，该数字只统计了括注中的**首个**书目；
> 本实现把并列书目（如「（据《旧唐书》《新唐书》）」）的第二本也作为独立标签，故实测 411 个标签。
> 引用条目 823 与任务卡一致（裴注引按 1 条计）。

## 2. 书目分布

| 书目 | 引用条目 | 标签数 |
|---|---:|---:|
| 丁奉传 | 1 | 1 |
| 三国史记 | 1 | 1 |
| 三国志 | 55 | 35 |
| 三朝北盟会编 | 1 | 1 |
| 三杨传 | 1 | 1 |
| 世本 | 1 | 1 |
| 于谦传 | 1 | 1 |
| 仆固怀恩传 | 1 | 1 |
| 俞大猷传 | 1 | 1 |
| 元史 | 53 | 4 |
| 光宗本纪 | 1 | 1 |
| 公羊传 | 1 | 1 |
| 关羽传 | 1 | 1 |
| 兵志 | 1 | 1 |
| 刑法志 | 1 | 1 |
| 则天皇后本纪 | 1 | 1 |
| 北齐书 | 3 | 2 |
| 南齐书 | 2 | 1 |
| 台湾外记 | 1 | 1 |
| 史记 | 237 | 59 |
| 后汉书 | 43 | 29 |
| 吕氏春秋 | 1 | 1 |
| 吴书 | 2 | 2 |
| 吴越春秋 | 1 | 1 |
| 周书 | 5 | 4 |
| 哀帝本纪 | 1 | 1 |
| 国语 | 4 | 3 |
| 地理志 | 1 | 1 |
| 墨子 | 1 | 1 |
| 大唐西域记 | 1 | 1 |
| 太宗本纪 | 1 | 1 |
| 太平公主传 | 1 | 1 |
| 太平御览 | 3 | 1 |
| 孙和传 | 1 | 1 |
| 宁宗本纪 | 1 | 1 |
| 宋书 | 7 | 5 |
| 宋史 | 106 | 23 |
| 宣宗本纪 | 1 | 1 |
| 宦官传 | 1 | 1 |
| 宪宗本纪 | 1 | 1 |
| 左传 | 20 | 11 |
| 庄子 | 1 | 1 |
| 庄烈帝本纪 | 1 | 1 |
| 庞统传 | 1 | 1 |
| 建炎以来系年要录 | 1 | 1 |
| 张浚传 | 1 | 1 |
| 张飞传 | 1 | 1 |
| 录鬼簿 | 1 | 1 |
| 徐达传 | 1 | 1 |
| 成祖本纪 | 1 | 1 |
| 战国策 | 1 | 1 |
| 文帝纪 | 1 | 1 |
| 新五代史 | 25 | 2 |
| 新唐书 | 54 | 6 |
| 方伎传 | 1 | 1 |
| 方腊传 | 1 | 1 |
| 旧五代史 | 26 | 1 |
| 旧唐书 | 68 | 18 |
| 明史 | 63 | 18 |
| 明季北略 | 1 | 1 |
| 明季南略 | 1 | 1 |
| 晋书 | 77 | 42 |
| 晏子春秋 | 1 | 1 |
| 景帝纪 | 1 | 1 |
| 朱升传 | 1 | 1 |
| 朱泚传 | 1 | 1 |
| 李定国传 | 1 | 1 |
| 李愬传 | 1 | 1 |
| 李晟传 | 1 | 1 |
| 杜预传 | 1 | 1 |
| 梁书 | 6 | 3 |
| 梦溪笔谈 | 2 | 1 |
| 楚辞 | 1 | 1 |
| 武帝纪 | 1 | 1 |
| 汉书 | 29 | 19 |
| 洛阳伽蓝记 | 1 | 1 |
| 海瑞传 | 1 | 1 |
| 清史稿 | 51 | 4 |
| 清太祖实录 | 1 | 1 |
| 瀛国公本纪 | 1 | 1 |
| 牛僧孺传 | 1 | 1 |
| 王世充传 | 1 | 1 |
| 王守仁传 | 1 | 1 |
| 王濬传 | 2 | 1 |
| 秃发树机能载记 | 1 | 1 |
| 秦桧传 | 1 | 1 |
| 窦建德传 | 1 | 1 |
| 童贯传 | 1 | 1 |
| 竹书纪年 | 23 | 1 |
| 纪年 | 5 | 1 |
| 续资治通鉴长编 | 2 | 1 |
| 胡惟庸传 | 1 | 1 |
| 艺文志 | 1 | 1 |
| 苏定方传 | 1 | 1 |
| 苏轼传 | 1 | 1 |
| 范仲淹传 | 1 | 1 |
| 蓝玉传 | 1 | 1 |
| 蜀书 | 5 | 4 |
| 袁崇焕传 | 1 | 1 |
| 论语 | 1 | 1 |
| 贾诩传 | 1 | 1 |
| 资治通鉴 | 18 | 4 |
| 辽史 | 24 | 2 |
| 选举志 | 1 | 1 |
| 郭嘉传 | 1 | 1 |
| 酷吏传 | 1 | 1 |
| 金史 | 33 | 3 |
| 钟会传 | 1 | 1 |
| 陆九渊集 | 1 | 1 |
| 陈书 | 2 | 2 |
| 隋书 | 25 | 3 |
| 青楼集 | 1 | 1 |
| 韩诗外传 | 1 | 1 |
| 韩非子 | 2 | 2 |
| 食货志 | 4 | 1 |
| 高僧传 | 1 | 1 |
| 高宗本纪 | 1 | 1 |
| 魏书 | 13 | 10 |
| 魏忠贤传 | 1 | 1 |

## 3. 标签清单（全部 411 个）

| 标签 | 书目 | 篇/章 | 引用次数 | 事件 |
|---|---|---|---:|---|
| 丁奉传 | 丁奉传 | — | 1 | sanguo-sunchenfeilianglixiusunxiuzhuchen-17 |
| 三国史记·高句丽本纪 | 三国史记 | 高句丽本纪 | 1 | sanguo-guanqiujianzhenggaojuli-07 |
| 三国志·三少帝纪 | 三国志 | 三少帝纪 | 1 | sanguo-simashifeicaofanglicaomao-13 |
| 三国志·吴主传 | 三国志 | 吴主传 | 2 | sanguo-sunquanergongzhizhengliaojie-08、sanguo-sunquanzuzhugekefuzheng-11 |
| 三国志·吴书·吴主传 | 三国志 | 吴书·吴主传 | 1 | sanguo-06 |
| 三国志·吴书·周瑜传 | 三国志 | 吴书·周瑜传 | 1 | handong-chibi |
| 三国志·吴书·孙破虏传 | 三国志 | 吴书·孙破虏传 | 1 | hanmo-01 |
| 三国志·吴书·孙讨逆传 | 三国志 | 吴书·孙讨逆传 | 2 | hanmo-03、hanmo-09 |
| 三国志·吴书·陆逊传 | 三国志 | 吴书·陆逊传 | 1 | sanguo-02 |
| 三国志·孙休传 | 三国志 | 孙休传 | 1 | sanguo-sunchenfeilianglixiusunxiuzhuchen-17 |
| 三国志·孙皓传 | 三国志 | 孙皓传 | 1 | xijin-jinmiewusanjiaguijin-06 |
| 三国志·明帝纪 | 三国志 | 明帝纪 | 1 | sanguo-weimingdituogu-05 |
| 三国志·曹爽传 | 三国志 | 曹爽传 | 1 | sanguo-caoshuangluoguzhiyi-06 |
| 三国志·毌丘俭传 | 三国志 | 毌丘俭传 | 2 | sanguo-guanqiujianwenqinzhipanhuainanerpan-15、sanguo-guanqiujianzhenggaojuli-07 |
| 三国志·王凌传 | 三国志 | 王凌传 | 1 | sanguo-wanglingzhipan-10 |
| 三国志·蜀书·先主传 | 三国志 | 蜀书·先主传 | 6 | handong-liubeiquyizhou-06、hanmo-02、hanmo-04… |
| 三国志·蜀书·关羽传 | 三国志 | 蜀书·关羽传 | 1 | handong-fanchang |
| 三国志·蜀书·刘二牧传 | 三国志 | 蜀书·刘二牧传 | 1 | hanmo-16 |
| 三国志·蜀书·庞统传 | 三国志 | 蜀书·庞统传 | 1 | hanmo-17 |
| 三国志·蜀书·诸葛亮传 | 三国志 | 蜀书·诸葛亮传 | 5 | hanmo-10、sanguo-03、sanguo-04… |
| 三国志·蜀书·马良传 | 三国志 | 蜀书·马良传 | 1 | sanguo-05 |
| 三国志·蜀书·魏延传 | 三国志 | 蜀书·魏延传 | 1 | hanmo-19 |
| 三国志·蜀书·黄忠传 | 三国志 | 蜀书·黄忠传 | 2 | handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08、hanmo-18 |
| 三国志·诸葛恪传 | 三国志 | 诸葛恪传 | 1 | sanguo-zhugekexinchengbaisunjunzhuke-12 |
| 三国志·诸葛诞传 | 三国志 | 诸葛诞传 | 1 | sanguo-zhugedanzhipanhuainansanpan-16 |
| 三国志·陆抗传 | 三国志 | 陆抗传 | 2 | sanguo-lukangzu-19、xijin-yanghududujingzhou-03 |
| 三国志·魏书·公孙瓒传 | 三国志 | 魏书·公孙瓒传 | 1 | hanmo-08 |
| 三国志·魏书·典韦传 | 三国志 | 魏书·典韦传 | 1 | hanmo-06 |
| 三国志·魏书·刘表传 | 三国志 | 魏书·刘表传 | 1 | hanmo-12 |
| 三国志·魏书·华佗传 | 三国志 | 魏书·华佗传 | 1 | hanmo-13 |
| 三国志·魏书·吕布传 | 三国志 | 魏书·吕布传 | 2 | handong-wangyunzhudongzhuocaocaoshouqingzhoubing-03、hanmo-07 |
| 三国志·魏书·张鲁传 | 三国志 | 魏书·张鲁传 | 1 | handong-caocaoquhanzhongxiangshuihuajie-07 |
| 三国志·魏书·文帝纪 | 三国志 | 魏书·文帝纪 | 1 | handong-han-fall |
| 三国志·魏书·武帝纪 | 三国志 | 魏书·武帝纪 | 5 | handong-beizhengwuhuansangumaolu-04、handong-caocao-emperor、handong-guandu… |
| 三国志·魏书·诸夏侯曹传 | 三国志 | 魏书·诸夏侯曹传 | 1 | sanguo-08 |
| 三国志·魏书·邓艾传 | 三国志 | 魏书·邓艾传 | 2 | sanguo-10、sanguo-mieshudaiweimiewu-18 |
| 三国志·魏书·陈群传 | 三国志 | 魏书·陈群传 | 1 | sanguo-jiupinzhongzhengzhichuangli-01 |
| 三朝北盟会编 | 三朝北盟会编 | — | 1 | jin-jinjueqiyuhaishangzhimeng-01 |
| 三杨传 | 三杨传 | — | 1 | ming-renxuanzhizhi-05 |
| 世本·作篇 | 世本 | 作篇 | 1 | xia-zhuzuojiadun-18 |
| 于谦传 | 于谦传 | — | 1 | ming-tumubaozhibianbeijingbaoweizhan-06 |
| 仆固怀恩传 | 仆固怀恩传 | — | 1 | tang-fanzhenyuhuanguangejuxingcheng-10 |
| 俞大猷传 | 俞大猷传 | — | 1 | ming-wohuanyukangwo-10 |
| 元史 | 元史 | — | 49 | jin-11、jin-12、jin-13… |
| 元史·世祖纪 | 元史 | 世祖纪 | 2 | nansong-xiangyangbaoweizhan-09、yuan-yingjiandadou-01 |
| 元史·太祖纪 | 元史 | 太祖纪 | 1 | xixia-menggumiexixia-01 |
| 元史·百官志 | 元史 | 百官志 | 1 | yuan-xingshengzhiduqueli-02 |
| 光宗本纪 | 光宗本纪 | — | 1 | ming-mingmosanan-14 |
| 公羊传·宣公十五年 | 公羊传 | 宣公十五年 | 1 | chunqiu-luguochushuimu-03 |
| 关羽传 | 关羽传 | — | 1 | handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08 |
| 兵志 | 兵志 | — | 1 | beisong-jiquanzhidujianshe-01 |
| 刑法志 | 刑法志 | — | 1 | ming-kaiguozhidujianshe-02 |
| 则天皇后本纪 | 则天皇后本纪 | — | 1 | tang-feiwangliwu-06 |
| 北齐书·文宣纪 | 北齐书 | 文宣纪 | 1 | nanbeichao-09 |
| 北齐书·神武纪 | 北齐书 | 神武纪 | 2 | nanbeichao-07、weijin-bohaiwang |
| 南齐书 | 南齐书 | — | 2 | nanbeichao-13、nanbeichao-14 |
| 台湾外记 | 台湾外记 | — | 1 | ming-nanmingyumingzheng-17 |
| 史记 | 史记 | — | 2 | xihan-tuien、xihan-wenjing |
| 史记·三代世表 | 史记 | 三代世表 | 3 | shang-08、xizhou-11、xizhou-13 |
| 史记·乐毅列传 | 史记 | 乐毅列传 | 1 | zhanguo-26 |
| 史记·六国年表 | 史记 | 六国年表 | 8 | zhanguo-02、zhanguo-03、zhanguo-13… |
| 史记·刺客列传 | 史记 | 刺客列传 | 2 | chunqiu-28、zhanguo-45 |
| 史记·匈奴列传 | 史记 | 匈奴列传 | 3 | xihan-baideng、xihan-four-generals、xihan-mayi |
| 史记·十二诸侯年表 | 史记 | 十二诸侯年表 | 9 | chunqiu-06、chunqiu-16、chunqiu-25… |
| 史记·南越列传 | 史记 | 南越列传 | 1 | xihan-nanyue |
| 史记·卫将军骠骑列传 | 史记 | 卫将军骠骑列传 | 3 | xihan-henan-battle、xihan-hexi-battle、xihan-mobei |
| 史记·吕不韦列传 | 史记 | 吕不韦列传 | 1 | zhanguo-39 |
| 史记·吕太后本纪 | 史记 | 吕太后本纪 | 4 | xihan-gaozu-death、xihan-lvhou-regent、xihan-lvhouchengzhizhulvzhiluan-01… |
| 史记·吴太伯世家 | 史记 | 吴太伯世家 | 5 | chunqiu-22、chunqiu-26、chunqiu-27… |
| 史记·吴王濞列传 | 史记 | 吴王濞列传 | 1 | han-seven-states |
| 史记·周本纪 | 史记 | 周本纪 | 21 | chunqiu-01、chunqiu-03、chunqiu-19… |
| 史记·商君列传 | 史记 | 商君列传 | 2 | zhanguo-08、zhanguo-10 |
| 史记·夏本纪 | 史记 | 夏本纪 | 30 | shang-02、xia-01、xia-02… |
| 史记·大宛列传 | 史记 | 大宛列传 | 3 | han-zhang-qian、xihan-dawan、xihan-zhangqian-again |
| 史记·孔子世家 | 史记 | 孔子世家 | 3 | chunqiu-40、chunqiu-45、chunqiu-kongzichuangliruxue-04 |
| 史记·孙子吴起列传 | 史记 | 孙子吴起列传 | 4 | chunqiu-29、zhanguo-04、zhanguo-07… |
| 史记·孝文本纪 | 史记 | 孝文本纪 | 1 | xihan-tiying |
| 史记·孟子荀卿列传 | 史记 | 孟子荀卿列传 | 2 | zhanguo-15、zhanguo-40 |
| 史记·宋微子世家 | 史记 | 宋微子世家 | 4 | chunqiu-11、chunqiu-hongshuizhizhan-02、shang-14… |
| 史记·封禅书 | 史记 | 封禅书 | 1 | qin-fengshan |
| 史记·屈原贾生列传 | 史记 | 屈原贾生列传 | 1 | zhanguo-29 |
| 史记·廉颇蔺相如列传 | 史记 | 廉颇蔺相如列传 | 3 | zhanguo-27、zhanguo-55、zhanguo-jiangxianghemianchizhihui-02 |
| 史记·张仪列传 | 史记 | 张仪列传 | 2 | zhanguo-14、zhanguo-18 |
| 史记·晋世家 | 史记 | 晋世家 | 8 | chunqiu-08、chunqiu-13、chunqiu-14… |
| 史记·曹相国世家 | 史记 | 曹相国世家 | 1 | xihan-xiao-cao |
| 史记·朝鲜列传 | 史记 | 朝鲜列传 | 1 | xihan-chaoxian |
| 史记·李斯列传 | 史记 | 李斯列传 | 4 | qin-sanchen-remonstrance、qin-shafu-coup、qin-zhaogao-chancellor… |
| 史记·楚世家 | 史记 | 楚世家 | 4 | chunqiu-04、chunqiu-18、xizhou-14… |
| 史记·殷本纪 | 史记 | 殷本纪 | 11 | shang-01、shang-03、shang-04… |
| 史记·河渠书 | 史记 | 河渠书 | 2 | zhanguo-35、zhanguo-37 |
| 史记·淮阴侯列传 | 史记 | 淮阴侯列传 | 4 | xihan-hanxin-pengyue、xihan-hanxin-qi、xihan-weishui… |
| 史记·燕召公世家 | 史记 | 燕召公世家 | 3 | zhanguo-11、zhanguo-48、zhanguo-54 |
| 史记·田单列传 | 史记 | 田单列传 | 1 | zhanguo-28 |
| 史记·田敬仲完世家 | 史记 | 田敬仲完世家 | 4 | zhanguo-20、zhanguo-25、zhanguo-51… |
| 史记·留侯世家 | 史记 | 留侯世家 | 1 | qin-bolangsha |
| 史记·白起王翦列传 | 史记 | 白起王翦列传 | 3 | zhanguo-23、zhanguo-31、zhanguo-33 |
| 史记·秦始皇本纪 | 史记 | 秦始皇本纪 | 22 | qin-arms-treasure、qin-baiyue、qin-book-burning… |
| 史记·秦始皇本纪·平津侯主父列传 | 史记 | 秦始皇本纪·平津侯主父列传 | 1 | qin-nanzhengbaiyuekaizaolingqu-01 |
| 史记·秦本纪 | 史记 | 秦本纪 | 7 | chunqiu-10、chunqiu-12、chunqiu-17… |
| 史记·穰侯列传 | 史记 | 穰侯列传 | 1 | zhanguo-24 |
| 史记·管蔡世家 | 史记 | 管蔡世家 | 1 | xizhou-05 |
| 史记·老子韩非列传 | 史记 | 老子韩非列传 | 6 | chunqiu-34、chunqiu-44、zhanguo-06… |
| 史记·苏秦列传·张仪列传 | 史记 | 苏秦列传·张仪列传 | 1 | zhanguo-hezonglianheng-01 |
| 史记·范睢蔡泽列传 | 史记 | 范睢蔡泽列传 | 1 | zhanguo-30 |
| 史记·蒙恬列传 | 史记 | 蒙恬列传 | 2 | qin-great-wall、qin-xiongnu |
| 史记·赵世家 | 史记 | 赵世家 | 2 | zhanguo-21、zhanguo-22 |
| 史记·越王勾践世家 | 史记 | 越王勾践世家 | 1 | xia-shaokangfengwuyuyuhuiji-15 |
| 史记·越王句践世家 | 史记 | 越王句践世家 | 3 | chunqiu-32、chunqiu-33、zhanguo-01 |
| 史记·郑世家 | 史记 | 郑世家 | 2 | chunqiu-02、chunqiu-24 |
| 史记·陈涉世家 | 史记 | 陈涉世家 | 1 | qin-daze-uprising |
| 史记·项羽本纪 | 史记 | 项羽本纪 | 5 | qin-julu-battle、qin-xiangyu-xianyang、xihan-gaixia… |
| 史记·高祖本纪 | 史记 | 高祖本纪 | 3 | han-founded、qin-liubang-xiangliang、qin-liubangruguanzhongyuefasanzhang-02 |
| 史记·魏世家 | 史记 | 魏世家 | 1 | zhanguo-50 |
| 史记·魏公子列传 | 史记 | 魏公子列传 | 2 | zhanguo-32、zhanguo-36 |
| 史记·鲁周公世家 | 史记 | 鲁周公世家 | 2 | xizhou-04、xizhou-08 |
| 史记·齐太公世家 | 史记 | 齐太公世家 | 6 | chunqiu-05、chunqiu-07、chunqiu-09… |
| 后汉书·东夷传 | 后汉书 | 东夷传 | 2 | xia-huaishijiuyilaichao-20、xia-xiejiajiuyijueming-24 |
| 后汉书·儒林传 | 后汉书 | 儒林传 | 2 | handong-baihuguan、handong-shuowen |
| 后汉书·光武帝纪 | 后汉书 | 光武帝纪 | 3 | handong-dutian、handong-founded、xihan-kunyang |
| 后汉书·党锢列传 | 后汉书 | 党锢列传 | 2 | handong-danggu-1、handong-danggu-2 |
| 后汉书·公孙述传 | 后汉书 | 公孙述传 | 1 | handong-gongsunshu |
| 后汉书·冯异传 | 后汉书 | 冯异传 | 1 | handong-chimei |
| 后汉书·列女传 | 后汉书 | 列女传 | 1 | hanmo-11 |
| 后汉书·刘焉传 | 后汉书 | 刘焉传 | 1 | handong-zhoumu |
| 后汉书·刘玄传 | 后汉书 | 刘玄传 | 1 | xihan-green-red |
| 后汉书·南匈奴传 | 后汉书 | 南匈奴传 | 1 | handong-xiongnu-split |
| 后汉书·孝灵帝纪 | 后汉书 | 孝灵帝纪 | 1 | handong-lingdi |
| 后汉书·宦者列传 | 后汉书 | 宦者列传 | 2 | han-cai-lun、handong-shun-emperor |
| 后汉书·张衡传 | 后汉书 | 张衡传 | 2 | handong-dizhenyi、handong-huntianyi |
| 后汉书·明帝纪·章帝纪 | 后汉书 | 明帝纪·章帝纪 | 1 | handong-mingzhangzhizhi-01 |
| 后汉书·显宗孝明帝纪 | 后汉书 | 显宗孝明帝纪 | 1 | handong-guangwu-death |
| 后汉书·梁冀传 | 后汉书 | 梁冀传 | 2 | handong-liangji、handong-zhidi |
| 后汉书·王允传 | 后汉书 | 王允传 | 1 | handong-wangyunzhudongzhuocaocaoshouqingzhoubing-03 |
| 后汉书·王景传 | 后汉书 | 王景传 | 1 | handong-wangjing |
| 后汉书·班固传 | 后汉书 | 班固传 | 1 | handong-hanshu |
| 后汉书·班超传 | 后汉书 | 班超传 | 3 | handong-banchao-death、handong-banchao-duhu、handong-banchao-start |
| 后汉书·皇甫嵩传 | 后汉书 | 皇甫嵩传 | 1 | han-yellow-turban |
| 后汉书·窦融传 | 后汉书 | 窦融传 | 1 | handong-yanran |
| 后汉书·肃宗孝章帝纪 | 后汉书 | 肃宗孝章帝纪 | 1 | handong-zhangdi |
| 后汉书·董卓传 | 后汉书 | 董卓传 | 3 | handong-dongzhuo、handong-dongzhuo-death、handong-liandong |
| 后汉书·蔡邕传 | 后汉书 | 蔡邕传 | 1 | handong-shijing |
| 后汉书·袁术传 | 后汉书 | 袁术传 | 1 | hanmo-05 |
| 后汉书·西域传 | 后汉书 | 西域传 | 3 | handong-fojiao、handong-fojiaodongchuanjianbaimasi-02、handong-ganying |
| 后汉书·西羌传 | 后汉书 | 西羌传 | 1 | handong-qiang-revolt |
| 后汉书·马援传 | 后汉书 | 马援传 | 1 | handong-zhengce |
| 吕氏春秋·顺民 | 吕氏春秋 | 顺民 | 1 | shang-tangdaosanglin-03 |
| 吴书·吕蒙传 | 吴书 | 吕蒙传 | 1 | handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08 |
| 吴书·吴主传 | 吴书 | 吴主传 | 1 | handong-caocaoquhanzhongxiangshuihuajie-07 |
| 吴越春秋 | 吴越春秋 | — | 1 | xia-shaokangfengwuyuyuhuiji-15 |
| 周书·卢辩传 | 周书 | 卢辩传 | 1 | weijin-beizhou-guanzhi |
| 周书·文帝纪 | 周书 | 文帝纪 | 1 | weijin-shayuan |
| 周书·武帝纪 | 周书 | 武帝纪 | 2 | nanbeichao-10、nanbeichao-zhouwudimiefo-07 |
| 周书·苏绰传 | 周书 | 苏绰传 | 1 | weijin-liutiao |
| 哀帝本纪 | 哀帝本纪 | — | 1 | tang-huangchaoqiyiyutangchaomiewang-17 |
| 国语·周语下 | 国语 | 周语下 | 2 | xia-kongjiajiwei-30、xia-kongjialuanxiazhuhoushipan-31 |
| 国语·晋语 | 国语 | 晋语 | 1 | xizhou-baosihuozhoufeidilishu-02 |
| 国语·晋语一 | 国语 | 晋语一 | 1 | xia-jiefayoushidemoxi-37 |
| 地理志 | 地理志 | — | 1 | tang-jingyingxiyu-04 |
| 墨子·公输 | 墨子 | 公输 | 1 | zhanguo-49 |
| 大唐西域记 | 大唐西域记 | — | 1 | tang-zhenggaojulixuanzangguiguo-05 |
| 太宗本纪 | 太宗本纪 | — | 1 | beisong-tongyinanbei-02 |
| 太平公主传 | 太平公主传 | — | 1 | tang-tanglongxiantianliangzhengbian-08 |
| 太平御览 | 太平御览 | — | 3 | xia-jinqianxihe-29、xia-zhuzhengdongyi-17、xia-zhuzuojiadun-18 |
| 孙和传 | 孙和传 | — | 1 | sanguo-sunquanergongzhizhengliaojie-08 |
| 宁宗本纪 | 宁宗本纪 | — | 1 | nansong-kaixibeifayujiadingheyi-06 |
| 宋书 | 宋书 | — | 1 | nanbeichao-13 |
| 宋书·文帝纪 | 宋书 | 文帝纪 | 1 | weijin-yuanjia |
| 宋书·武帝纪 | 宋书 | 武帝纪 | 3 | dongjin-liuyubeifa-12、nanbeichao-01、nanbeichao-liuyubeifamienanyan-02 |
| 宋书·王镇恶传 | 宋书 | 王镇恶传 | 1 | dongjin-10 |
| 宋书·隐逸传 | 宋书 | 隐逸传 | 1 | weijin-guiyin |
| 宋史 | 宋史 | — | 67 | beisong-01、beisong-02、beisong-03… |
| 宋史·司马光传 | 宋史 | 司马光传 | 2 | beisong-jingjiyukejifanrong-07、beisong-xinjiudangzhengyuanyougenghua-09 |
| 宋史·吕文焕传 | 宋史 | 吕文焕传 | 1 | nansong-xiangyangbaoweizhan-09 |
| 宋史·哲宗纪·司马光传 | 宋史 | 哲宗纪·司马光传 | 1 | beisong-yuanyougenghua-12 |
| 宋史·夏国传 | 宋史 | 夏国传 | 14 | beisong-25、beisong-songxiazhanzhengyuqingliheyi-05、xixia-01… |
| 宋史·太祖本纪 | 宋史 | 太祖本纪 | 1 | beisong-tongyinanbei-02 |
| 宋史·太祖纪·太宗纪 | 宋史 | 太祖纪·太宗纪 | 1 | beisong-taizongjiwei-03 |
| 宋史·孝宗本纪 | 宋史 | 孝宗本纪 | 1 | nansong-longxingbeifayulongxingheyi-05 |
| 宋史·孝宗纪 | 宋史 | 孝宗纪 | 1 | nansong-qianchunzhizhi-04 |
| 宋史·岳飞传 | 宋史 | 岳飞传 | 1 | nansong-yuefeikangjinyushaoxingheyi-02 |
| 宋史·徽宗本纪 | 宋史 | 徽宗本纪 | 1 | jin-jinjueqiyuhaishangzhimeng-01 |
| 宋史·文天祥传 | 宋史 | 文天祥传 | 1 | nansong-linanxianluowentianxiangkangyuan-10 |
| 宋史·朱熹传 | 宋史 | 朱熹传 | 1 | nansong-zhuxijilixuedacheng-03 |
| 宋史·瀛国公本纪 | 宋史 | 瀛国公本纪 | 2 | nansong-xiangyangbaoweizhan-09、nansong-yashanhaizhan-11 |
| 宋史·王安石传 | 宋史 | 王安石传 | 1 | beisong-wanganshibianfa-10 |
| 宋史·理宗本纪 | 宋史 | 理宗本纪 | 1 | nansong-menggujueqilianmengmiejin-07 |
| 宋史·理宗纪 | 宋史 | 理宗纪 | 1 | nansong-duanpingruluo-08 |
| 宋史·职官志 | 宋史 | 职官志 | 2 | beisong-jiquanzhidujianshe-01、beisong-yuanfenggaizhi-11 |
| 宋史·蔡京传 | 宋史 | 蔡京传 | 1 | beisong-huizongchaoluanzheng-13 |
| 宋史·道学传 | 宋史 | 道学传 | 1 | beisong-erchengchanglixue-08 |
| 宋史·韩侂胄传 | 宋史 | 韩侂胄传 | 1 | nansong-kaixibeifayujiadingheyi-06 |
| 宋史·食货志 | 宋史 | 食货志 | 2 | beisong-jiaoziguanying-04、beisong-jingjiyukejifanrong-07 |
| 宋史·高宗本纪 | 宋史 | 高宗本纪 | 1 | nansong-jianyannandu-01 |
| 宣宗本纪 | 宣宗本纪 | — | 1 | ming-renxuanzhizhi-05 |
| 宦官传 | 宦官传 | — | 1 | tang-fanzhenyuhuanguangejuxingcheng-10 |
| 宪宗本纪 | 宪宗本纪 | — | 1 | tang-hanyujianyingfogu-15 |
| 左传·僖公二十二年 | 左传 | 僖公二十二年 | 1 | chunqiu-hongshuizhizhan-02 |
| 左传·僖公四年 | 左传 | 僖公四年 | 1 | chunqiu-zhaolingzhimeng-01 |
| 左传·哀元年 | 左传 | 哀元年 | 7 | xia-bomibenyougeshouxiazhong-10、xia-houzhumieyiyuge-13、xia-shaokangbenyouyu-08… |
| 左传·哀公七年 | 左传 | 哀公七年 | 1 | xia-tushanzhihui-02 |
| 左传·哀公元年 | 左传 | 哀公元年 | 2 | xia-hanzhuomiexiang-06、xia-shaokangchusheng-07 |
| 左传·宣公十五年 | 左传 | 宣公十五年 | 1 | chunqiu-luguochushuimu-03 |
| 左传·昭公二十九年 | 左传 | 昭公二十九年 | 2 | xia-kongjiachulongliuleihuanlong-32、xia-liuleijutao-33 |
| 左传·昭公六年 | 左传 | 昭公六年 | 1 | chunqiu-42 |
| 左传·昭公四年 | 左传 | 昭公四年 | 1 | xia-qijianxiajuntaizhixiang-01 |
| 左传·襄公二十七年 | 左传 | 襄公二十七年 | 1 | chunqiu-41 |
| 左传·襄公四年 | 左传 | 襄公四年 | 2 | xia-hanzhuocuanxia-05、xia-houyidaixia-04 |
| 庄子·人间世 | 庄子 | 人间世 | 1 | xia-jieshaguanlongpang-38 |
| 庄烈帝本纪 | 庄烈帝本纪 | — | 1 | ming-nongminqiyimingchaomiewang-16 |
| 庞统传 | 庞统传 | — | 1 | handong-liubeiquyizhou-06 |
| 建炎以来系年要录 | 建炎以来系年要录 | — | 1 | nansong-jianyannandu-01 |
| 张浚传 | 张浚传 | — | 1 | nansong-longxingbeifayulongxingheyi-05 |
| 张飞传 | 张飞传 | — | 1 | sanguo-liubeichengdizhangfeiyuhai-02 |
| 录鬼簿 | 录鬼簿 | — | 1 | yuan-yuanzajuxingsheng-03 |
| 徐达传 | 徐达传 | — | 1 | yuan-miezhangshichengbeifajianming-05 |
| 成祖本纪 | 成祖本纪 | — | 1 | ming-yongledadianchengshuqiandubeijing-04 |
| 战国策 | 战国策 | — | 1 | zhanguo-hezonglianheng-01 |
| 文帝纪 | 文帝纪 | — | 1 | sanguo-simazhaojizhangweizheng-14 |
| 新五代史 | 新五代史 | — | 24 | wudai-01、wudai-02、wudai-03… |
| 新五代史·梁本纪 | 新五代史 | 梁本纪 | 1 | tang-huangchaoqiyiyutangchaomiewang-17 |
| 新唐书 | 新唐书 | — | 49 | tang-01、tang-02、tang-03… |
| 新唐书·宰相世系表 | 新唐书 | 宰相世系表 | 1 | tang-niulidangzheng-16 |
| 新唐书·文艺传 | 新唐书 | 文艺传 | 1 | tang-libaidufutangshidingsheng-09 |
| 新唐书·李德裕传 | 新唐书 | 李德裕传 | 1 | tang-niulidangzheng-16 |
| 新唐书·藩镇传 | 新唐书 | 藩镇传 | 1 | tang-fanzhengejuxingcheng-11 |
| 新唐书·选举志 | 新唐书 | 选举志 | 1 | tang-wuzhougeming-07 |
| 方伎传·玄奘 | 方伎传 | 玄奘 | 1 | tang-zhenggaojulixuanzangguiguo-05 |
| 方腊传 | 方腊传 | — | 1 | beisong-huizongchaoluanzheng-13 |
| 旧五代史 | 旧五代史 | — | 26 | wudai-01、wudai-02、wudai-03… |
| 旧唐书 | 旧唐书 | — | 50 | tang-01、tang-02、tang-03… |
| 旧唐书·则天皇后本纪 | 旧唐书 | 则天皇后本纪 | 1 | tang-wuzhougeming-07 |
| 旧唐书·地理志 | 旧唐书 | 地理志 | 1 | tang-fanzhenyuhuanguangejuxingcheng-10 |
| 旧唐书·太宗本纪 | 旧唐书 | 太宗本纪 | 2 | tang-tongyizhanzheng-02、tang-zhenggaojulixuanzangguiguo-05 |
| 旧唐书·太宗纪 | 旧唐书 | 太宗纪 | 1 | tang-hulaoguanzhizhan-03 |
| 旧唐书·宪宗本纪 | 旧唐书 | 宪宗本纪 | 1 | tang-yuanhezhongxingxueyerucaizhou-14 |
| 旧唐书·德宗本纪 | 旧唐书 | 德宗本纪 | 1 | tang-jingyuanbingbian-13 |
| 旧唐书·文苑传 | 旧唐书 | 文苑传 | 1 | tang-libaidufutangshidingsheng-09 |
| 旧唐书·李宗闵传 | 旧唐书 | 李宗闵传 | 1 | tang-niulidangzheng-16 |
| 旧唐书·李德裕传 | 旧唐书 | 李德裕传 | 1 | tang-niulidangzheng-16 |
| 旧唐书·杨炎传 | 旧唐书 | 杨炎传 | 1 | tang-liangshuifa-12 |
| 旧唐书·玄宗本纪 | 旧唐书 | 玄宗本纪 | 1 | tang-tanglongxiantianliangzhengbian-08 |
| 旧唐书·田承嗣传 | 旧唐书 | 田承嗣传 | 1 | tang-fanzhengejuxingcheng-11 |
| 旧唐书·西域传 | 旧唐书 | 西域传 | 1 | tang-jingyingxiyu-04 |
| 旧唐书·韩愈传 | 旧唐书 | 韩愈传 | 1 | tang-hanyujianyingfogu-15 |
| 旧唐书·高宗本纪 | 旧唐书 | 高宗本纪 | 1 | tang-feiwangliwu-06 |
| 旧唐书·高祖本纪 | 旧唐书 | 高祖本纪 | 1 | tang-tangchaojianli-01 |
| 旧唐书·黄巢传 | 旧唐书 | 黄巢传 | 1 | tang-huangchaoqiyiyutangchaomiewang-17 |
| 明史 | 明史 | — | 44 | ming-01、ming-02、ming-03… |
| 明史·严嵩传 | 明史 | 严嵩传 | 1 | ming-yansongzhuanquanhairuishangshu-09 |
| 明史·仁宗本纪 | 明史 | 仁宗本纪 | 1 | ming-renxuanzhizhi-05 |
| 明史·刑法志 | 明史 | 刑法志 | 1 | ming-hongwusidaan-01 |
| 明史·刘瑾传 | 明史 | 刘瑾传 | 1 | ming-liujinluanzhengwangyangmingxinxuepingche-08 |
| 明史·史可法传 | 明史 | 史可法传 | 1 | ming-nanmingyumingzheng-17 |
| 明史·太祖本纪 | 明史 | 太祖本纪 | 2 | yuan-miezhangshichengbeifajianming-05、yuan-zhuyuanzhangjueqi-04 |
| 明史·孝宗本纪 | 明史 | 孝宗本纪 | 1 | ming-hongzhizhongxing-07 |
| 明史·张居正传 | 明史 | 张居正传 | 1 | ming-zhangjuzhenggaige-12 |
| 明史·戚继光传 | 明史 | 戚继光传 | 1 | ming-wohuanyukangwo-10 |
| 明史·李自成传 | 明史 | 李自成传 | 1 | ming-nongminqiyimingchaomiewang-16 |
| 明史·神宗本纪 | 明史 | 神宗本纪 | 2 | ming-houjinjueqisaerhuningyuan-15、ming-mingmosanan-14 |
| 明史·职官志 | 明史 | 职官志 | 1 | ming-kaiguozhidujianshe-02 |
| 明史·艺文志·解缙传 | 明史 | 艺文志·解缙传 | 1 | ming-yongledadianchengshu-03 |
| 明史·英宗本纪 | 明史 | 英宗本纪 | 1 | ming-tumubaozhibianbeijingbaoweizhan-06 |
| 明史·解缙传 | 明史 | 解缙传 | 1 | ming-yongledadianchengshuqiandubeijing-04 |
| 明史·顾宪成传 | 明史 | 顾宪成传 | 1 | ming-donglindangzhengyuweizhongxian-13 |
| 明史·食货志 | 明史 | 食货志 | 1 | ming-longqingkaiguan-11 |
| 明季北略 | 明季北略 | — | 1 | ming-nongminqiyimingchaomiewang-16 |
| 明季南略 | 明季南略 | — | 1 | ming-nanmingyumingzheng-17 |
| 晋书·元帝纪 | 晋书 | 元帝纪 | 1 | dongjin-01 |
| 晋书·冉闵载记 | 晋书 | 冉闵载记 | 1 | dongjin-ranminmiehouzhao-03 |
| 晋书·刘元海载记 | 晋书 | 刘元海载记 | 1 | xijin-05 |
| 晋书·后妃传 | 晋书 | 后妃传 | 1 | weijin-taizifei |
| 晋书·周处传·惠帝纪 | 晋书 | 周处传·惠帝纪 | 1 | xijin-qiwannianfanjinzhouchuzhansi-12 |
| 晋书·姚苌载记 | 晋书 | 姚苌载记 | 1 | dongjin-beifangzaifenliehouyanhouqinbingli-09 |
| 晋书·孙恩传 | 晋书 | 孙恩传 | 1 | dongjin-sunenluxunqiyi-11 |
| 晋书·宣帝纪 | 晋书 | 宣帝纪 | 4 | sanguo-simayipingdingliaodong-04、sanguo-simayizusimashijizheng-09、sanguo-wanglingzhipan-10… |
| 晋书·嵇康传 | 晋书 | 嵇康传 | 2 | sanguo-09、weijin-zhulin |
| 晋书·废帝纪 | 晋书 | 废帝纪 | 1 | dongjin-huanwenfeidilijianwen-07 |
| 晋书·张华传·惠贾皇后传 | 晋书 | 张华传·惠贾皇后传 | 1 | xijin-jiahouzhuanzhengzhanghuafuzheng-10 |
| 晋书·怀帝纪 | 晋书 | 怀帝纪 | 1 | xijin-06 |
| 晋书·惠帝纪 | 晋书 | 惠帝纪 | 2 | xijin-03、xijin-04 |
| 晋书·惠帝纪·杨骏传·惠贾皇后传 | 晋书 | 惠帝纪·杨骏传·惠贾皇后传 | 1 | xijin-wudizuhuidijiweiyangjunfuzheng-09 |
| 晋书·惠贾皇后传·杨骏传·楚王玮传 | 晋书 | 惠贾皇后传·杨骏传·楚王玮传 | 1 | xijin-jiahouzhuyangjunbawangzhiluanxumu-11 |
| 晋书·愍帝纪 | 晋书 | 愍帝纪 | 1 | xijin-07 |
| 晋书·愍怀太子传·惠贾皇后传 | 晋书 | 愍怀太子传·惠贾皇后传 | 1 | xijin-jiahoufeitaizisimayu-13 |
| 晋书·成都王颖传·河间王颙传·长沙王乂传 | 晋书 | 成都王颖传·河间王颙传·长沙王乂传 | 1 | xijin-chengduwangyingxiedizhangfangruluo-18 |
| 晋书·文帝纪 | 晋书 | 文帝纪 | 3 | sanguo-zhugedanzhipanhuainansanpan-16、weijin-fengjinwang、weijin-shmaohuan |
| 晋书·景帝纪 | 晋书 | 景帝纪 | 5 | sanguo-guanqiujianwenqinzhipanhuainanerpan-15、sanguo-simashifeicaofanglicaomao-13、sanguo-simazhaojizhangweizheng-14… |
| 晋书·桓温传 | 晋书 | 桓温传 | 5 | dongjin-05、dongjin-huanwenbeifafangtouzhizhan-06、dongjin-huanwenbeifaguanzhongbashangzhishi-05… |
| 晋书·桓玄传 | 晋书 | 桓玄传 | 1 | dongjin-09 |
| 晋书·武帝纪 | 晋书 | 武帝纪 | 6 | sanguo-mieshudaiweimiewu-18、xijin-01、xijin-dafengzongshimaibawangzhihuo-08… |
| 晋书·殷浩传 | 晋书 | 殷浩传 | 1 | weijin-feiyinhao |
| 晋书·王敦传 | 晋书 | 王敦传 | 1 | dongjin-02 |
| 晋书·王濬传 | 晋书 | 王濬传 | 1 | xijin-02 |
| 晋书·王羲之传 | 晋书 | 王羲之传 | 2 | dongjin-04、weijin-erwang |
| 晋书·石勒载记 | 晋书 | 石勒载记 | 2 | dongjin-03、dongjin-shilejianlihouzhao-01 |
| 晋书·石崇传 | 晋书 | 石崇传 | 2 | weijin-doufu、weijin-jingu |
| 晋书·祖逖传 | 晋书 | 祖逖传 | 2 | weijin-wenji、weijin-zhongliu |
| 晋书·羊祜传 | 晋书 | 羊祜传 | 6 | sanguo-lukangzu-19、weijin-jingzhou、weijin-yanglu… |
| 晋书·苻坚载记 | 晋书 | 苻坚载记 | 5 | dongjin-06、dongjin-qianqintongyibeifang-08、dongjin-yaochangyishafujian-10… |
| 晋书·谢安传 | 晋书 | 谢安传 | 1 | weijin-xiean-huanwen |
| 晋书·谢玄传 | 晋书 | 谢玄传 | 3 | dongjin-07、weijin-beifu、weijin-xiexuan-beifa |
| 晋书·赵王伦传·惠贾皇后传 | 晋书 | 赵王伦传·惠贾皇后传 | 1 | xijin-zhaowanglunzhujiahoushataizi-14 |
| 晋书·赵王伦传·齐王冏传·成都王颖传 | 晋书 | 赵王伦传·齐王冏传·成都王颖传 | 1 | xijin-zhaowangluncuanweisanwangqiyi-15 |
| 晋书·长沙王乂传·齐王冏传 | 晋书 | 长沙王乂传·齐王冏传 | 1 | xijin-changshawangyizhujiongyizhuanzheng-17 |
| 晋书·阮籍传 | 晋书 | 阮籍传 | 1 | weijin-dazui |
| 晋书·陆机传 | 晋书 | 陆机传 | 1 | weijin-erlu |
| 晋书·陶潜传 | 晋书 | 陶潜传 | 1 | weijin-wudoumi |
| 晋书·食货志·武帝纪 | 晋书 | 食货志·武帝纪 | 1 | xijin-taikangzhizhibanzhantianzhi-07 |
| 晋书·齐王冏传 | 晋书 | 齐王冏传 | 1 | xijin-qiwangjiongzhuanzheng-16 |
| 晏子春秋·内篇杂下 | 晏子春秋 | 内篇杂下 | 1 | chunqiu-43 |
| 景帝纪 | 景帝纪 | — | 1 | sanguo-simayizusimashijizheng-09 |
| 朱升传 | 朱升传 | — | 1 | yuan-zhuyuanzhangjueqi-04 |
| 朱泚传 | 朱泚传 | — | 1 | tang-jingyuanbingbian-13 |
| 李定国传 | 李定国传 | — | 1 | ming-nanmingyumingzheng-17 |
| 李愬传 | 李愬传 | — | 1 | tang-yuanhezhongxingxueyerucaizhou-14 |
| 李晟传 | 李晟传 | — | 1 | tang-jingyuanbingbian-13 |
| 杜预传 | 杜预传 | — | 1 | xijin-yanghuzuduyudaizhenjingzhou-05 |
| 梁书 | 梁书 | — | 2 | nanbeichao-14、nanbeichao-15 |
| 梁书·侯景传 | 梁书 | 侯景传 | 2 | nanbeichao-08、weijin-houjing-pan |
| 梁书·陈庆之传 | 梁书 | 陈庆之传 | 2 | weijin-baipao、weijin-luoyang |
| 梦溪笔谈 | 梦溪笔谈 | — | 2 | beisong-bishenghuoziyinshua-06、beisong-jingjiyukejifanrong-07 |
| 楚辞·离骚 | 楚辞 | 离骚 | 1 | xia-shaokangzhongxing-14 |
| 武帝纪 | 武帝纪 | — | 1 | handong-wangyunzhudongzhuocaocaoshouqingzhoubing-03 |
| 汉书 | 汉书 | — | 2 | xihan-tuien、xihan-wenjing |
| 汉书·傅介子传 | 汉书 | 傅介子传 | 1 | xihan-fujiezi |
| 汉书·匈奴传 | 汉书 | 匈奴传 | 2 | xihan-huhanye、xihan-zhaojun |
| 汉书·司马迁传 | 汉书 | 司马迁传 | 1 | xihan-shiji |
| 汉书·律历志 | 汉书 | 律历志 | 1 | xihan-taichu-calendar |
| 汉书·昭帝纪·宣帝纪 | 汉书 | 昭帝纪·宣帝纪 | 1 | xihan-zhaoxuanzhongxing-02 |
| 汉书·武五子传 | 汉书 | 武五子传 | 1 | xihan-wugu |
| 汉书·武帝纪 | 汉书 | 武帝纪 | 1 | xihan-wudi-enthroned |
| 汉书·王莽传 | 汉书 | 王莽传 | 4 | han-wang-mang、xihan-wangmang-regent、xihan-wangmang-rise… |
| 汉书·艺文志 | 汉书 | 艺文志 | 1 | xihan-liuxiang |
| 汉书·董仲舒传 | 汉书 | 董仲舒传 | 1 | xihan-confucianism |
| 汉书·西域传 | 汉书 | 西域传 | 1 | xihan-luntai |
| 汉书·贾谊传 | 汉书 | 贾谊传 | 1 | xihan-jia-yi |
| 汉书·赵充国传 | 汉书 | 赵充国传 | 1 | xihan-zhaochongguo |
| 汉书·郑吉传 | 汉书 | 郑吉传 | 1 | han-xiyu-protectorate |
| 汉书·陈汤传 | 汉书 | 陈汤传 | 1 | xihan-chentang |
| 汉书·霍光传 | 汉书 | 霍光传 | 2 | xihan-xuandi、xihan-zhaodi |
| 汉书·食货志 | 汉书 | 食货志 | 5 | xihan-chaocuo-guishu、xihan-wuzhu、xihan-xin-reform… |
| 汉书·高后纪 | 汉书 | 高后纪 | 1 | xihan-lvhouchengzhizhulvzhiluan-01 |
| 洛阳伽蓝记 | 洛阳伽蓝记 | — | 1 | handong-fojiaodongchuanjianbaimasi-02 |
| 海瑞传 | 海瑞传 | — | 1 | ming-yansongzhuanquanhairuishangshu-09 |
| 清史稿 | 清史稿 | — | 47 | ming-38、ming-40、qing-01… |
| 清史稿·军机大臣年表 | 清史稿 | 军机大臣年表 | 1 | qing-junjichusheli-01 |
| 清史稿·邦交志 | 清史稿 | 邦交志 | 2 | qing-baguolianjunxinchoutiaoyue-04、qing-dierciyapianzhanzheng-03 |
| 清史稿·食货志 | 清史稿 | 食货志 | 1 | qing-guangzhouyikoutongshang-02 |
| 清太祖实录 | 清太祖实录 | — | 1 | ming-houjinjueqisaerhuningyuan-15 |
| 瀛国公本纪 | 瀛国公本纪 | — | 1 | nansong-linanxianluowentianxiangkangyuan-10 |
| 牛僧孺传 | 牛僧孺传 | — | 1 | tang-niulidangzheng-16 |
| 王世充传 | 王世充传 | — | 1 | tang-tongyizhanzheng-02 |
| 王守仁传 | 王守仁传 | — | 1 | ming-liujinluanzhengwangyangmingxinxuepingche-08 |
| 王濬传 | 王濬传 | — | 2 | sanguo-mieshudaiweimiewu-18、xijin-jinmiewusanjiaguijin-06 |
| 秃发树机能载记 | 秃发树机能载记 | — | 1 | xijin-tufashujinengfanjin-02 |
| 秦桧传 | 秦桧传 | — | 1 | nansong-yuefeikangjinyushaoxingheyi-02 |
| 窦建德传 | 窦建德传 | — | 1 | tang-tongyizhanzheng-02 |
| 童贯传 | 童贯传 | — | 1 | beisong-huizongchaoluanzheng-13 |
| 竹书纪年 | 竹书纪年 | — | 23 | shang-wudingzhengguifang-05、xia-bomibenyougeshouxiazhong-10、xia-bujiangfajiuyuan-26… |
| 纪年 | 纪年 | — | 5 | xia-huaishijiuyilaichao-20、xia-jinqianxihe-29、xia-xiejiajiuyijueming-24… |
| 续资治通鉴长编 | 续资治通鉴长编 | — | 2 | beisong-xinjiudangzhengyuanyougenghua-09、xixia-08 |
| 胡惟庸传 | 胡惟庸传 | — | 1 | ming-hongwusidaan-01 |
| 艺文志 | 艺文志 | — | 1 | ming-yongledadianchengshuqiandubeijing-04 |
| 苏定方传 | 苏定方传 | — | 1 | tang-jingyingxiyu-04 |
| 苏轼传 | 苏轼传 | — | 1 | beisong-xinjiudangzhengyuanyougenghua-09 |
| 范仲淹传 | 范仲淹传 | — | 1 | beisong-songxiazhanzhengyuqingliheyi-05 |
| 蓝玉传 | 蓝玉传 | — | 1 | ming-hongwusidaan-01 |
| 蜀书·先主传 | 蜀书 | 先主传 | 2 | handong-caocaoquhanzhongxiangshuihuajie-07、handong-weinanzhizhanliubeirushu-05 |
| 蜀书·姜维传 | 蜀书 | 姜维传 | 1 | sanguo-mieshudaiweimiewu-18 |
| 蜀书·王平传 | 蜀书 | 王平传 | 1 | sanguo-caoshuangluoguzhiyi-06 |
| 蜀书·诸葛亮传 | 蜀书 | 诸葛亮传 | 1 | handong-beizhengwuhuansangumaolu-04 |
| 袁崇焕传 | 袁崇焕传 | — | 1 | ming-houjinjueqisaerhuningyuan-15 |
| 论语 | 论语 | — | 1 | chunqiu-kongzichuangliruxue-04 |
| 贾诩传 | 贾诩传 | — | 1 | handong-weinanzhizhanliubeirushu-05 |
| 资治通鉴 | 资治通鉴 | — | 1 | tang-50 |
| 资治通鉴·晋纪 | 资治通鉴 | 晋纪 | 12 | xijin-changshawangyizhujiongyizhuanzheng-17、xijin-chengduwangyingxiedizhangfangruluo-18、xijin-dafengzongshimaibawangzhihuo-08… |
| 资治通鉴·秦纪一 | 资治通鉴 | 秦纪一 | 1 | zhanguo-hanfeiruqin-03 |
| 资治通鉴·魏纪 | 资治通鉴 | 魏纪 | 4 | sanguo-guanqiujianwenqinzhipanhuainanerpan-15、sanguo-sunchenfeilianglixiusunxiuzhuchen-17、sanguo-sunquanergongzhizhengliaojie-08… |
| 辽史 | 辽史 | — | 23 | beisong-16、beisong-17、beisong-19… |
| 辽史·百官志 | 辽史 | 百官志 | 1 | liao-nanbeimianguanzhi-01 |
| 选举志 | 选举志 | — | 1 | beisong-jiquanzhidujianshe-01 |
| 郭嘉传 | 郭嘉传 | — | 1 | handong-beizhengwuhuansangumaolu-04 |
| 酷吏传 | 酷吏传 | — | 1 | tang-wuzhougeming-07 |
| 金史 | 金史 | — | 31 | beisong-32、beisong-34、jin-01… |
| 金史·哀宗本纪 | 金史 | 哀宗本纪 | 1 | nansong-menggujueqilianmengmiejin-07 |
| 金史·太祖本纪 | 金史 | 太祖本纪 | 1 | jin-jinjueqiyuhaishangzhimeng-01 |
| 钟会传 | 钟会传 | — | 1 | sanguo-mieshudaiweimiewu-18 |
| 陆九渊集 | 陆九渊集 | — | 1 | nansong-17 |
| 陈书 | 陈书 | — | 1 | nanbeichao-15 |
| 陈书·高祖纪 | 陈书 | 高祖纪 | 1 | nanbeichao-chenbaxianxishawangsengbian-06 |
| 隋书 | 隋书 | — | 22 | sui-01、sui-02、sui-03… |
| 隋书·韩擒虎传 | 隋书 | 韩擒虎传 | 1 | nanbeichao-12 |
| 隋书·高祖纪 | 隋书 | 高祖纪 | 2 | nanbeichao-11、weijin-beizhou-waiqi |
| 青楼集 | 青楼集 | — | 1 | yuan-yuanzajuxingsheng-03 |
| 韩诗外传 | 韩诗外传 | — | 1 | xia-jieshaguanlongpang-38 |
| 韩非子·十过 | 韩非子 | 十过 | 1 | xia-jiejiweizhuqinggong-36 |
| 韩非子·难三 | 韩非子 | 难三 | 1 | xia-jiefayoushidemoxi-37 |
| 食货志 | 食货志 | — | 4 | beisong-wanganshibianfa-10、ming-kaiguozhidujianshe-02、ming-zhangjuzhenggaige-12… |
| 高僧传 | 高僧传 | — | 1 | handong-fojiaodongchuanjianbaimasi-02 |
| 高宗本纪 | 高宗本纪 | — | 1 | nansong-yuefeikangjinyushaoxingheyi-02 |
| 魏书·世祖纪 | 魏书 | 世祖纪 | 1 | nanbeichao-02 |
| 魏书·于禁传 | 魏书 | 于禁传 | 1 | handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08 |
| 魏书·太祖纪 | 魏书 | 太祖纪 | 3 | dongjin-08、nanbeichao-tuobaguiqiandupingcheng-01、weijin-canhebei |
| 魏书·尔朱荣传 | 魏书 | 尔朱荣传 | 1 | nanbeichao-06 |
| 魏书·皇后传 | 魏书 | 皇后传 | 1 | weijin-linchao |
| 魏书·肃宗纪 | 魏书 | 肃宗纪 | 1 | nanbeichao-05 |
| 魏书·释老志 | 魏书 | 释老志 | 2 | nanbeichao-taiwudimiefo-03、nanbeichao-yungangshikukaizao-04 |
| 魏书·食货志 | 魏书 | 食货志 | 1 | nanbeichao-03 |
| 魏书·高祖纪 | 魏书 | 高祖纪 | 1 | nanbeichao-04 |
| 魏书·高祖纪·食货志 | 魏书 | 高祖纪·食货志 | 1 | nanbeichao-fengtaihougaizhijuntianling-05 |
| 魏忠贤传 | 魏忠贤传 | — | 1 | ming-donglindangzhengyuweizhongxian-13 |

## 4. 例外与特殊处理

1. **彩蛋事件 `special-star-1893`**：`EVENT_SOURCES` 为空数组、`EVENT_SOURCE_STATUS` 为 `easter_egg`，
   不得参与事实回答，也不得作为引用来源。
2. **裴注引**：`hanmo-10`、`sanguo-sunquanzuzhugekefuzheng-11`、`sanguo-zhugeliangwucibeifa-03`、`xia-shaokangbenyouyu-08` 的括注为
   「据《三国志·蜀书·诸葛亮传》裴注引《襄阳记》」。按 1 条引用计：
   `label = 三国志·蜀书·诸葛亮传`，`raw` 保留完整括注（含裴注引原文），避免把转引来源伪装成主要来源。
3. **括注尾注**：75 条事件的括注在书名后还有说明（如「年代依夏商周断代工程推定」），
   这些说明保留在 `raw` 中，不单独生成引用条目。
4. **不修改 description 原文**：本卡只做抽取，正文保持 V0.9.0 的展示与 diff 口径。

## 5. 关系类引用的派生规则（供 TC-05 快照落地）

关系库 `person-relations.ts` 的 `label/description` 是人工校订定性，**没有「据《…》」书目**。
因此关系引用不新增书目：

- 引用构造时取该关系 `eventSummaries` 指向的**共同事件**的 `sourceRefs`；
- 关系定性本身标注「史脉关系库（人工校订）」；
- 快照里以 `relations[].basisEventIds[]` 记录共同事件 id，供 V1.0.5 引用构造直接使用。

## 6. 人工抽查记录（2 书并列 ≥10%）

> 抽查比例要求 ≥10%（238 条 2 书事件 → 至少 24 条）。
> 下表按事件 id 排序等距抽取 12 条，自动校验项为「两个 label 均出现在 raw 中、book 非空、label 可回查」；
> 人工结论请在「复核」列签字后本卡才算通过评审。

| 事件 | 标签 A | 标签 B | raw 片段 | 自动校验 | 复核 |
|---|---|---|---|---|---|
| beisong-16 | 宋史 | 辽史 | （据《宋史》《辽史》） | 通过 | 待人工复核 |
| handong-fojiaodongchuanjianbaimasi-02 | 后汉书·西域传 | 高僧传 | （据《后汉书·西域传》；《高僧传》《洛阳伽蓝记》） | 通过 | 待人工复核 |
| ming-21 | 明史 | 元史 | （据《明史》《元史》） | 通过 | 待人工复核 |
| nanbeichao-15 | 陈书 | 梁书 | （据《陈书》《梁书》） | 通过 | 待人工复核 |
| nansong-yuefeikangjinyushaoxingheyi-02 | 宋史·岳飞传 | 秦桧传 | （据《宋史·岳飞传》《秦桧传》《高宗本纪》） | 通过 | 待人工复核 |
| tang-04 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-23 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-42 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-tanglongxiantianliangzhengbian-08 | 旧唐书·玄宗本纪 | 太平公主传 | （据《旧唐书·玄宗本纪》《太平公主传》） | 通过 | 待人工复核 |
| wudai-15 | 旧五代史 | 新五代史 | （据《旧五代史》《新五代史》） | 通过 | 待人工复核 |
| xia-jieshaguanlongpang-38 | 韩诗外传 | 庄子·人间世 | （据《韩诗外传》《庄子·人间世》《竹书纪年》；年代依夏商周断代工程推定） | 通过 | 待人工复核 |
| xijin-changshawangyizhujiongyizhuanzheng-17 | 晋书·长沙王乂传·齐王冏传 | 资治通鉴·晋纪 | （据《晋书·长沙王乂传·齐王冏传》《资治通鉴·晋纪》） | 通过 | 待人工复核 |

## 7. 校验命令

```bash
node scripts/extract-sources.mjs --check
node scripts/validate-data.mjs
```
