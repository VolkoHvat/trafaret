import { useState } from 'react'
import { bodyPlacementLayout, bodyPresets, bodyRegions, createBodyPlacement, type BodyPlacement, type BodyRegion, type Side } from '../lib/body-placement'
import './BodyPlacementPanel.css'

export interface BodyPlacementPanelProps {
  value?: BodyPlacement
  onChange?: (value: BodyPlacement) => void
}

// Coordinates on the 100 × 220 diagram; paired sites are mirrored for each view.
const sites: Record<BodyRegion, [number, number]> = {
  back: [50, 59], chest: [50, 59], neck: [50, 35], ribs: [60, 78],
  shoulder: [71, 49], forearm: [80, 82], hand: [86, 104], thigh: [61, 133], shin: [63, 181],
}
const sides = { left: 'Левая', right: 'Правая', center: 'Центр' }

function Numeric({ label, value, min, max, change }: {
  label: string; value: number; min: number; max: number; change: (n: number) => void
}) {
  return <label>{label}<input key={value} type="number" min={min} max={max} required step="any" defaultValue={value}
    onBlur={e => {
      const input = e.currentTarget
      if (input.checkValidity()) change(input.valueAsNumber)
      else { input.reportValidity(); input.value = String(value) }
    }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
}

export default function BodyPlacementPanel({ value, onChange }: BodyPlacementPanelProps) {
  const [local, setLocal] = useState(() => createBodyPlacement('back'))
  const v = value ?? local, p = bodyPresets[v.bodyRegion]
  function update(patch: Partial<BodyPlacement>) {
    const next = { ...v, ...patch }
    if (!value) setLocal(next)
    onChange?.(next)
  }
  function selectRegion(region: BodyRegion, side = bodyPresets[region].side as Side) {
    update({ ...createBodyPlacement(region), side,
      orientation: region === 'back' || region === 'chest' ? bodyPresets[region].orientation : v.orientation })
  }
  const { center, warnings } = bodyPlacementLayout(v)
  const m = v.safeMarginMm
  return <section className="body-placement-panel" aria-label="Область тела">
    <h2>Область тела · beta</h2>
    <div className="body-placement-layout">
      <div className="body-placement-form">
        <label>Пресет области<select value={v.bodyRegion} onChange={e => selectRegion(e.currentTarget.value as BodyRegion)}>
          {bodyRegions.map(id => <option key={id} value={id}>{bodyPresets[id].label}</option>)}
        </select></label>
        <label>Вид<select value={v.orientation} onChange={e => {
          const orientation = e.currentTarget.value as BodyPlacement['orientation']
          update({ orientation, ...(v.bodyRegion === 'back' || v.bodyRegion === 'chest'
            ? { bodyRegion: orientation === 'front' ? 'chest' : 'back', safeMarginMm: Math.min(m, 110) } : {}) })
        }}><option value="front">Спереди</option><option value="back">Сзади</option></select></label>
        <label>Сторона тела<select value={v.side} onChange={e => update({ side: e.currentTarget.value as Side })}>
          {Object.entries(sides).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <div className="body-placement-grid">
          <Numeric label="Ширина, мм" value={v.widthMm} min={0.1} max={2000} change={widthMm => update({ widthMm })} />
          <Numeric label="Высота, мм" value={v.heightMm} min={0.1} max={2000} change={heightMm => update({ heightMm })} />
          <Numeric label="Поворот, °" value={v.rotation} min={-180} max={180} change={rotation => update({ rotation })} />
          <Numeric label="Безопасный отступ, мм" value={m} min={0} max={Math.min(p.widthMm, p.heightMm) / 2} change={safeMarginMm => update({ safeMarginMm })} />
          {(['x', 'y'] as const).map(axis => <Numeric key={axis} label={`Центр ${axis} (0–1)`} value={v.placement[axis]} min={0} max={1}
            change={n => update({ placement: { ...v.placement, [axis]: n } })} />)}
        </div>
        <label>Поверхность<select value={v.wrap} onChange={e => update({ wrap: e.currentTarget.value as BodyPlacement['wrap'] })}>
          <option value="flat">Плоская</option><option value="contour-preview">Контурная подсказка</option>
        </select></label>
      </div>
      <div className="body-placement-preview">
        <svg viewBox="0 0 100 220" aria-label={`Выбор участка: ${v.orientation === 'front' ? 'спереди' : 'сзади'}`}>
          <circle cx="50" cy="18" r="13"/><path d="M44 29h12l2 9 17 5 14 55 2 12-9 3-14-50-2 36 4 105-11 3-9-94-9 94-11-3 4-105-2-36-14 50-9-3 2-12 14-55 17-5Z"/>
          {bodyRegions.filter(r => !(r === 'back' && v.orientation === 'front' || r === 'chest' && v.orientation === 'back')).flatMap(r => {
            const [px, y] = sites[r]
            return (px === 50 ? ['center'] as const : ['left', 'right'] as const).map(side => {
              const x = side === 'center' || (side === 'left') === (v.orientation === 'front') ? px : 100 - px
              const name = `${bodyPresets[r].label} · ${sides[side]}`
              return <circle key={`${r}-${side}`} className="bp-site" cx={x} cy={y} r="5" role="button" tabIndex={0}
                aria-label={name} aria-pressed={v.bodyRegion === r && v.side === side} onClick={() => selectRegion(r, side)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRegion(r, side) } }}><title>{name}</title></circle>
            })
          })}
        </svg>
        <p>{p.label} · условный участок {p.widthMm} × {p.heightMm} мм</p>
        <svg className="bp-patch" viewBox={`0 0 ${p.widthMm} ${p.heightMm}`} style={{ width: `min(100%, ${220 * p.widthMm / p.heightMm}px)`, aspectRatio: `${p.widthMm}/${p.heightMm}` }}
          preserveAspectRatio="none" role="img" aria-label="Точка на участке; для выбора с клавиатуры используйте поля центра X и Y"
          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); update({ placement: {
            x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
          } }) }}>
          <rect className="bp-safe" x={m} y={m} width={p.widthMm - 2*m} height={p.heightMm - 2*m} />
          <g transform={`translate(${center.x} ${center.y}) rotate(${v.rotation})`}>
            <rect className="bp-footprint" x={-v.widthMm/2} y={-v.heightMm/2} width={v.widthMm} height={v.heightMm}/>
            {v.wrap === 'contour-preview' && <path className="bp-guide" d={`M${-v.widthMm/2} 0 Q0 ${v.heightMm/3} ${v.widthMm/2} 0`}/>}
            <circle cx="0" cy="0" r="2"/>
          </g>
        </svg><p>Нажмите на участок или задайте центр X/Y.</p>
      </div>
    </div>
    <div role="status">{warnings.includes('crop') && <p>Эскиз выходит за границу участка.</p>}{warnings.includes('safe-margin') && <p>Нарушен безопасный отступ.</p>}</div>
    <small>Ручное размещение. Контур — условная 2D-подсказка, не 3D-модель. Силуэт не включается в печать или экспорт.</small>
  </section>
}
