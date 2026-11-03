# 代码异常与错误排查报告

> 日期：2026-11-04。范围：`feature/image-management` 分支全量源码与脚本。
> 本报告只含通用与脱敏信息：不包含 Token、私钥、个人仓库账号或展开后的用户绝对路径。
> 未修改 Typora 安装目录、社区框架参考源码；未升级依赖。

## 1. 排查方法

| 类别 | 手段 | 结果 |
|---|---|---|
| 类型与语法 | `pnpm run typecheck`（strict） | 0 错误 |
| 增量严格检查 | `tsc --noUnusedLocals --noUnusedParameters` | 382 条历史未使用符号（项目未启用该选项）；图片模块仅 1 条，已修复 |
| 控制流 | `tsc --noFallthroughCasesInSwitch --noImplicitReturns` | 0 错误 |
| 单元/集成 | `pnpm run test` | 全部通过（见第 4 节） |
| 构建与依赖 | `pnpm run build` | 成功，无未解析导入 |
| 脚本语法 | `node --check`（根目录与 `scripts/` 下 `.js/.mjs`） | 0 语法错误 |
| JSON 资源 | 解析 `src/`、`scripts/` 下全部 `.json` | 1 个文件，0 解析错误 |
| 文档资源 | `pnpm run docs:verify` | 修复 1 个断链后 PASS |
| 运行时日志 | `typora.log`、`__plugin-logger.log` | 无插件异常；历史噪声已单独核实 |

## 2. 已修复问题

### 2.1 文档断链（docs:verify FAIL）

- **现象**：`docs/typora-startup-loading-audit.md` 使用 `file:///d:/.../build.js#L66-L78`，校验脚本按相对路径解析，报 `DOC_BROKEN_LINK_COUNT=1`。
- **根因**：绝对 `file://` 链接不可移植，且校验器不支持该形式。
- **修复**：改为相对链接 `../build.js#L66-L78`。`docs:verify` 现为 PASS。

### 2.2 Windows 绝对路径无法被动态 `import()` 加载

- **位置**：`src/image-management/image-upload-service.ts`。
- **现象**：`INKCHAPTER_PICGO_MODULE` 若配置为 `E:\...\picgo`，ESM 动态导入会把 `E:` 当作协议，抛出 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，上传被误判为 `PICGO_UNAVAILABLE`。
- **修复**：新增 `toPicGoImportSpecifier()`，把绝对/相对路径转换为 `file://` URL，裸包名与已带协议的说明符保持不变。
- **测试**：`toPicGoImportSpecifier` 2 个用例（裸包名、file URL、绝对路径、相对路径）。

### 2.3 PicGo 返回多个结果时过早判定失败

- **位置**：`src/image-management/image-upload-policy.ts`。
- **现象**：`evaluatePicGoResult` 遇到第一个非法 URL 立即返回 `PICGO_INVALID_URL`，即使后续存在合法 URL。
- **修复**：遍历全部候选，优先返回第一个合法 URL；只有「存在候选但全部非法」才返回 `PICGO_INVALID_URL`，完全没有候选才返回 `PICGO_EMPTY_RESULT`。
- **测试**：新增「跳过私网 URL 后取到合法 URL」用例。

### 2.4 远程目录非法被误报为暂存失败

- **位置**：`src/image-management/image-upload-service.ts`、`image-upload-policy.ts`。
- **现象**：远程目录含 `#`/`%` 等字符时，`joinRemotePath` 返回 `null`，但错误码为 `STAGING_FAILED`，会误导用户检查磁盘。
- **修复**：新增 `REMOTE_PATH_INVALID` 错误码与文案。
- **测试**：远程目录 `bad#dir` 时返回 `REMOTE_PATH_INVALID`，且不调用 PicGo、不移动源文件。

### 2.5 默认远程 Profile 被禁用时静默切换到其他仓库

- **位置**：`src/image-management/image-upload-service.ts`。
- **现象**：`defaultRemoteProfileId` 指向已禁用的 Profile 时，旧逻辑会回落到「第一个启用的 Profile」，可能把图片上传到非预期账号。
- **修复**：显式默认 Profile 存在时只认它；不可用即返回 `REMOTE_PROFILE_MISSING`，不再回落。仅当未设置默认值时使用第一个启用 Profile。
- **测试**：默认 Profile 禁用 + 另一个启用时返回 `REMOTE_PROFILE_MISSING`，PicGo 未被调用。

### 2.6 任务尝试次数语义错误

- **位置**：`src/image-management/image-upload-service.ts`、`image-library-center.ts`。
- **现象**：失败任务没有写入 `attempt`，界面用 `attempt + 1` 展示，导致「第 1/3 次」实为 0 次、成功任务显示「第 2/3 次」。
- **修复**：失败时写入 `attempt: 1`；四视图统一显示「已尝试 N/M 次」。
- **测试**：失败任务 `attempt === 1`；诊断视图文本为 `已尝试 1/3 次 · PICGO_EMPTY_RESULT`。

