import { describe, expect, it } from 'vitest'
import type { DocModel } from '../types'
import {
  analyzeArtwork,
  defaultArtworkAnalysisOptions,
  type ArtworkLayer,
  type ArtworkVectorObject,
  type RasterSample,
} from './artwork-analysis'

// Документ 400×400 px, 96 dpi → 1 px = 25.4/96 ≈ 0.2646 мм, 1 мм ≈ 3.7795 px.
// Безопасное поле 2 мм ≈ 7.56 px. Порог «пыль»: 0.5 мм ≈ 1.89 px.
const DOC: DocModel = { width: 400, height: 400, title: 'test', dpi: 96 }
const PX_PER_MM = 96 / 25.4

const transform = { x: 0, y: 0, scale: 1, rotation: 0 }
const brush = { size: 4 }

function stroke(id: string, points: [number, number, number][], extra: Partial<ArtworkVectorObject> = {}): ArtworkVectorObject {
  return { id, kind: 'stroke', points, brush, transform, ...extra }
}

function layer(id: string, objects: ArtworkVectorObject[], visible = true): ArtworkLayer {
  return { id, name: id, kind: 'vector', visible, opacity: 1, objects }
}

/** Центрированная синусоида: кривая, но без избыточных узлов (RDP почти не сокращает). */
function sinePoints(cx: number, cy: number, amp: number, length: number, n: number): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const x = cx - length / 2 + (length * i) / (n - 1)
    pts.push([x, cy + amp * Math.sin((i / (n - 1)) * Math.PI * 4), 0.5])
  }
  return pts
}

/** Растровый эллипс чернил (alpha 255) + опциональные одиночные пиксели. */
function ellipseRaster(a: number, b: number, cx = 200, cy = 200, specks: [number, number][] = []): RasterSample {
  const width = 400
  const height = 400
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = ((x - cx) ** 2) / (a * a) + ((y - cy) ** 2) / (b * b)
      if (d <= 1) {
        const i = (y * width + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255
      }
    }
  }
  for (const [sx, sy] of specks) {
    const i = (sy * width + sx) * 4
    data[i + 3] = 255
  }
  return { data, width, height }
}

/** Хороший центрированный сбалансированный эскиз: синусоида + прямоугольник + эллипс чернил. */
function goodLayers(): ArtworkLayer[] {
  return [
    layer('l-good-1', [
      stroke('o-sine', sinePoints(200, 140, 10, 100, 21)),
      stroke('o-rect', [
        [150, 240, 0.5],
        [250, 240, 0.5],
        [250, 300, 0.5],
        [150, 300, 0.5],
        [150, 240, 0.5],
      ]),
    ]),
  ]
}

const goodRaster = () => ellipseRaster(80, 60)

function codes(report: ReturnType<typeof analyzeArtwork>): string[] {
  return report.findings.map((f) => f.code)
}

describe('analyzeArtwork — хороший эскиз', () => {
  it('не даёт ни одной находки и сообщает метрики', () => {
    const report = analyzeArtwork(DOC, goodLayers(), goodRaster())
    expect(report.findings).toEqual([])
    expect(report.metrics.vector.objectCount).toBe(2)
    expect(report.metrics.vector.totalNodes).toBe(26)
    expect(report.metrics.vector.reduction).not.toBeNull()
    expect(report.metrics.raster).not.toBeNull()
    expect(report.metrics.raster!.inkPixels).toBeGreaterThan(0)
    expect(report.metrics.raster!.coverage).toBeGreaterThan(0)
    expect(report.metrics.raster!.marginsMm).not.toBeNull()
    expect(report.metrics.raster!.marginsMm!.left).toBeGreaterThan(2)
    expect(report.metrics.raster!.centroidDocPx).not.toBeNull()
    expect(report.metrics.composition.density).toBeLessThan(defaultArtworkAnalysisOptions.densityMaxCoverage)
    expect(report.metrics.composition.maxQuadrantShare).toBeLessThanOrEqual(
      defaultArtworkAnalysisOptions.imbalanceMaxQuadrantShare,
    )
  })
})

