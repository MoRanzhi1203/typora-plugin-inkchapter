import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from './default-settings'

describe('DEFAULT_SETTINGS', () => {
  const levels = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault.levels
  const customDefinition = DEFAULT_SETTINGS.headingNumberingScopes!.globalDefault.customDefinition!

  it('levels[2] !== customDefinition[2] (different objects)', () => {
    expect(levels).not.toBe(customDefinition)
    expect(levels[2]).not.toBe(customDefinition[2])
  })

  it('levels[2].formatVariants !== customDefinition[2].formatVariants (different arrays)', () => {
    expect(levels[2].formatVariants).not.toBe(customDefinition[2].formatVariants)
    expect(levels[2].formatVariants.withLevelOne).not.toBe(
      customDefinition[2].formatVariants.withLevelOne,
    )
    expect(levels[2].formatVariants.withoutLevelOne).not.toBe(
      customDefinition[2].formatVariants.withoutLevelOne,
    )
  })

  it('Modifying levels does not affect customDefinition', () => {
    const originalEnabled = customDefinition[2].enabled

    // Modify levels[2]
    levels[2].enabled = !originalEnabled

    // customDefinition should be unaffected
    expect(customDefinition[2].enabled).toBe(originalEnabled)

    // Restore
    levels[2].enabled = originalEnabled
  })
})
