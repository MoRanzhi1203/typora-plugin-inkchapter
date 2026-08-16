# Figure Alt 写回与路径投影 Fixture

用于验证：图片图名写回 Markdown alt、重复图片 occurrence 命中、路径 display 投影，以及 Caption label 单空格。

## encoded local path（未命名）

![](../../Downloads/ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5%2013_38_00.png)

## 已有图名 + encoded local path

![已有图名](../../Downloads/ChatGPT%20Image%20%E4%B8%AD%E6%96%87.png)

## duplicate image（两个相同 src，验证只改第二个 occurrence）

![](same.png)

![](same.png)

## HTTP URL

![HTTP](https://example.com/a%20b.png)
