# Figure Diagnostic Locator V1 — Remote (GitHub) Fixture

本 fixture 是 `Figure-Diagnostic-Locator-V1-Test.md` 的**远程副本**，专门验证 GitHub 图床链接下的图片诊断与重复引用定位。

本地资源基准（存在性、缺图诊断、PNG 内容与 SHA-256）仍由原 fixture 承担，不得用本文件替代。

资源策略：除 `[EXPECTED_MISSING]` Case 外，所有图片统一使用 GitHub 图床链接。

## Case S1 文字 + 图片（structure source-block）[EXPECTED_VISIBLE]

before ![S1](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png)

## Case S2 图片 + 文字（structure source-block）[EXPECTED_VISIBLE]

![S2](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png) after

## Case S3 同块双图（structure source-block）[EXPECTED_VISIBLE]

![S3a](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png) ![S3b](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-112626-9e8256de51.png)

## Case S4 文字 + 图片 + 图片（structure source-block）[EXPECTED_VISIBLE]

before ![S4a](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png) middle ![S4b](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-112626-9e8256de51.png)

## Case W1 两个合法重复远程 URL 图片块（duplicate destination occurrences）[EXPECTED_VISIBLE]

![](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-093908-7d5d02a14e.png)

![](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-093908-7d5d02a14e.png)

## Case W2 合法独立图片缺图名（occurrence locate）[EXPECTED_VISIBLE]

![](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-112626-9e8256de51.png)

## Case W3 远程图片不存在（missing-image fallback）[EXPECTED_MISSING]

![W3 expected missing](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/missing-local-image.png)

## Case S5 同块完全相同的两个段落（block identity 稳定）[EXPECTED_VISIBLE]

before ![](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png)

before ![](https://raw.githubusercontent.com/MoRanzhi1203/Picture_Bed/main/images/20261104-102331-7d5d02a14e.png)

## 结束

本 fixture 结束。
