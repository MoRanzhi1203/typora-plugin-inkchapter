# 图片管理 G0 / P0-LOCAL / P1 阶段实施记录

> 日期：2026-11-03。环境：Windows 10、Typora 1.6.7、PicGo-Core 3.2.0、Node 24。
> 本报告只包含通用与脱敏信息：不包含 Token、SSH 私钥、展开后的用户绝对路径或个人仓库账号。
> 本阶段未升级 Typora，未修改 Typora 安装目录与社区框架运行环境。

## 1. 阶段结论

| 阶段 | 状态 | 说明 |
|---|---|---|
| G0 Git 基线与保护 | 完成 | 分支 `feature/image-management` 已从最新 `main` 建立并与远端同步；未跟踪的验收图片改用本地排除保护，未删除、未提交 |
| P0 环境与代码审计 | 复用既有结论 | 见 [image-management-audit.md](./image-management-audit.md)；本阶段复核 Typora 配置与 PicGo 环境仍与审计一致 |
| P0-LOCAL 本机图床连接 | 完成 | 本机 PicGo-Core 已连接私有 GitHub 图床；Typora 原生「上传图片」真实单图与多图插入均通过 |
| P1 配置模型 | 完成（配置层） | 新增显式 `uploadService: none \| github`，默认 `none`；无有效远程配置时强制回落 `none` |

## 2. G0 — Git 基线与工作区保护

| 检查 | 结果 |
|---|---|
| 当前分支 | `feature/image-management`（跟踪 `origin/feature/image-management`，无本地领先/落后） |
| 主分支 | `main`；G0 合并与分支创建记录见 [git-pre-image-merge-report.md](./git-pre-image-merge-report.md)、[git-image-branch-report.md](./git-image-branch-report.md) |
| 本次开始前未提交内容 | 4 个测试 vault 图片（截图与个人图片各若干），全部为验收产物，未被 Git 跟踪 |
| 处理方式 | 写入 `.git/info/exclude`（仅本机生效，不进入版本库）：文件保留在磁盘，不出现在 `git status`，也不会被误提交 |
| 本次提交前工作区 | 仅 4 个预期修改文件（见第 6 节） |

未执行 `git reset --hard`、强推、分支删除或对已跟踪文件的丢弃。

## 3. P0-LOCAL — 本机 PicGo-Core 配置

### 3.1 环境复核

| 项目 | 结果 |
|---|---|
| Typora | 1.6.7，未升级 |
| Typora 上传方式 | `picgo-cli`（Typora 自带 PicGo-Core 二进制，位于 Typora 支持目录，未改动） |
| Typora 插入图片行为 | 当前为「上传图片」；其余五种原生方式未修改、未重写 |
| PicGo-Core | 3.2.0，已全局安装；Typora 另有一份自带二进制 |
| 配置文件位置 | `%USERPROFILE%\.picgo\config.json`（Git 工作区之外） |
| 凭据来源 | 操作系统凭据存储中既有的 GitHub 凭据，由本机进程直接读取；未打印、未写入仓库、未进入聊天 |
| 原配置备份 | 同目录 `config.json.inkchapter-backup-<时间戳>`，保留可回滚 |

### 3.2 配置结果（脱敏）

| 键 | 值 |
|---|---|
| `picBed.current` | `github` |
| `repo` | 本机私有图片仓库（记作 `<owner>/<private-image-repo>`，不写入公开默认配置） |
| `branch` | 以远端真实默认分支为准（本次实测为 `main`） |
| `path` | `images/` |
| `customUrl` | 空（使用 Raw URL） |

公开仓库的通用默认仍是 `uploadService: none`，不包含任何个人账号、仓库或路径。

### 3.3 权限与风险

- 曾尝试用 `icacls` 收紧 `.picgo` 目录 ACL，但当前执行环境使用受限令牌，导致 PicGo 无法写日志（`EPERM`）。已恢复用户目录默认继承权限；`%USERPROFILE%` 本身已按 Windows 用户配置目录限制访问。
- Token 以 PicGo 要求的明文形式存在于本机 PicGo 配置（这是 PicGo-Core 的既定格式）。该文件位于仓库之外、未被跟踪、未出现在任何日志或报告中。
- 若需更高隔离，可后续改用 fine-grained PAT 并定期轮换；本次未索取、未记录 Token 明文。

## 4. P0-LOCAL — 真实上传测试

所有测试图片均为程序生成的合成 PNG，不含隐私内容。

### 4.1 PicGo（Typora 自带二进制）直接调用

| 场景 | 结果 |
|---|---|
| 单文件上传 | PASS：返回 1 个 URL，退出码 0，配置文件未被改写 |
| 远程可访问性 | PASS：HTTP 200、`image/png`、字节数与本地一致 |
| 三文件批量（中文+空格 / `%`+`#` / 普通名） | 部分 PASS：三文件均提交成功，但见 4.3 的文件名缺陷 |
| 同名文件二次上传 | FAIL（预期）：HTTP 422 `sha wasn't supplied`，PicGo 不会自动覆盖 |

### 4.2 Typora 原生「上传图片」

在测试 vault 中新建临时文档，通过剪贴板粘贴本地图片，使用 Typora 原生上传流程（`picgo-cli`）：

