# 图片管理系统审计报告（P0）

## 1. 阶段目标与结论摘要

本阶段只做审计，不实现图片功能。目标是确认：现有墨章哪些能力可复用、Typora 与 PicGo 的真实环境状态、GitHub 图床可访问性，以及后续实现的技术约束与阻塞项。

结论摘要：

1. 墨章已具备**标题 / 图表题注编号**、**Markdown 资源引用扫描**、**图片路径解析与复制**、**文件复制冲突策略**、**设置系统与迁移**、**统一资源释放**等可复用基础设施。
2. 墨章**不存在**图片资产管理、哈希去重、任务队列、图库面板、GitHub 远程索引、凭据管理、下载与同步能力。
3. PicGo-Core 3.2.0 可在本机 Node v24 环境安装并运行，GitHub 上传管线存在；使用本机已存储的 GitHub 凭据完成了**真实上传验证**（文件存在于 `example-image-bed`，字节数一致，Raw URL 200）。
4. `example-owner/example-image-bed` 存在、公开、默认分支 `main`，Raw URL 可访问；凭据具备 `push` 权限。
5. 关键结论：**PicGo-CLI 每次启动都会以默认 `~/.picgo/config.json` 初始化并改写它**，即使传入 `-c`。审计过程已复现该行为并恢复原文件；后续实现必须使用 PicGo 编程 API + 插件私有配置路径。
6. PicGo 上传结果必须校验 `imgUrl`：成功时 `url` 可能为 `undefined`；失败时不抛异常但两个 URL 均为空。
7. Typora 内部编辑接口：`File.imgEdit` 在 1.6.7 不存在，`File.option.imageUploader = custom`；原生粘贴可观测（4.3），但 `Editor.reset` / `File.reloadContent` 的撤销语义与真实拖拽仍未验证，引用替换继续冻结。

## 2. 项目结构（P0.1）

| 层 | 位置 | 现状 |
|---|---|---|
| 插件入口 | `src/main.ts` | 单入口，`Plugin` 子类；`onload` 注册设置、服务、命令；`onunload` 统一释放 |
| 运行时 / 生命周期 | `src/runtime/` | 启动审计、取证日志、文档运行时上下文 |
| 基础设施 | `src/infrastructure/` | `content-block-clipboard.ts` 为唯一剪贴板边界；`typora-adapter.ts` **仍是空文件（仅 TODO）** |
| 文件传输 | `src/file-transfer/` | 文件树拖放、真实复制服务、冲突策略 |
| 文档工具 | `src/document-utilities/` | 文档诊断、定位、内容块工具栏、资源扫描、抽屉与覆盖层 |
| 标题与题注 | `src/heading-numbering/` | 标题编号、题注系统、图片 alt 绑定、题注存储 |
| 设置 | `src/settings/` | `InkChapterSettings` + 默认值 + 迁移 + 设置页 |
| 构建 | `build.js` / `pack.js` | esbuild 打包 `dist/main.js` + `style.css`；`pack.js` 生成 `plugin.zip` |

Node 能力已可用：`fs`、`path`、`crypto`、`child_process`（打包后运行于 Electron 渲染进程 + `reqnode`）。`plugin.dataPath` 可用作插件私有数据目录。

### 2.1 生命周期与资源释放

`onunload` 已按顺序释放：文件树拖放 → 标签关闭增强 → 标签菜单 → 文档工具 → 编号服务 → 题注右键菜单 → 题注服务 → 取证日志。每步独立 `try/catch`，单步失败不阻断后续释放。新增图片服务必须沿用同一模式。

### 2.2 设置系统

`src/settings/settings-model.ts` 定义 `InkChapterSettings`（`schemaVersion: 11`），`src/settings/default-settings.ts` 提供默认值，`main.ts` 在 `onload` 中执行字段级迁移（缺字段则补默认值）。图片配置应作为新的可选字段加入，并新增迁移，不破坏既有字段。

## 3. 现有图片处理能力

### 3.1 已存在且可复用

