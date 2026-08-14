import { captureRuntimeLogTimestamp, formatRuntimeLogTimestamp } from '../runtime/runtime-log-timestamp'

const PREFIX = '[InkChapter]'

function shouldLog(level: 'debug'): boolean {
  return false // production: no debug output by default
}

/**
 * Prefix an InkChapter console message with a single `[ISO][epoch]` timestamp.
 * Multi-line messages are split so every PHYSICAL line carries the timestamp.
 * All lines of one call share the same tsIso/tsEpochMs capture.
 */
function timestamped(message: string): string {
  const ts = formatRuntimeLogTimestamp(captureRuntimeLogTimestamp())
  return message
    .split('\n')
    .map(line => `${ts}${PREFIX} ${line}`)
    .join('\n')
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.debug(timestamped(message), ...args)
  }
}

export function info(message: string, ...args: unknown[]): void {
  console.info(timestamped(message), ...args)
}

export function warn(message: string, ...args: unknown[]): void {
  console.warn(timestamped(message), ...args)
}

export function error(message: string, ...args: unknown[]): void {
  console.error(timestamped(message), ...args)
}
