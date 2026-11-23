import { describe, expect, it } from 'vitest'
import { executeVoidProgram, parseVoidProgram } from './void-language.ts'

const program = `
  FIELD saturation=1
  PEN width=2 diffusion=4 strength=25.132741228718345 aspect=1 angle=0 driftX=0 driftY=0
  SOURCE time=0 x=0 y=0 pressure=1
  MEASURE time=0 x=0 y=0
  CONTOUR time=0.2 x=0 y=0 angle=0 maxDistance=64 step=0.25
  ENERGY time=0.2 x=0 y=0 angle=0
  OBSERVE time=1 minX=-1 minY=-1 columns=3 rows=3 gridStep=1
  GUIDE x=4 y=0 pressure=1
  GUIDE x=8 y=4 pressure=0.8
  REMODEL time=0.2 horizon=0.1 step=0.02 minX=-1 minY=-1 columns=3 rows=3 gridStep=1
`

describe('void field language', () => {
  it('executes dynamic measurements and static observations', () => {
    const result = executeVoidProgram(parseVoidProgram(program))

    expect(result.measurements).toHaveLength(1)
    expect(result.measurements[0].saturation).toBeCloseTo(0, 12)
    expect(result.measurements[0].saturationRate).toBeCloseTo(2, 12)
    expect(result.contours).toHaveLength(1)
    expect(result.contours[0].found).toBe(true)
    expect(result.contours[0].width).toBeGreaterThan(0)
    expect(result.energies).toHaveLength(1)
    expect(result.energies[0].energy).toBeGreaterThanOrEqual(0)
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0].saturation).toHaveLength(9)
    expect(result.observations[0].saturation[4]).toBeCloseTo(2 / 3, 12)
    expect(result.previews).toHaveLength(1)
    expect(result.process.sourceCount).toBe(1)
    expect(result.process.predictedCount).toBe(0)
  })

  it('rejects unknown instructions and invalid arguments', () => {
    expect(() => parseVoidProgram('STAMP x=0')).toThrow('Unknown command')
    expect(() => parseVoidProgram('PEN width=2 diffusion=4 strength=1 texture=bad')).toThrow('Invalid argument')
    expect(() => parseVoidProgram('PEN width=two diffusion=4 strength=1')).toThrow('Invalid number')
  })

  it('requires a pen law and valid source ordering', () => {
    expect(() => executeVoidProgram(parseVoidProgram('SOURCE time=0 x=0 y=0'))).toThrow('SOURCE requires a PEN law')
    expect(() => executeVoidProgram(parseVoidProgram(`
      PEN width=2 diffusion=4 strength=1
      SOURCE time=1 x=0 y=0
      SOURCE time=0 x=1 y=0
    `))).toThrow('Void sources must be causal')
  })
})