| 能力 | 位置 | 复用方式 |
|---|---|---|
| Markdown 图片引用扫描（含字面量排除、token / destination 双范围、alt、资源分类） | `src/document-utilities/document-resource-scanner.ts` | 图片引用识别、缺失检测、引用替换定位的唯一解析入口 |
| 图片路径编解码与类型判定 | `src/heading-numbering/image-path-codec.ts` | `classifyImagePath`、`safeDecodePathOnce`，避免重复实现 |
| DOM 图片资源解析（`data-src` 优先，local/http/blob/data） | `src/document-utilities/content-block-toolbar-image-resource.ts` | 图片复制、导入时定位真实源 |
| 图片复制（Electron nativeImage / canvas 回退） | `src/infrastructure/content-block-clipboard.ts` | 复制图片、导出原图 |
| 文件复制：符号链接拒绝、冲突 `rename/skip/overwrite`、复制后大小校验 | `src/file-transfer/file-copy-service.ts` | 图库导入、下载落盘、迁移 |
| 唯一文件名生成 | `src/file-transfer/file-transfer-policy.ts` | 图片命名与并发冲突 |
| 题注与图片 alt 绑定、题注 sidecar 持久化 | `src/heading-numbering/caption-service.ts`、`figure-alt-binding.ts`、`caption-store.ts` | 图片编号与物理文件解耦 |
| 覆盖层 / 抽屉宿主与定位 | `src/document-utilities/document-utility-overlay-host.ts` | 图库面板与预览宿主 |
| 设置页与设置迁移 | `src/settings/*`、`main.ts` | 图片配置入口 |
| 运行时审计日志 | `src/runtime/forensic-log-sink.ts` | 上传/下载/同步取证 |

### 3.2 尚不存在（必须新建）

- 图片资产模型、SHA-256 去重、资产索引持久化。
- 本地图库根目录、文档资源目录策略、图库迁移。
- 上传 / 下载 / 同步服务与任务队列（并发、重试、超时、持久化、恢复）。
- PicGo 适配层、GitHub 远程索引、凭据管理。
- 图片管理面板（当前文档 / 本地图库 / GitHub 图库 / 任务中心）。
- 图片右键菜单（现有 `caption-context-menu.ts` 只处理题注命名，不处理上传/下载）。
- 远程 URL 安全检查、下载原子入库、删除回收站。

### 3.3 图片编号现状

题注系统已实现「图」类题注的自动编号与 alt 绑定。图片文件名、alt、题注、墨章编号目前**没有**统一资产层；P1 必须保持四者独立，编号变化不得触发物理文件重命名。

## 4. Typora 图片能力审计（P0.2）

环境：Typora **1.6.7**（`D:\Typora\Typora.exe`），墨章 `minAppVersion` 1.6.0。

### 4.1 静态可确认

| 检查项 | 结果 | 证据 |
|---|---|---|
| Typora 用户配置 | `%APPDATA%\Typora\conf\conf.user.json` 存在，**不含**图片上传相关字段 | 文件内容 |
| Typora 默认图片缓存目录 | `%APPDATA%\Typora\typora-user-images` 存在，267 个历史图片 | 目录枚举 |
| 社区插件运行目录 | `%USERPROFILE%\.typora\community-plugins` 存在框架 2.9.13 | 目录枚举 |
| Typora 类型声明中的图片接口 | `File.imgEdit.getImageUploaderCommand()`、`getRealSrc()`、`resolveImagePath()`、`File.option.imageUploader`、`Editor.imgEdit` | `@types/typora` 类型定义 |
| Typora 粘贴与撤销接口 | `Editor.UserOp.pasteHandler`、`Editor.undo.UndoManager`、`Editor.reset`、`File.reloadContent` | `@types/typora` 类型定义 |
| 自定义上传命令 | `File.option.imageUploader = custom`；`File.imgEdit` 在 1.6.7 不存在，命令文本仍无法通过接口读取（见 4.3） | 运行时探针 |

### 4.2 类型声明可用的编辑接口（结论：不足以安全做单点引用替换）

- `Editor.reset(markdown)` 与 `File.reloadContent(markdown, ...)` 都是**整篇重载**，不是范围替换，是否进入原生撤销栈未知。
- `Editor.selection` 提供 Rangy 选区与 `getTextAround`，但没有「按 Markdown 源偏移替换」的公开方法。
- `Editor.undo.UndoManager.commandStack` 结构未文档化，不能据类型猜测语义。
- `Editor.UserOp.pasteHandler(editor, content, isMarkdown?)` 可能可用于受控插入，但必须运行时验证。

因此：**不得在 P1 直接做自动引用替换**。第一版上传只新增/记录资产与远程位置；Markdown 引用替换必须等运行时验证通过后单独开放，并优先使用「选中图片后走原生替换 / 用户确认重载」的安全路径。

### 4.3 真实运行时验证（2026-11-03，Typora 1.6.7）

在 `test/vault` 开发挂载中，用只观察、不拦截的临时探针（捕获阶段监听 `paste` / `drop` + `markdownEditor 'edit'`）实测：

