export const SMALL = { width: 384, height: 240 }, LARGE = { width: 2048, height: 2048 }
export type Size = typeof SMALL
export function sizeOf(cells: number): Size {
  if (cells === SMALL.width * SMALL.height) return SMALL
  if (cells === LARGE.width * LARGE.height) return LARGE
  throw new RangeError('Неподдерживаемый размер поля')
}
