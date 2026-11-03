/**
 * 引用状态与缓存决策（P4）。
 *
 * 三种存储状态只描述「真实可用落点」：
 * - LOCAL_ONLY：有永久本地副本，没有已验证远端。
 * - REMOTE_ONLY：有已验证远端，没有永久本地副本。
 * - DUAL_AVAILABLE：两者同时可用。
 *
 * 普通缓存永远不构成永久本地副本；缓存 + 远端仍算 REMOTE_ONLY。
 */

import {
  deriveStorageState,
  isPermanentLocalLocation,
  type AssetLocationRecord,
  type AssetStorageState,
  type ResolvedImageDestination,
} from './image-asset-model'
import type { ImageCacheMode } from './image-settings'

export type ReferenceDisplayState =
  | 'local'
  | 'remote'
  | 'dual'
  | 'cache-only'
  | 'unavailable'
  | 'non-file'

export interface ReferenceState {
  isRemoteReference: boolean
  hasPermanentLocal: boolean
  hasRemote: boolean
  hasCacheOnly: boolean
  storageState: AssetStorageState
  displayState: ReferenceDisplayState
}

export function resolveReferenceState(
  resolved: ResolvedImageDestination,
  locations: readonly AssetLocationRecord[],
): ReferenceState {
  const isRemoteReference = resolved.kind === 'remote'
  const hasPermanentLocal = locations.some(
    location => isPermanentLocalLocation(location) && location.availability === 'available',
  )
  const hasRemote = locations.some(
    location => location.type === 'github' && location.availability === 'available',
  )
  const hasCacheOnly = locations.some(
    location => location.type === 'cache' && location.availability === 'available',
  )

  let displayState: ReferenceDisplayState
  if (resolved.kind === 'data' || resolved.kind === 'unsupported') displayState = 'non-file'
  else if (hasPermanentLocal && hasRemote) displayState = 'dual'
  else if (hasPermanentLocal) displayState = 'local'
  else if (hasRemote) displayState = 'remote'
  else if (hasCacheOnly) displayState = 'cache-only'
  else displayState = 'unavailable'

  return {
    isRemoteReference,
    hasPermanentLocal,
    hasRemote,
    hasCacheOnly,
    storageState: deriveStorageState(locations),
    displayState,
  }
}

/**
 * 是否需要为该引用按需缓存：
 * - `off`：永不缓存，也不承诺离线。
 * - `manual`：只有用户显式指定才缓存。
 * - `smart`：远端图片、没有永久本地副本、尚未缓存时缓存。
 */
export function shouldCacheRemoteReference(input: {
  mode: ImageCacheMode
  state: ReferenceState
  explicit?: boolean
}): boolean {
  if (input.mode === 'off') return false
  if (!input.state.isRemoteReference) return false
  if (input.state.hasPermanentLocal || input.state.hasCacheOnly) return false
  if (input.mode === 'manual') return input.explicit === true
  return true
}
