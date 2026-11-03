# 图片管理 P2 — 统一资产模型与资产库

> 日期：2026-11-03。前置：G0 / P0-LOCAL / P1 已完成（见 [g0-p0local-p1-implementation.md](./g0-p0local-p1-implementation.md)）。
> 本阶段不升级 Typora、不修改安装目录、不发起任何上传、不改写用户 Markdown。

## 1. 阶段目标与结论

建立与现有工程兼容的统一资产层，为 P3（路径体系）、P4（双链/缓存/离线）、P5（迁移）、P6（分享）提供唯一数据源。

| 目标 | 结果 |
|---|---|
| 一张图片一个稳定 `assetId`，SHA-256 内容去重 | 完成（沿用 `img_<sha256 前缀>`，确定性且稳定） |
| 多位置映射（项目/图库/缓存/离线/GitHub） | 完成 |
| 文档引用事实（行内 / 参考式 / HTML） | 完成 |
| 资产索引持久化 + schema 迁移 | 完成（v1 → v2 无损迁移） |
| 接入插件私有数据目录与生命周期 | 完成（延迟加载、损坏不阻断启动） |
| 项目可移植清单 | 解析与校验完成；写入留到 P5/P6 |

## 2. 修改文件

| 文件 | 变更 |
|---|---|
| `src/image-management/image-asset-model.ts` | 新增：位置模型、存储状态、路径解析、引用扫描、任务/事务/离线固定实体、项目清单校验 |
| `src/image-management/image-asset-index.ts` | 扩展为 schema v2：统一 `locations`，`localPath`/`remoteLocations` 改为派生视图，支持 v1 迁移与位置可用性更新 |
| `src/image-management/image-data-paths.ts` | 新增：从 `Plugin.dataPath` 解析图片数据根与索引路径 |
| `src/image-management/image-asset-service.ts` | 新增：索引的延迟加载与释放封装 |
| `src/main.ts` | 启动时建立资产服务（不读盘），卸载时释放；失败不阻断插件 |
| `src/image-management/*.test.ts` | 新增/更新 31 个用例（图片管理合计 83；覆盖模型、迁移、多位置、路径与引用） |

## 3. 资产模型

| 实体 | 说明 |
|---|---|
| `ImageAssetRecord` | `assetId`、`sha256`、MIME、尺寸、原始文件名、`contentVersion`、创建/更新时间 |
| `AssetLocationRecord` | `type = project \| library \| cache \| offline \| github`、绑定 ID、`locator`、相对路径、内容哈希、`availability`、最后检查时间、远端版本 |
| `MarkdownImageReference` | 语法类型、alt、原始目标、源偏移、解析结果、`assetId`、校验状态 |
| `TransferTask` | 上传/下载/复制/校验任务；失败与重试独立于资产可用状态 |
| `ImageOperation` | 可回滚的批处理事务（导入/迁移/缓存晋升/离线固定/引用改写） |
| `OfflinePin` | 固定离线资源，明确不参与普通缓存清理 |

关键规则：

- `sha256` 只用于**完全相同内容**去重；同名、alt 或相似图片不会自动合并。
- `cache` 不计入永久本地副本，因此「缓存 + GitHub」是 `REMOTE_ONLY`，不冒充双存储。
- 本地副本复用顺序：图库 → 项目 → 离线固定 → 普通缓存。
- Windows 本地路径比较统一大小写与分隔符；GitHub 路径保留大小写。

## 4. 持久化

| 项目 | 值 |
|---|---|
| 位置 | `<Plugin.dataPath>/image/image-assets.json`（仓库之外） |
| 格式 | JSON，原子写（临时文件 + rename），写操作串行化 |
| 备份目录 | `<Plugin.dataPath>/image/backup/`（为 P3 迁移事务预留） |
| schema | v2；读取同时接受 v1 并迁移 |
| 损坏策略 | 只报错、不覆盖、不静默重建 |

未采用 SQLite：当前 Electron 运行时未验证原生模块 ABI，升级/编译风险高于收益。`image-data-paths.ts` 保持存储实现可替换的 seam。

## 5. 路径解析与引用扫描

### 5.1 路径

- 标准 `%XX` 与 Typora 历史 `%uXXXX` 均只解码一层，失败时保留原文，避免二次解码。
- 中文、空格、`%23`（`#`）按文件系统语义处理。
- 区分：远程 URL / 本地相对 / 本地绝对 / `file://` / `data:` / 不支持。
- 相对路径按**当前文档所在目录**解析，不假定工作区根目录。
- 提供 `isPathInside` 供后续下载、迁移做路径穿越防护。

### 5.2 引用

| 语法 | 支持 |
|---|---|
| 行内 `![alt](dest)` | 复用既有资源扫描器（含字面量排除） |
| 参考式 `![alt][label]` + `[label]: dest` | 支持 |
| HTML `<img src="...">` | 支持，实体先解码、偏移仍对应原文 |

代码块与行内代码中的示例不会被识别，也不会被后续改写。

## 6. 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 目标单测 | `npx vitest run src/image-management` | PASS：5 文件 / 83 用例 |
| 类型检查 | `pnpm run typecheck` | PASS |
| 生产构建 | `pnpm run build` | PASS |
| 全量单测 | `pnpm run test` | PASS：284 文件 / 5361 用例全部通过 |

重点用例：

- v1 索引读取后正确迁移，保存为 v2 且不再写 `localPath` 字段。
- 同内容第二次导入新增位置而非新增资产；`localPath` 仍指向首个规范副本。
- `cache + github` 判定为 `REMOTE_ONLY`；缺失本地副本不计入双存储。
- 代码块中的 `![x](...)`、`<img>`、参考式定义全部被忽略。
- 绝对路径、`..` 穿越、非法 SHA、非 HTTP locator 的项目清单被拒绝。

## 7. 未完成与风险

1. P3 才会落地图库/缓存/离线/暂存的独立路径配置与迁移事务。
2. 项目清单目前只有解析与校验，写入与导入在 P5/P6。
3. 引用尚未与实际资产关联（`assetId = null`），待导入/上传服务接入。
4. 资产服务的真实 Typora 运行时读写尚未做界面级验收；当前只有单元测试与启动构建验证。
5. `assetId` 为内容派生 ID（`img_<sha256>`），不是随机 UUID；满足「稳定、唯一、不随文件名变化」，但与计划中的措辞不同，已在此记录。

## 8. 下一阶段准入条件

1. P2 代码通过全量测试与构建。
2. 进入 P3：路径规范（配置、创建、迁移、清理），并复用 `image-data-paths.ts` 作为唯一 seam。
3. 任何缓存/离线实现必须先区分「普通缓存」与「固定离线资源」，禁止共用清理策略。
