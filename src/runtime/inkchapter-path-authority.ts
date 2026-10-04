// ── Block-Gap Transaction Closure V1.1-GLOBAL — Path Authority ───────────────
// InkChapter is a Typora USER-LEVEL plugin (one global install → any Markdown
// path), NOT a per-vault plugin. This module splits the path authorities so a
// single `vaultRoot` never stands in for plugin/install/resource/document roots.
//
// IMPORTANT: no absolute user/project path is hardcoded here. The OS user home
// is INJECTED; only the framework-standard relative layout and the plugin id are
// constants (per the global-closure spec §1).

/** The framework-standard global install layout (relative to the OS user home). */
export const GLOBAL_PLUGIN_LAYOUT = '.typora/community-plugins/plugins'
/** The InkChapter plugin id (manifest folder name). */
export const INKCHAPTER_PLUGIN_ID = 'ranzhi.inkchapter'

export type InkChapterPluginLoadMode = 'global' | 'test-vault' | 'unknown'

export type InstallRootAuthority =
  | 'FRAMEWORK_REPORTED'
  | 'USER_HOME_COMMUNITY_PLUGINS'
  | 'UNRESOLVED'

export interface InkChapterPathAuthorityInput {
  /** OS user home (injected — never hardcoded). */
  userHome: string | null
  /** Absolute install root reported by the framework, when it exposes one. */
  reportedInstallRoot: string | null
  /** Absolute path of the active document, when there is one. */
  documentPath: string | null
  /** Workspace root (may be null — single-file mode). */
  workspaceRoot: string | null
  /** Vault root (may be null — a folder without `.typora`). */
  vaultRoot: string | null
  /** Does `<documentDir>/.typora` exist? */
  localDotTyporaPresent: boolean
  /** Does `<documentDir>/.typora/plugins/<id>` exist? */
  localInkChapterPluginPresent: boolean
}

export interface InkChapterPathAuthority {
  pluginLoadMode: InkChapterPluginLoadMode
  installRootAuthority: InstallRootAuthority
  globalPluginRoot: string | null
  globalManifestPath: string | null
  globalMainPath: string | null
  globalStylePath: string | null
  documentPath: string | null
  documentDir: string | null
  workspaceRoot: string | null
  vaultRoot: string | null
  localDotTyporaPresent: boolean
  localInkChapterPluginPresent: boolean
}

