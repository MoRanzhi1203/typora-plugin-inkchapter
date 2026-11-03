# 图片管理验收矩阵（P8 建立，P10 更新）

> 日期：2026-11-04。适用范围：`feature/image-management` 分支 P1–P7 实现。
> 状态定义：**PASS** 有可重复的自动化证据；**PARTIAL** 部分能力已完成；**BLOCKED** 需要真实 Typora 运行时，本环境无法执行；**NOT IMPLEMENTED** 尚未实现。

## 1. 配置与隐私

| 验收项 | 证据 | 状态 |
|---|---|---|
| 干净安装默认上传服务为 `none` | `image-settings.test.ts`：默认值、无 Profile 拒绝 github | PASS |
| 公开默认不含个人账号、仓库、盘符 | `image-settings.test.ts` 序列化断言 | PASS |
| 公开清单/分享包不含绝对路径 | `image-share-package.test.ts`：清单不含项目根 | PASS |
| 暂存改动无 Token / 私钥 / 私人路径 | `pnpm run verify:image-privacy` | PASS |
| 项目级共享选项拒绝 Token/路径/上传服务 | `image-config-layers.test.ts` 白名单 | PASS |
| 关闭图片管理不删除文件、不改 Typora 设置 | 代码路径只停用服务 | PARTIAL（未做运行时禁用/启用回归） |
| 切换上传服务为 `none` 后历史远程链接不变 | 配置层不删除 remote location | PARTIAL（上传服务尚未接入运行时） |

## 2. 插入与上传

| 验收项 | 证据 | 状态 |
|---|---|---|
| 六种 Typora 原生插入方式不被改写 | 运行时确认 Typora 图像页插入方式仍为「上传图片」、上传服务仍为 PicGo-Core，插件未注册替代实现 | PARTIAL（其余五种未逐一触发） |
| `./assets` 相对当前文档语义不变 | 未改动 Typora 设置/解析 | PARTIAL（运行时未验收） |
| 「上传图片 + 服务=none」明确冲突 | `image-upload-policy.test.ts`；P10 真实 Typora 命令提示框显示完整冲突文案 | PASS |
| GitHub 单图/多图真实上传 | P0-LOCAL 使用 Typora 自带 PicGo 实测成功（合成图已清理） | PASS（历史证据） |
| 插件侧上传器（PicGo 编程 API） | `image-upload-service.test.ts`；真实上传合成 PNG：HTTP 200、`image/png`、字节一致 | PASS |
| 插件上传入口 | 命令「墨章：上传本地图片…」与设置页按钮；真实上传成功并记录 GitHub 位置 | PASS |
| 中文/空格/`%`/`#` 文件名 | 插件上传器使用安全命名并通过测试；Typora 原生链路仍存在 `#` 丢扩展名、空格未编码 | PASS（插件侧）/ FAIL（原生链路，已知限制） |
| 上传失败不丢唯一数据 | `image-upload-service.test.ts`：空结果、配置缺失均保留源文件并标记任务失败 | PASS |
| 日志脱敏 | 隐私门禁扫描暂存改动 | PASS（当前改动） |

## 3. 资产、缓存与离线

| 验收项 | 证据 | 状态 |
|---|---|---|
| 同内容只建一个资产 | `image-asset-index.test.ts` | PASS |
| 同名异内容不合并 | 同一测试 + 项目迁移冲突用例 | PASS |
| 图库/项目已有副本不重复缓存 | `image-cache-service.test.ts` | PASS |
| 缓存配额、LRU、固定离线保护 | `image-cache-policy.test.ts`、`image-cache-service.test.ts` | PASS |
| 路径迁移、备份、回滚、数据库改写 | `image-path-migration.test.ts`、`image-data-paths.test.ts` | PASS |
| 离线对象真实核验 | `image-offline-service.test.ts` | PASS |
| 纯云端图片断网不谎称可用 | 未实现透明离线，明确不宣称 | PASS（不承诺） |
| 透明离线回退 | 未找到可信接入点 | NOT IMPLEMENTED（按设计采用工作副本） |

## 4. Markdown 与分享

| 验收项 | 证据 | 状态 |
|---|---|---|
| 远程 URL 单发 `.md` 可读 | 导出保留 URL；未改写原文 | PARTIAL（未做真实 QQ/微信接收） |
| 清单 + 资源恢复原文件名/相对目录 | `image-share-package.test.ts` | PASS |
| 参考改写不改代码块/标题/编号 | 引用扫描排除字面量；迁移/分享用例 | PASS |
| 无清单不承诺恢复原文件名 | 导入返回 `originalFilename = null` | PASS |
| 接收者可迁移到自己的图床 | `uploadImpl` 只采用真实返回 URL | PARTIAL（未接入 PicGo 运行时） |
| 保留旧远程链接为历史来源 | 导入记录 sender location，`deletable=false` | PASS |

## 5. 既有 Typora / 插件回归

| 验收项 | 证据 | 状态 |
|---|---|---|
| 全量自动化测试 | `pnpm run test`：300 文件 / 5478 用例 | PASS |
| 类型检查 / 构建 | `pnpm run typecheck`、`pnpm run build` | PASS |
| R02 滚动（激活/非激活、代码块、图片、空行、公式） | 真实 Typora 中基础 PageDown 滚动无异常；组合场景未逐一验收 | PARTIAL |
| R03 侧栏拖拽 | 未执行 | BLOCKED |
| R04/R05 窗口与侧栏缩放 | 未执行 | BLOCKED |
| 自动编号、折叠、空行检测、Ctrl+Z | 自动化未退化；交互未做运行时回归 | PARTIAL |
| 普通目录与测试路径加载 | 测试 vault 正常加载，回执 `loadSource=vault`，插件设置页与命令真实可见 | PASS |
| 不升级 Typora | 版本仍为 1.6.7 | PASS |
| 四视图图库中心 | `image-library-center.test.ts`；真实 Typora 命令入口显示四视图计数与冲突提示 | PASS（只读入口） |
| 传输任务持久化 | `image-transfer-task-store.test.ts`：原子写、损坏不覆盖、数量上限 | PASS |

## 6. 运行时结论（P10 修订）

上一阶段记录的「Typora 启动后立即退出」源于调用方在命令结束时清理子进程，**不是插件缺陷**。
P10 改用与终端会话分离的系统级启动后，Typora 持续存活，插件从测试 vault 正常加载：

- 设置页出现「墨章 · 图片」，控件完整渲染；
- 命令面板执行「墨章：图片图库中心」，提示框显示四个视图计数与「上传图片 + 服务 none」冲突文案；
- 日志仅有开发前既有的 `SyntaxError: Unexpected token ')'` 与 `ResizeObserver` 噪声，无新增插件异常。

仍未执行：六种插入方式逐一触发、R03 侧栏拖拽、R04/R05 缩放、自动编号/折叠/空行/Ctrl+Z 交互回归。
这些项目保持 PARTIAL/BLOCKED，不据自动化测试宣称通过。

## 7. 必须补齐的缺口

1. 真实 Typora：六种插入方式逐一触发、R03 侧栏拖拽、R04/R05 缩放、自动编号/折叠/空行/Ctrl+Z 交互回归。
2. 插件私有 PicGo 配置的创建与系统凭据读取（当前只保存凭据引用 ID）。
3. 插件上传器真实联网上传与故障注入（断网、限流、写入中断）。
4. 文档级图库中心操作入口（缓存清理、离线准备、分享/迁移）——当前只读。
5. 上传任务队列的并发上限与重试调度（当前只持久化状态）。

## 8. 复跑命令

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:image-privacy
```
