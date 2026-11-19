import type { ControlHandle, DocModel } from '../types'
import { boundsCenter, controlHandlePoints, defaultVectorTransform, pointsBounds, transformPoint } from './geometry'

export type AnalysisSeverity = 'info' | 'review'
export type AnalysisCategory = 'detail' | 'vector' | 'composition'

export interface AnalysisFinding {
  severity: AnalysisSeverity
  category: AnalysisCategory
  code: string
  message: string
  evidence: Record<string, number>
  objectIds?: string[]
}

/** Минимальный структурный тип векторного объекта — без DOM-зависимостей. */
export interface ArtworkVectorObject {
  id: string
  kind: 'stroke' | 'path' | 'shape'
  shape?: 'rectangle' | 'ellipse' | 'arc'
  points: [number, number, number][]
  brush?: { size: number }
  closed?: boolean
  origin?: { x: number; y: number }
  handles?: Record<number, ControlHandle>
  transform?: { x: number; y: number; scale: number; rotation: number }
}

/** Минимальный структурный тип слоя — без DOM-зависимостей. */
export interface ArtworkLayer {
  id: string
  name: string
  kind: string
  visible: boolean
  opacity: number
  objects?: ArtworkVectorObject[]
}

/** Downsampled RGBA-подобный сэмпл видимого composite, фон прозрачный. */
export interface RasterSample {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface ArtworkAnalysisOptions {
  /** Допуск RDP-упрощения, мм (переводится в мировые пиксели документа) */
  rdpEpsilonMm: number
  /** Минимальное число узлов объекта, чтобы рассматривать упрощение */
  rdpMinPoints: number
  /** Минимальная доля сокращения узлов (0..1) для флага избыточных узлов */
  rdpMinReduction: number
  /** Шаг квантования нормализованной сигнатуры дубликатов (безразмерный) */
  duplicateQuantStep: number
  /** Минимальная длинная сторона объекта, мм; меньше — флаг мелкого элемента */
  tinyElementMm: number
  /** Допуск к границам холста при проверке выхода за край, мм */
  boundsToleranceMm: number
  /** Безопасное поле от краёв холста, мм */
  safeMarginMm: number
  /** Порог альфа-канала, выше которого пиксель считается чернилом (0..255) */
  rasterAlphaThreshold: number
  /** Минимальная площадь компонента, мм²; меньше — «пыль» */
  speckAreaMm2: number
  /** Минимальный размер (длинная сторона bbox) компонента, мм; меньше — «пыль» */
  speckSizeMm: number
  /** Максимальная доля покрытия холста чернилами (0..1) до флага плотности */
  densityMaxCoverage: number
  /** Максимальная доля массы чернил в одном квадранте (0..1) до флага дисбаланса */
  imbalanceMaxQuadrantShare: number
  /** Максимальное смещение центра масс от центра (доля полудлины стороны, 0..1) */
  imbalanceMaxCentroidOffset: number
}

export const defaultArtworkAnalysisOptions: ArtworkAnalysisOptions = {
  rdpEpsilonMm: 0.2,
  rdpMinPoints: 8,
  rdpMinReduction: 0.4,
  duplicateQuantStep: 0.02,
  tinyElementMm: 1.0,
  boundsToleranceMm: 0.1,
  safeMarginMm: 2.0,
  rasterAlphaThreshold: 16,
  speckAreaMm2: 0.5,
  speckSizeMm: 0.5,
  densityMaxCoverage: 0.6,
  imbalanceMaxQuadrantShare: 0.7,
  imbalanceMaxCentroidOffset: 0.2,
}

interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ArtworkMetrics {
  vector: {
    objectCount: number
    totalNodes: number
    simplifiedNodes: number
    /** Доля сокращённых узлов (0..1), null если объектов нет */
    reduction: number | null
    perObject: { objectId: string; nodes: number; simplified: number; reduction: number }[]
  }
  raster: {
    sampleWidth: number
    sampleHeight: number
    inkPixels: number
    coverage: number
    bboxDocPx: BBox | null
    marginsMm: { left: number; top: number; right: number; bottom: number } | null
    centroidDocPx: { x: number; y: number } | null
    quadrantShares: number[]
    componentCount: number
    componentAreasMm2: number[]
  } | null
  composition: {
    docAreaMm2: number
    inkAreaMm2: number
    /** Плотность покрытия (0..1); для векторного fallback — оценка по bbox */
    density: number
    maxQuadrantShare: number
    centroidOffsetRatio: number
  }
}

export interface ArtworkReport {
  findings: AnalysisFinding[]
  metrics: ArtworkMetrics
}

const MM_PER_INCH = 25.4

function objectOrigin(object: ArtworkVectorObject, points: [number, number][]): { x: number; y: number } {
  return object.origin ?? boundsCenter(pointsBounds(points))
}

/** Геометрический bbox точек объекта в мировых координатах с учётом толщины линии. */
function objectWorldBounds(object: ArtworkVectorObject, points: [number, number][]): BBox | null {
  if (!points.length) return null
  const origin = objectOrigin(object, points)
  const transform = object.transform ?? defaultVectorTransform()
  const pad = Math.max(0.5, (object.brush?.size ?? 2) / 2)
  const worldPoints = points.map(point => transformPoint(point[0], point[1], transform, origin))
  const worldHandles = controlHandlePoints(object).map(point => transformPoint(point[0], point[1], transform, origin))
  return pointsBounds([...worldPoints, ...worldHandles], pad)
}

/** Итеративное RDP-упрощение; epsilon в тех же единицах, что и точки. */
function rdpSimplify(points: [number, number][], epsilon: number): number[] {
  const n = points.length
  if (n < 3) return points.map((_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let maxDist = -1
    let maxIdx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      let dist: number
      if (len2 === 0) {
        dist = Math.hypot(px - ax, py - ay)
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      }
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxIdx >= 0 && maxDist > epsilon) {
      keep[maxIdx] = 1
      stack.push([a, maxIdx], [maxIdx, b])
    }
  }
  const result: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) result.push(i)
  return result
}

