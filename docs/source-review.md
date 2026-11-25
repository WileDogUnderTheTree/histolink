# 引用结构化复核（V1.0.1 / TC-03）

> 本文件由 `scripts/extract-sources.mjs` 生成，随数据一起提交。
> 生成口径与校验口径共用 `scripts/lib/parse-sources.mjs`，不存在两套正则。

## 1. 总览

- 事件总数：718 条（时间轴 684 + 图谱补足 34）
- 有引用的事件：717 条；彩蛋（无引用）：1 条
- 引用条目：837 条（其中 597 条事件 1 本书，120 条事件 2 本书）
- 书目标签：197 个；书目（按首个「·」切分）：32 种
- 括注尾注（如「年代依夏商周断代工程推定」）：39 条
- 特殊解析：裴注引 1 条（按 1 条引用计，见 §4）

> **与任务卡的口径差异**：任务卡记录「书目标签 185 种」，该数字只统计了括注中的**首个**书目；
> 本实现把并列书目（如「（据《旧唐书》《新唐书》）」）的第二本也作为独立标签，故实测 197 个标签。
> 引用条目 823 与任务卡一致（裴注引按 1 条计）。

## 2. 书目分布

| 书目 | 引用条目 | 标签数 |
|---|---:|---:|
| 三国志 | 31 | 22 |
| 元史 | 48 | 1 |
| 北齐书 | 3 | 2 |
| 南齐书 | 2 | 1 |
| 史记 | 213 | 56 |
| 后汉书 | 38 | 26 |
| 吕氏春秋 | 1 | 1 |
| 周书 | 4 | 4 |
| 国语 | 1 | 1 |
| 墨子 | 1 | 1 |
| 宋书 | 5 | 5 |
| 宋史 | 80 | 2 |
| 左传 | 6 | 5 |
| 新五代史 | 24 | 1 |
| 新唐书 | 49 | 1 |
| 旧五代史 | 26 | 1 |
| 旧唐书 | 50 | 1 |
| 明史 | 44 | 1 |
| 晋书 | 38 | 26 |
| 晏子春秋 | 1 | 1 |
| 梁书 | 6 | 3 |
| 汉书 | 27 | 17 |
| 清史稿 | 47 | 1 |
| 竹书纪年 | 1 | 1 |
| 续资治通鉴长编 | 1 | 1 |
| 资治通鉴 | 1 | 1 |
| 辽史 | 23 | 1 |
| 金史 | 31 | 1 |
| 陆九渊集 | 1 | 1 |
| 陈书 | 1 | 1 |
| 隋书 | 25 | 3 |
| 魏书 | 8 | 7 |

## 3. 标签清单（全部 197 个）

