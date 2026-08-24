# PROJECT ARCHIVE / MD CONSOLIDATION / GITHUB BASELINE

## 任务性质

本轮不是继续开发功能，而是对当前已恢复的墨章插件基线进行一次**项目级归档、Markdown 文档整编、历史提示词清理和 GitHub 存档**。

当前已经确认的新开发基线为：

```text
SOURCE BASELINE:
d8aca1f69a58bced6f6e57297a3a4bf67feaef10

BUILD ID:
inkchapter-outline-observer-late-bind-v26

FORMULA NATIVE RENDER:
PASS

LITERAL $$:
NOT VISIBLE
```

已完成的完整回档结论：

```text
SOURCE = d8aca1f
PROJECT BUILD = d8aca1f build
RUNTIME BUILD = project build
PROJECT/RUNTIME main.js SHA = MATCH
PROJECT/RUNTIME style.css SHA = MATCH
Typora process/window/vault = VERIFIED
Plugin document tracking = PERSISTED
```

本轮目标是把这一状态整理成**可长期维护、可在 GitHub 追溯、可供后续 AI Agent 准确读取**的项目文档基线。

---

## 一、总体目标

必须完成以下工作：

1. 对当前项目状态进行最终只读审计；
2. 盘点全部项目级 Markdown；
3. 将已经执行完成的历史提示词内容提炼进长期文档；
4. 将当前功能状态整理进项目功能文档；
5. 将重要开发/修复过程整理进项目日志；
6. 将当前回档基线、公式事故与恢复结论写入维护文档；
7. 清除已经失效、超版本、废弃的提示词 Markdown；
8. 清除被整合后已无独立价值的冗余 Markdown；
9. 更新 README / docs 索引；
10. 对整理后的项目执行 Git 审计；
11. 创建 Git 存档 commit；
12. 创建明确的 baseline/archive tag；
13. 推送到已存在并确认正确的 GitHub remote；
14. 最终输出项目文档结构、删除清单、Git commit、tag、remote 和 push 结果。

---

### 二、硬性安全规则

#### 2.1 不得删除用户资料

禁止删除：

```text
test/vault/**/*.md
```

以及：

- 用户测试文档；
- 用户配置；
- vault 中用于真实 Runtime 验收的 Markdown；
- 插件运行所需非文档配置；
- 源码；
- 测试源码；
- 构建配置；
- package / lockfile。

本轮 Markdown 清理仅针对**项目维护文档和 AI prompt 文档**。

## 2.2 不得按版本号机械删除

“超版本提示词”不能简单理解为：

```text
版本号 > d8aca1f
=> 全部删除
```

必须先判断内容是否已经：

- 被当前回档事实推翻；
- 描述已废弃的公式架构；
- 属于 R5/R24/R25/R59/R60 旧公式修复链；
- 已执行且其结论已经被吸收到正式项目文档；
- 被后续正式文档完全覆盖；
- 不再对应当前代码和当前开发路线。

只有满足以上条件，才允许进入删除候选。

如果某个历史 prompt 中仍包含当前项目唯一的设计依据、用户需求、验收标准或其他未迁移知识：

```text
先迁移
再删除
```

禁止直接删除。

## 2.3 删除必须可审计

所有删除操作之前必须生成：

```text
docs-cleanup-plan.txt
```

至少记录：

```text
PATH
CATEGORY
KEEP / MERGE / DELETE
TARGET_DOC
REASON
```

执行实际删除前，必须能够证明 DELETE 文件中的有效信息已经进入 TARGET_DOC，或者确实完全失效。

---

## 三、Phase 0 — 当前3状态再验证

进入：

```text
D:\TyporaPluginProjects\typora-plugin-inkchapter
```

执行：

```powershell
git rev-parse HEAD
git branch --show-current
git status --short
git remote -v
git tag --list
```

必须确认：

```text
CODE_BASELINE = d8aca1f69a58bced6f6e57297a3a4bf67feaef10
```

如果 HEAD 已因纯文档整理产生新 commit，则必须进一步验证源码树仍对应 d8aca1f：

```powershell
git diff d8aca1f69a58bced6f6e57297a3a4bf67feaef10 -- src
git diff d8aca1f69a58bced6f6e57297a3a4bf67feaef10 -- build.js package.json pnpm-lock.yaml tsconfig.json
```

源码/构建配置若已经发生非预期变化：

