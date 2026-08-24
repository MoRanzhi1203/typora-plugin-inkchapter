# FORMULA RENDER FULL ROLLBACK — d8aca1f

## 目标

停止 R60 / R59 / R24 / 公式编号修复链，将主项目正式、完整回档到：

`d8aca1f69a58bced6f6e57297a3a4bf67feaef10`

最终要求：

- SOURCE = d8aca1f
- BUILD = d8aca1f
- RUNTIME = d8aca1f
- 当前只验收 Typora 原生 MathJax 块公式能否恢复正常渲染
- 本轮不验收公式自动编号

##### 0. 回档前备份

这是破坏性回档。先保存当前状态，仅用于灾难恢复：

```powershell
$backup = ".backup-before-full-rollback-20260821"
New-Item -ItemType Directory -Force $backup | Out-Null
git rev-parse HEAD | Out-File "$backup\current-head.txt"
git status --short | Out-File "$backup\git-status.txt"
git diff | Out-File "$backup\working-tree.patch"
git diff --cached | Out-File "$backup\index.patch"
```

禁止 stash、禁止自动 commit、禁止回档后自动 apply patch。

1. 移除234临时 rollback worktree

若存在：

`D:\TyporaPluginProjects\typora-plugin-inkchapter-rollback-d8aca1f`

执行：

```powershell
git worktree remove "..\typora-plugin-inkchapter-rollback-d8aca1f" --force
git worktree prune
git worktree list
```

##### 2. 主项目完全回档

在：

`D:\TyporaPluginProjects\typora-plugin-inkchapter`

执行：

```powershell
git reset --hard d8aca1f69a58bced6f6e57297a3a4bf67feaef10
git rev-parse HEAD
```

HEAD 必须严格等于目标 commit，否则 STOP。

## 3. 检查未跟踪残留

只读执行：

```powershell
git status --short
git clean -nd
git clean -ndX
```

禁止直接 `git clean -fdx`。

允许选择性清理后续版本的临时构建、测试缓存、旧 audit、旧 runtime-load、R59/R60 forensic 临时文件。

必须保留：

- `test/vault/**/*.md`
- 用户插件配置
- 用户测试素材
- 无法确认用途的未跟踪文件

## 4. 验证源码确实等于 d8aca1f

```powershell
git diff HEAD -- src
git diff HEAD -- build.js
git diff HEAD -- package.json
git diff HEAD -- pnpm-lock.yaml
git diff HEAD -- tsconfig.json
```

要求全部无 diff。

输出：

```text
SOURCE_HEAD=d8aca1f69a58bced6f6e57297a3a4bf67feaef10
SOURCE_TREE_CLEAN=true
```

否则 STOP。

## 5. 清理旧构建产物

```powershell
Remove-Item "dist\main.js" -Force -ErrorAction SilentlyContinue
Remove-Item "dist\style.css" -Force -ErrorAction SilentlyContinue
```

## 6. 使用 d8aca1f 自身构建系统

重新读取当前 commit 的 `package.json` 和 `build.js`。

已知该版本无参数 dev build 可能有部署、关闭/启动 Typora 等副作用，因此本轮只允许：

```powershell
pnpm install --frozen-lockfile
node build.js --prod
```

禁止 `node build.js`。

构建后必须存在：

- `dist/main.js`
- `dist/style.css`

## 7. 验证构建

```powershell
git rev-parse HEAD
Get-FileHash "dist\main.js" -Algorithm SHA256
Get-FileHash "dist\style.css" -Algorithm SHA256
```

记录 SOURCE_COMMIT、PROJECT_MAIN_SHA256、PROJECT_STYLE_SHA256。

同时检查 bundle 中不得出现明显后续 R59/R60 标识，例如：

- `r60`
- `production-transaction-final-cutover`
- `formula-source-dom-validator`
- `formula-mathjax-ready-barrier`

若存在明确后续代码，STOP。

## 8. 停止 Typora

```powershell
Get-Process Typora -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Get-Process Typora -ErrorAction SilentlyContinue
```

