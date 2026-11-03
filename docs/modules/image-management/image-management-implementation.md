# 图片管理实现记录 — P1-a（配置模型与本地资产索引）

## 1. 阶段目标与范围

本阶段只实现图片管理的最小、可测试地基，不接入 Typora 原生流程、不发起网络请求、不修改任何 Markdown：

1. 用户级图片配置模型：默认值、读取侧补齐、路径与远程仓库校验。
2. 本地资产索引：SHA-256 内容寻址、去重、远程位置记录、原子持久化、损坏保护。

P1-b 及之后才实现初始化向导 UI、目录选择、导入登记、上传、下载、面板与同步。

## 2. 修改文件

| 文件 | 变更 |
|---|---|
| `src/image-management/image-settings.ts` | 新增：配置类型、默认值、路径 / 远程仓库校验、`resolveImageSettings` |
| `src/image-management/image-asset-index.ts` | 新增：`sha256File`、`ImageAssetIndex`、`guessMimeType` |
| `src/image-management/image-settings.test.ts` | 新增：19 个用例 |
| `src/image-management/image-asset-index.test.ts` | 新增：14 个用例 |
| `src/settings/settings-model.ts` | 新增可选字段 `image?: ImageSettings` |
| `src/settings/default-settings.ts` | 默认设置加入 `image: DEFAULT_IMAGE_SETTINGS` |

`main.ts` 本阶段未改动：配置读取侧由 `resolveImageSettings` 兜底，缺失字段不会导致插件失败。

## 3. 架构决策

| 决策 | 内容 | 理由 |
|---|---|---|
| 不硬编码个人配置 | 默认图库路径为空串，远程仓库列表为空 | 其他用户可独立配置；当前用户的 `E:\TyporaImageLibrary` 与 GitHub 仓库只作为向导输入，不进入默认值 |
| 凭据只存引用 | `credentialReferenceId` 保存键名，不保存 Token | 避免 Token 进入设置、日志、Markdown |
| 默认分支不预设 | `branch` 允许为空，表示「后续从仓库真实信息读取」 | 不假定所有仓库使用 `main` |
| 索引存储 | 第一版 JSON + 原子写入（临时文件 + rename） | SQLite 原生模块与 Electron ABI 兼容性尚未验证；先保证可用与可回滚 |
| 身份判定 | SHA-256 内容寻址，文件名不参与身份 | 同名不同内容、同内容不同名都能正确处理 |
| 损坏保护 | 索引解析失败抛 `INDEX_CORRUPT`，不回写、不自动修复 | 用户数据优先于「自动恢复」 |
| 并发 | 所有写操作进入串行队列 | 并发导入不会互相覆盖 |
| 校验失败即丢弃 | 非法远程配置在读取时被剔除 | 避免带着错误仓库配置继续上传 |

## 4. 已实现能力

### 4.1 配置

- 存储模式：`local-first` / `remote-first` / `dual-storage`（默认 `dual-storage`）。
- 引用模式：`local-relative` / `remote-url`（默认 `local-relative`，与存储模式解耦）。
- 命名策略、压缩策略、是否转换 WebP、是否自动上传。
- 文档级资源目录：仅允许相对目录，拒绝绝对路径与 `..`。
- 本地图库路径：仅允许盘符绝对路径或 UNC，拒绝相对路径、`..`、控制字符；允许中文与空格。
- 远程配置：`remoteProfileId`、Provider、Owner、Repository、Branch、RemoteDirectory、URL 策略、自定义 URL 基址、凭据引用、启用开关；同一 `remoteProfileId` 去重。
- 任务限制：上传 / 下载并发、重试次数、单文件下载上限，全部有界。

### 4.2 资产索引

- `sha256File`：流式哈希，不把整图读入内存，返回真实字节数。
- 相同内容只产生一个逻辑资产；`assetId` 由哈希前缀生成并做碰撞扩展。
- 记录 `filename`、`mimeType`（扩展名推断）、`sizeBytes`、时间戳、规范本地路径。
- `recordRemoteLocation`：按 `remoteProfileId + remotePath` 去重更新，支持多远程位置。
- 原子持久化；成功后无残留临时文件；索引损坏时不覆盖原文件。

## 5. 尚未实现（不在本阶段）

1. 首次初始化向导 UI 与系统目录选择。
2. 图库目录创建前检查（磁盘、权限、空间、既有文件）。
3. 图库切换与迁移。
4. 原生插入后的图片登记（P1-b）。
5. `width` / `height` 探测、缩略图、感知哈希。
6. 上传（PicGo）、下载、任务队列、GitHub 远程索引、同步。
7. 图片管理面板与右键菜单。
8. 凭据的实际存取实现（Windows 凭据管理器 / 受限文件）。
9. `main.ts` 中的服务装配与 `onunload` 释放接线。

## 6. 已知问题与风险

| 问题 | 说明 |
|---|---|
| 配置暂时无法在界面编辑 | 仅模型与校验可用；向导在 P1-b |
| 索引尚未接入插件运行时 | 需要 P1-b 决定 `plugin.dataPath` 下的具体索引位置 |
| JSON 索引在超大图库下的查询性能未知 | 需在 P5 用真实图库量级测试；必要时再评估 SQLite |
| 哈希在调用线程执行 | 当前 API 为异步 IO，但 CPU 计算仍在主线程；批量导入时应放入 Worker |
| MIME 仅按扩展名推断 | 压缩 / 转换前仍需真实内容探测（P2） |

## 7. 验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | 0 错误 |
| 新增单测 | `npx vitest run src/image-management` | 2 文件 / 33 用例通过 |
| 全量单测 | `pnpm run test` | 280 文件 / 5305 用例通过（基线 5272，+33） |
| 生产构建 | `pnpm run build` | 成功：`dist/main.js` 2,438,337 B，`dist/style.css` 109,580 B |
| 真实 Typora 运行时 | — | **未验证**（本阶段无 UI、无 Typora 交互） |

## 8. 下一阶段准入条件

1. 用户确认 P0 审计结论，并明确 GitHub Token 的提供方式（或接受上传验证延后）。
2. 真实 Typora 运行时完成 P0 审计 4.3 的 6 项探测，确认可用的粘贴 / 拖拽观测点。
3. P1-b 先做初始化向导与目录校验，不触碰 Markdown 引用。
