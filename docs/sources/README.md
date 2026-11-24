# 外部数据来源（sources）

本目录保存**进入本项目之前的原始素材**，用于追溯数据来源与复现整理过程。
它们不是运行时数据：前端 TS 数据、后端快照都是由这些素材经脚本整理后的产物。

## 目录

| 文件 | 来源 | 用途 | 备注 |
|---|---|---|---|
| `史脉_历史事件与人物参与表.md` | WorkBuddy 会话 `2026-11-20-22-28-15` 产出（原路径 `C:\Users\wiledog\WorkBuddy\2026-11-20-22-28-15\`） | 早期「事件—人物参与」人工整理表，是 `frontend/data/timeline-participants.ts` 与 `person-relations.ts` 的上游素材之一 | 2026-11-25 整合时迁入 |
| `../史脉_RAG语料库_*.md` | WorkBuddy 语料生成任务产出 | RAG 向量库语料（`backend/scripts/ingest_rag.py` 的输入） | 存于 `docs/` 根目录 |
| `../史脉_第*批_*.md` | 图谱补足事件整理 | 图谱分期补足事件素材 | 存于 `docs/` 根目录 |

## 约定

- **只增不改**：原始素材保持原样；整理口径写进 `../source-review.md` 与 SPEC。
- 新素材入库前先在本目录留档，再写转换脚本（脚本归档在 `archive/dev-history/`）。
