# Figure 右键图名写回 + 本地路径规范化 Fixture

用于验证：右键图片/Caption 写回 Markdown alt、本地 percent-encoded path 规范化为中英文可读、duplicate occurrence、remote URL 不被误改。

## encoded local path（未命名）

![](../../Downloads/ChatGPT%20Image%202026%E5%B9%B48%E6%9C%8814%E6%97%A5%2013_39_53.png)

## 已有图名 + encoded local path

![已有图名](../../Downloads/ChatGPT%20Image%20%E4%B8%AD%E6%96%87.png)

## duplicate image（两个相同 src，验证只改第二个 occurrence）

![](same.png)

![](same.png)

## HTTP URL（禁止本地 normalize）

![HTTP](https://example.com/a%20b.png)
