# 墨章 InkChapter

面向 Typora 的 Markdown 文档结构、自动编号、段落排版、图表题注与文档工作流增强插件。

## 当前基线

```text
CODE BASELINE = d8aca1f69a58bced6f6e57297a3a4bf67feaef10
BUILD ID      = inkchapter-outline-observer-late-bind-v26
```

## 主要功能

- 标题自动编号（H1–H6）与多种编号预设
- 自定义多级组合格式
- 标题排版与段落缩进
- 表格 / 图片 / 代码题注与独立编号
- 目录编号同步
- 原生 MathJax 块公式渲染（公式自动编号待重新开发）

## 开发环境

- TypeScript（严格类型检查）
- pnpm + esbuild（`node build.js --prod`）

## 构建入口

```text
node build.js --prod
```

> 产出 `dist/main.js` + `dist/main.css`（部署时按框架约定重命名为 `style.css`）。

## Runtime 测试 vault

```text
test/vault
```

验收文档：`test/vault/墨章插件测试/01-中文学术论文模板.md`

## docs 导航

见 [docs/README.md](docs/README.md)。

## 当前公式模块状态

```text
原生 MathJax 块公式渲染 = PASS
公式自动编号 = REDEVELOPMENT REQUIRED（旧 R5→R60 架构废弃）
```

详见 [docs/FORMULA-BASELINE.md](docs/FORMULA-BASELINE.md)。

## 后续开发约束

- 不得恢复旧公式修复链。
- 不得让块公式回退到裸 `$$`。
- 源码改动需通过构建 + SHA 闭环 + 真实 Typora Runtime 验证。