/** Устойчивая нормализованная сигнатура геометрии: без id, порядка обхода и случайных данных. */
function geometrySignature(points: [number, number][], quantStep: number): string {
  let cx = 0
  let cy = 0
  for (const [x, y] of points) {
    cx += x
    cy += y
  }
  cx /= points.length
  cy /= points.length
  let rms = 0
  for (const [x, y] of points) rms += (x - cx) ** 2 + (y - cy) ** 2
  rms = Math.sqrt(rms / points.length) || 1
  const q = (v: number) => Math.round(v / (rms * quantStep))
  const norm = points.map(([x, y]) => [q(x - cx), q(y - cy)] as [number, number])
  const sequences: string[] = []
  for (const seq of [norm, [...norm].reverse()]) {
    let start = 0
    for (let i = 1; i < seq.length; i++) {
      const [x, y] = seq[i]
      const [sx, sy] = seq[start]
      if (x < sx || (x === sx && y < sy)) start = i
    }
    const rotated = [...seq.slice(start), ...seq.slice(0, start)]
    sequences.push(rotated.map(([x, y]) => `${x},${y}`).join(' '))
  }
  return sequences[0] < sequences[1] ? sequences[0] : sequences[1]
}

interface RasterStats {
  sample: RasterSample
  inkPixels: number
  bbox: BBox | null
  marginsMm: { left: number; top: number; right: number; bottom: number } | null
  centroid: { x: number; y: number } | null
  quadrantShares: number[]
  componentAreasPx: number[]
  componentBBoxes: BBox[]
}

