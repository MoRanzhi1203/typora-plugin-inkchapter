# 图片独立块规范 Runtime Fixture

本 fixture 验证 V5.15 Standalone Object Block Invariant：一个独立块只能包含一个图片对象，图片不得与正文混排。

## Case A 合法单图

![合法独立图片](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

## Case B 文字加图片

before ![B](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

## Case C 图片加文字

![C](assets/phase7-strict-h1-boundary/boundary-a-figure.png) after

## Case D 文字加图片加文字

before ![D](assets/phase7-strict-h1-boundary/boundary-a-figure.png) after

## Case E 同块双图

![E1](assets/phase7-strict-h1-boundary/boundary-a-figure.png) ![E2](assets/phase7-strict-h1-boundary/boundary-b-figure.png)

## Case F 文字加双图

before ![F1](assets/phase7-strict-h1-boundary/boundary-a-figure.png) middle ![F2](assets/phase7-strict-h1-boundary/boundary-b-figure.png)

## Case G 两个合法独立图片块

![G1](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

![G2](assets/phase7-strict-h1-boundary/boundary-b-figure.png)

## Case I 列表图片

- ![I](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

## Case J 引用图片

> ![J](assets/phase7-strict-h1-boundary/boundary-a-figure.png)

## Case I2 列表图片原位拆分

- 第一项
- ![I2](assets/phase7-strict-h1-boundary/boundary-a-figure.png)
- 第三项

## Case J2 引用文字与图片共存

> 前面的引用说明
>
> ![J2](assets/phase7-strict-h1-boundary/boundary-a-figure.png)
>
> 后面的引用说明

## Case K 标题未闭合图片语法

## 结束 ![K](https://raw.githubusercontent.com/inkchapter/fixture/main/assets/k.png

## Case L 标题多图含空路径

## 标题 ![L1](assets/phase7-strict-h1-boundary/boundary-a-figure.png) ![]()

## 结束

本 fixture 结束。