```text
STOP
```

不得继续做“基线存档”。

---

### 四、Phase 1 — Markdown 全量盘点

只盘点项目维护 Markdown。

必须排除：

```text
node_modules/
.pnpm-store/
dist/
test/vault/**/*.md
.git/
```

生成 Markdown 清单，至少包含：

```text
PATH
SIZE
LAST MODIFIED
PURPOSE
CATEGORY
```

推荐分类：

```text
A. ROOT / README
B. PROJECT STATUS
C. FEATURE / FUNCTION
D. ARCHITECTURE
E. DEVELOPMENT LOG / CHANGELOG
F. RUNBOOK / DEPLOYMENT
G. TEST / ACCEPTANCE DOC
H. PROMPT - PENDING
I. PROMPT - EXECUTED
J. PROMPT - OBSOLETE / ABANDONED
K. DUPLICATE / REDUNDANT
L. UNKNOWN
```

重点扫描：

```text
docs/
docs/prompts/
docs/prompts/pending/
docs/prompts/archive/
README*.md
CHANGELOG*.md
*STATUS*.md
*FEATURE*.md
*ARCHITECTURE*.md
*RUNBOOK*.md
```

---

### 五、Phase 2 — 建立长期文档体系

整理后至少应存在以下长期文档。

如已有同类文档，优先更新原文件，不要重复创建。

## 5.1 README.md

作为项目总入口。

至少整理：

- 项目定位；
- 当前基线；
- 主要功能；
- 开发环境；
- 构建入口；
- Runtime 测试 vault；
- docs 导航；
- 当前公式模块状态；
- 后续开发约束。

不要把历史事故细节全部堆进 README。

### 5.2 docs/PROJECT-STATUS.md

记录当前真实状态。

至少包括：

```text
Git baseline
Build ID
Build command
Runtime deployment path
Test vault
Current validated capabilities
Known limitations
Formula status
Current development baseline
Deprecated architecture
Next development entry point
```

公式部分必须明确：

```text
d8aca1f established as new formula redevelopment baseline
Typora native MathJax rendering = PASS
Old R5/R24/R25/R59/R60 formula intervention chain = ABANDONED
Formula numbering = NOT YET REDEVELOPED on new baseline
```

#### 5.3 docs/FEATURES.md

将当前真正存在的插件功能整理成长期功能说明。

必须以**当前源码 + 已验证 Runtime**为依据，不得把旧 prompt 中“计划实现但实际不存在”的功能写成已完成功能。

建议按模块整理：

- 标题编号；
- 目录/侧栏；
- 严格文档校验；
- 段落/排版；
- 图名；
- 表名；
- 代码片段命名；
- 公式；
- Runtime 日志/审计；
- 设置界面；
- 测试 vault。

每项标记：

```text
STABLE
AVAILABLE
PARTIAL
DISABLED
NOT IMPLEMENTED
REDEVELOPMENT REQUIRED
```

### 5.4 docs/DEVELOPMENT-HISTORY.md

将已经执行完的历史 prompt 中仍值得保留的开发过程整合进这里。

不要逐份复制 prompt。

应整理成：

```text
日期 / 阶段
问题
采取方案
结果
最终结论
是否仍适用于当前基线
```

特别记录 Formula incident：

- 旧公式自动编号架构逐渐进入 MathJax 内部干预；
- 后期出现块公式无法正常渲染、裸 `$$...$$`；
- R24 无可恢复 Git commit；
- forensic 确认 r5.4.3.22/23/24 不存在独立 commit；
- 最终完整回档到 d8aca1f；
- Runtime 重新验证原生 MathJax 渲染正常；
- d8aca1f 成为新公式开发基线；
- 旧 R5→R60 公式架构不应整体恢复。

## 5.5 docs/FORMULA-BASELINE.md

至少写明：

```text
BASELINE COMMIT
BASELINE BUILD ID
WHY THIS BASELINE
WHAT IS VERIFIED
WHAT IS NOT VERIFIED
ABANDONED FORMULA ARCHITECTURE
HARD INVARIANTS
REDEVELOPMENT RULES
```

Hard invariants：

1. Typora 原生 MathJax 渲染优先级最高；
2. 任何编号功能不得让块公式回退到裸 `$$`；
3. 不得默认接管 MathJax 内部生命周期；
4. 不得直接覆盖 MathJax 管理 DOM；
5. 每次公式开发必须先验证 native render；
6. Source/Build/Runtime SHA 必须闭环；
7. Typora 启动必须真实验证 process / HWND / title / vault / runtime build。