function analyzeRaster(sample: RasterSample, alphaThreshold: number, scaleDocPxPerSamplePx: number, mmPerDocPx: number): RasterStats {
  const { width: w, height: h, data } = sample
  const total = w * h
  const ink = new Uint8Array(total)
  let inkPixels = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let sumX = 0, sumY = 0
  const quadMass = [0, 0, 0, 0]
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > alphaThreshold) {
      ink[i] = 1
      inkPixels++
      const x = i % w
      const y = (i / w) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      sumX += x
      sumY += y
      quadMass[(x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2)]++
    }
  }
  const bbox: BBox | null = inkPixels ? { minX, minY, maxX, maxY } : null
  const centroid = inkPixels ? { x: sumX / inkPixels, y: sumY / inkPixels } : null
  const marginsMm = bbox
    ? {
        left: bbox.minX * scaleDocPxPerSamplePx * mmPerDocPx,
        top: bbox.minY * scaleDocPxPerSamplePx * mmPerDocPx,
        right: (w - 1 - bbox.maxX) * scaleDocPxPerSamplePx * mmPerDocPx,
        bottom: (h - 1 - bbox.maxY) * scaleDocPxPerSamplePx * mmPerDocPx,
      }
    : null
  const quadrantShares = inkPixels ? quadMass.map((m) => m / inkPixels) : [0, 0, 0, 0]

  // Connected components: BFS с очередью Uint32Array (без JS-массива как стека).
  const componentAreasPx: number[] = []
  const componentBBoxes: BBox[] = []
  const labels = new Int32Array(total).fill(-1)
  const queue = new Uint32Array(total)
  for (let start = 0; start < total; start++) {
    if (!ink[start] || labels[start] >= 0) continue
    const label = componentAreasPx.length
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = label
    let area = 0
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity
    while (head < tail) {
      const i = queue[head++]
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < cMinX) cMinX = x
      if (y < cMinY) cMinY = y
      if (x > cMaxX) cMaxX = x
      if (y > cMaxY) cMaxY = y
      if (x > 0 && ink[i - 1] && labels[i - 1] < 0) { labels[i - 1] = label; queue[tail++] = i - 1 }
      if (x < w - 1 && ink[i + 1] && labels[i + 1] < 0) { labels[i + 1] = label; queue[tail++] = i + 1 }
      if (y > 0 && ink[i - w] && labels[i - w] < 0) { labels[i - w] = label; queue[tail++] = i - w }
      if (y < h - 1 && ink[i + w] && labels[i + w] < 0) { labels[i + w] = label; queue[tail++] = i + w }
    }
    componentAreasPx.push(area)
    componentBBoxes.push({ minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY })
  }

  return {
    sample,
    inkPixels,
    bbox,
    marginsMm,
    centroid,
    quadrantShares,
    componentAreasPx,
    componentBBoxes,
  }
}

function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/**
 * Детерминированный анализ tattoo-эскиза: только факты и необязательные рекомендации.
 * Никаких вкусовых оценок и автоматического удаления. Метрики заполняются всегда.
 */
