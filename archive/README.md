# archive · 历史开发归档

本目录保存史脉项目开发过程中产生的**历史脚本、日志与原型**，仅供追溯，不参与构建与运行。
2026-11-25「本机材料整合」时从仓库 `.tmp/`（原为各 AI 开发会话的临时目录，共约 2 GB）
与桌面残留目录中挑选有价值的部分归档，其余可再生的浏览器缓存 / 截图已清理。

## 结构

| 目录 | 内容 |
|---|---|
| `legacy/` | 旧目录残留文件（如桌面「史脉」目录里的 `backend/.env.example`，已被 `backend/.env.example` 取代） |
| `dev-history/scripts/` | 各版本的数据生成、校验、截图、CDP 验收脚本（V0.8–V1.0.5.1） |
| `dev-history/data/` | 生成脚本的中间产物（V0.8.2 新增事件 JSON、候选清单等） |
| `dev-history/logs/` | 历史验收日志（verify / live-acceptance / ui-e2e / ingest-rag） |
| `dev-history/ui-prototype/` | Logo 与首页 / 问答页的 HTML 原型（V1.0.4–V1.0.5 期间的 UI 迭代） |

## 说明

- 这些文件**不保证可运行**（依赖当时的工作目录与中间数据），保留目的是可追溯、可复用思路。
- 完整开发历程见 [`../docs/开发历程-DSH会话索引.md`](../docs/开发历程-DSH会话索引.md)。
- 整合前的完整备份（含 2 GB 临时目录副本、git bundle）在本机
  `C:\Users\wiledog\Backup\histolink-20261125\`，确认无误后可自行删除。
