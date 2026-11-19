export type ColorProfile = 'srgb' | 'display-p3'

const PRIMARIES = {
  srgb: [[0.64, 0.33, 0.3], [0.3, 0.6, 0.1], [0.15, 0.06, 0.79]],
  'display-p3': [[0.68, 0.32, 0.265], [0.265, 0.69, 0.15], [0.15, 0.06, 0.79]],
} as const

function fixed(value: number) {
  return Math.round(value * 65536)
}

function ascii(value: string) {
  return new TextEncoder().encode(value)
}

function xyzTag(value: readonly number[]) {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  bytes.set(ascii('XYZ '), 0)
  value.forEach((component, index) => view.setInt32(8 + index * 4, fixed(component)))
  return bytes
}

function trcTag() {
  const coefficients = [2.4, 1, 0, 1, 0.04045, 1 / 12.92, 0]
  const bytes = new Uint8Array(10 + coefficients.length * 4)
  const view = new DataView(bytes.buffer)
  bytes.set(ascii('curv'), 0)
  view.setUint16(8, 3)
  coefficients.forEach((value, index) => view.setInt32(10 + index * 4, fixed(value)))
  return bytes
}

function textTag(value: string) {
  return ascii(value)
}

export function writeIccProfile(profile: ColorProfile): Uint8Array {
  const tags = [
    ['rXYZ', xyzTag(PRIMARIES[profile][0])], ['gXYZ', xyzTag(PRIMARIES[profile][1])],
    ['bXYZ', xyzTag(PRIMARIES[profile][2])], ['wtpt', xyzTag([0.9642, 1, 0.8249])],
    ['rTRC', trcTag()], ['gTRC', trcTag()], ['bTRC', trcTag()],
    ['desc', textTag(profile === 'srgb' ? 'sRGB' : 'Display P3')],
    ['cprt', textTag('Public domain')],
  ] as const
  const tableSize = 4 + tags.length * 12
  const dataSize = tags.reduce((sum, [, data]) => sum + data.length + (4 - data.length % 4) % 4, 0)
  const bytes = new Uint8Array(128 + tableSize + dataSize)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  bytes.set(ascii('Kimi'), 4)
  view.setUint32(8, 0x04400000)
  bytes.set(ascii('mntr'), 12)
  bytes.set(ascii('RGB '), 16)
  bytes.set(ascii('XYZ '), 20)
  const now = new Date()
  ;[now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .forEach((value, index) => view.setUint16(24 + index * 2, value))
  bytes.set(ascii('acsp'), 36)
  bytes.set(ascii('MSFT'), 40)
  bytes.set(ascii('KIR '), 48)
  view.setInt32(68, fixed(0.9642))
  view.setInt32(72, fixed(1))
  view.setInt32(76, fixed(0.8249))
  bytes.set(ascii('KIR '), 80)
  view.setUint32(128, tags.length)
  let offset = 128 + tableSize
  tags.forEach(([signature, data], index) => {
    const entry = 132 + index * 12
    bytes.set(ascii(signature), entry)
    view.setUint32(entry + 4, offset)
    view.setUint32(entry + 8, data.length)
    bytes.set(data, offset)
    offset += data.length + (4 - data.length % 4) % 4
  })
  return bytes
}

function linear(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function encoded(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
]
const XYZ_TO_P3 = [
  [2.493497148, -0.931383444, -0.402710878],
  [-0.829489196, 1.762664089, 0.023624762],
  [0.035845774, -0.07617225, 0.956884494],
]

export function convertToDisplayP3(rgba: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]].map(value => linear(value / 255))
    const xyz = SRGB_TO_XYZ.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])
    for (let channel = 0; channel < 3; channel++) {
      const row = XYZ_TO_P3[channel]
      out[i + channel] = Math.round(encoded(row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]) * 255)
    }
    out[i + 3] = rgba[i + 3]
  }
  return out
}