| 项目 | 结果 |
|---|---|
| `File.imgEdit` | **不存在（undefined）**；类型声明中的 `getImageUploaderCommand()` 在本版本不可调用 |
| `File.option.imageUploader` | `custom`（Typora 当前使用「自定义命令」上传方式） |
| `File` 上与图片相关的键 | `setDefaultImageStorage`、`pasteAsPlainText`、`refreshImageCopyStatus` |
| 截图粘贴 | DOM `paste` 事件 `isTrusted=true`、`defaultPrevented=false`；`clipboardData.files` 含 1 个 `image.png`（16,594 B） |
| 截图粘贴后的 Markdown | `![image-20261103210839457](C:\Users\<user>\AppData\Roaming\Typora\typora-user-images\image-20261103210839457.png)`（绝对路径 + 时间戳文件名） |
| 截图粘贴后的 DOM | `.md-image[data-src="C:\...\image-...png"]`，`img[src="file:///C:/.../image-...png?lastModify=..."]` |
| 复制文件后粘贴 | `clipboardData.files` 为原文件 `02-3-3-3.png`（14,970 B）；Typora 将其复制到 `typora-user-images` 并保留原文件名，Markdown 仍写绝对路径 |
| 观测点 `markdownEditor 'edit'` | 粘贴后约 0.5 s 触发一次，`editor.getMarkdown()` 已包含新引用，可据此做「新增图片」登记 |
| 撤销粘贴 | Markdown 正确回退，但**未触发** `markdownEditor 'edit'`（不能只靠 edit 事件感知引用移除） |
| 同名覆盖风险 | Typora 粘贴到 `typora-user-images` 时按原文件名写入；同名文件会被覆盖（本次内容相同，未造成数据损失） |

由此确定的观测方案：**不拦截原生粘贴 / 拖拽**；在 `markdownEditor 'edit'` 后对 `editor.getMarkdown()` 做图片引用差量，登记新增资产；引用移除（含撤销）另行处理，不依据单次 edit 事件。

### 4.4 仍未验证

1. 从资源管理器真实拖入图片（需要人工跨窗口拖拽；当前自动化环境无法可靠完成）。
2. 浏览器直接复制图片（与截图粘贴同属 `clipboardData.files`，但仍需真实浏览器验证）。
3. 「复制图片到资源目录」的原生设置与目标目录（当前设置为 `typora-user-images`）。
4. `Editor.reset` / `File.reloadContent` 是否清空撤销栈、是否触发未保存提示。
5. 上传期间切换文档、删除图片、撤销插入时原生行为。
6. Typora 原生图片右键菜单的实际项与可扩展点。

### 4.5 已有扫描器的缺陷（已修复）

实测粘贴产生的 Windows 绝对路径被 `document-resource-scanner` 误判为 `remote`（`C:` 被当作 URL scheme）。已在 `classifyResourceClass` / `isLocalResourceDestination` 中优先识别盘符绝对路径，并新增 6 个单测覆盖。

## 5. PicGo 环境审计（P0.3 / P0.4）

### 5.1 环境事实

| 项目 | 结果 |
|---|---|
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| pnpm | 11.15.0 |
| PicGo GUI | 未安装 |
| PicGo-Core（审计前） | 未安装 |
| `~/.picgo/config.json`（审计前） | 4 字节空配置 `{ }`（2024-05 创建） |
| 自定义上传脚本 | 项目内与 `~/.picgo` 内均未发现 |
| GitHub CLI | 已安装 `gh`，但**未登录**（无 `GH_TOKEN` / `GITHUB_TOKEN`） |

### 5.2 安装与运行验证

在隔离目录 `%TEMP%\inkchapter-picgo-audit` 安装 `picgo@3.2.0` 并执行：

```text
node <temp>/node_modules/picgo/bin/picgo -v  →  3.2.0
```

随后按文档要求全局安装：

```text
npm install -g picgo  →  E:\NodeJS\picgo.ps1，版本 3.2.0
```

验证结论：

1. PicGo-Core 在本机 Node 24 下可安装、可启动、CLI 可用。
2. 内置上传器包含 `github`，无需额外插件即可配置 GitHub 图床。
3. 编程 API 可用：`new PicGo(configPath)`、`setConfig()`、`upload(input)`。

### 5.3 真实上传验证（已完成）

凭据来源：Windows 凭据管理器中的 `git:https://github.com`（用户名 `example-owner`，Token scopes：`gist, repo, workflow`）。Token 通过进程环境变量传入 PicGo 编程 API，未打印、未写入仓库、未落盘。

测试文件：`%APPDATA%\Typora\typora-user-images\02-3-3-3.png`（14,970 B）的临时副本。

上传目标：`example-owner/example-image-bed` 的 `main` 分支，目录 `inkchapter-audit`。

