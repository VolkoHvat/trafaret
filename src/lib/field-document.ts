import { SMALL, sizeOf } from './field-size'
const { width: WIDTH, height: HEIGHT } = SMALL

const CELLS = WIDTH * HEIGHT, HEADER = 24
export const FIELD_BYTES = HEADER + 8 * CELLS
const MAGIC = 'TRAFDENS'
function checksum(bytes: Uint8Array) {
  let h = 2166136261
  for (let i = HEADER; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619)
  return h >>> 0
}
export function validateDensity(field: Float64Array) {
  let sum = 0
  for (let i = 0; i < field.length; i++) {
    const m = field[i]
    if (!Number.isFinite(m) || m < 0) throw new Error('Недопустимая плотность')
    sum += m
  }
  if (Math.abs(sum - field.length) > 1e-5) throw new Error('Нарушен баланс поля')
}
export function encodeField(field: Float64Array) {
  validateDensity(field)
  const CELLS = field.length, { width: WIDTH, height: HEIGHT } = sizeOf(CELLS)
  const buffer = new ArrayBuffer(HEADER + field.byteLength), bytes = new Uint8Array(buffer), v = new DataView(buffer)
  bytes.set(new TextEncoder().encode(MAGIC)); v.setUint32(8, 2, true); v.setUint32(12, WIDTH, true); v.setUint32(16, HEIGHT, true)
  for (let i = 0; i < CELLS; i++) v.setFloat64(HEADER + i * 8, field[i], true)
  v.setUint32(20, checksum(bytes), true)
  return buffer
}
export function decodeField(buffer: ArrayBuffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER || (buffer.byteLength - HEADER) % 8 !== 0) throw new Error('Неверный размер поля')
  const CELLS = (buffer.byteLength - HEADER) / 8, { width: WIDTH, height: HEIGHT } = sizeOf(CELLS)
  const bytes = new Uint8Array(buffer), v = new DataView(buffer)
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC || v.getUint32(8, true) !== 2 || v.getUint32(12, true) !== WIDTH || v.getUint32(16, true) !== HEIGHT) throw new Error('Неизвестный формат поля')
  if (v.getUint32(20, true) !== checksum(bytes)) throw new Error('Повреждены данные поля')
  const field = new Float64Array(CELLS)
  let sum = 0
  for (let i = 0; i < CELLS; i++) {
    const m = v.getFloat64(HEADER + i * 8, true)
    if (!Number.isFinite(m) || m < 0) throw new Error('Недопустимая плотность')
    field[i] = m; sum += m
  }
  if (Math.abs(sum - CELLS) > 1e-5) throw new Error('Нарушен баланс поля')
  return field
}