## 5.6 docs/CHANGELOG.md

如已有同类文件则更新原文件。

增加本次基线恢复条目：

```text
2026-08-21
- Full rollback to d8aca1f
- Restored native MathJax block formula rendering
- Abandoned old formula intervention chain
- Established new redevelopment baseline
- Consolidated project documentation
- Removed obsolete prompt documentation
```

---

### 六、Phase 3 — 已执行 Prompt 的知识迁移

重点处理：

```text
docs/prompts/pending/
```

以及其他 prompt 目录。

逐份判定：

## EXECUTED

已执行且已经产生明确结果。

处理方式：

```text
提炼关键事实
→ DEVELOPMENT-HISTORY / PROJECT-STATUS / FEATURES / FORMULA-BASELINE / CHANGELOG
→ 删除原 prompt
```

## OBSOLETE

描述已经废弃、被回档推翻或不再允许恢复的方案。

例如旧公式链：

```text
R5
R24
R25
R26...
R59
R60
R60.1
R60.1.1
R60.1.2
```

如果这些 prompt 的有效历史信息已经进入 DEVELOPMENT-HISTORY / FORMULA-BASELINE，则删除原 prompt。

## ACTIVE

仍对应当前未完成任务并且在当前基线上仍成立。

保留。

但旧公式体系的“未完成 prompt”不能仅因状态为 pending 就保留。

如果其架构依赖已经废弃：

```text
PENDING + INVALID ARCHITECTURE
=> OBSOLETE
```

---

### 七、Phase 4 — 超版本 Prompt 清理规则

当前公式开发版本线已经重置。

旧 Formula R5→R60 架构的 prompt 不再作为当前开发指令库存在。

完成历史知识迁移后，应从当前 prompt 工作区移除。

原则：

```text
正式长期文档保留历史结论
Prompt 不承担永久历史档案职责
```

如果确实需要留下极少数原始 prompt 作为取证材料，应进入：

```text
docs/archive/
```

并明确：

```text
ARCHIVED
DO NOT EXECUTE
OBSOLETE ARCHITECTURE
```

默认优先删除，而不是无限制 archive。

---

## 八、Phase 5 — 冗余 Markdown 清理

允许删除：

1. 内容已经 100% 被新长期文档覆盖；
2. 临时 forensic 报告；
3. 已执行的阶段性 runbook；
4. 已完成 prompt；
5. 重复功能说明；
6. 重复项目状态说明；
7. 旧版本部署手册；
8. 不再适用于当前基线的公式文档；
9. 无独立维护价值的中间总结。

不得因为“看起来相似”就删除。

删除前必须在 cleanup plan 中标明：

```text
MERGED INTO:
<target path>
```

---

## 九、Phase 6 — 文档交叉一致性检查

整理后检查：

```text
README
PROJECT-STATUS
FEATURES
DEVELOPMENT-HISTORY
FORMULA-BASELINE
CHANGELOG
```

必须不存在互相冲突的信息。

重点检查：

- 当前 commit；
- 当前 build ID；
- 公式状态；
- 旧公式架构状态；
- build/deploy 命令；
- Runtime 路径；
- vault 路径；
- 当前稳定功能；
- 未实现功能。

禁止出现：

```text
一个文档写 R60 是当前版本
另一个文档写 d8aca1f 是当前版本
```

---

### 十、Phase 7 — 更新 docs 索引

如果有：

```text
docs/README.md
docs/index.md
```

更新它。

如果没有，可创建：

```text
docs/README.md
```

只作为简洁目录索引。

至少指向：

```text
../README.md
PROJECT-STATUS.md
FEATURES.md
DEVELOPMENT-HISTORY.md
FORMULA-BASELINE.md
CHANGELOG.md
```

不要再建立大量一页式索引。

---

### 十一、Phase 8 — 删除后审计

执行：

```powershell
git status --short
git diff --stat
git diff -- README.md docs
```

输出：

```text
KEPT_MD
MERGED_MD
DELETED_MD
CREATED_MD
UPDATED_MD
```

确认：

- 无源码改动；
- 无 test/vault 用户文档删除；
- 无配置文件误删；
- 无构建文件误改。

如果出现源码改动：

