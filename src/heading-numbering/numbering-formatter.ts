import type { NumberedHeading, HeadingNumberingSettings } from './heading-types'

/**
 * Format numbering result into display labels.
 * Currently only supports "decimal-hierarchical" format.
 */
export function formatNumberedHeadings(
  headings: NumberedHeading[],
  settings: HeadingNumberingSettings,
): string[] {
  return headings.map((h) =>
    h.counters.join(settings.separator) + settings.suffix,
  )
}

/**
 * Interface for future formatter presets.
 * Extensions: 中文编号 / 自定义模板 will implement this.
 */
export interface NumberingFormatter {
  format(headings: NumberedHeading[], settings: HeadingNumberingSettings): string[]
}

/** Default formatter: decimal-hierarchical. */
export const decimalHierarchicalFormatter: NumberingFormatter = {
  format: formatNumberedHeadings,
}
