# Document Utilities Dynamic Layout Test

> 可变 smoke fixture（允许人工修改）。
>
> 用途：验证 Document Utilities Overlay 的动态行为：
> - short ↔ long（右下 ↑/↓ 实时出现 / 消失）
> - Drawer 2 → 1 → 0 项收缩（内容自适应高度）
> - EOF 空行 Warning 的出现与清除
>
> 不要用 README.md 做这些破坏性测试，本文件专门承担。

## 短文档基线

下面这一小段让本文件在默认窗口下通常不可滚动（↑/↓ 隐藏）。

这一行用于占位。

## 可编辑滚动填充区（short → long）

> 操作：把下面的占位文字复制粘贴数遍，直到页面可滚动（↑/↓ 应自动出现）；
> 再全部删除恢复短文档（↑/↓ 应自动消失）。

