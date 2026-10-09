/**
 * Ribbon 可见性 —— 原生侧栏恢复的**纯状态助手**。
 *
 * 设计约束（见 docs/prompts/pending/TRAE-INKCHAPTER-TYPORA-FREEZE-RIBBON-RUNTIME-CLOSURE.md B1）：
 *  1. 墨章**只**写自己命名空间下的 `body.inkchapter-ribbon-hidden`；
 *  2. **绝不**写框架持有的 `body.typ-ribbon--enable`（原生切页栏与侧栏布局改由
 *     style.scss 在该框架类仍然存在时，用墨章命名空间的 CSS 恢复）；
 *  3. 值未变化时**不产生任何 DOM 写入**（幂等）⇒ 不产生 MutationRecord，
 *     不与任何观察者形成“写—观察”反馈环；
 *  4. 该模块不注册任何观察器、定时器或事件监听。
 */

/** 墨章自己的状态类（唯一写入目标）。 */
export const INKCHAPTER_RIBBON_HIDDEN_CLASS = 'inkchapter-ribbon-hidden'

/** 框架持有的 Ribbon 模式类。墨章**只读**它，永不写入。 */
export const FRAMEWORK_RIBBON_ENABLE_CLASS = 'typ-ribbon--enable'

/**
 * 是否隐藏框架 Ribbon（= 保持原生侧栏）。
 *
 * **只有显式 `true` 才使用框架 Ribbon**；`false` / 缺省 / 未定义一律保持原生侧栏
 * （fail-native：配置缺失时也绝不让窗口退回“社区插件外观”）。
 */
export function resolveRibbonHidden(ribbon: boolean | undefined): boolean {
  return ribbon !== true
}

/**
 * 幂等地应用墨章自己的隐藏类。
 *
 * @returns 是否发生了**真实 DOM 写入**（未变化时为 false，且不调用 classList）。
 */
export function applyRibbonHiddenClass(body: HTMLElement, hidden: boolean): boolean {
  if (body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS) === hidden) return false
  body.classList.toggle(INKCHAPTER_RIBBON_HIDDEN_CLASS, hidden)
  return true
}

/** 只读快照：当前是否隐藏、框架类是否仍在（全部为纯读取，无写入）。 */
export function readRibbonState(body: HTMLElement): {
  inkchapterHidden: boolean
  frameworkRibbonEnabled: boolean
} {
  return {
    inkchapterHidden: body.classList.contains(INKCHAPTER_RIBBON_HIDDEN_CLASS),
    frameworkRibbonEnabled: body.classList.contains(FRAMEWORK_RIBBON_ENABLE_CLASS),
  }
}
