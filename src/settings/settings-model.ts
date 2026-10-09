import type { HeadingNumberingSettings, HeadingLevelRangeSettings, SpecialHeadingNumberingSettings, HeadingNumberingScopeStore, FormatLibrary } from '../heading-numbering/heading-types'
import type { CaptionSettings } from '../heading-numbering/caption-system'

export type { HeadingNumberingSettings }

/** 标签右键菜单里墨章扩展项的显隐（原生项永不受影响）。 */
export interface DocViewMenuItemSettings {
  /** 关闭全部标签 */
  closeAll: boolean
  /** 复制完整路径 */
  copyAbsolute: boolean
  /** 复制相对路径 */
  copyRelative: boolean
  /** 在文件树中定位 */
  revealTree: boolean
  /** 在文件资源管理器中显示 */
  revealExplorer: boolean
}

/**
 * 墨章「界面 / 文件夹树」配置（可选字段，缺失即用默认值）。
 *
 * 这些开关只控制墨章自己的增强：原生 Typora 的文件树 / 大纲 DOM 与状态永不被改写。
 */
export interface InkChapterUiSettings {
  /** 文件树定位：定位成功后在目标节点上闪一下高亮（只加临时类，不改原生状态）。 */
  fileTreeLocateFlash: boolean
  /** 空工作区：在空白编辑区双击创建并打开一个 .md。 */
  emptyWorkspaceCreate: boolean
  /** 标签右键菜单里墨章扩展项的显隐。 */
  docViewMenu: DocViewMenuItemSettings
  /** 显示社区框架的左侧 Ribbon（`.typ-ribbon`）；false 仅由墨章隐藏，不改框架配置。 */
  ribbon: boolean
}

export interface InkChapterSettings {
  /** Schema version for migration. Current: 11 */
  schemaVersion: number
  debug: boolean
  /** @deprecated Migrated to headingNumberingScopes.globalDefault. Kept for migration compatibility. */
  headingNumbering?: HeadingNumberingSettings
  /** New scope-aware heading numbering store (schema version >= 10). */
  headingNumberingScopes?: HeadingNumberingScopeStore
  /** User-managed custom format library (schema version >= 11). */
  formatLibrary?: FormatLibrary
  levelRange: HeadingLevelRangeSettings
  specialNumbering: SpecialHeadingNumberingSettings
  /** Caption System V1 settings (schema version >= 12, optional field). */
  caption?: CaptionSettings
  /** 界面 / 文件夹树 设置（可选字段，缺失时按 DEFAULT_UI_SETTINGS 补齐）。 */
  ui?: InkChapterUiSettings
}
