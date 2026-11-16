# R10 图表代码公式编号运行时验收

## 第一章 系统设计

本章用于验证图题接管、表格题注、代码题注与公式编号的源码持久化。

![系统架构图](../../assets/image-20261103215400185.png)

图 9-9 系统架构图

![处理流程](../../assets/image-20261103215644436.png)

表 1-1 模块状态

| 模块 | 状态 |
|---|---|
| 采集 | 完成 |
| 计算 | 进行中 |

代码 1-1 数据读取程序

```python
import pandas as pd

df = pd.read_csv("data.csv")
print(df.head())
```

$$
E = mc^2
$$

（9-9）

## 第二章 实验结果

本章用于验证章节变化后的编号联动。

![实验结果](../../assets/image-20261103215650169.png)

表 7-7 实验结果

| 方法 | 准确率 |
|---|---|
| A | 95% |
| B | 97% |

```js
const result = compute()
console.log(result)
```

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
\tag{9-9}
$$

$$
x^2 + y^2 = z^2
$$
