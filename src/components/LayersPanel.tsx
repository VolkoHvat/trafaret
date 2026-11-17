import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Plus, Trash2 } from 'lucide-react'
import type { LayerModel } from '../types'
import { PanelHeading, Slider } from './UI'

interface Props {
  layers: LayerModel[]
  activeId: string
  onSelect: (id: string) => void
  onChange: (layers: LayerModel[]) => void
  onAdd: () => void
  onDelete: () => void
  onDuplicate: () => void
}

export function LayersPanel({ layers, activeId, onSelect, onChange, onAdd, onDelete, onDuplicate }: Props) {
  const active = layers.find((layer) => layer.id === activeId)
  const update = (id: string, patch: Partial<LayerModel>) => onChange(layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer))
  const move = (id: string, delta: number) => {
    const index = layers.findIndex((layer) => layer.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= layers.length) return
    const next = [...layers]
    const [layer] = next.splice(index, 1)
    next.splice(target, 0, layer)
    onChange(next)
  }

  return (
    <section className="layers-section">
      <PanelHeading eyebrow="Документ" title="Слои" action={
        <div className="inline-actions">
          <button className="icon-button" onClick={onAdd} title="Добавить слой" aria-label="Добавить слой"><Plus size={17} /></button>
          <button className="icon-button" onClick={onDuplicate} title="Дублировать слой" aria-label="Дублировать активный слой"><Copy size={16} /></button>
          <button className="icon-button danger" onClick={onDelete} title="Удалить слой" aria-label="Удалить активный слой"><Trash2 size={16} /></button>
        </div>
      } />
      <div className="layers-list">
        {[...layers].reverse().map((layer) => (
          <div key={layer.id} className={`layer-row ${layer.id === activeId ? 'active' : ''}`}>
            <button className="layer-select" onClick={() => onSelect(layer.id)} aria-label={`Выбрать слой ${layer.name}`}>
              <span className="layer-kind">{layer.kind === 'image' ? <ImageIcon size={14} /> : 'L'}</span>
              <span className="layer-name">{layer.name}</span>
            </button>
            <button className="icon-button compact" onClick={() => update(layer.id, { visible: !layer.visible })} aria-label={layer.visible ? `Скрыть ${layer.name}` : `Показать ${layer.name}`}>
              {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon-button compact" onClick={() => update(layer.id, { locked: !layer.locked })} aria-label={layer.locked ? `Разблокировать ${layer.name}` : `Заблокировать ${layer.name}`}>
              {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <div className="layer-order">
              <button className="icon-button compact" onClick={() => move(layer.id, 1)} disabled={layers.indexOf(layer) === layers.length - 1} aria-label="Поднять слой"><ArrowUp size={13} /></button>
              <button className="icon-button compact" onClick={() => move(layer.id, -1)} disabled={layers.indexOf(layer) === 0} aria-label="Опустить слой"><ArrowDown size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      {active && (
        <div className="layer-settings">
          <Slider label="Непрозрачность слоя" min={0.05} max={1} step={0.05} value={active.opacity} onChange={(opacity) => update(active.id, { opacity })} />
          <label className="select-field">
            <span>Смешивание</span>
            <select value={active.blend} onChange={(event) => update(active.id, { blend: event.target.value as GlobalCompositeOperation })}>
              <option value="source-over">Обычное</option>
              <option value="multiply">Умножение</option>
              <option value="screen">Экран</option>
              <option value="overlay">Перекрытие</option>
              <option value="darken">Затемнение</option>
            </select>
          </label>
        </div>
      )}
    </section>
  )
}