describe('analyzeArtwork — испорченные эскизы', () => {
  it('ловит коллинеарные избыточные узлы (прямая из 30 точек)', () => {
    const pts: [number, number, number][] = []
    for (let i = 0; i < 30; i++) pts.push([150 + i * (100 / 29), 200, 0.5])
    const report = analyzeArtwork(DOC, [layer('l1', [stroke('o-line', pts)])])
    const f = report.findings.find((x) => x.code === 'detail.excess-nodes')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('info')
    expect(f!.objectIds).toEqual(['o-line'])
    expect(f!.evidence.nodes).toBe(30)
    expect(f!.evidence.simplified).toBe(2)
    expect(f!.evidence.reduction).toBeCloseTo(28 / 30, 3)
    expect(report.metrics.vector.perObject[0].reduction).toBeCloseTo(28 / 30, 3)
  })

  it('ловит дубликаты по нормализованной сигнатуре (перенос не мешает)', () => {
    const shape: [number, number, number][] = [
      [0, 0, 0.5],
      [20, 5, 0.5],
      [40, 0, 0.5],
      [30, -15, 0.5],
      [10, -15, 0.5],
    ]
    const a = stroke('o-dup-a', shape)
    const b = stroke('o-dup-b', shape.map(([x, y, p]) => [x + 120, y + 60, p] as [number, number, number]))
    const report = analyzeArtwork(DOC, [layer('l1', [a, b])])
    const f = report.findings.find((x) => x.code === 'vector.duplicate')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('review')
    expect(f!.objectIds).toEqual(['o-dup-a', 'o-dup-b'])
    expect(f!.evidence.count).toBe(2)
  })

  it('ловит полностью и частично off-canvas объекты', () => {
    const full = stroke('o-out-full', [
      [0, 0, 0.5],
      [40, 0, 0.5],
      [40, 40, 0.5],
    ], { transform: { ...transform, x: 500 } })
    const partial = stroke('o-out-partial', [
      [0, 0, 0.5],
      [40, 0, 0.5],
      [40, 40, 0.5],
    ], { transform: { ...transform, x: 400 } })
    const report = analyzeArtwork(DOC, [layer('l1', [full, partial])])
    const findings = report.findings.filter((x) => x.code === 'vector.off-canvas')
    expect(findings).toHaveLength(2)
    const fullF = findings.find((x) => x.objectIds!.includes('o-out-full'))!
    const partialF = findings.find((x) => x.objectIds!.includes('o-out-partial'))!
    expect(fullF.evidence.fullyOutside).toBe(1)
    expect(partialF.evidence.fullyOutside).toBe(0)
  })

  it('ловит суб-миллиметровый элемент через doc.dpi', () => {
    const tiny = stroke('o-tiny', [
      [195, 195, 0.5],
      [197, 195, 0.5],
      [197, 197, 0.5],
    ], { brush: { size: 1 } })
    const report = analyzeArtwork(DOC, [layer('l1', [tiny])])
    const f = report.findings.find((x) => x.code === 'detail.tiny-element')
    expect(f).toBeDefined()
    expect(f!.objectIds).toEqual(['o-tiny'])
    expect(f!.evidence.thresholdMm).toBe(defaultArtworkAnalysisOptions.tinyElementMm)
    // 2 px геометрии + pad 0.5 px с каждой стороны = 3 px ≈ 0.79 мм < 1 мм
    expect(f!.evidence.sizeMm).toBeLessThan(defaultArtworkAnalysisOptions.tinyElementMm)
  })

  it('ловит specks/мелкие компоненты по мм', () => {
    const raster = ellipseRaster(60, 60, 200, 200, [
      [20, 20],
      [380, 380],
    ])
    const report = analyzeArtwork(DOC, [], raster)
    const f = report.findings.find((x) => x.code === 'detail.specks')
    expect(f).toBeDefined()
    expect(f!.evidence.count).toBe(2)
    expect(f!.evidence.speckAreaMm2).toBe(defaultArtworkAnalysisOptions.speckAreaMm2)
    expect(report.metrics.raster!.componentCount).toBe(3)
    expect(report.metrics.raster!.componentAreasMm2).toHaveLength(3)
  })

  it('ловит one-quadrant композицию', () => {
    const raster = ellipseRaster(50, 50, 100, 100)
    const report = analyzeArtwork(DOC, [], raster)
    const f = report.findings.find((x) => x.code === 'composition.imbalance')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('review')
    expect(f!.evidence.maxQuadrantShare).toBeGreaterThan(
      defaultArtworkAnalysisOptions.imbalanceMaxQuadrantShare,
    )
  })

  it('ловит пустой эскиз', () => {
    const report = analyzeArtwork(DOC, [layer('l1', [], true)])
    const f = report.findings.find((x) => x.code === 'composition.empty-sketch')
    expect(f).toBeDefined()
    expect(f!.severity).toBe('review')
    // также с валидным, но полностью прозрачным растром
    const transparent: RasterSample = { data: new Uint8ClampedArray(400 * 400 * 4), width: 400, height: 400 }
    const report2 = analyzeArtwork(DOC, [], transparent)
    expect(codes(report2)).toContain('composition.empty-sketch')
  })
})

