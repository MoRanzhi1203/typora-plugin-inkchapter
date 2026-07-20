# 墨章 InkChapter - 项目规则

## 项目信息

- **名称**: 墨章 InkChapter
- **ID**: `inkchapter`
- **类型**: Typora 社区插件
- **框架**: `@typora-community-plugin/core` (≥2.7.7)
- **构建工具**: esbuild (dev) / rollup (prod)

## 目录结构

```
typora-plugin-inkchapter/
├── src/
│   ├── main.ts          # 插件入口
│   ├── manifest.json    # 插件元数据
│   ├── style.scss       # 样式
│   └── locales/         # 国际化
├── test/vault/          # 测试用 Typora vault
├── build.js             # 开发构建脚本
├── rollup.config.js     # 生产构建配置
└── pack.js              # 打包脚本
```

## 开发命令

```powershell
pnpm run build:dev   # 开发构建（自动安装到 Typora 并启动）
pnpm run build       # 生产构建
pnpm run pack        # 生产构建 + 打包 ZIP
```

## 强制规则

1. 不得修改 `D:\Typora` 中的文件。
2. 不得修改社区框架 `D:\TyporaPluginProjects\framework-source\typora-community-plugin`。
3. 不得删除 `pnpm-lock.yaml`。
4. 不得执行 `pnpm update` 或整体升级依赖。
5. 使用社区框架 API 前，必须搜索参考源码确认接口。
6. 构建失败时不得通过删除锁文件或升级依赖规避。
7. 不得声称 Typora 界面验证成功（用户人工确认）。
8. Git 提交失败时不得修改全局 Git 配置。
