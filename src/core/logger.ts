const PREFIX = '[InkChapter]'

function shouldLog(level: 'debug'): boolean {
  return false // production: no debug output by default
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.debug(`${PREFIX} ${message}`, ...args)
  }
}

export function info(message: string, ...args: unknown[]): void {
  console.info(`${PREFIX} ${message}`, ...args)
}

export function warn(message: string, ...args: unknown[]): void {
  console.warn(`${PREFIX} ${message}`, ...args)
}

export function error(message: string, ...args: unknown[]): void {
  console.error(`${PREFIX} ${message}`, ...args)
}
