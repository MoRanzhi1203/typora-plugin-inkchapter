/**
 * 模式契约修复 — FILL_ONLY 验收必须**按视觉类型**判定。
 *
 * Runtime FAIL（已取证）：
 *   ruleId=DOCUMENT_TERMINAL_NEWLINE_MISSING / visualTargetKind=synthetic-eof
 *   presentationMode=FILL_ONLY / fillCount=0
 *   pluginOwnedGateFailing=["PLUGIN_OWNED_FILL_MISSING"]
 *   reason=SYNTHETIC_EOF_VISUAL_NOT_VISIBLE / visualOutcome=ROLLED_BACK
 *
 * 根因：EOF 采用「端点式（无填充）」后，通用 FILL_ONLY 门仍要求 pluginOwnedFillCount>=1，
 * 于是合法的端点标记被误杀并回滚。修复：端点形态由自身「已连接 + 可见」验收，
 * **绝不**为了过旧门而重新给 EOF 加大面积背景填充。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  emptyFillOnlyOwnershipFacts,
  evaluateFillOnlyOwnershipGate,
} from './document-diagnostic-presentation-epoch-policy'

describe('模式契约 — EOF 端点合法无填充不被 FILL_ONLY 门禁误杀', () => {
  it('endpoint form: fillCount=0 不再是失败', () => {
    const facts = { ...emptyFillOnlyOwnershipFacts(), pluginOwnedFillCount: 0 }
    // 通用（非端点）路径仍然要求填充
    expect(evaluateFillOnlyOwnershipGate(facts, true).decision).toBe('FAIL')
    expect(evaluateFillOnlyOwnershipGate(facts, true).failing).toContain('PLUGIN_OWNED_FILL_MISSING')
    // 端点形态：无填充合法
    expect(evaluateFillOnlyOwnershipGate(facts, true, { endpointForm: true }).decision).toBe('PASS')
    expect(evaluateFillOnlyOwnershipGate(facts, true, { endpointForm: true }).failing)
      .not.toContain('PLUGIN_OWNED_FILL_MISSING')
  })

  it('端点形态仍必须对「插件自有装饰」失败（不得放松其它项）', () => {
    const facts = {
      ...emptyFillOnlyOwnershipFacts(),
      pluginOwnedFillCount: 0,
      pluginOwnedBorderCount: 1,
    }
    expect(evaluateFillOnlyOwnershipGate(facts, true, { endpointForm: true }).decision).toBe('FAIL')
  })

  it('非端点定位 fillCount=0 仍 FAIL（视觉提交失败不得被 PASS 掩盖）', () => {
    const facts = { ...emptyFillOnlyOwnershipFacts(), pluginOwnedFillCount: 0 }
    expect(evaluateFillOnlyOwnershipGate(facts, true).decision).toBe('FAIL')
  })

  it('overlay host 已把端点形态判定接入门禁与最终 decision', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/document-utilities/document-utility-overlay-host.ts'), 'utf8')
    expect(src).toContain('findEndpointFormCarrier')
    expect(src).toContain('endpointForm: endpointFormValid')
    expect(src).toContain('const fillSatisfied = fillOk || endpointFormValid')
    // 最终 decision 必须消费 fillSatisfied（而不是旧的 fillOk）
    expect(src).toContain('!fillSatisfied || gate.decision')
  })
})
