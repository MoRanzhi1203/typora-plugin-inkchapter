# P0_AUDIT — 图片管理环境与代码审计摘要

> 日期：2026-11-03 / 2026-11-04。本文件是 P0 的交付摘要；详细证据见
> [image-management-audit.md](../modules/image-management/image-management-audit.md)。
> 不含 Token、私钥、展开后的用户绝对路径或个人仓库账号。

## 1. 环境

| 项目 | 结果 |
|---|---|
| 操作系统 | Windows 10 |
| Typora | 1.6.7，未升级、未修改安装目录 |
| Node / npm | Node 24、npm 11 |
| PicGo-Core | 3.2.0；Typora 另带一份自带二进制 |
| 社区框架 | 2.9.x，插件运行于框架提供的渲染进程 |
| GitHub 凭据 | 已存在于操作系统凭据存储；未复制、未打印 |

## 2. Typora 原生行为

| 项目 | 结果 |
|---|---|
| 六种插入方式 | 保持 Typora 原生：无特殊操作、`./`、`./assets`、`./${filename}.assets`、上传图片、指定路径 |
| 上传方式 | `picgo-cli`（Typora 自带 PicGo-Core） |
| `File.imgEdit` | 1.6.7 不存在；不能依赖其做引用替换 |
| 粘贴观测 | `markdownEditor 'edit'` 后可读取新引用；撤销粘贴不会触发该事件 |
| 截图落盘 | 无特殊操作时可能写入 Typora 用户图片目录；不得删除 |

## 3. PicGo / 图床

| 项目 | 结果 |
|---|---|
| 配置位置 | `%USERPROFILE%\.picgo\config.json`（Git 工作区之外） |
| 上传方式 | PicGo 编程 API / Typora 自带二进制，不自建 CLI 包装 |
| 真实上传 | 合成图片单图、多图、Typora 原生插入均成功；Raw URL HTTP 200 |
| 同名文件 | 二次上传返回 422 `sha wasn't supplied` |
| 特殊文件名 | `#` 导致扩展名丢失；空格未编码；`%` 存在双重编码风险 |
| 失败返回 | PicGo 失败时可能不抛异常且 URL 为空，必须校验 `imgUrl`/`url` |
| Token | 仅存本机 PicGo 配置；未进入仓库、日志或聊天 |

## 4. 代码与架构决策

| 主题 | 决策 |
|---|---|
| 资产身份 | SHA-256 内容寻址，`img_<sha256 前缀>` |
| 索引存储 | JSON 原子写；未引入 SQLite（原生 ABI 未验证） |
| 引用扫描 | 复用既有资源扫描器，排除代码块/行内代码 |
| 上传 | 只使用真实返回 URL；不按用户名拼接 |
| 离线 | 不宣称透明离线；提供受保护离线对象与离线工作副本 |
| DOM | 不注册高频 MutationObserver，不劫持协议，不覆盖渲染节点 |
| 配置 | 公开默认 `uploadService=none`，路径为空，运行时解析 |

## 5. 证据级别

| 级别 | 状态 |
|---|---|
| 静态类型检查 | PASS |
| 自动化测试 | PASS |
| 真实 PicGo 上传 | PASS（合成图，已清理） |
| Typora 原生上传 | PASS（历史会话；测试图已清理） |
| Typora 交互回归（滚动/拖拽/缩放） | BLOCKED（当前环境启动后立即退出） |
| 清理/恢复 | 测试产物已删除；仓库无个人图片提交 |

## 6. 结论

- 可在不升级 Typora、不修改安装目录的前提下实现图片增强能力。
- 最大阻塞不是代码，而是**真实 Typora 交互验收环境**与**插件侧上传/冲突提示尚未接入运行时**。
- 任何后续阶段不得把 BLOCKED 项报告为 PASS。
