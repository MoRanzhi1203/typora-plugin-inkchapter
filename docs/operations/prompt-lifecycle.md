# Prompt Lifecycle 治理指南（历史）

> 合并自历史整理任务的最终规则。**自 2026-10-05 起，项目不再保留任何提示词 Markdown 文件**：
> 全部提示词的有效信息已并入 [../modules/](../modules/)、[../architecture/](../architecture/)、
> [../operations/](../operations/) 与 [../maintenance/prompt-consolidation-record.md](../maintenance/prompt-consolidation-record.md)。
> 本文件仅保留"证据核对"与"内容压缩"的通用原则，供未来处理一次性工程任务时参考。

---

## 一、当前文档模型（替代旧的提示词目录）

```text
docs/
├─ modules/          # 当前功能的 canonical 模块说明
├─ architecture/     # 架构与身份/呈现权威
├─ operations/       # 构建 / 部署 / 运行 / 测试
├─ decisions/        # ADR 架构决策记录
├─ diagnostics/      # 诊断能力矩阵与 gap ledger
├─ roadmap/          # 已知缺口与延后工作
└─ maintenance/      # 清理历史 + 提示词迁移记录
```

一次性工程任务完成后，**结论进入上述正式文档**，不另存任务正文。

---

## 二、ExecutionStatus（执行状态）

状态描述 prompt 的**执行完成度**，与文件动作分离：

| Status | 定义 |
|--------|------|
| `PENDING` | 尚未开始执行 |
| `EXECUTED_PARTIAL` | 部分执行完成，仍有未完成项 |
| `EXECUTED_CONFIRMED` | 已完成执行，其要求的标准均已满足 |
| `SUPERSEDED` | 被后续 prompt 完整替代 |
| `ROLLED_BACK` | 已执行但被回退 |
| `REMOVED_FEATURE` | 相关功能已被移除 |
| `UNKNOWN` | 无法从现有证据确认执行状态 |

---

## 三、FinalAction（最终动作）

动作描述 prompt **文件的最终处置**，与执行状态分离：

| Action | 定义 |
|--------|------|
| `KEEP_PENDING` | 保留在 pending/，等待执行 |
| `DELETE` | 永久删除 prompt 文件 |
| `MERGE_THEN_DELETE` | 提取有效结论 → 合并到长期文档 → 删除 |
| `ARCHIVE_EXECUTED` | 归档：独立历史价值 + 已执行完成 |
| `ARCHIVE_REPLACED` | 归档：被替代 + 有独立历史价值 |
| `ARCHIVE_ROLLED_BACK` | 归档：已回退 + 有回退历史价值 |
| `ARCHIVE_REMOVED` | 归档：功能已移除 + 有历史价值 |
| `KEEP_UNKNOWN` | 保留：状态无法确定，不可删除 |

**核心规则：`ExecutionStatus ≠ FinalAction`。`EXECUTED_CONFIRMED` 不自动等于 `ARCHIVE_EXECUTED`。**

---

## 四、DELETE 条件

同时满足以下全部条件方可 DELETE：

- [x] 已经执行完成
- [x] 当前有效结论已被长期文档（modules/、operations/、decisions/、PROJECT_STATUS.md）吸收
- [x] 无独立历史价值（非唯一根因、非重大架构决策、非不可逆迁移、非兼容约束、非回滚点）
- [x] 当前源码 / docs 无对 prompt 正文的依赖引用
- [x] 不属于仍待执行的任务

---

## 五、MERGE_THEN_DELETE 条件

满足以下条件时执行 MERGE_THEN_DELETE：

- [x] 当前有效结论仍有价值
- [x] 但尚未进入长期文档

流程：
1. 提取当前仍有效的结论（非旧失败方案、非流水账、非重复构建信息）
2. 合并到正确的长期主文档
3. 确认主文档能够独立表达当前事实
4. 删除 prompt

---

## 六、ARCHIVE 条件（严格限制）

仅以下情况允许 ARCHIVE：

- 唯一根因证据（删除后无法解释当前代码设计）
- 重大架构决策及原因
- 不可逆 schema / 数据迁移
- 重大兼容策略
- 重要回滚点
- 重大失败方案及其技术原因
- 安全约束
- 当前主文档明确引用的历史证据

**普通已执行的 bug 修复、UI 调整、中间补丁、一次性诊断等，一律不归档。**

---

## 七、Evidence Checklist（删除前必检）

每个 DELETE 或 MERGE_THEN_DELETE 候选必须逐项确认：

```
[ ] 已读完整任务核心要求（目标、完成标准、GUI/runtime 要求）
[ ] 已确认 ExecutionStatus（基于代码/测试/GUI 证据，非仅文件名）
[ ] 已确认当前有效结论由长期文档承载（精确到章节）
[ ] 已确认无唯一历史价值
[ ] 已检查源码/docs 引用依赖
[ ] 已检查后续 GUI 是否推翻旧"完成"报告
[ ] 已记录 AbsorbedBy 到章节
```

---

## 八、"前 30 行"硬约束

**读取文件前 20/30 行只能用于 topic 初筛，绝不能用于 completion/delete 判定。**

任何删除候选至少需检查：
- 任务目标
- 完整完成标准（含 GUI/runtime 要求）
- 测试要求
- 后续证据

---

## 九、Git 跟踪与备份要求

**历史提示词目录（已不存在）不受 Git 跟踪。** 因此（历史规则）：

1. 任何批量删除前，必须先建立外部备份（如 `D:\TyporaPluginProjects\_prompt-backups\`）或可恢复快照
2. 删除操作建议分步执行，每步可回退
3. 重大清理后必须更新 `docs/maintenance/prompt-cleanup-history.md`

---

## 十、问题链压缩原则

对连续多轮修复同一问题域的 prompt 链：

- 识别：最早审计 → 失败修复 → 部分修复 → 后续替代 → 最终有效方案
- 中间普通补丁 → DELETE（无独立价值）
- 最终仍需执行 → KEEP_PENDING
- 唯一根因审计 → 仅真正不可替代的 ARCHIVE

---

## 十一、普通 Superseded Prompt 默认删除

```
A 被 B 完整替代
+ A 的有效结论已进入主文档
+ A 无独立历史价值
→ DELETE A（非 ARCHIVE_REPLACED）
```

---

## 十二、审计 Prompt 处理

审计任务完成后：
- 结论已进入后续主文档 + 无唯一证据 → DELETE
- 包含唯一根因证据 + 删除后无法解释当前设计 → ARCHIVE_EXECUTED

---

## 十三、后续 GUI 证据可推翻旧"完成"

如果旧 prompt 报告"完成"但后续截图证明问题仍存在：
- 不能判 `EXECUTED_CONFIRMED`
- 应重新判 `EXECUTED_PARTIAL` 或 `SUPERSEDED`
- 按当前价值决定 KEEP / DELETE / ARCHIVE

---

## 十四、AborbedBy 必须精确到章节

不允许只写 `docs/modules/settings-ui.md`，应写：

```
docs/modules/settings-ui.md
§ Heading Layout
§ Number-Title Gap
§ Dirty State
```

---

## 十五、Cleanup Manifest

每次清理后更新 `docs/maintenance/prompt-cleanup-history.md`，记录：

| Prompt | Topic | ExecutionStatus | FinalAction | AbsorbedBy | HistoricalValue | FinalPath |

只记录简短索引，不复制 prompt 全文。