describe('analyzeArtwork — границы и устойчивость', () => {
  it('не флагает объект, касающийся края и безопасного поля ровно на допуске', () => {
    const marginPx = defaultArtworkAnalysisOptions.safeMarginMm * PX_PER_MM // ≈7.56
    const pad = 2 // полтолщины кисти size 4
    const atMargin = stroke('o-margin', [
      [marginPx + pad, 200, 0.5],
      [marginPx + pad + 60, 200, 0.5],
    ])
    const report = analyzeArtwork(DOC, [layer('l1', [atMargin])])
    expect(codes(report)).not.toContain('vector.off-canvas')
    expect(codes(report)).not.toContain('composition.safe-margin')
  })

  it('флагает выход за безопасное поле', () => {
    const crossing = stroke('o-cross', [
      [2, 200, 0.5],
      [60, 200, 0.5],
    ])
    const report = analyzeArtwork(DOC, [layer('l1', [crossing])])
    const f = report.findings.find((x) => x.code === 'composition.safe-margin')
    expect(f).toBeDefined()
    expect(f!.evidence.marginMm).toBe(defaultArtworkAnalysisOptions.safeMarginMm)
    expect(f!.evidence.violatedLeft).toBe(1)
  })

  it('игнорирует невидимые слои полностью', () => {
    const badInvisible = layer('l-hidden', [
      stroke('o-hidden-line', (() => {
        const pts: [number, number, number][] = []
        for (let i = 0; i < 30; i++) pts.push([100 + i * 5, 100, 0.5])
        return pts
      })()),
      stroke('o-hidden-out', [[0, 0, 0.5], [10, 0, 0.5]], { transform: { ...transform, x: 1000 } }),
    ], false)
    const report = analyzeArtwork(DOC, [...goodLayers(), badInvisible], goodRaster())
    expect(report.findings).toEqual([])
    expect(report.metrics.vector.objectCount).toBe(2)
  })

  it('одинаковый input → глубоко одинаковый report', () => {
    const layers = goodLayers()
    const raster = goodRaster()
    const r1 = analyzeArtwork(DOC, layers, raster)
    const r2 = analyzeArtwork(DOC, layers, raster)
    expect(r1).toEqual(r2)
  })

  it('переименование id не меняет независимые метрики и набор находок', () => {
    const dupShape: [number, number, number][] = [
      [140, 160, 0.5],
      [160, 165, 0.5],
      [180, 160, 0.5],
      [170, 145, 0.5],
      [150, 145, 0.5],
    ]
    const shifted = dupShape.map(([x, y, p]) => [x + 40, y, p] as [number, number, number])
    const baseLayers = [layer('l1', [stroke('a', dupShape), stroke('b', shifted)])]
    const renamedLayers = [layer('l1', [stroke('x1', dupShape), stroke('x2', shifted)])]
    const stripIds = (m: ReturnType<typeof analyzeArtwork>['metrics']) => ({
      ...m,
      vector: {
        ...m.vector,
        perObject: m.vector.perObject.map(({ nodes, simplified, reduction }) => ({ nodes, simplified, reduction })),
      },
    })
    const r1 = analyzeArtwork(DOC, baseLayers, goodRaster())
    const r2 = analyzeArtwork(DOC, renamedLayers, goodRaster())
    expect(stripIds(r2.metrics)).toEqual(stripIds(r1.metrics))
    expect(r1.findings).toHaveLength(1) // только дубликат — в обоих прогонах
    expect(r1.findings[0].code).toBe('vector.duplicate')
    expect(r2.findings.map((f) => [f.code, f.severity, f.evidence])).toEqual(
      r1.findings.map((f) => [f.code, f.severity, f.evidence]),
    )
  })

  it('безопасно обрабатывает malformed/пустой RGBA', () => {
    const malformed: RasterSample = { data: new Uint8ClampedArray(3), width: 10, height: 10 }
    const empty: RasterSample = { data: new Uint8ClampedArray(0), width: 0, height: 0 }
    for (const sample of [malformed, empty]) {
      const report = analyzeArtwork(DOC, goodLayers(), sample)
      expect(report.metrics.raster).toBeNull()
      // fallback на векторную оценку композии остаётся детерминированным
      const again = analyzeArtwork(DOC, goodLayers(), sample)
      expect(report.findings.map((f) => [f.code, f.severity, f.evidence])).toEqual(
        again.findings.map((f) => [f.code, f.severity, f.evidence]),
      )
      expect(() => analyzeArtwork(DOC, goodLayers(), sample)).not.toThrow()
    }
  })
})
