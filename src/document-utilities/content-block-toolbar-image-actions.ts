/**
 * 图片"更多操作"可用性（纯函数）。
 *
 * 只声明当前图片真实具备的动作：
 * - 本地路径：解析出的绝对文件路径；
 * - 云端链接：http(s) 目标；
 * - Markdown 引用：优先使用原始 `data-src`（未改写），没有则退回 `src`。
 *
 * 不联网、不读写文件；没有对应资源时返回 null，由 UI 隐藏该菜单项。
 */

import { resolveImageResource } from './content-block-toolbar-image-resource'

export interface ImageActionTarget {
  src: string | null
  dataSrc: string | null
  alt: string | null
  /** 当前文档所在目录，用于解析相对路径；未知时传 null。 */
  baseDir: string | null
}

export interface ImageActionAvailability {
  localPath: string | null
  remoteUrl: string | null
  markdown: string | null
}

function stripBrackets(value: string): string {
  return value.replace(/[[\]]/g, '').trim()
}

/** 构造标准行内 Markdown 图片引用；目标为空时返回 null。 */
export function buildMarkdownImageReference(alt: string | null, destination: string | null): string | null {
  const target = (destination ?? '').trim()
  if (!target) return null
  return `![${stripBrackets(alt ?? '')}](${target})`
}

export function buildImageActions(input: ImageActionTarget): ImageActionAvailability {
  const resource = resolveImageResource({
    src: input.src,
    dataSrc: input.dataSrc,
    baseDir: input.baseDir,
  })
  const markdownDestination = (input.dataSrc ?? '').trim() || (input.src ?? '').trim() || null
  return {
    localPath: resource?.kind === 'local-path' ? resource.absolutePath : null,
    remoteUrl: resource?.kind === 'http' ? resource.value : null,
    markdown: buildMarkdownImageReference(input.alt, markdownDestination),
  }
}
