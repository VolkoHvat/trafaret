import type { BrushConfig } from '../types'

interface AbrDescriptor {
  name: string
  classID: string
  items: Record<string, { type: string; value: unknown }>
}

export interface AbrPreset {
  name: string
  diameter?: number
  spacing?: number
  angle?: number
  roundness?: number
  hardness?: number
  minimumDiameter?: number
}

class Reader {
  readonly view: DataView
  readonly bytes: Uint8Array
  offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8() { return this.view.getUint8(this.offset++) }
  u16() { const value = this.view.getUint16(this.offset); this.offset += 2; return value }
  u32() { const value = this.view.getUint32(this.offset); this.offset += 4; return value }
  i32() { const value = this.view.getInt32(this.offset); this.offset += 4; return value }
  i64() { const value = this.view.getBigInt64(this.offset); this.offset += 8; return value }
  double() { const value = this.view.getFloat64(this.offset); this.offset += 8; return value }
  bytesRead(length: number) {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error('ABR обрезан')
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }
  ascii(length: number) { return new TextDecoder('ascii').decode(this.bytesRead(length)) }
  unicode() {
    const length = this.u32()
    if (length > 1_000_000) throw new Error('Слишком длинная строка ABR')
    return new TextDecoder('utf-16be').decode(this.bytesRead(length * 2)).replace(/\0+$/, '')
  }
  idString() {
    const length = this.u32()
    return this.ascii(length === 0 ? 4 : length)
  }
}

function readDescriptor(reader: Reader): AbrDescriptor {
  const name = reader.unicode()
  const classID = reader.idString()
  const count = reader.u32()
  if (count > 100_000) throw new Error('Слишком много полей ABR')
  const items: AbrDescriptor['items'] = {}
  for (let index = 0; index < count; index++) {
    const key = reader.idString()
    const type = reader.ascii(4)
    items[key] = { type, value: readValue(reader, type) }
  }
  return { name, classID, items }
}

function readReference(reader: Reader) {
  const count = reader.u32()
  for (let index = 0; index < count; index++) {
    const type = reader.ascii(4)
    if (type === 'prop') {
      reader.unicode(); reader.idString(); reader.idString()
    } else if (type === 'Clss') {
      reader.unicode(); reader.idString()
    } else if (type === 'Enmr') {
      reader.unicode(); reader.idString(); reader.idString(); reader.idString()
    } else if (type === 'rele') {
      reader.unicode(); reader.idString(); reader.i32()
    } else if (type === 'Idnt' || type === 'indx') {
      reader.i32()
    } else if (type === 'name') {
      reader.unicode(); reader.idString(); reader.unicode()
    } else throw new Error('Неизвестный reference ABR')
  }
}

function readValue(reader: Reader, type: string): unknown {
  if (type === 'Objc' || type === 'GlbO') return readDescriptor(reader)
  if (type === 'VlLs') {
    const count = reader.u32()
    return Array.from({ length: count }, () => {
      const itemType = reader.ascii(4)
      return readValue(reader, itemType)
    })
  }
  if (type === 'doub') return reader.double()
  if (type === 'UntF') return { unit: reader.ascii(4), value: reader.double() }
  if (type === 'TEXT') return reader.unicode()
  if (type === 'enum') return { type: reader.idString(), value: reader.idString() }
  if (type === 'long') return reader.i32()
  if (type === 'comp') return reader.i64()
  if (type === 'bool') return reader.u8() !== 0
  if (type === 'type' || type === 'GlbC') {
    reader.unicode(); reader.idString(); return null
  }
  if (type === 'alis' || type === 'tdta') return reader.bytesRead(reader.u32())
  if (type === 'obj ') return readReference(reader)
  throw new Error(`Неизвестный тип ABR ${type}`)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value === 'object' && 'value' in value) {
    const nested = (value as { value: unknown }).value
    if (typeof nested === 'number') return nested
  }
  return undefined
}

function presetFromDescriptor(descriptor: AbrDescriptor): AbrPreset {
  const items = descriptor.items
  const tip = items.Brsh?.value as AbrDescriptor | undefined
  return {
    name: String(items['Nm  ']?.value ?? tip?.items['Nm  ']?.value ?? 'ABR preset'),
    diameter: numberValue(tip?.items.Dmtr?.value),
    spacing: numberValue(tip?.items.Spcn?.value),
    angle: numberValue(tip?.items.Angl?.value),
    roundness: numberValue(tip?.items.Rndn?.value),
    hardness: numberValue(tip?.items.Hrdn?.value),
    minimumDiameter: numberValue(items.minimumDiameter?.value),
  }
}

export function readAbr(bytes: Uint8Array): AbrPreset[] {
  const reader = new Reader(bytes)
  reader.u16()
  reader.u16()
  const presets: AbrPreset[] = []
  while (reader.offset + 12 <= bytes.length) {
    if (reader.ascii(4) !== '8BIM') break
    const key = reader.ascii(4)
    const length = reader.u32()
    const end = reader.offset + length
    if (end > bytes.length) throw new Error('ABR секция обрезана')
    if (key === 'desc') {
      reader.u32()
      const descriptor = readDescriptor(reader)
      const list = descriptor.items.Brsh?.value
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && typeof item === 'object' && 'items' in item) presets.push(presetFromDescriptor(item as AbrDescriptor))
        }
      }
    }
    reader.offset = end
  }
  if (!presets.length) throw new Error('В ABR не найдены brush presets')
  return presets
}

export function abrToBrush(preset: AbrPreset): BrushConfig {
  const minimum = preset.minimumDiameter ?? 32
  return {
    id: 'fineline', name: preset.name, family: 'ABR preset',
    size: Math.max(1, Math.min(120, preset.diameter ?? 10)), opacity: 1,
    thinning: Math.max(0, Math.min(1, 1 - minimum / 100)), streamline: 0.5,
    smoothing: 0.65, taperStart: 0, taperEnd: 0, pressureCurve: 'soft',
    passes: 1, jitter: 0, strokeMode: 'outline',
  }
}
