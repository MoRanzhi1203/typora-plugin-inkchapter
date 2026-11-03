# 图片管理开发前置分支合并报告（G0）

## 1. 阶段目标

在开始图片管理模块开发前，把现有开发分支中已完成并验证的改动安全合并到主分支，保证图片分支从干净、可构建、测试通过的主分支切出。

## 2. 审计时的仓库状态

| 项目 | 值 |
|---|---|
| 当前分支 | `archive/codeblock-fold-intermittent-repair` |
| 当前分支 HEAD | `95f2f04` feat: bottom fold chevron for foldable code blocks |
| 主分支实际名称 | `main`（remote HEAD 指向 `origin/main`） |
| 远程 | `origin` → `git@github.com:MoRanzhi1203/typora-plugin-inkchapter.git` |
| 上游跟踪 | 当前分支与 `origin/archive/codeblock-fold-intermittent-repair` 一致 |
| 工作区 | clean（无未提交、无未跟踪文件） |
| 暂存区 | 空 |
| main 与开发分支差异 | main 落后 10 个提交，开发分支落后 main 0 个提交 |
| 可合并性 | `main` 是 `HEAD` 的祖先，可 fast-forward，无冲突 |

### 2.1 待合并提交（10 个）

```text
95f2f04 feat: bottom fold chevron for foldable code blocks
22ab3da fix: auto-expand a folded code block only on real text change
d3bbf57 feat: fold interaction - edit-only auto expand and manual priority
ac49655 fix: diagnostic mark sync and delete boundary guard
955a2f6 fix: code review p1-p2 - caption sidecar safety, protected lines, cleanup
e3c7adb feat: code block v4 follow-up - language bar diagnostics badge and read-only line marks
99d3ba4 feat: code block v4 - fold caret clamp and L1/L2 read-only diagnostics
6a92251 fix: code block fold intermittency - caret-visible gate and single state owner
c7344c1 feat: code block toolbar v3 - language bar, preview folding, caption alignment
f46a786 feat: content block toolbar - code copy, image copy, manual folding (v1)
```

### 2.2 改动分类（G0.2）

| 类别 | 结论 |
|---|---|
| 已实现且已验证的功能 | 内容块工具栏（代码复制 / 图片复制 / 手动折叠）、代码块折叠、代码块 v4 诊断、题注 sidecar 安全、段落删除边界、空行与诊断同步修复 |
| 已实现但尚未验证的功能 | 代码块折叠的底部折叠箭头（`95f2f04`）为最新提交，本次仅验证了构建与自动化测试，真实 Typora 交互验证仍需人工执行 |
| 临时测试代码 | 未发现未提交的临时文件；分支内测试文件均为正式 vitest 用例 |
| 调试日志 / 取证代码 | 工作区无未提交调试代码；`src/runtime/forensic-log-sink.ts` 为既有受控取证设施 |
| 不应提交的构建缓存 / 本地配置 | `dist/` 已被 `.gitignore` 忽略；未发现本地配置进入版本库 |
| 需要保留但暂不合并的实验性修改 | 无（全部改动均在当前分支且已提交） |

未执行 `git add .`；合并前工作区已 clean，无需额外整理提交。

## 3. 合并前验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 归档一致性 | `pnpm run verify:archive` | PASS（ENTRY_COUNT=39） |
| 类型检查 | `pnpm run typecheck` | 0 errors |
| 自动化测试 | `pnpm run test` | 278 文件 / 5272 用例全部通过 |
| 生产构建 | `pnpm run build` | 成功，生成 `dist/main.js`（2,433,557 B）与 `dist/style.css`（109,580 B） |
| 文档一致性 | `pnpm run docs:verify` | FAIL（1 处既有断链：历史启动审计文档指向 `build.js#L66-L78`，与本次合并无关，合并前即存在；该一次性文档已清理） |

## 4. 合并执行

```text
git switch main
git merge --ff-only archive/codeblock-fold-intermittent-repair
```

- 合并方式：fast-forward（`84028a8..95f2f04`）
- 冲突：无
- 提交 ID：`95f2f04`（未新建合并提交，历史保持线性）
- 开发者分支未删除、未改写

## 5. 合并后状态

| 项目 | 值 |
|---|---|
| main HEAD | `95f2f04` |
| 工作区 | clean |
| 远程同步 | 已推送 `84028a8..95f2f04 main -> main`，`main` 与 `origin/main` 一致 |
| 强制操作 | 未执行（无 `--force`、无历史重写） |

## 6. 未解决事项

1. 代码块底部折叠箭头（`95f2f04`）的真实 Typora 运行时交互验证尚未在本阶段执行，属于后续人工回归项（R02–R05 场景清单第 17.5 节）。
2. 图片管理模块尚未开始，本报告不包含任何图片功能改动。

## 7. 下一阶段准入条件

G1 准入条件已满足：`main` 干净、可构建、自动化测试全绿、远程已同步。