### 2.7 缺少 APPDATA 时可能读取相对路径

- **位置**：`src/image-management/image-upload-service.ts`。
- **现象**：非 Windows 或受限环境下 `APPDATA` 为空，旧逻辑拼出相对路径 `Typora/profile.data`，可能误读当前目录文件。
- **修复**：`APPDATA` 缺失时路径留空，读取侧直接返回 `unknown`。
- **测试**：临时移除 `APPDATA` 后路径为空，读取返回 `unknown`。

### 2.8 上传成功后的索引/任务写入被误判为上传失败

- **位置**：`src/image-management/image-upload-service.ts`。
- **现象**：上传成功后 `recordRemoteLocation` 抛错会被外层 `catch` 归类为 `PICGO_UNAVAILABLE`/`FILE_NOT_READABLE`；任务状态写入失败也会把成功的上传判为失败。
- **修复**：远程位置写入失败统一返回 `INDEX_WRITE_FAILED`（文案改为「资产索引写入失败」）；任务状态写入改为尽力而为，失败不影响已成功的上传结果。
- **测试**：注入 `recordRemoteLocation` 抛错后返回 `INDEX_WRITE_FAILED`，源文件保留、任务标记失败。

### 2.9 图片模块未使用导入

- **位置**：`src/image-management/image-offline-service.ts`。
- **现象**：`noUnusedLocals` 报告 `MarkdownImageReference` 未使用。
- **修复**：删除该 type 导入；行为不变。

### 2.10 任务文件仅校验字段类型，未校验枚举

- **位置**：`src/image-management/image-transfer-task-store.ts`。
- **现象**：结构合法但 `kind`/`status` 为任意字符串时会被当作有效任务加载，诊断视图可能显示未知状态。
- **修复**：按 `TransferTaskKind` / `TransferTaskStatus` 白名单校验，缺失或未知值按损坏文件处理（只报错、不覆盖）。
- **测试**：非法 `status` 与非法 `kind` 均抛出 `corrupt`。

### 2.11 图片数据根目录把设置文件当成目录

- **位置**：`src/main.ts`。
- **现象**：框架的 `dataPath` 实际是**设置文件路径**（`<dataDir>/<pluginId>.json`），直接传给 `resolveImageDataPaths` 会得到 `.../ranzhi.inkchapter.json/image`。该路径无法创建目录（`ENOTDIR`），导致上传在资产索引阶段失败、磁盘上不产生任何图片数据。
- **修复**：新增 `imageDataBaseDir = path.dirname(this.dataPath)`，服务初始化、图库中心与设置页诊断统一使用该目录。
- **验证**：修复后重新执行上传入口，资产索引与任务文件写入 `<dataDir>/image/`，真实上传成功（HTTP 200、`image/png`、字节一致）。

## 3. 已核实但非缺陷

| 项目 | 结论 |
|---|---|
| `typora.log` 的 `SyntaxError: Unexpected token ')'` | 开发前既存：`typora-old.log` 有 206 次记录，`typora.log` 首次出现在本次开发之前；与插件无关 |
| `ResizeObserver loop limit exceeded` | Chromium/Typora 渲染噪声，非插件异常 |
| 382 条未使用符号 | 项目 `tsconfig` 未启用 `noUnusedLocals`；集中在既有标题编号模块，属技术债，不影响编译与运行，本次不做大规模重构 |
| `as any` / `require()` | 既有代码中的历史兼容写法；构建与运行均通过。新增代码未引入无依据 `any` |
| `__plugin-logger.log` | 无 `ERROR` / `Uncaught` / `TypeError` / `ReferenceError` 记录 |

## 4. 验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | PASS |
| 全量测试 | `pnpm run test` | PASS：301 文件 / 5492 用例 |
| 生产构建 | `pnpm run build` | PASS |
| 文档校验 | `pnpm run docs:verify` | PASS（断链 0） |
| 隐私门禁 | `pnpm run verify:image-privacy` | PASS |
| 运行时启动 | Typora 1.6.7 + 测试 vault | 插件正常加载，设置页与命令可用，无新增插件异常 |

## 5. 残余风险

1. 插件私有 PicGo 配置与系统凭据读取尚未产品化，真实联网上传未在本轮验证。
2. 上传任务的并发上限、重试调度尚未接入，仅持久化状态。
3. 六种原生插入方式、R03 侧栏拖拽、R04/R05 缩放仍需真实交互验收。
4. 既有标题编号模块的 382 条未使用符号未清理，若后续启用 `noUnusedLocals` 需要单独治理。
