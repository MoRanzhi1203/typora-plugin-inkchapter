export type DisposeFunc = () => void

/**
 * A simple store for disposable cleanup functions.
 * Call dispose() to invoke all registered functions and clear the store.
 */
export class DisposableStore {
  private disposables: DisposeFunc[] = []

  /** Register a cleanup function. Returns a function to unregister it. */
  add(fn: DisposeFunc): DisposeFunc {
    this.disposables.push(fn)
    return () => {
      const idx = this.disposables.indexOf(fn)
      if (idx !== -1) {
        this.disposables.splice(idx, 1)
        fn()
      }
    }
  }

  /** Invoke all disposables and clear the store. */
  dispose(): void {
    const fns = this.disposables.splice(0)
    for (const fn of fns.reverse()) {
      try {
        fn()
      } catch (e) {
        console.error('[InkChapter] Error during disposal:', e)
      }
    }
  }

  /** Number of registered disposables. */
  get size(): number {
    return this.disposables.length
  }
}
