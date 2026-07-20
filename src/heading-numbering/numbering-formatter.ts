import type { NumberedHeading, HeadingNumberingSettings } from './heading-types'

/**
 * Format numbering result into display labels.
 * Labels are computed by the engine; the formatter simply extracts them.
 */
export function formatNumberedHeadings(
  headings: NumberedHeading[],
  _settings: HeadingNumberingSettings,
): string[] {
  return headings.map((h) => h.label)
}

export interface NumberingFormatter {
  format(headings: NumberedHeading[], settings: HeadingNumberingSettings): string[]
}

export const decimalHierarchicalFormatter: NumberingFormatter = {
  format: formatNumberedHeadings,
}
