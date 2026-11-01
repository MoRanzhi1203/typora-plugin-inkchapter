/**
 * 内容块工具栏 — 会话级折叠状态。
 *
 * 折叠只存在于当前会话：不写 Markdown、不写 Sidecar、不跨重启持久化。
 * 状态按**规范块身份**（cid → data-line → ordinal+签名）绑定；块消失或文档
 * 切换时清理，绝不把旧状态串绑到新块。
 */

export interface ContentBlockFoldEntry {
  key: string
  lineCount: number
  documentKey: string | null
}

export class ContentBlockToolbarSession {
  private readonly folds = new Map<string, ContentBlockFoldEntry>()

  /** 文档切换 / 卸载：丢弃全部折叠状态。 */
  reset(): void {
    this.folds.clear()
  }

  setFold(entry: ContentBlockFoldEntry): void {
    this.folds.set(entry.key, entry)
  }

  clearFold(key: string): boolean {
    return this.folds.delete(key)
  }

  isFolded(key: string): boolean {
    return this.folds.has(key)
  }

  getFold(key: string): ContentBlockFoldEntry | null {
    return this.folds.get(key) ?? null
  }

  /** 当前所有折叠条目（只读快照）。 */
  entries(): ContentBlockFoldEntry[] {
    return Array.from(this.folds.values())
  }

  get size(): number {
    return this.folds.size
  }

  /**
   * 丢弃不再存在的块（块被删除 / 文档重建）。返回被丢弃的 key。
   * `activeKeys` 必须是本轮真实存在的规范身份集合。
   */
  retain(activeKeys: ReadonlySet<string>): string[] {
    const removed: string[] = []
    for (const key of Array.from(this.folds.keys())) {
      if (!activeKeys.has(key)) {
        this.folds.delete(key)
        removed.push(key)
      }
    }
    return removed
  }
}
