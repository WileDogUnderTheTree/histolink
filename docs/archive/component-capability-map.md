# 组件能力现状与缺口清单（V1.0.1 / TC-08）

> 依据：[V1.0.1-任务卡拆解](V1.0.1-任务卡拆解.md) TC-08 / [V1.0-项目现状与开发前置审核报告](V1.0-项目现状与开发前置审核报告.md) §7-8
> 冻结日期：2026-11-23
> 代码事实源：`frontend/lib/action-capabilities.ts`（动作 → 能力 → 归属版本），
> `frontend/lib/graph-selection.ts`（受控选中 / 高亮纯函数）。

## 1. 本卡交付的接口

### 1.1 `PersonGraph2D` 受控 props

| prop | 类型 | 缺省 | 语义 |
|---|---|---|---|
| `data` | `PersonGraphData` | 必填 | 当期图数据（不变） |
| `centerPersonId` | `string` | 必填 | 当前中心人物（不变） |
| `onCenterPersonChange` | `(id) => void` | 必填 | 长按换中心（不变） |
| `highlightedPersonIds` | `readonly string[]?` | `undefined` | 最小视觉高亮；未知 id 自动过滤、不参与布局 |
| `selectedPersonId` | `string \| null?` | `undefined` | `undefined` = 非受控（默认行为完全不变）；`null` = 受控无选中；合法一跳邻居 id = 打开关系面板 |
| `onPersonSelect` | `(id) => void?` | `undefined` | 点击 / 键盘选中邻居时回传，参数为**图节点 id** |

> **id 口径说明**：V1.0.1 图谱节点仍以姓名为 id（任务卡 §0.3「不迁移 person_id」）；
> V1.1 关系库与节点迁移 `person_id` 后，prop 名称与语义不变，仅 id 取值切换。

### 1.2 页面级接入

| 页面 | 接入内容 | 深链接 |
|---|---|---|
| `/timeline` | 注册 `timeline.focus_event` / `timeline.focus_dynasty` handler，执行后回写 URL | `/timeline?event=&dynasty=&mode=` |
| `/graph` | 注册 `graph.focus_person` / `graph.focus_relation` handler，执行后回写 URL | `/graph?person=&era=&mode=&selected=` |

约定：

- 同页 handler 只在 `currentSurface` 命中时注册；卸载即注销（`ActionBus.register` 返回注销函数）。
- payload 非法 / id 不存在 / 人物不在当期图 → **静默不执行**，绝不把页面带到空白状态。
- `graph.focus_relation` 是受控选中的第一个真实使用方：换中心 + `selectedPersonId` 打开关系面板。
- V1.0.1 **不做**全量 URL 状态化（每次点击都同步 query）；打开深链接可恢复，动作执行会回写，
  其余交互仍由页面状态自行管理。全量状态化属 V1.0.4（见 §3）。

## 2. 能力矩阵（当前进度）

图例：✅ implemented｜🟡 partial｜⬜ planned

| 动作类型 | 目标表面 | 契约可用性 | 现状 | 所需组件能力 | 归属 |
|---|---|---|---|---|---|
| `timeline.focus_event` | timeline | available | ✅ | `timeline.select-event` | V1.0.4 |
| `timeline.focus_dynasty` | timeline | available | ✅ | `timeline.select-dynasty` | V1.0.4 |
| `graph.focus_person` | graph | available | ✅ | `graph.focus-person` + `graph.center-person` | V1.0.4 |
| `graph.focus_relation` | graph | available | 🟡 | `graph.focus-person` + `graph.select-relation` + `graph.center-person` | V1.0.4 |
| `ask.suggest` | ask | available | ⬜ | `ask.suggest-questions` | V1.0.6 |
| `timeline.highlight_events` | timeline | planned | ⬜ | `timeline.highlight-event-set` | V1.0.4 |
| `graph.highlight_persons` | graph | planned | 🟡 | `graph.highlight-person-set` | V1.0.4 |
| `open.event_card` | —（跨页确认） | planned | ⬜ | `overlay.event-card` | V1.0.5 |
| `open.person_card` | —（跨页确认） | planned | ⬜ | `overlay.person-card` | V1.0.5 |

`graph.focus_relation` 与 `graph.highlight_persons` 标 partial 的原因：
组件已具备受控选中 / 高亮入参，但页面级入口、关系卡抽屉与边高亮尚未实现。

## 3. V1.0.4 待做清单（能力缺口）

1. **时间轴高亮集合 / 区间**：`timeline.highlight_events` 需要页面维护高亮 id 集合、点样式与图例；
   本卡明确不做，避免把「基建」做成「交互重构」。
2. **图谱边高亮**：`graph.focus_relation` 目前只高亮目标人物；共同事件边需要额外 class 与事件过滤。
3. **实体卡片抽屉**：`open.event_card` / `open.person_card` 需要全局抽屉与跨页确认 UI。
4. **全量 URL 状态化**：打开链接恢复已具备；每次点击同步 query、浏览器前进后退恢复属 V1.0.4。
5. **Ask 建议问题**：`ask.suggest` 需要问答页渲染建议 chips，随 V1.0.6 多轮能力落地。
6. **person_id 迁移**：受控 props 的 id 目前是姓名；V1.1 关系库迁移后统一为 `person_id`。

## 4. 回归清单（手工验收，V1.0.1）

- [ ] 春秋默认中心孔子、三国默认中心曹操；单击邻居弹关系面板、长按换中心、拖拽均正常（非受控默认行为）。
- [ ] `/graph` 打开 `?person=p-kangxidi-aaa3&era=qing` 中心为康熙帝；`?person=唐太宗&era=tang` 中心为李世民。
- [ ] `/timeline?event=qin-unify` 定位秦朝、选中「秦始皇统一六国」并展开事件卡。
- [ ] `/timeline?event=special-star-1893` 打开彩蛋横幅；`?event=chunqiu-40&mode=brief` 保持简阅。
- [ ] ActionBus 同页动作执行后 URL 变为对应深链接；非法 payload 不改变页面。
- [ ] `graph.focus_relation` 执行后中心换人、关系面板打开（受控选中）；用户再点击其他邻居可切换选中。

> 上述手工项在 V1.0.1 出口验收时用 Edge headless + CDP 复核，结果记录在
> [V1.0.1-验收记录](V1.0.1-验收记录.md)。
