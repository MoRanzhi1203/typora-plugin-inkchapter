# 图片管理 P8 验收矩阵

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
| 六种 Typora 原生插入方式不被改写 | 无替代实现，设置页只引导 | PARTIAL（运行时未验收） |
| `./assets` 相对当前文档语义不变 | 未改动 Typora 设置/解析 | PARTIAL（运行时未验收） |
| 「上传图片 + 服务=none」明确冲突 | 尚无运行时冲突提示 | NOT IMPLEMENTED |
| GitHub 单图/多图真实上传 | P0-LOCAL 使用 Typora 自带 PicGo 实测成功（合成图已清理） | PASS（历史证据） |
| 中文/空格/`%`/`#` 文件名 | P0-LOCAL 实测发现 `#` 丢扩展名、空格未编码 | FAIL（已知缺陷，插件上传器需规避） |
| 上传失败不丢唯一数据 | 设计约束 + 无删除原图代码 | PARTIAL（未做故障注入） |
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
| 全量自动化测试 | `pnpm run test`：295 文件 / 5448 用例 | PASS |
| 类型检查 / 构建 | `pnpm run typecheck`、`pnpm run build` | PASS |
| R02 滚动（激活/非激活、代码块、图片、空行、公式） | 需真实 Typora | BLOCKED |
| R03 侧栏拖拽 | 需真实 Typora | BLOCKED |
| R04/R05 窗口与侧栏缩放 | 需真实 Typora | BLOCKED |
| 自动编号、折叠、空行检测、Ctrl+Z | 自动化未退化；交互需真实 Typora | PARTIAL |
| 普通目录与测试路径加载 | 构建已安装到测试 vault；Typora 启动后立即退出 | BLOCKED |
| 不升级 Typora | 版本仍为 1.6.7 | PASS |

## 6. 环境阻塞说明

本机当前启动 Typora 后进程立即退出，`typora.log` 中仅有历史既有的
`SyntaxError: Unexpected token ')'`（该错误在图片功能开发前已反复出现），
没有新增插件异常。因此所有需要真实编辑器交互的验收项标记为 **BLOCKED**，
不得据自动化测试宣称已通过。

## 7. 必须补齐的缺口

1. 真实 Typora：六种插入方式、上传冲突提示、R02–R05 回归。
2. 插件侧上传服务与冲突提示（当前只有 Typora 自带 PicGo 链路）。
3. 文件名含 `#`/`%`/空格时的上传命名规避（使用内容哈希命名）。
4. 文档级图库中心、缓存清理、离线准备、分享/迁移命令入口。
5. 故障注入：断网、上传中断、磁盘写满、文档被占用。

## 8. 复跑命令

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:image-privacy
```
