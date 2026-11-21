export const rulerMm = 50
// Portrait A4, 10 mm margins and a 12 mm calibration strip below the image.
export const fieldPrintArea = { widthMm: 190, heightMm: 265 } as const

export function fieldPrintLayout(widthMm: number, pixelWidth: number, pixelHeight: number) {
  if (!Number.isFinite(widthMm) || widthMm <= 0) throw new Error('Введите положительную ширину в мм.')
  if (![pixelWidth, pixelHeight].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Нет изображения поля.')
  const heightMm = widthMm * (pixelHeight / pixelWidth)
  if (widthMm > fieldPrintArea.widthMm || heightMm > fieldPrintArea.heightMm) {
    throw new Error('Поле не помещается на A4 (область 190 × 265 мм). Уменьшите ширину; автоподгонки нет.')
  }
  return { widthMm, heightMm }
}
