# 图片管理最终验收清单（P9）

> 状态：PASS = 有可重复证据；PARTIAL = 部分完成；FAIL = 已知失败；BLOCKED = 本环境无法执行；NOT IMPLEMENTED = 未实现。
> 详细矩阵见 [image-management-acceptance-matrix.md](./image-management-acceptance-matrix.md)。

## A. 配置与隐私

- [x] 干净安装默认 `uploadService = none` — PASS
- [x] 公开默认不含个人账号、仓库、盘符 — PASS
- [x] 分享包/清单不含绝对路径 — PASS
- [x] 暂存改动无 Token、私钥、私人路径 — PASS（`pnpm run verify:image-privacy`）
- [x] 项目级选项拒绝 Token/路径/上传服务 — PASS
- [ ] 本机 Profile 上传在插件运行时可用 — PARTIAL（Typora 自带 PicGo 已实测；插件侧未接入）
- [ ] 切换 `none` 后历史远程引用不变 — PARTIAL（配置层保留；运行时未验收）
- [ ] 禁用/重新启用插件无损 — BLOCKED

## B. 插入与上传

- [ ] 六种原生插入方式在普通项目与测试 vault 正确 — BLOCKED
- [ ] `./assets` 相对当前文档语义不变 — PARTIAL（未改动，未运行时验收）
- [ ] 「上传图片 + 服务=none」明确冲突 — NOT IMPLEMENTED
- [x] GitHub 单图/多图真实上传 — PASS（P0-LOCAL 历史证据）
- [x] 远程 URL 真实可访问 — PASS（HTTP 200）
- [x] 上传不强制创建长期本地图库副本 — PASS（设计 + 无此代码路径）
- [ ] 中文/空格/`%`/`#` 文件名全部正确 — FAIL（`#` 丢扩展名、空格未编码；需插件上传器规避）
- [ ] 上传失败/中断不丢唯一数据 — PARTIAL（未做故障注入）

## C. 资产、缓存与离线

- [x] 同内容只建一个资产 — PASS
- [x] 同名异内容不合并 — PASS
- [x] 图库/项目已有副本不重复缓存 — PASS
- [x] 缓存配额、LRU、固定离线保护 — PASS
- [x] 路径修改可迁移、备份、回滚、改写数据库 — PASS
- [x] 离线对象真实核验 — PASS
- [x] 未缓存云端图片断网不谎称可用 — PASS（不承诺透明离线）
- [ ] 透明离线回退 — NOT IMPLEMENTED（采用工作副本）

## D. Markdown 与分享

- [x] 分享包恢复原文件名与相对目录 — PASS
- [x] 引用改写不触碰代码块/标题/编号 — PASS
- [x] 无清单不承诺恢复原文件名 — PASS
- [x] 记录发送者远端为历史来源 — PASS
- [ ] 接收者迁移到自己的图床 — PARTIAL（上传回调可用，未接 PicGo 运行时）
- [ ] 真实 QQ/微信接收验证 — BLOCKED

## E. 既有 Typora / 插件回归

- [x] 全量自动化测试 — PASS（295 文件 / 5448 用例）
- [x] 类型检查 / 构建 / 隐私门禁 — PASS
- [ ] R02 滚动 — BLOCKED
- [ ] R03 侧栏拖拽 — BLOCKED
- [ ] R04/R05 窗口与侧栏缩放 — BLOCKED
- [ ] 自动编号/折叠/空行/信息栏/Ctrl+Z 交互回归 — PARTIAL（自动化未退化）
- [ ] 普通目录与测试路径加载 — BLOCKED（Typora 启动即退出）
- [x] 未升级 Typora — PASS（1.6.7）

## F. 交付物

- [x] 通用插件代码与安全默认配置
- [x] 本机 PicGo 配置与真实测试记录（配置在工作区外）
- [x] 路径策略、资产 Schema、迁移事务文档
- [x] 缓存、离线、分享、项目整理实现与单测
- [x] `P0_AUDIT.md`、阶段实施记录、隐私扫描摘要、最终验收清单
- [ ] 主分支整合 — 见最终交付报告
- [ ] 真实 Typora 交互验收 — BLOCKED

## G. 复跑命令

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:image-privacy
```
