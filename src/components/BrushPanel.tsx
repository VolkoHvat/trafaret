import { Brush, Check, Copy, Pipette, Save, Spline, Trash2 } from 'lucide-react'
import type { BrushConfig, BrushId, BrushPreset, PressureCurve } from '../types'
import { BRUSH_ORDER } from '../lib/brushes'
import { PanelHeading, Slider } from './UI'

const PALETTE = ['#171914', '#f2f0e7', '#7d1f2d', '#1f4e46', '#314c76', '#a36938']

export function BrushPanel({
  brushes, activeId, customPresets, activeCustomIndex, onSelect, onSelectCustom,
  onSavePreset, onDeletePreset, onUpdate, color, onColor, stylusOnly, onStylusOnly,
  selectedObjectSize, onObjectSize, simplifyEpsilon, onSimplifyEpsilon, onSimplify, onDuplicate,
}: {
  brushes: Record<BrushId, BrushConfig>
  activeId: BrushId
  customPresets: BrushPreset[]
  activeCustomIndex: number | null
  onSelect: (id: BrushId) => void
  onSelectCustom: (index: number) => void
  onSavePreset: () => void
  onDeletePreset: () => void
  onUpdate: (patch: Partial<BrushConfig>) => void
  color: string
  onColor: (color: string) => void
  stylusOnly: boolean
  onStylusOnly: (value: boolean) => void
  selectedObjectSize: number | null
  onObjectSize: (size: number) => void
  simplifyEpsilon: number
  onSimplifyEpsilon: (value: number) => void
  onSimplify?: () => void
  onDuplicate?: () => void
}) {
  const brush = activeCustomIndex !== null && customPresets[activeCustomIndex]
    ? customPresets[activeCustomIndex].config
    : brushes[activeId]
  return (
    <div className="brush-panel-content">
      <PanelHeading eyebrow="Linework" title="Кисти и пресеты" action={
        <div className="inline-actions">
          <button className="icon-button" onClick={onSavePreset} title="Сохранить текущую кисть как пресет" aria-label="Сохранить пресет кисти"><Save size={16} /></button>
          {activeCustomIndex !== null && <button className="icon-button danger" onClick={onDeletePreset} aria-label="Удалить пользовательский пресет"><Trash2 size={15} /></button>}
        </div>
      } />
      <div className="brush-list">
        {BRUSH_ORDER.map((id) => {
          const item = brushes[id]
          const active = activeCustomIndex === null && id === activeId
          return (
            <button key={id} className={`brush-preset ${active ? 'active' : ''}`} onClick={() => onSelect(id)} aria-pressed={active}>
              <span className={`brush-sample sample-${id}`}><i style={{ height: `${Math.min(12, Math.max(1, item.size / 3))}px` }} /></span>
              <span><strong>{item.name}</strong><small>{item.family}</small></span>
              {active && <Check size={14} />}
            </button>
          )
        })}
        {customPresets.map((preset, index) => (
          <button key={`${preset.name}-${index}`} className={`brush-preset custom ${activeCustomIndex === index ? 'active' : ''}`} onClick={() => onSelectCustom(index)} aria-pressed={activeCustomIndex === index}>
            <span className={`brush-sample sample-${preset.config.id}`}><i style={{ height: `${Math.min(12, Math.max(1, preset.config.size / 3))}px` }} /></span>
            <span><strong>{preset.name}</strong><small>Мой пресет · {preset.config.family}</small></span>
            {activeCustomIndex === index && <Check size={14} />}
          </button>
        ))}
      </div>

      {selectedObjectSize !== null && (
        <div className="settings-group selected-object-settings">
          <div className="group-title"><Spline size={14} /><span>Выбранный объект</span></div>
          <Slider label="Толщина объекта" min={1} max={120} value={selectedObjectSize} unit=" px" onChange={onObjectSize} />
          <p className="control-hint">Меняется только выбранная векторная линия, не кисть.</p>
          {onDuplicate && <button className="secondary-button full-width" onClick={onDuplicate}><Copy size={15} />Дублировать · Ctrl+D</button>}
          {onSimplify && <>
            <Slider label="Допуск упрощения" min={0.5} max={12} step={0.5} value={simplifyEpsilon} unit=" px" onChange={onSimplifyEpsilon} />
            <button className="secondary-button full-width" onClick={onSimplify}><Spline size={15} />Упростить контур</button>
          </>}
        </div>
      )}

      <div className="settings-group">
        <div className="group-title"><Brush size={14} /><span>Форма линии</span></div>
        <Slider label="Размер" min={1} max={120} value={brush.size} unit=" px" onChange={size => onUpdate({ size })} />
        <Slider label="Непрозрачность" min={0.03} max={1} step={0.01} value={brush.opacity} onChange={opacity => onUpdate({ opacity })} />
        <Slider label="Стабилизация" min={0} max={95} value={Math.round(brush.streamline * 100)} unit="%" onChange={value => onUpdate({ streamline: value / 100, smoothing: 0.45 + value / 200 })} />
        <Slider label="Динамика нажатия" min={0} max={100} value={Math.round(brush.thinning * 100)} unit="%" onChange={value => onUpdate({ thinning: value / 100 })} />
        <div className="two-sliders">
          <Slider label="Вход" min={0} max={60} value={brush.taperStart} onChange={taperStart => onUpdate({ taperStart })} />
          <Slider label="Выход" min={0} max={80} value={brush.taperEnd} onChange={taperEnd => onUpdate({ taperEnd })} />
        </div>
        <div className="two-sliders">
          <Slider label="Проходы" min={1} max={4} value={brush.passes} onChange={passes => onUpdate({ passes })} />
          <Slider label="Рассеивание" min={0} max={30} value={Math.round(brush.jitter * 100)} unit="%" onChange={value => onUpdate({ jitter: value / 100 })} />
        </div>
        <label className="select-field">
          <span>Кривая пера</span>
          <select value={brush.pressureCurve} onChange={event => onUpdate({ pressureCurve: event.target.value as PressureCurve })}>
            <option value="soft">Мягкий вход</option>
            <option value="linear">Линейная</option>
            <option value="firm">Плотный контакт</option>
          </select>
        </label>
      </div>

      <div className="settings-group color-group">
        <div className="group-title"><Pipette size={14} /><span>Пигмент</span></div>
        <div className="color-controls">
          <label className="color-well" title="Выбрать цвет"><input type="color" value={color} onChange={event => onColor(event.target.value)} /><span style={{ background: color }} /></label>
          <code>{color.toUpperCase()}</code>
        </div>
        <div className="swatches">
          {PALETTE.map(swatch => <button key={swatch} className={color === swatch ? 'selected' : ''} style={{ '--swatch': swatch } as React.CSSProperties} onClick={() => onColor(swatch)} aria-label={`Цвет ${swatch}`} />)}
        </div>
      </div>

      <label className="toggle-row">
        <span><strong>Только перо</strong><small>Не рисовать ладонью</small></span>
        <input type="checkbox" checked={stylusOnly} onChange={event => onStylusOnly(event.target.checked)} />
      </label>
    </div>
  )
}
