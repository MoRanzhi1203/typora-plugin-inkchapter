// @vitest-environment jsdom
/**
 * Ribbon 原生侧栏恢复 —— 状态机契约 / 幂等性 / 无观察器 / 无框架类争夺 /
 * CSS 可达性 / 原生数值来源核对。
 *
 * 对应任务文档 C1（状态机与 observer 契约）、C2（模拟框架争用）、B1.4/B1.6。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FRAMEWORK_RIBBON_ENABLE_CLASS,
  INKCHAPTER_RIBBON_HIDDEN_CLASS,
  applyRibbonHiddenClass,
  readRibbonState,
  resolveRibbonHidden,
} from './ribbon-visibility'
import { DEFAULT_UI_SETTINGS } from './default-settings'

const mainSrc = (): string => readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')
const moduleSrc = (): string => readFileSync(resolve(process.cwd(), 'src/settings/ribbon-visibility.ts'), 'utf8')
const styleScss = (): string => readFileSync(resolve(process.cwd(), 'src/style.scss'), 'utf8')
const TYPORA_WINDOW_CSS = 'D:\\Typora\\resources\\style\\window.css'

async function nextMicrotask(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  document.body.className = ''
})

describe('C1.1 — 默认使用原生侧栏', () => {
  it('resolveRibbonHidden: 仅显式 true 才使用框架 Ribbon', () => {
    expect(resolveRibbonHidden(undefined)).toBe(true) // 缺省 ⇒ 隐藏（原生）
    expect(resolveRibbonHidden(false)).toBe(true)
    expect(resolveRibbonHidden(true)).toBe(false)
  })

  it('DEFAULT_UI_SETTINGS.ribbon = false ⇒ 任何文件夹默认原生侧栏', () => {
    expect(DEFAULT_UI_SETTINGS.ribbon).toBe(false)
    expect(resolveRibbonHidden(DEFAULT_UI_SETTINGS.ribbon)).toBe(true)
  })
})

describe('C1.2 — 幂等：状态不变时零 DOM 写入', () => {
  it('首次写入 true，重复应用不再产生任何 MutationRecord', async () => {
    const records: MutationRecord[] = []
    const mo = new MutationObserver(rs => records.push(...rs))
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    expect(applyRibbonHiddenClass(document.body, true)).toBe(true)
    await nextMicrotask()
    const afterFirst = records.length
    expect(afterFirst).toBeGreaterThan(0)

    for (let i = 0; i < 10; i++) applyRibbonHiddenClass(document.body, true)
    await nextMicrotask()
    expect(records.length).toBe(afterFirst) // 无新增变化 ⇒ 不会被观察者再次唤醒
    mo.disconnect()
  })

  it('读取快照为纯读：不改变状态', () => {
    applyRibbonHiddenClass(document.body, true)
    const before = document.body.className
    const s = readRibbonState(document.body)
    expect(s.inkchapterHidden).toBe(true)
    expect(document.body.className).toBe(before)
  })
})

describe('C1.6 / C2 — 其它 body 类高频变化 / 模拟框架争用', () => {
  it('框架先置 typ-ribbon--enable，墨章不写该框架类、也不被其变化带走', async () => {
    document.body.classList.add(FRAMEWORK_RIBBON_ENABLE_CLASS)
    expect(applyRibbonHiddenClass(document.body, true)).toBe(true)
    // 框架类必须保持不动（墨章永不写它）
    expect(document.body.classList.contains(FRAMEWORK_RIBBON_ENABLE_CLASS)).toBe(true)
    expect(document.body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS)).toBe(true)
  })

  it('模拟框架反复改写框架类：墨章写入次数有上界（≤1）', async () => {
    let ourWrites = 0
    // 框架交替设置/清除自己的类，期间反复触发墨章的应用动作
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) document.body.classList.add(FRAMEWORK_RIBBON_ENABLE_CLASS)
      else document.body.classList.remove(FRAMEWORK_RIBBON_ENABLE_CLASS)
      if (applyRibbonHiddenClass(document.body, true)) ourWrites++
    }
    expect(ourWrites).toBe(1) // 只有第一次是真实写入，之后全部为 0 写入
    expect(document.body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS)).toBe(true)
  })

  it('arbitrary body 类高频变化不会让墨章产生任何写入', async () => {
    applyRibbonHiddenClass(document.body, true)
    let writes = 0
    for (let i = 0; i < 50; i++) {
      document.body.classList.add(`churn-${i % 3}`)
      document.body.classList.remove(`churn-${(i + 1) % 3}`)
      if (applyRibbonHiddenClass(document.body, true)) writes++
    }
    expect(writes).toBe(0)
  })

  it('ribbon-visibility 模块不含任何观察器 / 定时器 / 事件监听', () => {
    const src = moduleSrc()
    expect(src).not.toContain('MutationObserver')
    expect(src).not.toContain('ResizeObserver')
    expect(src).not.toContain('setInterval')
    expect(src).not.toContain('requestAnimationFrame')
    expect(src).not.toContain('addEventListener')
    // 永不写入框架类：该常量只允许出现在只读判断 classList.contains(...) 中
    expect(src).not.toMatch(/classList\.(add|remove|toggle)\(\s*FRAMEWORK_RIBBON_ENABLE_CLASS/)
  })
})

describe('C1.4 — false → true → false 双向切换一致', () => {
  it('每次真实状态变化恰好 1 次写入，且无半失效状态', () => {
    let writes = 0
    const seq = [true, true, false, false, true]
    for (const hidden of seq) if (applyRibbonHiddenClass(document.body, hidden)) writes++
    expect(writes).toBe(3) // true(写) / true(0) / false(写) / false(0) / true(写)
    expect(document.body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS)).toBe(true)

    applyRibbonHiddenClass(document.body, false)
    expect(document.body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS)).toBe(false)
    // 打开 Ribbon 时，框架类始终由框架持有，墨章不介入 ⇒ 无半失效状态
    expect(mainSrc()).not.toContain(`classList.remove('${FRAMEWORK_RIBBON_ENABLE_CLASS}')`)
  })
})

describe('C1.5 — main.ts 契约：无 Ribbon 长期观察器', () => {
  it('不再注册 body.class MutationObserver，也不再争夺框架类', () => {
    const src = mainSrc()
    expect(src).not.toContain('new MutationObserver')
    expect(src).not.toContain('enforceRibbonVisibility')
    expect(src).not.toContain('attributeFilter')
    // 只保留有界心跳取证（3 次一次性计时器）
    expect(src).toContain('emitResponsiveHeartbeats')
    expect(src).toContain('INKCHAPTER-UI-RESPONSIVE-HEARTBEAT')
  })
})

describe('C1.7 / B1.4 — CSS 可达性：原生切页栏与布局恢复', () => {
  it('四条命名空间规则齐备且都带 !important', () => {
    const css = styleScss()
    expect(css).toMatch(/body\.inkchapter-ribbon-hidden\s*\{[\s\S]{0,80}--typ-ribbon-width:\s*0px\s*!important/)
    expect(css).toMatch(/body\.inkchapter-ribbon-hidden \.typ-ribbon\s*\{[\s\S]{0,60}display:\s*none\s*!important/)
    expect(css).toMatch(
      /body\.inkchapter-ribbon-hidden\.typ-ribbon--enable \.info-panel-tab-wrapper\s*\{[\s\S]{0,60}display:\s*flex\s*!important/,
    )
    expect(css).toMatch(
      /body\.inkchapter-ribbon-hidden\.typ-ribbon--enable\.typora-node \.sidebar-content\s*\{[\s\S]{0,60}top:\s*64px\s*!important/,
    )
    expect(css).toMatch(
      /body\.inkchapter-ribbon-hidden\.typ-ribbon--enable\.typora-node\.native-window \.sidebar-content\s*\{[\s\S]{0,60}top:\s*54px\s*!important/,
    )
  })

  it('所有规则都限定在墨章命名空间下（不以 .typ-ribbon--enable 单独改写全局）', () => {
    const css = styleScss()
    // 不得出现“单独针对框架类”的裸覆盖（必须以 body.inkchapter-ribbon-hidden 前缀出现）
    const bareFramework = css.match(/^\s*\.typ-ribbon--enable[^{]*\{/gm) ?? []
    expect(bareFramework).toHaveLength(0)
  })
})

describe('B1.6 — 原生数值来源核对（本机 Typora window.css）', () => {
  const hasLocal = existsSync(TYPORA_WINDOW_CSS)
  it.skipIf(!hasLocal)('引用的 display/top 数值与本机 Typora 原生 CSS 一致', () => {
    const css = readFileSync(TYPORA_WINDOW_CSS, 'utf8')
    expect(css).toMatch(/\.info-panel-tab-wrapper\{[^}]*display:flex/)
    expect(css).toMatch(/\.sidebar-content\{[^}]*top:64px/)
    expect(css).toMatch(/\.native-window \.sidebar-content\{top:54px\}/)
  })
})