export function analyzeArtwork(
  doc: DocModel,
  layers: ArtworkLayer[],
  raster?: RasterSample | null,
  options: ArtworkAnalysisOptions = defaultArtworkAnalysisOptions,
): ArtworkReport {
  const findings: AnalysisFinding[] = []
  const mmPerDocPx = MM_PER_INCH / doc.dpi
  const pxPerMm = doc.dpi / MM_PER_INCH
  const docW = doc.width
  const docH = doc.height

  // --- Видимые векторные объекты (невидимые слои полностью игнорируются) ---
  interface VisibleObject {
    object: ArtworkVectorObject
    layerId: string
    points: [number, number][]
    worldBounds: BBox | null
  }
  const visibleObjects: VisibleObject[] = []
  for (const layer of layers) {
    if (!layer.visible) continue
    for (const object of layer.objects ?? []) {
      const points: [number, number][] = object.points.map((p) => [p[0], p[1]])
      visibleObjects.push({ object, layerId: layer.id, points, worldBounds: objectWorldBounds(object, points) })
    }
  }

  // --- 1. RDP-упрощение и избыточные узлы ---
  const perObject: ArtworkMetrics['vector']['perObject'] = []
  let totalNodes = 0
  let totalSimplified = 0
  const epsilonPx = options.rdpEpsilonMm * pxPerMm
  for (const { object, points } of visibleObjects) {
    const nodes = points.length
    const simplified = points.length >= 3 ? rdpSimplify(points, epsilonPx).length : nodes
    const reduction = nodes ? (nodes - simplified) / nodes : 0
    totalNodes += nodes
    totalSimplified += simplified
    perObject.push({ objectId: object.id, nodes, simplified, reduction })
    if (nodes >= options.rdpMinPoints && reduction >= options.rdpMinReduction) {
      findings.push({
        severity: 'info',
        category: 'detail',
        code: 'detail.excess-nodes',
        message:
          `Объект «${object.id}» содержит ${nodes} узлов; упрощение с допуском ` +
          `${options.rdpEpsilonMm} мм оставляет ${simplified} (сокращение ${(reduction * 100).toFixed(0)}%). ` +
          'Возможны избыточные почти-коллинеарные точки — проверьте вручную.',
        evidence: { nodes, simplified, reduction: Number(reduction.toFixed(4)), epsilonMm: options.rdpEpsilonMm },
        objectIds: [object.id],
      })
    }
  }

  // --- 2. Дубликаты / почти-дубликаты по нормализованной геометрической сигнатуре ---
  const signatureGroups = new Map<string, string[]>()
  for (const { object, points } of visibleObjects) {
    if (points.length < 2) continue
    const signature = [
      object.kind,
      object.shape ?? '-',
      object.closed ? 'closed' : 'open',
      geometrySignature(points, options.duplicateQuantStep),
    ].join('|')
    const group = signatureGroups.get(signature)
    if (group) group.push(object.id)
    else signatureGroups.set(signature, [object.id])
  }
  for (const ids of signatureGroups.values()) {
    if (ids.length < 2) continue
    findings.push({
      severity: 'review',
      category: 'vector',
      code: 'vector.duplicate',
      message:
        `Объекты (${ids.join(', ')}) имеют совпадающую нормализованную геометрическую сигнатуру — ` +
        'это эвристика, они могут быть намеренным повтором; проверьте вручную, нужны ли оба.',
      evidence: { count: ids.length },
      objectIds: ids,
    })
  }

  // --- 3/4. Выход за холст и мелкие элементы ---
  const tolerancePx = options.boundsToleranceMm * pxPerMm
  for (const { object, worldBounds } of visibleObjects) {
    if (!worldBounds) continue
    const fullyOutside =
      worldBounds.minX > docW + tolerancePx ||
      worldBounds.maxX < -tolerancePx ||
      worldBounds.minY > docH + tolerancePx ||
      worldBounds.maxY < -tolerancePx
    const partiallyOutside =
      !fullyOutside &&
      (worldBounds.minX < -tolerancePx ||
        worldBounds.maxX > docW + tolerancePx ||
        worldBounds.minY < -tolerancePx ||
        worldBounds.maxY > docH + tolerancePx)
    if (fullyOutside || partiallyOutside) {
      findings.push({
        severity: 'info',
        category: 'vector',
        code: 'vector.off-canvas',
        message: fullyOutside
          ? `Объект «${object.id}» полностью за пределами холста (${docW}×${docH} px).`
          : `Объект «${object.id}» частично выходит за границы холста (${docW}×${docH} px).`,
        evidence: {
          minX: Number(worldBounds.minX.toFixed(2)),
          minY: Number(worldBounds.minY.toFixed(2)),
          maxX: Number(worldBounds.maxX.toFixed(2)),
          maxY: Number(worldBounds.maxY.toFixed(2)),
          fullyOutside: fullyOutside ? 1 : 0,
        },
        objectIds: [object.id],
      })
    }
    const sizePx = Math.max(worldBounds.maxX - worldBounds.minX, worldBounds.maxY - worldBounds.minY)
    const sizeMm = sizePx * mmPerDocPx
    if (sizeMm < options.tinyElementMm) {
      findings.push({
        severity: 'info',
        category: 'detail',
        code: 'detail.tiny-element',
        message:
          `Объект «${object.id}» имеет размер ~${sizeMm.toFixed(2)} мм по длинной стороне ` +
          `(порог ${options.tinyElementMm} мм при ${doc.dpi} dpi) — мелкие элементы могут потеряться при печати.`,
        evidence: { sizeMm: Number(sizeMm.toFixed(3)), thresholdMm: options.tinyElementMm },
        objectIds: [object.id],
      })
    }
  }

  // --- 5. Растровые чернила ---
  const rasterValid =
    !!raster && raster.width > 0 && raster.height > 0 && raster.data.length >= raster.width * raster.height * 4
  const scaleDocPxPerSamplePx = rasterValid ? docW / raster!.width : 1
  const rasterStats = rasterValid
    ? analyzeRaster(raster!, options.rasterAlphaThreshold, scaleDocPxPerSamplePx, mmPerDocPx)
    : null

  if (rasterStats && rasterStats.inkPixels > 0) {
    const samplePxAreaMm2 = (scaleDocPxPerSamplePx * mmPerDocPx) ** 2
    const specks: { areaMm2: number; sizeMm: number }[] = []
    for (let i = 0; i < rasterStats.componentAreasPx.length; i++) {
      const areaMm2 = rasterStats.componentAreasPx[i] * samplePxAreaMm2
      const bb = rasterStats.componentBBoxes[i]
      const sizeMm =
        Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * scaleDocPxPerSamplePx * mmPerDocPx
      if (areaMm2 < options.speckAreaMm2 || sizeMm < options.speckSizeMm) {
        specks.push({ areaMm2, sizeMm })
      }
    }
    if (specks.length) {
      findings.push({
        severity: 'review',
        category: 'detail',
        code: 'detail.specks',
        message:
          `Обнаружено ${specks.length} изолированных мелких компонента(ов) чернил ` +
          `(пороги: площадь < ${options.speckAreaMm2} мм² или размер < ${options.speckSizeMm} мм) — ` +
          'возможны случайные помарки; проверьте вручную.',
        evidence: {
          count: specks.length,
          maxAreaMm2: Number(Math.max(...specks.map((s) => s.areaMm2)).toFixed(3)),
          minAreaMm2: Number(Math.min(...specks.map((s) => s.areaMm2)).toFixed(3)),
          speckAreaMm2: options.speckAreaMm2,
          speckSizeMm: options.speckSizeMm,
        },
      })
    }
  }

  // --- 6. Композиция (все findings — review, не error) ---
  const rasterBBoxDoc: BBox | null = rasterStats?.bbox
    ? {
        minX: rasterStats.bbox.minX * scaleDocPxPerSamplePx,
        minY: rasterStats.bbox.minY * scaleDocPxPerSamplePx,
        maxX: (rasterStats.bbox.maxX + 1) * scaleDocPxPerSamplePx,
        maxY: (rasterStats.bbox.maxY + 1) * scaleDocPxPerSamplePx,
      }
    : null
  let inkBBox: BBox | null = rasterBBoxDoc
  for (const { worldBounds } of visibleObjects) inkBBox = unionBBox(inkBBox, worldBounds)

  const docAreaMm2 = docW * docH * mmPerDocPx * mmPerDocPx
  let inkAreaMm2 = 0
  let density: number
  let quadrantShares: number[]
  let centroidDocPx: { x: number; y: number } | null
  if (rasterStats && rasterStats.inkPixels > 0) {
    const samplePxAreaMm2 = (scaleDocPxPerSamplePx * mmPerDocPx) ** 2
    inkAreaMm2 = rasterStats.inkPixels * samplePxAreaMm2
    density = rasterStats.inkPixels / (rasterStats.sample.width * rasterStats.sample.height)
    quadrantShares = rasterStats.quadrantShares
    centroidDocPx = rasterStats.centroid
      ? {
          x: rasterStats.centroid.x * scaleDocPxPerSamplePx,
          y: rasterStats.centroid.y * scaleDocPxPerSamplePx,
        }
      : null
  } else {
    // Fallback на векторные bbox (оценка; наложения bbox считаются с повтором).
    let vecArea = 0
    for (const { worldBounds } of visibleObjects) {
      if (worldBounds) vecArea += (worldBounds.maxX - worldBounds.minX) * (worldBounds.maxY - worldBounds.minY)
    }
    inkAreaMm2 = vecArea * mmPerDocPx * mmPerDocPx
    density = docW * docH > 0 ? vecArea / (docW * docH) : 0
    const quad = [0, 0, 0, 0]
    for (const { worldBounds } of visibleObjects) {
      if (!worldBounds) continue
      const area = (worldBounds.maxX - worldBounds.minX) * (worldBounds.maxY - worldBounds.minY)
      quad[(worldBounds.minX + worldBounds.maxX < docW ? 0 : 1) + (worldBounds.minY + worldBounds.maxY < docH ? 0 : 2)] += area
    }
    quadrantShares = vecArea > 0 ? quad.map((q) => q / vecArea) : [0, 0, 0, 0]
    centroidDocPx = null
  }

  const emptySketch = visibleObjects.length === 0 && (!rasterStats || rasterStats.inkPixels === 0)
  if (emptySketch) {
    findings.push({
      severity: 'review',
      category: 'composition',
      code: 'composition.empty-sketch',
      message:
        'Эскиз пуст: видимых векторных объектов нет и растровых чернил не обнаружено. ' +
        'Проверьте видимость слоёв и содержимое.',
      evidence: { vectorObjects: 0, inkPixels: rasterStats?.inkPixels ?? 0 },
    })
  }

  const marginPx = options.safeMarginMm * pxPerMm
  if (inkBBox) {
    const marginViolation = {
      left: inkBBox.minX < marginPx - tolerancePx,
      top: inkBBox.minY < marginPx - tolerancePx,
      right: inkBBox.maxX > docW - marginPx + tolerancePx,
      bottom: inkBBox.maxY > docH - marginPx + tolerancePx,
    }
    if (marginViolation.left || marginViolation.top || marginViolation.right || marginViolation.bottom) {
      findings.push({
        severity: 'review',
        category: 'composition',
        code: 'composition.safe-margin',
        message:
          `Чернила выходят за безопасное поле ${options.safeMarginMm} мм от краёв холста ` +
          '(это эвристика для печати; порог настраивается). Проверьте примыкание к краям.',
        evidence: {
          marginMm: options.safeMarginMm,
          violatedLeft: marginViolation.left ? 1 : 0,
          violatedTop: marginViolation.top ? 1 : 0,
          violatedRight: marginViolation.right ? 1 : 0,
          violatedBottom: marginViolation.bottom ? 1 : 0,
        },
      })
    }
  }

  const maxQuadrantShare = Math.max(...quadrantShares)
  const centroidOffsetRatio = centroidDocPx
    ? Math.max(
        Math.abs(centroidDocPx.x - docW / 2) / (docW / 2),
        Math.abs(centroidDocPx.y - docH / 2) / (docH / 2),
      )
    : 0
  if (
    !emptySketch &&
    (maxQuadrantShare > options.imbalanceMaxQuadrantShare ||
      centroidOffsetRatio > options.imbalanceMaxCentroidOffset)
  ) {
    findings.push({
      severity: 'review',
      category: 'composition',
      code: 'composition.imbalance',
      message:
        `Заметный дисбаланс композиции (эвристика): максимальная доля массы в квадранте ` +
        `${(maxQuadrantShare * 100).toFixed(1)}% при пороге ${(options.imbalanceMaxQuadrantShare * 100).toFixed(0)}%, ` +
        `смещение центра масс ${(centroidOffsetRatio * 100).toFixed(1)}% при пороге ` +
        `${(options.imbalanceMaxCentroidOffset * 100).toFixed(0)}%. Это не ошибка — проверьте замысел.`,
      evidence: {
        maxQuadrantShare: Number(maxQuadrantShare.toFixed(4)),
        thresholdQuadrantShare: options.imbalanceMaxQuadrantShare,
        centroidOffsetRatio: Number(centroidOffsetRatio.toFixed(4)),
        thresholdCentroidOffset: options.imbalanceMaxCentroidOffset,
      },
    })
  }

  if (!emptySketch && density > options.densityMaxCoverage) {
    findings.push({
      severity: 'review',
      category: 'composition',
      code: 'composition.density',
      message:
        `Плотность покрытия ${(density * 100).toFixed(1)}% превышает эвристический порог ` +
        `${(options.densityMaxCoverage * 100).toFixed(0)}% — чернила занимают большую часть холста. ` +
        'Это не ошибка; проверьте, задумано ли сплошное заполнение.',
      evidence: { density: Number(density.toFixed(4)), thresholdDensity: options.densityMaxCoverage },
    })
  }

  const metrics: ArtworkMetrics = {
    vector: {
      objectCount: visibleObjects.length,
      totalNodes,
      simplifiedNodes: totalSimplified,
      reduction: totalNodes ? Number(((totalNodes - totalSimplified) / totalNodes).toFixed(4)) : null,
      perObject,
    },
    raster: rasterStats
      ? {
          sampleWidth: rasterStats.sample.width,
          sampleHeight: rasterStats.sample.height,
          inkPixels: rasterStats.inkPixels,
          coverage: rasterStats.sample.width * rasterStats.sample.height > 0
            ? Number((rasterStats.inkPixels / (rasterStats.sample.width * rasterStats.sample.height)).toFixed(4))
            : 0,
          bboxDocPx: rasterBBoxDoc,
          marginsMm: rasterStats.marginsMm
            ? {
                left: Number(rasterStats.marginsMm.left.toFixed(3)),
                top: Number(rasterStats.marginsMm.top.toFixed(3)),
                right: Number(rasterStats.marginsMm.right.toFixed(3)),
                bottom: Number(rasterStats.marginsMm.bottom.toFixed(3)),
              }
            : null,
          centroidDocPx: centroidDocPx
            ? { x: Number(centroidDocPx.x.toFixed(2)), y: Number(centroidDocPx.y.toFixed(2)) }
            : null,
          quadrantShares: quadrantShares.map((s) => Number(s.toFixed(4))),
          componentCount: rasterStats.componentAreasPx.length,
          componentAreasMm2: rasterStats.componentAreasPx.map((a) =>
            Number((a * (scaleDocPxPerSamplePx * mmPerDocPx) ** 2).toFixed(4)),
          ),
        }
      : null,
    composition: {
      docAreaMm2: Number(docAreaMm2.toFixed(2)),
      inkAreaMm2: Number(inkAreaMm2.toFixed(2)),
      density: Number(density.toFixed(4)),
      maxQuadrantShare: Number(maxQuadrantShare.toFixed(4)),
      centroidOffsetRatio: Number(centroidOffsetRatio.toFixed(4)),
    },
  }

  return { findings, metrics }
}
