import { useEffect, useRef, useState } from 'react'
import { fieldPrintLayout, rulerMm } from '../lib/field-print'
import sheetCss from './FieldPrint.css?inline'

interface Props {
  canvas: () => HTMLCanvasElement | null
  widthMm: number
  onWidthMmChange: (n: number) => void
}

export default function FieldPrint({ canvas, widthMm, onWidthMmChange }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { frame.current?.remove(); frame.current = null }, [])

  async function printField() {
    if (busy) return
    setError('')
    setBusy(true)
    frame.current?.remove()
    let sheet: HTMLIFrameElement | undefined
    try {
      const source = canvas()
      if (!source) throw new Error('Нет изображения поля.')
      const layout = fieldPrintLayout(widthMm, source.width, source.height)
      const png = source.toDataURL('image/png')
      sheet = document.createElement('iframe')
      sheet.title = 'Лист печати поля'
      sheet.tabIndex = -1
      sheet.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;pointer-events:none'
      const loaded = new Promise<void>((resolve, reject) => {
        sheet!.onload = () => resolve()
        sheet!.onerror = () => reject(new Error('Не удалось загрузить лист печати.'))
      })
      sheet.srcdoc = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Поле 1:1</title><style>${sheetCss}</style><figure><img alt="Поле" style="width:${layout.widthMm}mm;height:${layout.heightMm}mm" src="${png}"><figcaption><span class="ruler" style="width:${rulerMm}mm"></span>Контроль: ${rulerMm} мм · 1:1</figcaption></figure></html>`
      frame.current = sheet
      document.body.append(sheet)
      await loaded
      const win = sheet.contentWindow
      if (!win) throw new Error('Нет окна печати.')
      await win.document.images[0].decode()
      if (frame.current !== sheet) return
      win.print()
      // Non-blocking print dialogs may still need the document after print returns.
    } catch (err) {
      sheet?.remove()
      setError(err instanceof Error ? err.message : 'Не удалось напечатать поле.')
    } finally { setBusy(false) }
  }

  return <section aria-label="Печать поля">
    <label>Ширина поля, мм <input type="number" step="any" value={Number.isFinite(widthMm) ? widthMm : ''}
      onChange={e => { setError(''); onWidthMmChange(e.currentTarget.valueAsNumber) }} /></label>
    <p>Масштаб 1:1. Выберите A4, книжную ориентацию и 100% (фактический размер). Отключите подгонку и колонтитулы. Проверьте линейку 50 мм на бумаге.</p>
    <button type="button" disabled={busy} onClick={printField}>Печать поля 1:1</button>
    {error && <p role="alert">{error}</p>}
  </section>
}