必须确认进程真正消失。

## 9. 覆盖 Runtime 插件

Runtime：

`D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\.typora\plugins\dist`

删除旧 main.js / style.css，再把当前主项目的：

- `dist/main.js`
- `dist/style.css`

复制进去。

## 10. SHA 部署闭环

```powershell
Get-FileHash "dist\main.js" -Algorithm SHA256
Get-FileHash "test\vault\.typora\plugins\dist\main.js" -Algorithm SHA256
Get-FileHash "dist\style.css" -Algorithm SHA256
Get-FileHash "test\vault\.typora\plugins\dist\style.css" -Algorithm SHA256
```

必须满足：

- PROJECT_MAIN_SHA256 == RUNTIME_MAIN_SHA256
- PROJECT_STYLE_SHA256 == RUNTIME_STYLE_SHA256

否则 STOP。

## 11. 清 Runtime 状态

```powershell
Remove-Item "test\vault\.typora\inkchapter-runtime-load.json" -Force -ErrorAction SilentlyContinue
Remove-Item "test\vault\.typora\inkchapter\audit" -Recurse -Force -ErrorAction SilentlyContinue
```

不得删除 Markdown 文档。

## 12. 启动并验证真实 Typora

打开：

`D:\TyporaPluginProjects\typora-plugin-inkchapter\test\vault\墨章插件测试\01-中文学术论文模板.md`

必须验证：

- Typora process 存在
- MainWindowHandle != 0
- 窗口标题包含目标文档
- target vault 正确
- runtime main.js SHA 与刚构建的 SHA 一致
- 实际加载的插件来自本轮 d8aca1f 构建

未验证不得声明部署成功。

## 13. P0 验收

定位 `5.3 模型构建`。

目标公式：

```markdown
$$
\hat{y}_{t+1}=f(y_t,y_{t-1},x_t)
$$
```

PASS：

- 页面显示正常数学公式
- literalDollarDelimiterVisible=false
- 若能检查 DOM，应存在 MathJax 实际渲染输出，例如 `mjx-container`

FAIL：

- 页面仍显示裸 `$$ ... $$`
- 或长期停留在 `md-rawblock / math-jax-preprocess`

## 14. PASS 后立即停止

输出：

```text
FULL ROLLBACK COMPLETE

SOURCE_COMMIT:
d8aca1f69a58bced6f6e57297a3a4bf67feaef10

SOURCE_TREE:
CLEAN

PROJECT/RUNTIME MAIN SHA:
MATCH

PROJECT/RUNTIME STYLE SHA:
MATCH

TYPORA PROCESS:
VERIFIED

MAIN WINDOW HANDLE:
VERIFIED

WINDOW TITLE:
VERIFIED

TARGET VAULT:
VERIFIED

FORMULA NATIVE RENDER:
PASS

LITERAL $$:
NOT VISIBLE

FORMULA NUMBERING:
NOT EVALUATED

DECISION:
d8aca1f ESTABLISHED AS NEW DEVELOPMENT BASELINE
```

然后 STOP，不恢复 R5/R24/R25/R59/R60 公式代码。

## 15. 若 FAIL

禁止修改源码，先做插件禁用对照：

- 同一 Typora
- 同一 Markdown
- 同一主题
- 仅禁用墨章插件

若禁用插件后正常，而 d8aca1f 插件启用时失败，则继续寻找更早基线。

若禁用插件仍失败，则 STOP，转查：

- Typora 本体
- 主题/CSS
- 其他插件
- Markdown 文件状态
- MathJax Runtime

## 硬性禁止

- 不再建立 rollback worktree
- 不继续寻找不存在的 R24 commit
- 不 checkout R25/R59/R60
- 不 cherry-pick 后续公式修改
- 不修改 BUILD_ID 伪装旧版本
- 不在 Runtime 验证失败后立即写修复代码
- 不使用 `git clean -fdx`
- 不把启动命令成功等同于 Typora 已真实启动