| 标签 | 书目 | 篇/章 | 引用次数 | 事件 |
|---|---|---|---:|---|
| 三国志·吴书·吴主传 | 三国志 | 吴书·吴主传 | 1 | sanguo-06 |
| 三国志·吴书·周瑜传 | 三国志 | 吴书·周瑜传 | 1 | handong-chibi |
| 三国志·吴书·孙破虏传 | 三国志 | 吴书·孙破虏传 | 1 | hanmo-01 |
| 三国志·吴书·孙讨逆传 | 三国志 | 吴书·孙讨逆传 | 2 | hanmo-03、hanmo-09 |
| 三国志·吴书·陆逊传 | 三国志 | 吴书·陆逊传 | 1 | sanguo-02 |
| 三国志·蜀书·先主传 | 三国志 | 蜀书·先主传 | 4 | hanmo-02、hanmo-04、hanmo-14… |
| 三国志·蜀书·关羽传 | 三国志 | 蜀书·关羽传 | 1 | handong-fanchang |
| 三国志·蜀书·刘二牧传 | 三国志 | 蜀书·刘二牧传 | 1 | hanmo-16 |
| 三国志·蜀书·庞统传 | 三国志 | 蜀书·庞统传 | 1 | hanmo-17 |
| 三国志·蜀书·诸葛亮传 | 三国志 | 蜀书·诸葛亮传 | 4 | hanmo-10、sanguo-03、sanguo-04… |
| 三国志·蜀书·马良传 | 三国志 | 蜀书·马良传 | 1 | sanguo-05 |
| 三国志·蜀书·魏延传 | 三国志 | 蜀书·魏延传 | 1 | hanmo-19 |
| 三国志·蜀书·黄忠传 | 三国志 | 蜀书·黄忠传 | 1 | hanmo-18 |
| 三国志·魏书·公孙瓒传 | 三国志 | 魏书·公孙瓒传 | 1 | hanmo-08 |
| 三国志·魏书·典韦传 | 三国志 | 魏书·典韦传 | 1 | hanmo-06 |
| 三国志·魏书·刘表传 | 三国志 | 魏书·刘表传 | 1 | hanmo-12 |
| 三国志·魏书·华佗传 | 三国志 | 魏书·华佗传 | 1 | hanmo-13 |
| 三国志·魏书·吕布传 | 三国志 | 魏书·吕布传 | 1 | hanmo-07 |
| 三国志·魏书·文帝纪 | 三国志 | 魏书·文帝纪 | 1 | handong-han-fall |
| 三国志·魏书·武帝纪 | 三国志 | 魏书·武帝纪 | 3 | handong-caocao-emperor、handong-guandu、hanmo-15 |
| 三国志·魏书·诸夏侯曹传 | 三国志 | 魏书·诸夏侯曹传 | 1 | sanguo-08 |
| 三国志·魏书·邓艾传 | 三国志 | 魏书·邓艾传 | 1 | sanguo-10 |
| 元史 | 元史 | — | 48 | jin-11、jin-12、jin-13… |
| 北齐书·文宣纪 | 北齐书 | 文宣纪 | 1 | nanbeichao-09 |
| 北齐书·神武纪 | 北齐书 | 神武纪 | 2 | nanbeichao-07、weijin-bohaiwang |
| 南齐书 | 南齐书 | — | 2 | nanbeichao-13、nanbeichao-14 |
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
| 史记·吕太后本纪 | 史记 | 吕太后本纪 | 3 | xihan-gaozu-death、xihan-lvhou-regent、xihan-zhulv |
| 史记·吴太伯世家 | 史记 | 吴太伯世家 | 5 | chunqiu-22、chunqiu-26、chunqiu-27… |
| 史记·吴王濞列传 | 史记 | 吴王濞列传 | 1 | han-seven-states |
| 史记·周本纪 | 史记 | 周本纪 | 21 | chunqiu-01、chunqiu-03、chunqiu-19… |
| 史记·商君列传 | 史记 | 商君列传 | 2 | zhanguo-08、zhanguo-10 |
| 史记·夏本纪 | 史记 | 夏本纪 | 16 | shang-02、xia-01、xia-02… |
| 史记·大宛列传 | 史记 | 大宛列传 | 3 | han-zhang-qian、xihan-dawan、xihan-zhangqian-again |
| 史记·孔子世家 | 史记 | 孔子世家 | 2 | chunqiu-40、chunqiu-45 |
| 史记·孙子吴起列传 | 史记 | 孙子吴起列传 | 4 | chunqiu-29、zhanguo-04、zhanguo-07… |
| 史记·孝文本纪 | 史记 | 孝文本纪 | 1 | xihan-tiying |
| 史记·孟子荀卿列传 | 史记 | 孟子荀卿列传 | 2 | zhanguo-15、zhanguo-40 |
| 史记·宋微子世家 | 史记 | 宋微子世家 | 3 | chunqiu-11、shang-14、xizhou-03 |
| 史记·封禅书 | 史记 | 封禅书 | 1 | qin-fengshan |
| 史记·屈原贾生列传 | 史记 | 屈原贾生列传 | 1 | zhanguo-29 |
| 史记·廉颇蔺相如列传 | 史记 | 廉颇蔺相如列传 | 2 | zhanguo-27、zhanguo-55 |
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
| 史记·秦本纪 | 史记 | 秦本纪 | 7 | chunqiu-10、chunqiu-12、chunqiu-17… |
| 史记·穰侯列传 | 史记 | 穰侯列传 | 1 | zhanguo-24 |
| 史记·管蔡世家 | 史记 | 管蔡世家 | 1 | xizhou-05 |
| 史记·老子韩非列传 | 史记 | 老子韩非列传 | 5 | chunqiu-34、chunqiu-44、zhanguo-06… |
| 史记·范睢蔡泽列传 | 史记 | 范睢蔡泽列传 | 1 | zhanguo-30 |
| 史记·蒙恬列传 | 史记 | 蒙恬列传 | 2 | qin-great-wall、qin-xiongnu |
| 史记·赵世家 | 史记 | 赵世家 | 2 | zhanguo-21、zhanguo-22 |
| 史记·越王句践世家 | 史记 | 越王句践世家 | 3 | chunqiu-32、chunqiu-33、zhanguo-01 |
| 史记·郑世家 | 史记 | 郑世家 | 2 | chunqiu-02、chunqiu-24 |
| 史记·陈涉世家 | 史记 | 陈涉世家 | 1 | qin-daze-uprising |
| 史记·项羽本纪 | 史记 | 项羽本纪 | 5 | qin-julu-battle、qin-xiangyu-xianyang、xihan-gaixia… |
| 史记·高祖本纪 | 史记 | 高祖本纪 | 2 | han-founded、qin-liubang-xiangliang |
| 史记·魏世家 | 史记 | 魏世家 | 1 | zhanguo-50 |
| 史记·魏公子列传 | 史记 | 魏公子列传 | 2 | zhanguo-32、zhanguo-36 |
| 史记·鲁周公世家 | 史记 | 鲁周公世家 | 2 | xizhou-04、xizhou-08 |
| 史记·齐太公世家 | 史记 | 齐太公世家 | 5 | chunqiu-05、chunqiu-07、chunqiu-09… |
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
| 后汉书·显宗孝明帝纪 | 后汉书 | 显宗孝明帝纪 | 1 | handong-guangwu-death |
| 后汉书·梁冀传 | 后汉书 | 梁冀传 | 2 | handong-liangji、handong-zhidi |
| 后汉书·王景传 | 后汉书 | 王景传 | 1 | handong-wangjing |
| 后汉书·班固传 | 后汉书 | 班固传 | 1 | handong-hanshu |
| 后汉书·班超传 | 后汉书 | 班超传 | 3 | handong-banchao-death、handong-banchao-duhu、handong-banchao-start |
| 后汉书·皇甫嵩传 | 后汉书 | 皇甫嵩传 | 1 | han-yellow-turban |
| 后汉书·窦融传 | 后汉书 | 窦融传 | 1 | handong-yanran |
| 后汉书·肃宗孝章帝纪 | 后汉书 | 肃宗孝章帝纪 | 1 | handong-zhangdi |
| 后汉书·董卓传 | 后汉书 | 董卓传 | 3 | handong-dongzhuo、handong-dongzhuo-death、handong-liandong |
| 后汉书·蔡邕传 | 后汉书 | 蔡邕传 | 1 | handong-shijing |
| 后汉书·袁术传 | 后汉书 | 袁术传 | 1 | hanmo-05 |
| 后汉书·西域传 | 后汉书 | 西域传 | 2 | handong-fojiao、handong-ganying |
| 后汉书·西羌传 | 后汉书 | 西羌传 | 1 | handong-qiang-revolt |
| 后汉书·马援传 | 后汉书 | 马援传 | 1 | handong-zhengce |
| 吕氏春秋·顺民 | 吕氏春秋 | 顺民 | 1 | shang-tangdaosanglin-03 |
| 周书·卢辩传 | 周书 | 卢辩传 | 1 | weijin-beizhou-guanzhi |
| 周书·文帝纪 | 周书 | 文帝纪 | 1 | weijin-shayuan |
| 周书·武帝纪 | 周书 | 武帝纪 | 1 | nanbeichao-10 |
| 周书·苏绰传 | 周书 | 苏绰传 | 1 | weijin-liutiao |
| 国语·晋语 | 国语 | 晋语 | 1 | xizhou-baosihuozhoufeidilishu-02 |
| 墨子·公输 | 墨子 | 公输 | 1 | zhanguo-49 |
| 宋书 | 宋书 | — | 1 | nanbeichao-13 |
| 宋书·文帝纪 | 宋书 | 文帝纪 | 1 | weijin-yuanjia |
| 宋书·武帝纪 | 宋书 | 武帝纪 | 1 | nanbeichao-01 |
| 宋书·王镇恶传 | 宋书 | 王镇恶传 | 1 | dongjin-10 |
| 宋书·隐逸传 | 宋书 | 隐逸传 | 1 | weijin-guiyin |
| 宋史 | 宋史 | — | 67 | beisong-01、beisong-02、beisong-03… |
| 宋史·夏国传 | 宋史 | 夏国传 | 13 | beisong-25、xixia-01、xixia-02… |
| 左传·哀公七年 | 左传 | 哀公七年 | 1 | xia-tushanzhihui-02 |
| 左传·昭公六年 | 左传 | 昭公六年 | 1 | chunqiu-42 |
| 左传·昭公四年 | 左传 | 昭公四年 | 1 | xia-qijianxiajuntaizhixiang-01 |
| 左传·襄公二十七年 | 左传 | 襄公二十七年 | 1 | chunqiu-41 |
| 左传·襄公四年 | 左传 | 襄公四年 | 2 | xia-hanzhuocuanxia-05、xia-houyidaixia-04 |
| 新五代史 | 新五代史 | — | 24 | wudai-01、wudai-02、wudai-03… |
| 新唐书 | 新唐书 | — | 49 | tang-01、tang-02、tang-03… |
| 旧五代史 | 旧五代史 | — | 26 | wudai-01、wudai-02、wudai-03… |
| 旧唐书 | 旧唐书 | — | 50 | tang-01、tang-02、tang-03… |
| 明史 | 明史 | — | 44 | ming-01、ming-02、ming-03… |
| 晋书·元帝纪 | 晋书 | 元帝纪 | 1 | dongjin-01 |
| 晋书·刘元海载记 | 晋书 | 刘元海载记 | 1 | xijin-05 |
| 晋书·后妃传 | 晋书 | 后妃传 | 1 | weijin-taizifei |
| 晋书·嵇康传 | 晋书 | 嵇康传 | 2 | sanguo-09、weijin-zhulin |
| 晋书·怀帝纪 | 晋书 | 怀帝纪 | 1 | xijin-06 |
| 晋书·惠帝纪 | 晋书 | 惠帝纪 | 2 | xijin-03、xijin-04 |
| 晋书·愍帝纪 | 晋书 | 愍帝纪 | 1 | xijin-07 |
| 晋书·文帝纪 | 晋书 | 文帝纪 | 2 | weijin-fengjinwang、weijin-shmaohuan |
| 晋书·景帝纪 | 晋书 | 景帝纪 | 2 | weijin-feicaofang、weijin-simashi-zhuanquan |
| 晋书·桓温传 | 晋书 | 桓温传 | 1 | dongjin-05 |
| 晋书·桓玄传 | 晋书 | 桓玄传 | 1 | dongjin-09 |
| 晋书·武帝纪 | 晋书 | 武帝纪 | 1 | xijin-01 |
| 晋书·殷浩传 | 晋书 | 殷浩传 | 1 | weijin-feiyinhao |
| 晋书·王敦传 | 晋书 | 王敦传 | 1 | dongjin-02 |
| 晋书·王濬传 | 晋书 | 王濬传 | 1 | xijin-02 |
| 晋书·王羲之传 | 晋书 | 王羲之传 | 2 | dongjin-04、weijin-erwang |
| 晋书·石勒载记 | 晋书 | 石勒载记 | 1 | dongjin-03 |
| 晋书·石崇传 | 晋书 | 石崇传 | 2 | weijin-doufu、weijin-jingu |
| 晋书·祖逖传 | 晋书 | 祖逖传 | 2 | weijin-wenji、weijin-zhongliu |
| 晋书·羊祜传 | 晋书 | 羊祜传 | 2 | weijin-jingzhou、weijin-yanglu |
| 晋书·苻坚载记 | 晋书 | 苻坚载记 | 3 | dongjin-06、weijin-menshi、weijin-zhiguo |
| 晋书·谢安传 | 晋书 | 谢安传 | 1 | weijin-xiean-huanwen |
| 晋书·谢玄传 | 晋书 | 谢玄传 | 3 | dongjin-07、weijin-beifu、weijin-xiexuan-beifa |
| 晋书·阮籍传 | 晋书 | 阮籍传 | 1 | weijin-dazui |
| 晋书·陆机传 | 晋书 | 陆机传 | 1 | weijin-erlu |
| 晋书·陶潜传 | 晋书 | 陶潜传 | 1 | weijin-wudoumi |
| 晏子春秋·内篇杂下 | 晏子春秋 | 内篇杂下 | 1 | chunqiu-43 |
| 梁书 | 梁书 | — | 2 | nanbeichao-14、nanbeichao-15 |
| 梁书·侯景传 | 梁书 | 侯景传 | 2 | nanbeichao-08、weijin-houjing-pan |
| 梁书·陈庆之传 | 梁书 | 陈庆之传 | 2 | weijin-baipao、weijin-luoyang |
| 汉书 | 汉书 | — | 2 | xihan-tuien、xihan-wenjing |
| 汉书·傅介子传 | 汉书 | 傅介子传 | 1 | xihan-fujiezi |
| 汉书·匈奴传 | 汉书 | 匈奴传 | 2 | xihan-huhanye、xihan-zhaojun |
| 汉书·司马迁传 | 汉书 | 司马迁传 | 1 | xihan-shiji |
| 汉书·律历志 | 汉书 | 律历志 | 1 | xihan-taichu-calendar |
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
| 清史稿 | 清史稿 | — | 47 | ming-38、ming-40、qing-01… |
| 竹书纪年 | 竹书纪年 | — | 1 | shang-wudingzhengguifang-05 |
| 续资治通鉴长编 | 续资治通鉴长编 | — | 1 | xixia-08 |
| 资治通鉴 | 资治通鉴 | — | 1 | tang-50 |
| 辽史 | 辽史 | — | 23 | beisong-16、beisong-17、beisong-19… |
| 金史 | 金史 | — | 31 | beisong-32、beisong-34、jin-01… |
| 陆九渊集 | 陆九渊集 | — | 1 | nansong-17 |
| 陈书 | 陈书 | — | 1 | nanbeichao-15 |
| 隋书 | 隋书 | — | 22 | sui-01、sui-02、sui-03… |
| 隋书·韩擒虎传 | 隋书 | 韩擒虎传 | 1 | nanbeichao-12 |
| 隋书·高祖纪 | 隋书 | 高祖纪 | 2 | nanbeichao-11、weijin-beizhou-waiqi |
| 魏书·世祖纪 | 魏书 | 世祖纪 | 1 | nanbeichao-02 |
| 魏书·太祖纪 | 魏书 | 太祖纪 | 2 | dongjin-08、weijin-canhebei |
| 魏书·尔朱荣传 | 魏书 | 尔朱荣传 | 1 | nanbeichao-06 |
| 魏书·皇后传 | 魏书 | 皇后传 | 1 | weijin-linchao |
| 魏书·肃宗纪 | 魏书 | 肃宗纪 | 1 | nanbeichao-05 |
| 魏书·食货志 | 魏书 | 食货志 | 1 | nanbeichao-03 |
| 魏书·高祖纪 | 魏书 | 高祖纪 | 1 | nanbeichao-04 |

