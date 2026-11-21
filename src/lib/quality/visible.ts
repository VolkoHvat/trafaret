import type { DocModel, LayerModel, VectorObject } from '../../types'
import { analyzeQuality, type QualityReport } from './analyzer'

// At most 512 segments, including closing edges: fewer than 131,000 segment pairs.
const MAX_NODES = 512

export type VisibleQuality = { status: 'empty' } | { status: 'limited'; maxNodes: number }
  | { status: 'ready'; report: QualityReport }

export function analyzeVisibleQuality(document: Pick<DocModel, 'width' | 'height'>,
  layers: readonly Pick<LayerModel, 'visible' | 'kind' | 'objects'>[]): VisibleQuality {
  const objects: VectorObject[] = []
  let nodes = 0
  for (const layer of layers) {
    if (!layer.visible || layer.kind !== 'vector') continue
    for (const object of layer.objects ?? []) {
      if (object.points.length < 2) continue
      nodes += object.points.length
      if (nodes > MAX_NODES) return { status: 'limited', maxNodes: MAX_NODES }
      objects.push(object)
    }
  }
  return objects.length ? { status: 'ready', report: analyzeQuality({ objects, document }) } : { status: 'empty' }
}
