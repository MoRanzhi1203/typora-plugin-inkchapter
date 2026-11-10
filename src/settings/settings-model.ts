import type { HeadingNumberingSettings, HeadingLevelRangeSettings, SpecialHeadingNumberingSettings, HeadingNumberingScopeStore, FormatLibrary } from '../heading-numbering/heading-types'
import type { CaptionSettings } from '../heading-numbering/caption-system'
import type { ImageSettings } from '../image-management/image-settings'

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
  /**
   * 是否使用社区框架的左侧 Ribbon（**默认 false = 保持 Typora 原生侧栏**）。
   *
   * false 时墨章**不修改任何框架状态**（不写 `typ-ribbon--enable`，不写 core.json），
   * 只加自己的 `body.inkchapter-ribbon-hidden`，由墨章命名空间的 CSS 恢复原生
   * 「文件 / 搜索 / 大纲」切页栏与侧栏布局 ⇒ 任何文件夹下都保持原生外观。
   */
  ribbon: boolean
  /**
   * 代码块预览式折叠保留的逻辑行数（V3）。
   * 仅影响「超过该行数」的代码块；短代码始终完整显示。
   */
  codeBlockPreviewLines: 5 | 10
  /**
   * 折叠代码块内的文本真正发生变化时（输入 / 空格 / Tab / 删除 / 粘贴），
   * 是否自动完整展开。默认 true；关闭后只能通过顶部展开按钮或诊断定位展开。
   * 纯点击、选中、光标移动不改变折叠状态。
   */
  codeBlockAutoExpandOnEdit: boolean
  /** B3 — diagnostic profile (general / academic / lab-report / custom). */
  diagnosticProfile: 'general' | 'academic' | 'lab-report' | 'custom'
  /** B3 — academic content width preset. */
  academicWidthPreset: 'narrow' | 'standard' | 'wide' | 'lab-report' | 'custom'
  /** B3 — custom content width (used when preset is custom; clamped). */
  academicCustomWidthPx: number
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
  /** 图片管理配置（可选字段，缺失或非法时由 resolveImageSettings 补齐）。 */
  image?: ImageSettings
}
