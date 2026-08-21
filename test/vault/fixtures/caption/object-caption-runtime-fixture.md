# 对象题注 Runtime Fixture

这是一个用于验证表格、图片、代码块题注功能的专用测试文档。

## 说明段落

本文档包含多个表格、图片和代码块，用于验证题注的独立编号、命名、位置与动态刷新。

## 表格区

### 表格 A

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键 |
| name | text | 名称 |

### 表格 B

| 名称 | 数量 |
|------|------|
| 苹果 | 3 |
| 香蕉 | 5 |

## 图片区

![架构图](https://example.com/arch.png)

![流程图](https://example.com/flow.png)

## 代码区

```js
function init() {
  console.log("初始化")
}
```

```python
def load():
    return "data"
```

## 公式区

$$
a + b
$$

## 混合区

### 表格 C

| 状态 | 值 |
|------|----|
| 完成 | true |

```ts
export function run(): void {
  console.log("run")
}
```
