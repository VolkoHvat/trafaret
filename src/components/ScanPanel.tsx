import { useRef } from 'react'
import { FileImage, ScanLine } from 'lucide-react'
import type { LayerModel, ScanFilters } from '../types'
import { PanelHeading, Slider } from './UI'

const DEFAULT_FILTERS: ScanFilters = { grayscale: false, contrast: 100, threshold: 0, invert: false }

export function ScanPanel({ layer, onImport, onUpdate }: {
  layer?: LayerModel
  onImport: (file: File) => void
  onUpdate: (patch: Partial<LayerModel>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const filters = layer?.filters ?? DEFAULT_FILTERS
  const isImage = layer?.kind === 'image'
  const updateFilters = (patch: Partial<ScanFilters>) => {
    if (!layer) return
    onUpdate({ filters: { ...filters, ...patch }, filterKey: undefined })
  }
  const updateTransform = (patch: { scale?: number; rotation?: number; x?: number; y?: number }) => {
    if (!layer) return
    onUpdate({
      transform: {
        scale: layer.transform?.scale ?? 1,
        rotation: layer.transform?.rotation ?? 0,
        x: layer.transform?.x ?? 0,
        y: layer.transform?.y ?? 0,
        ...patch,
      },
    })
  }
  return (
    <section className="scan-section">
      <PanelHeading eyebrow="Reference" title="Скан и референс" />
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImport(file)
        event.target.value = ''
      }} />
      <button className="secondary-button full-width" onClick={() => inputRef.current?.click()}><FileImage size={16} />Импортировать изображение</button>
      {!layer ? (
        <p className="panel-note">Добавьте скан или выберите слой. Новый чистый слой для линии появится автоматически.</p>
      ) : (
        <div className="settings-group scan-settings">
          <div className="group-title"><ScanLine size={14} /><span>{layer.name}</span></div>
          {isImage && <>
            <Slider label="Масштаб" min={0.1} max={3} step={0.05} value={layer.transform?.scale ?? 1} onChange={(scale) => updateTransform({ scale })} />
            <Slider label="Поворот" min={-180} max={180} value={layer.transform?.rotation ?? 0} unit="°" onChange={(rotation) => updateTransform({ rotation })} />
            <Slider label="Смещение X" min={-2000} max={2000} value={layer.transform?.x ?? 0} unit=" px" onChange={(x) => updateTransform({ x })} />
            <Slider label="Смещение Y" min={-2000} max={2000} value={layer.transform?.y ?? 0} unit=" px" onChange={(y) => updateTransform({ y })} />
          </>}
          {!isImage && <p className="control-hint">Эффекты применяются при наложении. Исходные пиксели и векторные объекты не меняются.</p>}
          <Slider label="Контраст" min={40} max={260} value={filters.contrast} unit="%" onChange={(contrast) => updateFilters({ contrast })} />
          <Slider label="Порог линии" min={0} max={255} value={filters.threshold} onChange={(threshold) => updateFilters({ threshold })} />
          <p className="control-hint">0 — без постеризации. Увеличивайте порог для чистого трафарета.</p>
          <label className="check-row"><input type="checkbox" checked={filters.grayscale} onChange={(event) => updateFilters({ grayscale: event.target.checked })} /><span>Чёрно-белый исходник</span></label>
          <label className="check-row"><input type="checkbox" checked={filters.invert} onChange={(event) => updateFilters({ invert: event.target.checked })} /><span>Инвертировать</span></label>
        </div>
      )}
    </section>
  )
}
