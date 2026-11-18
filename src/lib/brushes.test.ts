import { describe, expect, it } from 'vitest'
import { brushRendering, DEFAULT_BRUSHES } from './brushes'

describe('brush rendering data', () => {
  it('reads dotwork, distributed opacity and blur from brush presets', () => {
    expect(brushRendering(DEFAULT_BRUSHES.dotwork)).toMatchObject({ dotwork: true })
    expect(brushRendering(DEFAULT_BRUSHES.whip)).toMatchObject({ distributeOpacity: true })
    expect(brushRendering(DEFAULT_BRUSHES.sketch)).toMatchObject({ distributeOpacity: true })
    expect(brushRendering(DEFAULT_BRUSHES.shader)).toMatchObject({ blurScale: 1 / 9 })
    expect(brushRendering(DEFAULT_BRUSHES.fineline)).toEqual({
      dotwork: false, distributeOpacity: false, blurScale: 0,
    })
  })

  it('keeps legacy presets working and allows data overrides', () => {
    const legacy = { ...DEFAULT_BRUSHES.dotwork }
    delete legacy.strokeMode
    expect(brushRendering(legacy).dotwork).toBe(true)

    expect(brushRendering({
      ...DEFAULT_BRUSHES.fineline,
      strokeMode: 'dotwork', distributeOpacity: true, blurScale: 0.25,
    })).toEqual({ dotwork: true, distributeOpacity: true, blurScale: 0.25 })
  })
})