验证结果：

| 检查 | 结果 |
|---|---|
| PicGo 编程 API 上传 | 成功，返回 1 条结果 |
| 远程文件存在 | 是：`inkchapter-audit/2026-11-03inkchapter-verify-20261103-201747.png` |
| 远程字节数 | 14,970 B，与本地一致 |
| Git blob SHA | `f42c324bb0961ae6ade44f7bcfde50f22c00dcf6` |
| Raw URL | HTTP 200，`image/png`，`Content-Length: 14970` |
| 重复内容再次上传 | 生成新路径，但 blob SHA 相同（GitHub 按内容去重存储） |
| Token 写权限 | API `permissions.push = true` |

空 Token 对照组：HTTP 401 `Bad credentials`；编程 API 不抛异常，返回长度 1 的数组，`url` / `imgUrl` 均为 `undefined`。

验证结束后已按用户确认删除两个测试文件（远程提交 `9970eac` 与 `d4b1985`），`inkchapter-audit/` 目录已不存在。未触碰仓库内任何既有图片。

### 5.4 PicGo 行为约束（实测）

1. **成功与失败的返回值形状相同**：失败时也不抛异常。适配器必须校验返回项中存在可解析的 URL，不能把「未抛异常」当作成功。
2. **成功时 `url` 可能为 `undefined`，真实地址在 `imgUrl`**。适配器必须 `url ?? imgUrl` 并按优先级校验。
3. **`github.path` 末尾缺少 `/` 会与文件名粘连**：配置 `path = inkchapter-audit/2026-11-03` 时实际生成 `inkchapter-audit/2026-11-03inkchapter-verify-....png`。适配器必须规范化远程目录并在拼接时补 `/`。
4. **GitHub Blob SHA ≠ 本地 SHA-256**：远端返回的是 Git blob SHA，不能与本地内容哈希直接比较；只能比较字节数与 URL 可用性。
5. 上传失败必须保留本地文件，且不得改写 Markdown 引用。

### 5.5 重要环境副作用（已复现并修复）

**PicGo-CLI 每次启动都会初始化并改写默认 `~/.picgo/config.json`**：

- 首次 CLI 调用后，原 4 字节空配置被改写为 103 字节的 `picgo-cloud` 默认配置，并生成 `package.json` 与空 `i18n-cli/` 目录。
- 传入 `-c <临时配置>` **不能**阻止该改写（CLI 在解析参数前已按默认路径初始化）。
- 对照实验：使用编程 API 并显式传入插件私有 `configPath`，默认 `~/.picgo/config.json` **保持不变**。

已恢复用户原文件（4 字节 `{ \n \n }`）并删除 CLI 生成的 `package.json` 与 `i18n-cli/`。

架构约束：墨章只允许使用 **PicGo 编程 API + 插件私有配置路径**；禁止调用未隔离的 PicGo CLI，禁止让 PicGo 触碰用户默认配置。

## 6. GitHub 图床审计（P0.5）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 仓库存在 | 是 | `https://api.github.com/repos/example-owner/example-image-bed` |
| 可见性 | Public | API `private: false` |
| 默认分支 | `main` | API `default_branch` 与 `git ls-remote --symref` |
| 仓库大小 | 约 155 MB | API `size` |
| 最近推送 | 2026-10-09 | API `pushed_at` |
| 目录结构 | 按主题分目录（如 `Big_Data_Technology/intern-it-job-analysis/02/...`），历史图片以语义化文件名存放 | Git Trees API |
| Raw URL 可用性 | HTTP 200，`image/png` | `raw.githubusercontent.com/.../fig_3_3_acquisition_flow.png` |
| Token / 上传权限 | 已验证：`permissions.push = true`，真实上传成功 | 见 5.3 |
| 旧上传脚本规则 | 未发现脚本；仅能从历史路径推断「按主题目录 + 语义文件名」 | 项目与 `~/.picgo` 扫描 |

约束：不得移动、重命名或删除既有远程图片；默认分支必须从仓库读取而非假设。

## 7. 技术方案建议

### 7.1 模块落点

新增 `src/image-management/`，按职责拆分而非照抄 14 个服务名：

```text
src/image-management/
├── domain/         资产模型、命名、状态机（纯函数）
├── storage/        资产索引、任务队列持久化、配置（Node fs）
├── services/       导入、本地存储、上传、下载、引用、同步
├── adapters/       PicGo 编程 API 适配、GitHub REST 适配
├── ui/             图库面板、右键菜单、任务中心
└── index.ts        组装与生命周期
```

