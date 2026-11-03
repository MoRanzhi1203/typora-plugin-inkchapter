# 图片管理实现记录 — P1-a / P1-b

## 1. 阶段目标与范围

本阶段只建立「可配置、可校验、可初始化」的地基，不接入 Typora 原生粘贴流程、不改写任何 Markdown、不发起上传：

- **P1-a**：用户级图片配置模型 + 本地资产索引（SHA-256 内容寻址）。
- **P1-b**：图片管理设置页（首次初始化向导）、本地图库目录校验、原生目录选择、显式初始化。

上传、下载、图库面板、远程索引与同步在 P2–P4 实现。

## 2. 修改文件

| 文件 | 变更 |
|---|---|
| `src/image-management/image-settings.ts` | P1-a：配置类型、默认值、路径 / 远程仓库校验、读取侧补齐 |
| `src/image-management/image-asset-index.ts` | P1-a：`sha256File`、`ImageAssetIndex`、原子持久化 |
| `src/image-management/image-library-inspection.ts` | P1-b：目录检查（磁盘 / 存在性 / 可写 / 空间 / 占用 / 标记）与显式初始化 |
| `src/image-management/image-directory-picker.ts` | P1-b：Windows 原生目录选择（PowerShell FolderBrowserDialog） |
| `src/settings/image-management-setting-tab.ts` | P1-b：初始化向导与日常配置设置页 |
| `src/settings/settings-model.ts` / `default-settings.ts` | 新增可选字段 `image`，默认关闭且未初始化 |
| `src/main.ts` | 注册「墨章 · 图片」设置页；已启用未初始化时给一次性提示 |
| 同名 `*.test.ts` | P1-a/P1-b 单测 |

## 3. 架构决策

| 决策 | 内容 | 理由 |
|---|---|---|
| 不硬编码个人配置 | 默认图库路径为空串，远程仓库列表为空 | 其他用户可独立配置；当前用户的 `E:\TyporaImageLibrary` 与 GitHub 仓库只作为向导输入 |
| 检查与创建分离 | `inspectImageLibraryTarget` 只读（仅写权限探针并立即删除）；`initializeImageLibrary` 才创建目录与标记 | 避免「打开设置页就产生目录」 |
| 非空目录保护 | 无墨章标记且非空时，必须用户确认后才接管 | 不覆盖、不移动用户已有文件 |
| 图库标记 | `.inkchapter-image-library.json`（原子写入） | 用于识别「这是墨章图库」，支持重新接管 |
| 原生目录选择 | 独立 PowerShell 进程调用 `System.Windows.Forms.FolderBrowserDialog` | 框架与 Typora 类型声明均无已验证的目录选择 API；不猜测 Electron renderer 能力 |
| 凭据 | 设置中只保存 `credentialReferenceId` | Token 不进入设置、日志、Markdown |
| 索引存储 | JSON + 原子写入；SQLite 待原生模块兼容验证 | 先保证可用与可回滚 |
| 身份判定 | SHA-256 内容寻址 | 文件名不参与资产身份 |

## 4. 已实现能力

### 4.1 配置（P1-a）

- 存储模式（默认双存储）、Markdown 引用模式（默认文档相对路径）、自动上传、命名、压缩、WebP 转换。
- 本地图库路径：盘符绝对路径或 UNC；拒绝相对路径、`..`、控制字符；支持中文与空格。
- 文档资源目录：仅相对目录，拒绝绝对路径与 `..`。
- 远程仓库：`remoteProfileId`、Owner、Repository、Branch、RemoteDirectory、URL 策略、自定义基址、凭据引用、启用开关；非法配置在读取时剔除。
- 并发与重试限制有界（上传 2 / 下载 3 / 重试 3 / 单文件 50 MB）。

### 4.2 资产索引（P1-a）

- 流式 SHA-256、内容去重、规范本地路径、远程位置记录（按 profile + path 更新）。
- 原子写入、成功后无临时文件、损坏索引只报错不覆盖、并发写串行化。

### 4.3 初始化向导与目录校验（P1-b）

- 设置页「墨章 · 图片」：未初始化时显示初始化向导；初始化后显示完整配置。
- 目录操作：浏览（Windows 原生对话框）/ 校验 / 初始化图库。
- 校验项：路径合法性、磁盘存在、目标是否存在、是否目录、写权限探针、可用空间、目录条目数、是否已有墨章标记。
- 初始化：缺失目录按需创建；空目录直接写入标记；非空且无标记必须确认；已初始化目录幂等接管。
- 远程图床可选，可跳过；保存前执行 Owner / Repository / Branch / 目录校验，失败不写入。

