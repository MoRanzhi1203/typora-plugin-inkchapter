# 图片管理 P3 — 路径规范、配额与安全迁移

> 日期：2026-11-03。前置：P2 统一资产模型已完成。
> 本阶段只建立路径配置、校验、缓存配额与迁移事务；不创建任何用户目录、不删除任何文件、不发起上传。

## 1. 阶段结论

| 目标 | 结果 |
|---|---|
| 图库 / 缓存 / 离线 / 暂存 / 数据库五类独立路径 | 完成 |
| 公开默认不含个人绝对路径，运行时解析系统目录 | 完成 |
| 路径校验、符号链接 / junction 识别、冲突检测 | 完成 |
| 缓存 512 MB 默认、可选 256/1024、LRU、固定离线排除 | 完成 |
| 迁移预览（文件数/容量/空间）、复制校验、回滚日志 | 完成 |
| 迁移后更新资产库，数据库先备份 | 完成 |

## 2. 配置模型

`ImageSettings` 新增五组配置，默认值全部为空字符串（运行时解析），不写入任何个人路径：

| 配置 | 默认 | 说明 |
|---|---|---|
| `globalLibrary.mode` | `off` | `off / index / archive`；`archive` 必须有目录，缺失时回落 `off` |
| `globalLibrary.root` | `''` | 仅归档模式需要物理目录 |
| `cache.mode` | `smart` | `off / smart / manual` |
| `cache.root` | `''` | 空 = `%LOCALAPPDATA%\InkChapter\ImageCache` |
| `cache.maxSizeMB` | `512` | 可选 256 / 512 / 1024；范围 64–102400 |
| `offline.root` | `''` | 空 = `%LOCALAPPDATA%\InkChapter\OfflineAssets` |
| `uploadStaging.root` | `''` | 空 = `%TEMP%\InkChapter\ImageUpload` |
| `database.root` | `''` | 空 = 插件私有数据目录 |

旧版 `localLibraryPath` 会被读取并迁移为 `globalLibrary = { mode: 'archive', root }`；一旦存在新配置，旧字段不再覆盖新值。设置页已改用新结构，并新增图库模式选择。

## 3. 路径解析（运行时）

| 数据类别 | 默认逻辑路径 | 创建时机 | 自动清理 |
|---|---|---|---|
| 项目图片 | Typora 原生六种规则 | Typora 插入时 | 墨章不清理 |
| 全局图库归档 | `<libraryRoot>/images/` | 显式归档 | 不自动清理 |
| 普通缓存 | `%LOCALAPPDATA%\InkChapter\ImageCache\objects/` | 首次按需缓存 | LRU 有界 |
| 缩略图 | `.../ImageCache/thumbnails/` | 需要缩略图时 | 可清理 |
| 固定离线资源 | `%LOCALAPPDATA%\InkChapter\OfflineAssets\objects/` | 用户固定 | 禁止普通清理 |
| 离线清单 | `.../OfflineAssets/manifests/` | 准备离线时 | 解除固定并确认后 |
| 上传暂存 | `%TEMP%\InkChapter\ImageUpload/` | 上传需要时 | 完成且恢复安全后 |
| 资产数据库 | `<Plugin.dataPath>/image/` | 启用索引 | 持久保留 |
| 数据库备份 / 迁移日志 | `<Plugin.dataPath>/image/backup/` | 迁移前 | 不自动清理 |

解析函数只计算路径，**不创建目录**；每一类同时返回 `sources`（`default / override / disabled`），设置页可以展示最终有效来源。

## 4. 校验与冲突

- 目录检查复用既有图库检查：磁盘存在、是否目录、写权限探针、可用空间、条目数。
- 额外识别符号链接 / junction：`lstat` + `realpath` 与声明路径不一致时给出 `REDIRECTED_PATH` 警告。
- 五个路径角色两两检查：相同或互相嵌套均视为冲突，避免缓存清理误删图库、迁移搬走数据库。
- 目录占用统计不跟随链接，默认 20000 条目 / 深度 32 上限，超出标记 `truncated`。

## 5. 缓存配额

- 只有可清理的普通缓存对象与缩略图参与统计。
- 固定离线、图库、项目图片、数据库、上传暂存不进入配额。
- LRU 顺序按最后访问时间升序；时间相同时按 locator 稳定排序。
- 配额为 0 / 非正数表示关闭缓存，计划清空全部可清理对象。

## 6. 迁移事务

流程：

1. `planPathMigration`：只读预览文件数、总容量、目标空间、路径冲突、符号链接风险。
2. `executePathMigration`：
   - 先写 `in-progress` 回滚日志；
   - 逐文件复制到临时文件 → SHA-256 校验 → rename；
   - 目标已有相同内容则 `skipped`；内容不同则 `TARGET_CONFLICT`，绝不覆盖；
   - 失败时只删除本次新建的副本，源文件保持不变；
   - 默认保留源文件；显式 `deleteSource` 才在全部校验通过后删除源副本。
3. `rollbackPathMigration`：把已复制且源缺失的文件复制回源并校验，再删除目标副本。
4. `ImageAssetService.applyPathMigration`：数据库备份 → 迁移 → 改写本地位置；迁移失败不改数据库；数据库更新失败保留迁移日志以便回滚。

变更语义：

| 角色 | 清空 / 改路径 |
|---|---|
| 缓存、暂存 | 可只影响未来任务 |
| 图库、离线、数据库 | 必须迁移或明确确认取消保障 |

## 7. 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 图片管理单测 | `npx vitest run src/image-management` | PASS：8 文件 / 116 用例 |
| 类型检查 | `pnpm run typecheck` | PASS |
| 生产构建 | `pnpm run build` | PASS |
| 全量单测 | `pnpm run test` | PASS：287 文件 / 5394 用例全部通过 |

重点用例：

- 五类默认路径、覆盖路径与 `sources` 正确；解析不创建目录。
- 缓存关闭时所有缓存目录为 `null`。
- 相同/嵌套路径被识别为冲突。
- 迁移复制后 SHA 校验一致；源默认保留；显式删除后可回滚恢复。
- 目标同名同内容跳过、异内容拒绝覆盖。
- 迁移成功后资产库位置改写为新的根，远程位置不变；数据库备份存在。

## 8. 未完成与风险

1. 设置页目前只暴露图库模式/目录；缓存、离线、暂存、数据库路径的编辑与迁移向导属于 P7。
2. 缓存清理只生成 LRU 计划，尚未接入真实缓存写入与定时/触发清理。
3. 迁移尚未做“大批量文件进度/取消”UI；当前只提供 `onProgress` 回调。
4. 数据库仍为单个 JSON 索引；迁移事务以文件复制 + 回滚日志实现，未引入 SQLite。
5. 未验证：跨磁盘移动、目标磁盘中途写满、迁移期间文件被 Typora 修改。

## 9. 下一阶段准入条件

1. P3 代码通过全量测试与构建。
2. 进入 P4：双链/远程引用、智能缓存与离线资源，必须复用本阶段的路径与配额策略。
3. 缓存清理不得触碰 `offline` 与 `library` 路径；迁移必须先预览、后执行。