`main.ts` 只新增：配置字段迁移、服务实例化、命令注册、`onunload` 释放。Typora DOM 访问应集中到 `src/infrastructure/typora-adapter.ts`（当前为空），不得继续散落在业务模块。

### 7.2 关键决策

| 主题 | 决策 | 理由 |
|---|---|---|
| PicGo 调用方式 | 编程 API + 插件私有 configPath；CLI 子进程不采用 | 5.4 已实测 CLI 会改写用户配置 |
| 资产索引存储 | 第一版用**原子写入的 JSON 索引**；SQLite 仅在验证原生模块兼容后引入 | 避免 Electron ABI 不匹配；先用无原生依赖方案保证可用 |
| 图片导入 | 先让 Typora 原生流程完成插入，再事后扫描新增引用并登记资产 | 规范禁止未经验证拦截 `paste` / `drop` |
| 引用替换 | P1/P2 不自动替换；仅「上传 + 记录」，替换需运行时验证后单独开关 | 无安全范围替换 API |
| 存储模式 | 默认 Dual Storage；存储策略与引用策略解耦 | 避免上传即改 Markdown |
| 凭据 | 不落库、不进 Markdown、不进日志；优先操作系统凭据机制，退化为插件私有目录的受限文件 | 规范 8.5 |
| 去重 | SHA-256 内容去重；pHash 仅提示 | 规范 10.2 |
| 并发 | 上传 2 / 下载 3 / 重试 3，全部可配置 | 规范 11.4 |

### 7.3 分阶段落地建议

1. **P1-a 配置与资产模型**：设置字段 + 迁移 + 首次初始化向导（仅本地图库）+ 资产索引（JSON + 原子写 + SHA-256）。
2. **P1-b 导入与本地图库**：原生插入后扫描登记、命名、冲突策略、按文档引用统计。
3. **P2 上传**：PicGo 编程 API 适配、任务队列持久化、URL 校验。
4. **P3 面板**：复用覆盖层宿主，四标签 + 懒加载。
5. **P4 同步**：GitHub 远程索引、状态机、冲突处理。
6. **P5 验收**：按规范 17 的场景矩阵执行；无凭据与无运行时验证的场景必须标注为阻塞。

## 8. 风险与阻塞

| 风险 | 等级 | 说明 / 缓解 |
|---|---|---|
| 插件凭据存取（历史缺口，已关闭） | 高 | 本次验证借用了系统已存的 git 凭据；P11 已实现 `credentialReferenceId` 对应的 Windows DPAPI 安全存取，Token 不进入设置或日志 |
| Typora 编辑 API 未验证 | 高 | 引用替换可能破坏撤销与文档；P2 默认不替换引用 |
| PicGo-CLI 改写用户配置 | 高 | 已实测；仅用编程 API + 私有配置路径 |
| PicGo 上传结果判定 | 高 | 失败不抛异常且 `url` 可能为空；必须校验 `imgUrl` 并验证远程文件 |
| `github.path` 拼接 | 中 | 末尾无 `/` 会与文件名粘连；适配器必须规范化 |
| 无 SQLite 原生模块验证 | 中 | 第一版用 JSON 索引规避 |
| 大图库性能 | 中 | 面板分页/虚拟列表；哈希与 IO 移出主线程 |
| `typora-adapter.ts` 为空 | 中 | 新模块必须把 Typora 访问收敛到 infrastructure |
| 现有文档校验既有断链 | 低 | 历史启动审计文档曾有 1 处断链，合并前已存在；该一次性文档已清理，与本阶段无关 |

## 9. 验证证据分级

| 级别 | 本项目状态 |
|---|---|
| 静态代码检查通过 | 是：`pnpm run typecheck` 0 错误；`pnpm run verify:archive` PASS |
| 自动化测试通过 | 是：`pnpm run test` 280 文件 / 5305 用例通过（含 P1-a 新增 33 例） |
| 真实 PicGo 上传验证 | 是：文件已在 `example-image-bed` 落地，字节数一致，Raw URL 200（见 5.3） |
| 真实 Typora 运行时验证 | **否**：图片原生行为与上传命令均未验证 |
| 尚未验证或阻塞 | 见 4.3 |

## 10. 下一阶段准入条件

1. ~~用户提供 GitHub Token~~ 已完成（使用系统已存凭据完成真实验证）；插件自身的 Windows DPAPI 凭据存取已在 P11 实现。
2. 真实 Typora 运行时完成 4.3 的 6 项探测，并记录证据。
3. 图片配置字段与迁移设计评审通过（P1-a 已交付模型与校验）。
4. 明确第一版不自动重写已有图片引用。