## 5. 尚未实现

1. 原生插入后的图片登记与资产入库（需要 Typora 运行时观测点）。
2. 图片命名与冲突处理的导入服务。
3. 上传（PicGo 编程 API 适配）、下载、任务队列。
4. GitHub 远程索引、同步、冲突处理。
5. 图片管理面板与图片右键菜单。
6. 图库切换 / 迁移流程。
7. 宽 / 高探测、缩略图、感知哈希。
8. 凭据的实际安全存取（当前仅保存引用 ID）。
9. 资产索引接入插件运行时（`plugin.dataPath` 位置与生命周期）。

## 6. 已知问题与风险

| 问题 | 说明 |
|---|---|
| 设置页没有自动化 UI 测试 | 逻辑与文件操作有单测；DOM 渲染依赖真实 Typora 手动验收 |
| 原生目录选择依赖 PowerShell | 仅 Windows；`powershell.exe` 不可用或策略受限时返回 null，需退回手动输入 |
| 真实 Typora 运行时的其余场景 | 设置页、目录对话框、校验、初始化、持久化已验收；自动上传 / 远程配置尚未做运行时验收（依赖 P2 服务） |
| Typora 自带 Node 无 `fs.statfs` | 已实测并在 P1-b 修复：回退到 PowerShell `Get-PSDrive` 查询剩余空间（失败时显示「未知」，不阻断校验） |
| 大图库索引性能未知 | 仍为全量 JSON；P5 需按真实量级测试 |
| 哈希在主线程 | 批量导入时应移入 Worker |
| 远程配置未验证仓库 | P2 才做连接测试（仓库存在性 / 分支 / 上传权限） |

## 7. 验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | 0 错误 |
| 新增单测 | `npx vitest run src/image-management` | 3 文件 / 48 用例通过 |
| 全量单测 | `pnpm run test` | 281 文件 / 5320 用例通过（基线 5272，+48） |
| 生产构建 | `pnpm run build` | 成功：`dist/main.js` 2,457,998 B，`dist/style.css` 109,580 B |
| 真实 Typora 运行时 | 见 7.1 | 向导 UI、原生目录对话框、校验、初始化、持久化均通过 |

### 7.1 真实 Typora 运行时证据（2026-11-03，Typora 1.6.7）

测试环境：`test/vault` 开发挂载，插件从 `test/vault/.typora/plugins/dist` 加载（`loadSource=vault`）。

| 场景 | 操作 | 结果 |
|---|---|---|
| 设置页注册 | `Ctrl+.` → 框架设置 → 「墨章 · 图片」 | 设置页正常出现，标题为「图片管理 · 初始化向导」 |
| 初始状态 | 打开页面 | 显示「启用图片管理」「图库目录」「浏览… / 校验 / 初始化图库」「尚未初始化本地图库」 |
| 原生目录对话框 | 点击「浏览…」 | 弹出 Windows「浏览文件夹」对话框，描述为「选择墨章图片图库目录」，可正常取消 |
| 目录校验（空目录） | 输入临时目录 → 「校验」 | 显示「目录可用：... 现有条目 0 · 可写 · 可用空间 31.8 GB」 |
| 初始化图库 | 点击「初始化图库」 | 提示「图库已初始化：...」，页面切换为已初始化状态并显示「已初始化」标记 |
| 磁盘标记 | 检查目录 | 生成 `.inkchapter-image-library.json`（schemaVersion 1） |
| 设置持久化 | 检查 `test/vault/.typora/data/ranzhi.inkchapter.json` | `settings.image` 为 `enabled=true`、`initialized=true`、路径与各项默认值正确 |
| 重新校验 | 已初始化目录再次「校验」 | 识别为「已存在墨章图库（可直接接管）」，条目与可用空间正确 |

验收后已删除临时图库目录，并把测试 vault 的 `settings.image` 重置为未初始化默认值（仅本地运行时数据，未提交）。

## 8. 下一阶段准入条件

1. ~~真实 Typora 运行时完成设置页与目录选择验收~~ 已完成（见 7.1）。
2. 完成 P0 审计 4.3 的原生粘贴 / 拖拽观测点探测。
3. 明确导入登记的触发方式（事后扫描而非拦截原生事件）。
4. P2 上传适配器必须遵守已实测的 PicGo 行为约束（校验 `imgUrl`、远程目录补 `/`、失败不抛异常）。