## 4. 例外与特殊处理

1. **彩蛋事件 `special-star-1893`**：`EVENT_SOURCES` 为空数组、`EVENT_SOURCE_STATUS` 为 `easter_egg`，
   不得参与事实回答，也不得作为引用来源。
2. **裴注引**：`hanmo-10` 的括注为
   「据《三国志·蜀书·诸葛亮传》裴注引《襄阳记》」。按 1 条引用计：
   `label = 三国志·蜀书·诸葛亮传`，`raw` 保留完整括注（含裴注引原文），避免把转引来源伪装成主要来源。
3. **括注尾注**：39 条事件的括注在书名后还有说明（如「年代依夏商周断代工程推定」），
   这些说明保留在 `raw` 中，不单独生成引用条目。
4. **不修改 description 原文**：本卡只做抽取，正文保持 V0.9.0 的展示与 diff 口径。

## 5. 关系类引用的派生规则（供 TC-05 快照落地）

关系库 `person-relations.ts` 的 `label/description` 是人工校订定性，**没有「据《…》」书目**。
因此关系引用不新增书目：

- 引用构造时取该关系 `eventSummaries` 指向的**共同事件**的 `sourceRefs`；
- 关系定性本身标注「史脉关系库（人工校订）」；
- 快照里以 `relations[].basisEventIds[]` 记录共同事件 id，供 V1.0.5 引用构造直接使用。

