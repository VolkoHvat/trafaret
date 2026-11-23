import { Circle, Grid2X2, PenTool, RotateCw, Scan, Square } from 'lucide-react'
import type { GuideMode, SelectionModel, ShapeKind, SymmetryMode } from '../types'
import { PanelHeading, Slider } from './UI'

export function DocumentPanel({
  symmetry, radialCount, guide, shapeKind, areaShape, selection,
  onSymmetry, onRadialCount, onGuide, onShapeKind, onAreaShape,
  onSelectionChange, onCommitPen, onCancelDraft,
}: {
  symmetry: SymmetryMode
  radialCount: number
  guide: GuideMode
  shapeKind: ShapeKind
  areaShape: 'rectangle' | 'ellipse'
  selection: SelectionModel | null
  onSymmetry: (value: SymmetryMode) => void
  onRadialCount: (value: number) => void
  onGuide: (value: GuideMode) => void
  onShapeKind: (value: ShapeKind) => void
  onAreaShape: (value: 'rectangle' | 'ellipse') => void
  onSelectionChange: (value: SelectionModel | null) => void
  onCommitPen: (closed: boolean) => void
  onCancelDraft: () => void
}) {
  return (
    <section className="document-section">
      <PanelHeading eyebrow="Construction" title="Построение линии" />
      <div className="option-block">
        <span className="option-label">Симметрия</span>
        <div className="segmented-control three">
          <button className={symmetry === 'off' ? 'active' : ''} onClick={() => onSymmetry('off')}>Нет</button>
          <button className={symmetry === 'vertical' ? 'active' : ''} onClick={() => onSymmetry('vertical')}>Ось</button>
          <button className={symmetry === 'radial' ? 'active' : ''} onClick={() => onSymmetry('radial')}>Круг</button>
        </div>
        {symmetry === 'radial' && <Slider label="Секторы" min={3} max={12} value={radialCount} onChange={onRadialCount} />}
      </div>
      <div className="option-block">
        <span className="option-label">Направляющая</span>
        <div className="segmented-control three">
          <button className={guide === 'none' ? 'active' : ''} onClick={() => onGuide('none')}>Нет</button>
          <button className={guide === 'circle' ? 'active' : ''} onClick={() => onGuide('circle')} aria-label="Круглая направляющая"><Circle size={14} />Круг</button>
          <button className={guide === 'ellipse' ? 'active' : ''} onClick={() => onGuide('ellipse')} aria-label="Овальная направляющая"><Scan size={14} />Овал</button>
        </div>
      </div>
      <div className="option-block">
        <span className="option-label">Фигура и выделение</span>
        <div className="segmented-control three">
          <button className={shapeKind === 'rectangle' ? 'active' : ''} onClick={() => onShapeKind('rectangle')}><Square size={13} />Прям.</button>
          <button className={shapeKind === 'ellipse' ? 'active' : ''} onClick={() => onShapeKind('ellipse')}><Circle size={13} />Эллипс</button>
          <button className={shapeKind === 'arc' ? 'active' : ''} onClick={() => onShapeKind('arc')}><RotateCw size={13} />Дуга</button>
        </div>
        <div className="segmented-control">
          <button className={areaShape === 'rectangle' ? 'active' : ''} onClick={() => onAreaShape('rectangle')}><Grid2X2 size={13} />Область</button>
          <button className={areaShape === 'ellipse' ? 'active' : ''} onClick={() => onAreaShape('ellipse')}><Circle size={13} />Эллипс</button>
        </div>
        {selection && <div className="inline-actions spread"><button className="secondary-button" onClick={() => onSelectionChange({ ...selection, inverse: !selection.inverse })}>Инвертировать</button><button className="secondary-button" onClick={() => onSelectionChange(null)}>Снять</button></div>}
      </div>
      <div className="option-block pen-actions">
        <span className="option-label"><PenTool size={12} />Перьевой контур</span>
        <p className="control-hint">Ставьте узлы касанием. Двойной клик завершает открытый путь.</p>
        <div className="inline-actions spread"><button className="secondary-button" onClick={() => onCommitPen(false)}>Завершить</button><button className="secondary-button" onClick={() => onCommitPen(true)}>Замкнуть</button><button className="icon-button" onClick={onCancelDraft} aria-label="Отменить черновик">×</button></div>
      </div>
    </section>
  )
}
