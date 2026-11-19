import { describe, expect, it } from 'vitest'
import { abrToBrush, readAbr } from './abr'

const u16 = (value: number) => {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value)
  return bytes
}
const u32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}
const double = (value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value)
  return bytes
}
const ascii = (value: string) => new TextEncoder().encode(value)
const unicode = (value: string) => {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) bytes[i * 2 + 1] = value.charCodeAt(i)
  return join(u32(value.length), bytes)
}
const join = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
const id = (value: string) => join(u32(value.length), ascii(value))
const text = (value: string) => join(ascii('TEXT'), unicode(value))
const doub = (value: number) => join(ascii('doub'), double(value))
const field = (key: string, value: Uint8Array) => join(id(key), value)
const descriptor = (name: string, classID: string, fields: Uint8Array[]) => join(
  unicode(name), id(classID), u32(fields.length), ...fields,
)

function makeAbr() {
  const tip = descriptor('', 'sampledBrush', [
    field('Nm  ', text('Test Liner')),
    field('Dmtr', doub(42)), field('Spcn', doub(15)), field('Angl', doub(10)),
    field('Rndn', doub(80)), field('Hrdn', doub(90)),
  ])
  const preset = descriptor('', 'brushPreset', [field('Nm  ', text('Test Liner')), field('Brsh', join(ascii('Objc'), tip))])
  const root = descriptor('', 'root', [field('Brsh', join(ascii('VlLs'), u32(1), ascii('Objc'), preset))])
  return join(u16(6), u16(2), ascii('8BIM'), ascii('desc'), u32(4 + root.length), u32(16), root)
}

describe('ABR presets', () => {
  it('reads descriptor brush settings and maps them to a brush preset', () => {
    const presets = readAbr(makeAbr())

    expect(presets).toEqual([{
      name: 'Test Liner', diameter: 42, spacing: 15, angle: 10,
      roundness: 80, hardness: 90, minimumDiameter: undefined,
    }])
    const brush = abrToBrush(presets[0])
    expect(brush).toMatchObject({
      name: 'Test Liner', family: 'ABR preset', size: 42,
      strokeMode: 'outline', passes: 1, jitter: 0,
    })
    expect(brush.thinning).toBeCloseTo(0.68)
  })

  it('rejects invalid files', () => {
    expect(() => readAbr(new Uint8Array(32))).toThrow()
  })
})