## 6. 人工抽查记录（2 书并列 ≥10%）

> 抽查比例要求 ≥10%（120 条 2 书事件 → 至少 12 条）。
> 下表按事件 id 排序等距抽取 12 条，自动校验项为「两个 label 均出现在 raw 中、book 非空、label 可回查」；
> 人工结论请在「复核」列签字后本卡才算通过评审。

| 事件 | 标签 A | 标签 B | raw 片段 | 自动校验 | 复核 |
|---|---|---|---|---|---|
| beisong-16 | 宋史 | 辽史 | （据《宋史》《辽史》） | 通过 | 待人工复核 |
| jin-12 | 金史 | 元史 | （据《金史》《元史》） | 通过 | 待人工复核 |
| ming-38 | 明史 | 清史稿 | （据《明史》《清史稿》） | 通过 | 待人工复核 |
| nansong-19 | 宋史 | 金史 | （据《宋史》《金史》） | 通过 | 待人工复核 |
| tang-04 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-14 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-24 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-34 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| tang-44 | 旧唐书 | 新唐书 | （据《旧唐书》《新唐书》） | 通过 | 待人工复核 |
| wudai-04 | 旧五代史 | 新五代史 | （据《旧五代史》《新五代史》） | 通过 | 待人工复核 |
| wudai-14 | 旧五代史 | 新五代史 | （据《旧五代史》《新五代史》） | 通过 | 待人工复核 |
| xihan-wenjing | 史记 | 汉书 | （据《史记》《汉书》） | 通过 | 待人工复核 |

## 7. 校验命令

```bash
node scripts/extract-sources.mjs --check
node scripts/validate-data.mjs
```
