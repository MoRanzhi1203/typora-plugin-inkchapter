# 图片管理 P6 — 分享、接收者本地化与图床迁移

> 日期：2026-11-04。前置：P5 项目资源整理已完成。
> 本阶段不修改原文档；导出只生成副本与清单，导入写入接收者指定的项目目录。

## 1. 阶段结论

| 目标 | 结果 |
|---|---|
| 直接分享：保留远程 HTTPS URL | 完成（导出不本地化时原样保留） |
| 完整分享：文档 + 清单 + 可选 assets | 完成（目录 + ZIP） |
| 清单不含绝对路径 / 凭据 | 完成 |
| 接收者恢复原始文件名与相对目录 | 完成（清单 `assetRoot` + `projectRelativePath`） |
| 无清单时保留远程 URL、不猜文件名 | 完成 |
| 上传接收者图床只用真实 URL | 完成（`uploadImpl` 必须返回可用 URL） |
| 源远端与接收者远端多位置并存 | 完成（location 带 ownership / deletable） |
| SSRF、大小、MIME、路径穿越、Windows 保留名 | 完成 |

## 2. 导出（`exportSharePackage`）

| 模式 | 行为 |
|---|---|
| 默认（本地化副本） | 复制本地图片到包内原相对路径，改写**副本**引用；原文档不变 |
| `localizeReferences: false` | 文档原样复制；本地引用不可移植时给出 `LOCAL_REFERENCES_NOT_PORTABLE` |
| `zip: true` | 额外生成 ZIP（文档 + 清单 + assets），无外部运行时依赖 |

清单 `inkchapter-images.json`：

```json
{
  "schemaVersion": 1,
  "assetRoot": "assets",
  "assets": [
    {
      "assetId": "img_<sha256 前缀>",
      "sha256": "<64 位>",
      "originalFilename": "x.png",
      "projectRelativePath": "assets/images/x.png",
      "remoteUrl": null
    }
  ]
}
```

- `assetRoot` 用于接收方剥离发送方资源根，避免 `assets/assets`。
- 只包含实际打包的本地资源；远程 URL 已存在于文档中，无需重复。
- ZIP 条目使用 UTF-8 文件名与 deflate；测试校验 EOCD 与条目数。

## 3. 导入（`importSharePackage`）

有清单：

1. 按 `projectRelativePath` 找到包内文件并校验 SHA-256；
2. 去掉发送方 `assetRoot`，在接收者资源根恢复原目录；
3. 原始文件名经 Windows 保留名、非法字符、尾随点/空格、长度限制处理；
4. 同名同内容复用，同名异内容追加内容哈希后缀；
5. 文档引用改为接收者项目内的相对路径。

无清单：

- 本地文件按包内文件名导入；
- 远程 URL 原样保留，资产记录 `originalFilename = null`，不猜测发送方原名；
- 不虚构发送者原始目录。

远程下载与上传：

- `downloadRemote: true` 时复用 P4 的安全下载（协议、SSRF、重定向、MIME、大小）；
- `uploadImpl` 必须返回真实可用 URL 才会改写引用并记录接收者 GitHub 位置；
- 未提供上传器时保持本地引用并标记 `pendingUpload`；
- 绝不通过替换用户名伪造新 URL。

多位置与权限：

| 位置 | ownership | deletable |
|---|---|---|
| 发送者远程 URL | `sender` | `false` |
| 接收者本地副本 | `receiver` | `true` |
| 接收者图床上传结果 | `receiver` | `true` |

安全：

- 包内路径必须位于包目录内，并额外校验 `realpath`（符号链接逃逸）；
- 目标资源路径必须位于接收者资源根内；
- 目标文档默认不覆盖，需显式 `overwrite`；
- 文件写入使用临时文件 + rename，哈希校验后才落位。

## 4. 直接分享与原文

- 云端 URL 文档可直接发送；接收者联网且仓库公开即可阅读。
- 纯本地引用文档单发 `.md` 不可移植，应使用完整分享包或先上传转换。
- 导出与导入都不会自动改写原文档；不存在“静默转换原文”的代码路径。

## 5. 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 图片管理单测 | `npx vitest run src/image-management` | PASS：15 文件 / 162 用例 |
| 类型检查 | `pnpm run typecheck` | PASS |
| 生产构建 | `pnpm run build` | PASS |
| 全量单测 | `pnpm run test` | PASS：294 文件 / 5440 用例全部通过 |

重点用例：

- 导出后原文档不变，副本引用指向包内 `assets/...`。
- 清单不含项目绝对路径。
- ZIP 签名与条目数正确。
- 导入恢复 `assets/images/x.png` 与原始文件名。
- 远程下载 + 上传只采用回调返回的真实 URL。
- 无上传器时保留本地引用并报告待上传。
- 已存在的目标文档默认拒绝覆盖。
- 文件名穿越、Windows 保留名、非法字符被清洗。

## 6. 未完成与风险

1. ZIP **导入**尚未实现（当前只导入目录）；P7 可增加解包向导。
2. 分享/导入 UI、用户确认与进度属于 P7。
3. 上传回调由上层提供；本阶段不直接读取本机凭据或调用 PicGo。
4. 未验证：真实 QQ/微信接收、超大包、跨盘目标、接收者仓库权限失败。
5. 清单 schema 新增可选 `assetRoot`，旧清单仍可读取；不发 `assetRoot` 时按扁平文件名恢复。

## 7. 下一阶段准入条件

1. P6 代码通过全量测试与构建。
2. 进入 P7：设置页/图库中心/任务状态/路径与分享入口，复用本阶段的导出导入与所有权模型。
3. 任何上传必须使用真实返回 URL；不得由用户名或本地路径推导远程地址。