| 场景 | 结果 |
|---|---|
| 单图粘贴 | PASS：Typora 日志出现 `[Upload Result] ... [PicGo SUCCESS]`，Markdown 只写入远程 HTTPS URL |
| 同文档第二张图 | PASS：第二张同样上传成功，Markdown 为第二个远程 URL |
| 远程可访问性 | PASS：三张测试图均 HTTP 200，字节数一致 |
| Markdown 形态 | 仅标准 `![alt](https://...)`；无本地副本链接、无双重链接、无强制元数据 |
| 本地唯一副本 | 未被删除；Typora 用户图片目录未被清空 |

> 观察到：一次粘贴剪贴板中的两个文件时，Typora 只插入了第一个；随后单独粘贴第二个成功。该行为属于 Typora 原生剪贴板处理，本阶段不拦截、不修改。

### 4.3 PicGo / 原生上传的文件名缺陷（重要）

| 输入文件名 | 远端实际路径 | 结论 |
|---|---|---|
| `plain-name.png` | `images/plain-name.png` | 正常 |
| `中文 空格.png` | `images/中文 空格.png` | 远端路径保留空格；Raw URL 需要正确编码，直接放入 Markdown 可能被截断 |
| `percent%hash#.png` | `images/percent%hash` | `#` 被当作 URL 片段，**扩展名丢失** |

结论与约束：

1. 墨章自身的上传适配器必须使用**安全文件名**（默认 `timestamp-hash`），不得直接沿用含空格、`%`、`#` 的原始文件名。
2. 原始文件名只作为资产元数据保存，用于下载/恢复，不参与远端路径。
3. Typora 原生上传路径无法在插件侧改名；该缺陷作为已知限制记录，后续可在插件提供的上传服务中规避。

### 4.4 测试产物

- 本地：合成图片位于系统临时目录；测试文档已删除。
- 远端：本次在 `images/` 下新增了少量合成测试图（`paste-probe.png`、`probe-a-*`、`probe-b-*` 及批量测试文件）。未触碰仓库内任何既有图片；如需清理可单独确认后删除。

## 5. P1 — 配置模型收口

### 5.1 代码改动

| 文件 | 变更 |
|---|---|
| `src/image-management/image-settings.ts` | 新增 `ImageUploadService`；`ImageSettings.uploadService`；默认 `none`；读取侧 `resolveUploadService` 强制校验 |
| `src/settings/image-management-setting-tab.ts` | 新增「上传服务」选择（无 / GitHub）；选择 GitHub 但无有效远程配置时拒绝并提示 |
| `src/image-management/image-settings.test.ts` | 新增 4 个用例：默认 none、无远程配置拒绝 github、有远程配置允许 github、未知服务名回落 none |
| `.gitignore` | 增加 `.env.local`、`config.local.*`、`config.private.*`、`*.private.json`、`picgo.config.json`、`.picgo/` 等防误提交规则 |

### 5.2 结果矩阵（配置层保证）

| 原生插入方式 | 上传服务 = none | 上传服务 = github |
|---|---|---|
| 无特殊操作 / 复制到 `./` / `./assets` / `./${filename}.assets` / 指定路径 | 保留 Typora 原生结果，不新增远程位置 | 保留原生结果；仅用户显式上传后才新增远程位置 |
| 上传图片 | 不静默上传；服务层不产生新远程链接 | 真实上传成功后才写入远程 URL |

说明：Typora 原生六种插入方式未被插件重写或替换；`none` 时插件不创建远程位置、不生成双链、不删除历史远程引用。

## 6. 验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | PASS（0 错误） |
| 目标单测 | `npx vitest run src/image-management src/settings` | PASS：8 文件 / 99 用例 |
| 全量单测 | `pnpm run test` | PASS：282 文件 / 5330 用例全部通过 |
| 生产构建 | `pnpm run build` | PASS：`dist/main.js`、`dist/style.css` 已更新 |
| 密钥扫描 | `git grep`（PAT / 私钥模式） | CLEAN（已跟踪文件中 0 命中） |
| 真实上传 | Typora 原生 + PicGo 二进制 | PASS（见第 4 节） |

## 7. 隐私与密钥

| 项目 | 状态 |
|---|---|
| GitHub Token | 仅本机 PicGo 配置文件；未进入仓库、聊天、日志或报告 |
| SSH 私钥 | 未读取、未复制 |
| PicGo 用户配置 | 仓库之外；原配置已备份 |
| 个人绝对路径 | 未写入公开默认配置、测试或报告；报告中仅使用 `%USERPROFILE%` 等逻辑路径 |
| 测试图片 | 全部为合成图；个人测试图片通过本地排除保护，未提交 |

## 8. 未完成与风险

1. P2–P9（资产模型与数据库、路径体系、双链/缓存/离线、迁移、分享、管理界面、完整验收）尚未实现。
2. 原生上传的 `#`/`%`/空格文件名缺陷无法在 Typora 原生链路内修复，只能由墨章上传适配器规避。
3. PicGo 同名文件二次上传返回 422，适配器必须生成唯一文件名并校验返回 URL。
4. 插件自身的安全凭据存取（`credentialReferenceId` → 系统凭据）在 P1 阶段尚未实现；后续 P11 已补齐 Windows DPAPI 存储与 Token 输入/测试链路（本文件保留为阶段记录）。
5. 本次未验证：断网、上传中断、切换文档、撤销粘贴等异常路径。

## 9. 下一阶段准入条件

1. 本阶段代码提交并通过全量测试与构建（已完成）。
2. 开始 P2：资产模型（Asset / AssetLocation / AssetReference）与资产索引接入插件数据目录。
3. 任何远程上传实现必须先满足：唯一命名、返回 URL 校验、失败不改写 Markdown、日志脱敏。
