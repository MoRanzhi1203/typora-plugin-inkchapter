/**
 * 图片数据根目录解析（P2）。
 *
 * 位置优先复用框架提供的插件私有数据目录（`Plugin.dataPath`），
 * 绝不在公开默认中硬编码用户盘符。P3 会在同一 seam 上扩展
 * 图库、缓存、离线与上传暂存的独立路径配置。
 *
 * 持久化格式选择 JSON 原子写（临时文件 + rename），不引入 SQLite：
 * 现有 Electron 运行时未验证原生模块 ABI，升级/编译风险高于收益。
 * 待原生兼容性得到真实验证后，可在保持本模块 API 的前提下替换存储实现。
 */

import * as path from 'path'

export interface ImageDataPaths {
  /** 插件私有数据目录下的图片数据根。 */
  root: string
  /** 统一资产索引文件。 */
  assetIndexFile: string
  /** 迁移/事务前的索引备份目录。 */
  backupDir: string
}

export function resolveImageDataPaths(pluginDataPath: string): ImageDataPaths {
  const trimmed = typeof pluginDataPath === 'string' ? pluginDataPath.trim() : ''
  if (!trimmed) throw new Error('plugin data path is empty')
  const root = path.join(trimmed, 'image')
  return {
    root,
    assetIndexFile: path.join(root, 'image-assets.json'),
    backupDir: path.join(root, 'backup'),
  }
}
