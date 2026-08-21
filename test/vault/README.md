# test/vault

墨章 InkChapter 插件的真实 Runtime 测试 vault。

## 目录结构

```text
墨章插件测试/  = 人工综合验收（真实 Typora 手工操作）
fixtures/     = 单功能测试 fixture（figure / caption 等）
regression/   = 历史回归（r58 等）
runtime/smoke/ = 真实 Typora 快速冒烟（单一目的，快速判断 PASS/FAIL）
scratch/      = 临时人工实验
.typora/      = test vault 的插件 Runtime / 配置
```

## 规则

- 不要将新的单元 fixture 继续堆到 vault 根目录，请放入对应子目录。
- `墨章插件测试/` 是人工验收模板，默认保护（尤其 `01-中文学术论文模板.md`）。
- 真实 Runtime 冒烟文档放在 `runtime/smoke/`。
- 历史回归样本放在 `regression/`（`r58/` 为 R58 回归，`legacy/` 为非当前主线历史样本）。