```text
STOP
```

---

## 十二、Phase 9 — GitHub 存档前验证

检查 remote：

```powershell
git remote -v
```

必须证明现有 remote 是目标 GitHub 仓库。

如果没有 remote、remote 不是 GitHub、remote 地址存在歧义或无法确认用户希望推送的仓库：

```text
STOP
```

不得自动创建或修改 remote。

---

#### 十三、Phase 10 — 创建项目文档整理 commit

确认 diff 只包含本轮允许的：

```text
README / docs / prompt cleanup
```

然后：

```powershell
git add README.md docs
```

检查：

```powershell
git diff --cached --stat
git diff --cached --name-status
```

确认无源码/用户 vault 文件后提交：

```text
docs: archive d8aca1f baseline and consolidate project history
```

记录：

```text
ARCHIVE_COMMIT=<new commit hash>
CODE_BASELINE=d8aca1f69a58bced6f6e57297a3a4bf67feaef10
```

必须明确 ARCHIVE_COMMIT 是文档整理 commit；CODE_BASELINE 仍是 d8aca1f。

---

### 十四、Phase 11 — 创建 Git Tag

在文档整理 commit 上创建 annotated tag：

```text
formula-render-restored-baseline-20260821
```

示例：

```powershell
git tag -a formula-render-restored-baseline-20260821 -m "d8aca1f code baseline: native MathJax rendering restored; project docs consolidated"
```

验证：

```powershell
git show formula-render-restored-baseline-20260821 --no-patch
```

---

### 十五、Phase 12 — 推送 GitHub

只有已确认 remote 后才允许执行。

若当前分支为 main：

```powershell
git push origin main
git push origin formula-render-restored-baseline-20260821
```

如果当前分支不是 main：

不得自行猜目标分支。

禁止：

```text
git push --force
git push -f
```

禁止重写远端历史。

---

### 十六、最终 GitHub 存档验证

推送后执行：

```powershell
git status
git log -3 --oneline --decorate
git remote -v
git tag --list "formula-render-restored-baseline-20260821"
```

如工具可安全读取远端：

```powershell
git ls-remote --heads origin
git ls-remote --tags origin
```

必须确认 archive commit 已在 remote、tag 已在 remote、本地工作区无非预期修改。

---

### 十七、最终报告格式

```text
PROJECT ARCHIVE COMPLETE

CODE BASELINE:
d8aca1f69a58bced6f6e57297a3a4bf67feaef10

ARCHIVE COMMIT:
<hash>

ARCHIVE TAG:
formula-render-restored-baseline-20260821

GITHUB REMOTE:
<verified remote>

PUSH:
PASS / NOT EXECUTED + reason

DOCUMENTS CREATED:
...

DOCUMENTS UPDATED:
...

PROMPTS MERGED:
...

PROMPTS DELETED:
...

REDUNDANT MD DELETED:
...

USER VAULT MD DELETED:
0

SOURCE FILES CHANGED:
0

CURRENT FORMULA STATE:
NATIVE MATHJAX RENDER = PASS
FORMULA NUMBERING = REDEVELOPMENT REQUIRED

OLD FORMULA R5-R60 ARCHITECTURE:
ABANDONED

DECISION:
CURRENT PROJECT STATE ARCHIVED
```

---

## 十八、本轮停止条件

以下任意情况出现立即 STOP：

1. HEAD / source baseline 无法证明；
2. 需要删除但内容尚未迁移；
3. 无法判断 Markdown 是否属于用户数据；
4. 删除计划涉及 `test/vault/**/*.md`；
5. 出现非预期源码 diff；
6. Git remote 无法确认；
7. 推送要求 force；
8. GitHub authentication 失败；
9. 文档之间出现当前版本冲突；
10. 无法证明旧 prompt 已经被正式长期文档覆盖。

---

### 最终原则

正确流程必须是：

```text
审计
→ 分类
→ 提炼有效知识
→ 写入长期文档
→ 验证长期文档完整
→ 删除已经失效/被覆盖的 prompt
→ 删除冗余项目 Markdown
→ 审计 diff
→ commit
→ tag
→ GitHub push
```

最终目标是让项目只保留：

```text
当前真实代码
+
少量长期有效文档
+
必要的当前开发 prompt
```

而不是继续保留大量已经执行、互相冲突、已经超版本或属于废弃架构的历史提示词。