/** Normalise a path to forward slashes without a trailing separator. */
export function normalizeAuthorityPath(p: string | null | undefined): string | null {
  if (p == null) return null
  const t = p.trim()
  if (t === '') return null
  return t.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** The directory of a document path (document-centric resource base, §9). */
export function resolveDocumentDirectory(documentPath: string | null): string | null {
  const n = normalizeAuthorityPath(documentPath)
  if (n == null) return null
  const i = n.lastIndexOf('/')
  if (i < 0) return null
  return i === 0 ? '/' : n.slice(0, i)
}

/**
 * Resolve the split path authorities. `vaultRoot` / `workspaceRoot` are allowed
 * to be null: a document outside any vault MUST still resolve a usable authority
 * (single-file mode §7, nested folders §8).
 */
export function resolveInkChapterPathAuthority(
  input: InkChapterPathAuthorityInput,
): InkChapterPathAuthority {
  const reported = normalizeAuthorityPath(input.reportedInstallRoot)
  const home = normalizeAuthorityPath(input.userHome)
  const fromHome = home == null ? null : `${home}/${GLOBAL_PLUGIN_LAYOUT}/${INKCHAPTER_PLUGIN_ID}`

  let globalPluginRoot: string | null = null
  let installRootAuthority: InstallRootAuthority = 'UNRESOLVED'
  if (reported != null) {
    globalPluginRoot = reported
    installRootAuthority = 'FRAMEWORK_REPORTED'
  } else if (fromHome != null) {
    globalPluginRoot = fromHome
    installRootAuthority = 'USER_HOME_COMMUNITY_PLUGINS'
  }

  const documentDir = resolveDocumentDirectory(input.documentPath)
  const workspaceRoot = normalizeAuthorityPath(input.workspaceRoot)
  const vaultRoot = normalizeAuthorityPath(input.vaultRoot)

  // Load mode is decided by the OBSERVED facts, never by where the document is:
  // a local vault install wins only when it actually exists.
  let pluginLoadMode: InkChapterPluginLoadMode = 'unknown'
  if (input.localInkChapterPluginPresent) pluginLoadMode = 'test-vault'
  else if (globalPluginRoot != null) pluginLoadMode = 'global'

  return {
    pluginLoadMode,
    installRootAuthority,
    globalPluginRoot,
    globalManifestPath: globalPluginRoot == null ? null : `${globalPluginRoot}/manifest.json`,
    globalMainPath: globalPluginRoot == null ? null : `${globalPluginRoot}/main.js`,
    globalStylePath: globalPluginRoot == null ? null : `${globalPluginRoot}/style.css`,
    documentPath: normalizeAuthorityPath(input.documentPath),
    documentDir,
    workspaceRoot,
    vaultRoot,
    localDotTyporaPresent: input.localDotTyporaPresent,
    localInkChapterPluginPresent: input.localInkChapterPluginPresent,
  }
}

/** §14 — the `INKCHAPTER-GLOBAL-LOAD-AUDIT` payload. */
export interface InkChapterGlobalLoadAudit {
  pluginLoadMode: InkChapterPluginLoadMode
  pluginInstallRoot: string | null
  installRootAuthority: InstallRootAuthority
  documentPath: string | null
  documentDir: string | null
  workspaceRoot: string | null
  vaultRoot: string | null
  localDotTyporaPresent: boolean
  localInkChapterPluginPresent: boolean
  globalPluginLoaded: boolean
  initializationCount: number
  decision: 'PASS' | 'FAIL'
  reason: string
}

export function buildInkChapterGlobalLoadAudit(
  authority: InkChapterPathAuthority,
  globalPluginLoaded: boolean,
  initializationCount: number,
): InkChapterGlobalLoadAudit {
  const decision: 'PASS' | 'FAIL' = globalPluginLoaded ? 'PASS' : 'FAIL'
  return {
    pluginLoadMode: authority.pluginLoadMode,
    pluginInstallRoot: authority.globalPluginRoot,
    installRootAuthority: authority.installRootAuthority,
    documentPath: authority.documentPath,
    documentDir: authority.documentDir,
    workspaceRoot: authority.workspaceRoot,
    vaultRoot: authority.vaultRoot,
    localDotTyporaPresent: authority.localDotTyporaPresent,
    localInkChapterPluginPresent: authority.localInkChapterPluginPresent,
    globalPluginLoaded,
    initializationCount,
    decision,
    reason: globalPluginLoaded
      ? (authority.localInkChapterPluginPresent
        ? 'GLOBAL_PLUGIN_LOADED_IN_TEST_VAULT_MODE'
        : 'GLOBAL_PLUGIN_LOADED_WITHOUT_LOCAL_DOT_TYPORA')
      : 'GLOBAL_PLUGIN_NOT_LOADED',
  }
}

/** §6 — the frozen DocumentContext field set. `vaultRoot` MAY be null. */
export interface InkChapterDocumentContext {
  documentPath: string | null
  documentDir: string | null
  workspaceRoot: string | null
  vaultRoot: string | null
  pluginInstallRoot: string | null
  pluginLoadMode: InkChapterPluginLoadMode
}

/** Project the resolved path authority onto the service-level DocumentContext. */
export function toInkChapterDocumentContext(
  authority: InkChapterPathAuthority,
): InkChapterDocumentContext {
  return {
    documentPath: authority.documentPath,
    documentDir: authority.documentDir,
    workspaceRoot: authority.workspaceRoot,
    vaultRoot: authority.vaultRoot,
    pluginInstallRoot: authority.globalPluginRoot,
    pluginLoadMode: authority.pluginLoadMode,
  }
}

// ── Hard-gate labels (all must stay 0) ──────────────────────────────────────
export const GLOBAL_LOAD_HARD_GATE_LABELS = [
  'PLUGIN_INITIALIZATION_REQUIRES_LOCAL_DOT_TYPORA_COUNT',
  'PLUGIN_INITIALIZATION_REQUIRES_TEST_VAULT_COUNT',
  'PLUGIN_INITIALIZATION_REQUIRES_PROJECT_ROOT_COUNT',
  'GLOBAL_PLUGIN_ABSOLUTE_USER_PATH_HARDCODE_COUNT',
  'GLOBAL_PLUGIN_PROJECT_PATH_HARDCODE_COUNT',
  'PLUGIN_GLOBAL_MODE_IMPLEMENTED_BY_PER_FOLDER_COPY_COUNT',
  'PLUGIN_GLOBAL_MODE_IMPLEMENTED_BY_PER_FOLDER_SYMLINK_COUNT',
  'PLUGIN_GLOBAL_MODE_RECURSIVE_PATH_SCAN_COUNT',
  'PLUGIN_INSTALL_ROOT_AND_DOCUMENT_ROOT_CONFLATED_COUNT',
  'WORKSPACE_ROOT_AND_PLUGIN_ROOT_CONFLATED_COUNT',
  'DOCUMENT_DIR_AND_VAULT_ROOT_CONFLATED_COUNT',
  'PLUGIN_LOAD_DEPENDS_ON_WORKSPACE_SETTINGS_FILE_COUNT',
  'GLOBAL_PLUGIN_FAILED_IN_NESTED_FOLDER_COUNT',
  'GLOBAL_PLUGIN_FAILED_WITHOUT_LOCAL_DOT_TYPORA_COUNT',
  'GLOBAL_PLUGIN_FAILED_IN_SINGLE_FILE_MODE_COUNT',
  'GLOBAL_PLUGIN_FAILED_ON_SPACE_PATH_COUNT',
  'GLOBAL_PLUGIN_FAILED_ON_UNICODE_PATH_COUNT',
  'GLOBAL_PLUGIN_CROSS_WINDOW_DOCUMENT_STATE_LEAK_COUNT',
  'GLOBAL_PLUGIN_CROSS_WINDOW_DIAGNOSTIC_STATE_LEAK_COUNT',
  'GLOBAL_PLUGIN_DUPLICATE_INITIALIZATION_COUNT',
  'GLOBAL_DEPLOY_MAIN_SHA_MISMATCH_COUNT',
  'GLOBAL_DEPLOY_STYLE_SHA_MISMATCH_COUNT',
] as const

export type GlobalLoadHardGateLabel = (typeof GLOBAL_LOAD_HARD_GATE_LABELS)[number]
