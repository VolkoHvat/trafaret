import { useRef } from 'react'
import { FileImage, ScanLine } from 'lucide-react'
import type { LayerModel, ScanFilters } from '../types'
import { PanelHeading, Slider } from './UI'

export function ScanPanel({ layer, onImport, onUpdate }: {
  layer?: LayerModel
  onImport: (file: File) => void
  onUpdate: (patch: Partial<LayerModel>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const filters = layer?.filters
  const updateFilters = (patch: Partial<ScanFilters>) => {
    if (!layer || !filters) return
    onUpdate({ filters: { ...filters, ...patch }, filterKey: undefined })
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
      {!layer || !filters ? (
        <p className="panel-note">Добавьте скан или выберите его в слоях. Новый чистый слой для линии появится автоматически.</p>
      ) : (
        <div className="settings-group scan-settings">
          <div className="group-title"><ScanLine size={14} /><span>{layer.name}</span></div>
          <Slider label="Масштаб" min={0.1} max={3} step={0.05} value={layer.transform?.scale ?? 1} onChange={(scale) => onUpdate({ transform: { scale, rotation: layer.transform?.rotation ?? 0 } })} />
          <Slider label="Поворот" min={-180} max={180} value={layer.transform?.rotation ?? 0} unit="°" onChange={(rotation) => onUpdate({ transform: { scale: layer.transform?.scale ?? 1, rotation } })} />
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
