# 开发指南

## 环境准备

- **Node.js**: ≥ 16
- **包管理器**: pnpm（`package.json` 指定 `packageManager: pnpm@11.15.0`）
- **Typora**: ≥ 1.6.0（Windows）
- **编辑器**: VS Code（推荐，有 .editorconfig 和 .browserslistrc）

```bash
# 安装依赖
pnpm install
```

## 项目结构

```
typora-plugin-inkchapter/
├── src/                    # 源代码
│   ├── main.ts             # 插件入口
│   ├── heading-numbering/  # 核心编号引擎
│   ├── settings/           # 设置模型和 UI
│   ├── infrastructure/     # Typora 适配层
│   ├── core/               # 日志等工具
│   ├── utils/              # 通用工具
│   └── style.scss          # 全部样式
├── test/vault/             # 测试环境（Typora vault）
├── build.js                # 唯一构建 authority（esbuild，`--prod` 生产）
├── pack.js                 # 打包脚本
└── package.json
```

## 构建命令

```bash
# 开发构建 + 自动部署 + 打开 Typora
pnpm build:dev

# 生产构建（esbuild + 压缩）
pnpm run build

# 打包为 zip
pnpm run pack
```

## 开发流程

1. 修改 `src/` 下的源代码
2. 运行 `pnpm build:dev`
3. Typora 自动打开 test vault，插件重新加载
4. 在 Typora 中测试功能
5. 检查 `test/vault/.typora/inkchapter-runtime-load.json` 确认构建标识

## 关键技术

- **Typora 社区插件框架**: 基于 `@typora-community-plugin/core` v2.7.7
- **构建**: esbuild（唯一构建 authority；`node build.js` 开发 / `node build.js --prod` 生产）
- **样式**: SCSS，通过 `esbuild-sass-plugin` 编译
- **类型**: TypeScript + `@types/typora`

## 测试

- 测试 vault: `test/vault/`
- 模板文档: `test/vault/墨章插件测试/`
- 手动验证: 在 Typora 中打开模板文档
