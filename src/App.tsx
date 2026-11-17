import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Brush, Columns2, Download, Eraser, FilePlus2, FlipHorizontal2, FolderOpen, Hand,
  HelpCircle, Layers3, Maximize, Minus, Pipette, Redo2, Save, ScanLine,
  SlidersHorizontal, Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import { get, set } from 'idb-keyval'
import { StudioCanvas, type StudioHandle } from './components/StudioCanvas'
import { BrushPanel } from './components/BrushPanel'
import { LayersPanel } from './components/LayersPanel'
import { ScanPanel } from './components/ScanPanel'
import { StudioDialog } from './components/UI'
import { BRUSH_ORDER, DEFAULT_BRUSHES } from './lib/brushes'
import {
  downloadBlob, fileToDataURL, loadImage, makeCanvas, makePaintLayer, redrawImageLayer,
  restoreProject, safeFilename, snapshotProject, uid,
} from './lib/project'
import type { BrushConfig, BrushId, DocModel, LayerModel, ProjectSnapshot, ToolId, ViewState } from './types'
import './App.css'

const AUTOSAVE_KEY = 'trafaret-autosave-v1'
const SETTINGS_KEY = 'trafaret-settings-v1'
const initialDoc: DocModel = { width: 2048, height: 2048, title: 'Новый эскиз' }

interface WorkspaceSettings {
  brushId?: BrushId
  brushes?: Partial<Record<BrushId, Partial<BrushConfig>>>
  color?: string
  stylusOnly?: boolean
}

function readWorkspaceSettings(): WorkspaceSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as WorkspaceSettings }
  catch { return {} }
}
const initialView: ViewState = { zoom: 0.25, panX: 80, panY: 80 }
type ModalId = 'new' | 'export' | 'help' | null

export default function App() {
  const workspaceSettings = useRef(readWorkspaceSettings()).current
  const [doc, setDoc] = useState<DocModel>(initialDoc)
  const [layers, setLayers] = useState<LayerModel[]>(() => [makePaintLayer(initialDoc, 'Линия 1')])
  const [activeLayerId, setActiveLayerId] = useState(() => layers[0].id)
  const [tool, setTool] = useState<ToolId>('brush')
  const [brushId, setBrushId] = useState<BrushId>(() => workspaceSettings.brushId && BRUSH_ORDER.includes(workspaceSettings.brushId) ? workspaceSettings.brushId : 'fineline')
  const [brushes, setBrushes] = useState<Record<BrushId, BrushConfig>>(() => Object.fromEntries(
    BRUSH_ORDER.map((id) => [id, { ...DEFAULT_BRUSHES[id], ...workspaceSettings.brushes?.[id] }]),
  ) as Record<BrushId, BrushConfig>)
  const [color, setColor] = useState(workspaceSettings.color ?? '#171914')
  const [symmetry, setSymmetry] = useState(false)
  const [stencil, setStencil] = useState(false)
  const [stylusOnly, setStylusOnly] = useState(workspaceSettings.stylusOnly ?? true)
  const [flipped, setFlipped] = useState(false)
  const [view, setView] = useState<ViewState>(initialView)
  const [renderToken, setRenderToken] = useState(0)
  const [saveVersion, setSaveVersion] = useState(0)
  const [projectSession, setProjectSession] = useState(0)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [modal, setModal] = useState<ModalId>(null)
  const [notice, setNotice] = useState('')
  const [saveStatus, setSaveStatus] = useState('Только на этом устройстве')
  const [hydrated, setHydrated] = useState(false)
  const [newTitle, setNewTitle] = useState('Новый эскиз')
  const [newWidth, setNewWidth] = useState(2048)
  const [newHeight, setNewHeight] = useState(2048)
  const [exporting, setExporting] = useState(false)
  const studioRef = useRef<StudioHandle>(null)
  const openProjectRef = useRef<HTMLInputElement>(null)
  const activeLayer = layers.find((layer) => layer.id === activeLayerId)
  const activeImage = activeLayer?.kind === 'image' ? activeLayer : undefined
  const currentBrush = brushes[brushId]

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ brushId, brushes, color, stylusOnly })) }
    catch { /* Settings persistence is optional when storage is unavailable. */ }
  }, [brushId, brushes, color, stylusOnly])

  const showNotice = useCallback((message: string) => setNotice(message), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timer)
  }, [notice])

  const mutate = useCallback(() => {
    setSaveVersion((value) => value + 1)
    setRenderToken((value) => value + 1)
  }, [])

  const changeLayers = useCallback((next: LayerModel[]) => {
    setLayers(next)
    mutate()
  }, [mutate])

  const loadProject = useCallback(async (snapshot: ProjectSnapshot) => {
    const restored = await restoreProject(snapshot)
    setDoc(restored.doc)
    setLayers(restored.layers)
    setActiveLayerId(restored.activeLayerId)
    setProjectSession((value) => value + 1)
    setView(initialView)
    mutate()
    setTimeout(() => studioRef.current?.fitView(), 80)
  }, [mutate])

  useEffect(() => {
    let cancelled = false
    get<ProjectSnapshot>(AUTOSAVE_KEY).then(async (saved) => {
      if (saved && !cancelled) {
        try { await loadProject(saved) } catch { /* Start with a clean document. */ }
      }
      if (!cancelled) {
        setHydrated(true)
        setTimeout(() => studioRef.current?.fitView(), 80)
      }
    }).catch(() => setHydrated(true))
    return () => { cancelled = true }
  }, [loadProject])

  useEffect(() => {
    if (!hydrated) return
    setSaveStatus('Локальное сохранение…')
    const timer = setTimeout(() => {
      try {
        const snapshot = snapshotProject(doc, layers, activeLayerId)
        set(AUTOSAVE_KEY, snapshot)
          .then(() => setSaveStatus(`Сохранено локально · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`))
          .catch(() => setSaveStatus('Не удалось сохранить — экспортируйте проект'))
      } catch {
        setSaveStatus('Не удалось сохранить — экспортируйте проект')
      }
    }, 1100)
    return () => clearTimeout(timer)
  }, [doc, layers, activeLayerId, saveVersion, hydrated])

  const createProject = () => {
    const nextDoc = {
      width: Math.max(256, Math.min(4096, Math.round(newWidth))),
      height: Math.max(256, Math.min(4096, Math.round(newHeight))),
      title: newTitle.trim() || 'Новый эскиз',
    }
    const layer = makePaintLayer(nextDoc, 'Линия 1')
    setDoc(nextDoc)
    setLayers([layer])
    setActiveLayerId(layer.id)
    setProjectSession((value) => value + 1)
    setView(initialView)
    setModal(null)
    mutate()
    setTimeout(() => studioRef.current?.fitView(), 80)
  }

  const saveProject = useCallback(() => {
    const snapshot = snapshotProject(doc, layers, activeLayerId)
    downloadBlob(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }), `${safeFilename(doc.title)}.tattoo.json`)
    showNotice('Проект сохранён файлом')
  }, [doc, layers, activeLayerId, showNotice])

  const importScan = async (file: File) => {
    if (!file.type.startsWith('image/')) return showNotice('Нужен PNG, JPEG или WebP')
    if (file.size > 40 * 1024 * 1024) return showNotice('Изображение слишком большое: максимум 40 МБ')
    try {
      const source = await fileToDataURL(file)
      const image = await loadImage(source)
      const layer: LayerModel = {
        id: uid(), name: `Скан · ${file.name.slice(0, 28)}`, kind: 'image', visible: true, locked: true,
        opacity: 0.62, blend: 'multiply', canvas: makeCanvas(doc.width, doc.height), source, pixelVersion: 0,
        sourceImage: image, transform: { scale: 1, rotation: 0, x: 0, y: 0 },
        filters: { grayscale: true, contrast: 112, threshold: 0, invert: false },
      }
      redrawImageLayer(layer)
      const line = makePaintLayer(doc, `Линия ${layers.filter((item) => item.kind === 'paint').length + 1}`)
      changeLayers([layer, ...layers, line])
      setActiveLayerId(line.id)
      setTool('brush')
      showNotice('Скан размещён. Чистый слой для линии готов')
    } catch {
      showNotice('Не удалось прочитать изображение')
    }
  }

  const updateActiveLayer = (patch: Partial<LayerModel>) => {
    if (!activeLayer) return
    const next = { ...activeLayer, ...patch }
    if (patch.transform) redrawImageLayer(next)
    if (patch.filters || patch.transform) next.filterKey = undefined
    changeLayers(layers.map((layer) => layer.id === activeLayer.id ? next : layer))
  }

  const addLayer = () => {
    const layer = makePaintLayer(doc, `Линия ${layers.filter((item) => item.kind === 'paint').length + 1}`)
    changeLayers([...layers, layer])
    setActiveLayerId(layer.id)
  }

  const deleteLayer = () => {
    if (layers.length <= 1) return showNotice('В проекте должен остаться хотя бы один слой')
    if (!activeLayer) return
    const index = layers.indexOf(activeLayer)
    const next = layers.filter((layer) => layer.id !== activeLayer.id)
    studioRef.current?.dropHistoryFor(activeLayer.id)
    changeLayers(next)
    setActiveLayerId(next[Math.min(index, next.length - 1)].id)
  }

  const duplicateLayer = () => {
    if (!activeLayer) return
    const canvas = makeCanvas(doc.width, doc.height)
    canvas.getContext('2d')!.drawImage(activeLayer.canvas, 0, 0)
    const copy: LayerModel = { ...activeLayer, id: uid(), name: `${activeLayer.name} · копия`, canvas, filterCache: undefined, filterKey: undefined }
    const index = layers.indexOf(activeLayer)
    const next = [...layers]
    next.splice(index + 1, 0, copy)
    changeLayers(next)
    setActiveLayerId(copy.id)
  }

  const exportImage = async (transparent: boolean, stencilMode: boolean, onlyActive = false) => {
    if (!studioRef.current) return
    setExporting(true)
    try {
      const blob = await studioRef.current.exportImage(transparent, stencilMode, onlyActive)
      const suffix = onlyActive ? '-active-layer' : stencilMode ? '-stencil' : transparent ? '-transparent' : ''
      downloadBlob(blob, `${safeFilename(doc.title)}${suffix}.png`)
      setModal(null)
      showNotice('PNG экспортирован')
    } catch {
      showNotice('Не удалось экспортировать PNG')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || modal) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) studioRef.current?.redo()
        else studioRef.current?.undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault(); saveProject(); return
      }
      const tools: Record<string, ToolId> = { b: 'brush', e: 'eraser', l: 'line', h: 'pan', i: 'picker' }
      if (tools[key]) setTool(tools[key])
      else if (key === 'm') setSymmetry((value) => !value)
      else if (key === 't') setStencil((value) => !value)
      else if (key === '[' || key === ']') {
        const delta = key === '[' ? -1 : 1
        setBrushes((current) => ({ ...current, [brushId]: { ...current[brushId], size: Math.max(1, Math.min(120, current[brushId].size + delta)) } }))
      } else if (key === '+' || key === '=') setView((current) => ({ ...current, zoom: Math.min(8, current.zoom * 1.2) }))
      else if (key === '-') setView((current) => ({ ...current, zoom: Math.max(0.03, current.zoom / 1.2) }))
      else if (key === '0') studioRef.current?.fitView()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [brushId, modal, saveProject])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const debug = {
      getState: () => ({
        doc: { ...doc }, layers: layers.map((layer) => ({ id: layer.id, name: layer.name, kind: layer.kind, visible: layer.visible, locked: layer.locked })),
        activeLayerId, tool, brushId, symmetry, stencil, zoom: view.zoom,
        historyPixels: studioRef.current?.historyPixels() ?? 0,
      }),
    }
    Object.assign(window, { __tattooStudio: debug })
    return () => { delete (window as Window & { __tattooStudio?: unknown }).__tattooStudio }
  }, [doc, layers, activeLayerId, tool, brushId, symmetry, stencil, view.zoom])

  const toolButtons: { id: ToolId; label: string; icon: React.ReactNode; key: string }[] = [
    { id: 'brush', label: 'Кисть', icon: <Brush size={20} />, key: 'B' },
    { id: 'eraser', label: 'Ластик', icon: <Eraser size={20} />, key: 'E' },
    { id: 'line', label: 'Прямая линия', icon: <Minus size={20} />, key: 'L' },
    { id: 'pan', label: 'Перемещение холста', icon: <Hand size={20} />, key: 'H' },
    { id: 'picker', label: 'Пипетка', icon: <Pipette size={20} />, key: 'I' },
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <div><strong>ТРАФАРЕТ</strong><small>LINEWORK STUDIO</small></div>
        </div>
        <input className="document-title" value={doc.title} onChange={(event) => setDoc({ ...doc, title: event.target.value })} aria-label="Название проекта" />
        <nav className="file-actions" aria-label="Проект">
          <button className="text-button" onClick={() => setModal('new')}><FilePlus2 size={16} /><span>Новый</span></button>
          <button className="text-button" onClick={() => openProjectRef.current?.click()}><FolderOpen size={16} /><span>Открыть</span></button>
          <button className="text-button" onClick={saveProject}><Save size={16} /><span>Сохранить</span></button>
        </nav>
        <div className="top-actions">
          <button className="icon-button" disabled={!canUndo} onClick={() => studioRef.current?.undo()} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={18} /></button>
          <button className="icon-button" disabled={!canRedo} onClick={() => studioRef.current?.redo()} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить"><Redo2 size={18} /></button>
          <button className="accent-button" onClick={() => setModal('export')}><Download size={16} /><span>Экспорт</span></button>
          <button className="icon-button help-button" onClick={() => setModal('help')} aria-label="Справка"><HelpCircle size={18} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="Инструменты">
          <div className="rail-top">
            {toolButtons.map((item) => (
              <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => setTool(item.id)} aria-label={`${item.label} (${item.key})`} title={`${item.label} · ${item.key}`} aria-pressed={tool === item.id}>{item.icon}</button>
            ))}
          </div>
          <div className="rail-bottom">
            <button className="tool-button panel-toggle" onClick={() => setLeftOpen((value) => !value)} aria-label="Настройки кисти"><SlidersHorizontal size={20} /></button>
            <button className="tool-button" onClick={() => studioRef.current?.clearActive()} aria-label="Очистить активный слой" title="Очистить активный слой"><Trash2 size={18} /></button>
            <button className="tool-button panel-toggle" onClick={() => setRightOpen((value) => !value)} aria-label="Слои и скан"><Layers3 size={20} /></button>
          </div>
        </aside>

        <aside className={`left-panel ${leftOpen ? 'open' : ''}`}>
          <button className="panel-backdrop" onClick={() => setLeftOpen(false)} aria-label="Закрыть настройки" />
          <div className="panel-inner"><BrushPanel brushes={brushes} activeId={brushId} onSelect={(id) => { setBrushId(id); setTool('brush') }} onUpdate={(patch) => setBrushes((current) => ({ ...current, [brushId]: { ...current[brushId], ...patch } }))} color={color} onColor={setColor} stylusOnly={stylusOnly} onStylusOnly={setStylusOnly} /></div>
        </aside>

        <main className="canvas-area">
          <StudioCanvas
            key={projectSession} ref={studioRef} doc={doc} layers={layers} activeLayerId={activeLayerId}
            tool={tool} brush={currentBrush} color={color} symmetry={symmetry} stencil={stencil}
            stylusOnly={stylusOnly} flipped={flipped} view={view} renderToken={renderToken}
            onViewChange={setView} onMutated={mutate} onHistoryChange={(undo, redo) => { setCanUndo(undo); setCanRedo(redo) }}
            onPickColor={(picked) => { setColor(picked); setTool('brush') }} onNotice={showNotice}
          />
        </main>

        <aside className={`right-panel ${rightOpen ? 'open' : ''}`}>
          <button className="panel-backdrop" onClick={() => setRightOpen(false)} aria-label="Закрыть слои" />
          <div className="panel-inner">
            <LayersPanel layers={layers} activeId={activeLayerId} onSelect={setActiveLayerId} onChange={changeLayers} onAdd={addLayer} onDelete={deleteLayer} onDuplicate={duplicateLayer} />
            <ScanPanel layer={activeImage} onImport={importScan} onUpdate={updateActiveLayer} />
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="save-status"><i />{saveStatus}</span>
        <div className="zoom-controls">
          <button className="icon-button compact" onClick={() => setView({ ...view, zoom: Math.max(0.03, view.zoom / 1.2) })} aria-label="Уменьшить"><ZoomOut size={16} /></button>
          <button className="zoom-value" onClick={() => studioRef.current?.fitView()} title="Вписать холст">{Math.round(view.zoom * 100)}%</button>
          <button className="icon-button compact" onClick={() => setView({ ...view, zoom: Math.min(8, view.zoom * 1.2) })} aria-label="Увеличить"><ZoomIn size={16} /></button>
          <button className="icon-button compact" onClick={() => studioRef.current?.fitView()} aria-label="Вписать холст"><Maximize size={15} /></button>
        </div>
        <div className="view-modes">
          <button className={symmetry ? 'active' : ''} onClick={() => setSymmetry(!symmetry)} aria-pressed={symmetry}><Columns2 size={15} /><span>Симметрия</span></button>
          <button className={stencil ? 'active' : ''} onClick={() => setStencil(!stencil)} aria-pressed={stencil}><ScanLine size={15} /><span>Трафарет</span></button>
          <button className={flipped ? 'active' : ''} onClick={() => setFlipped(!flipped)} aria-pressed={flipped}><FlipHorizontal2 size={15} /><span>Отразить</span></button>
        </div>
      </footer>

      <input ref={openProjectRef} type="file" accept=".json,.tattoo,application/json" hidden onChange={async (event) => {
        const file = event.target.files?.[0]
        if (file) {
          try { await loadProject(JSON.parse(await file.text()) as ProjectSnapshot); showNotice('Проект открыт') }
          catch { showNotice('Не удалось открыть проект') }
        }
        event.target.value = ''
      }} />

      <StudioDialog open={modal === 'new'} onOpenChange={(open) => !open && setModal(null)} title="Новый эскиз" description="Рабочая область без лишних слоёв и настроек.">
        <div className="form-stack">
          <label className="text-field"><span>Название</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={80} /></label>
          <div className="preset-row">
            <button className="secondary-button" onClick={() => { setNewWidth(2048); setNewHeight(2048) }}>Квадрат</button>
            <button className="secondary-button" onClick={() => { setNewWidth(2480); setNewHeight(3508) }}>A4 · 300 dpi</button>
            <button className="secondary-button" onClick={() => { setNewWidth(1600); setNewHeight(2400) }}>2 : 3</button>
          </div>
          <div className="dimension-fields">
            <label className="text-field"><span>Ширина, px</span><input type="number" min={256} max={4096} value={newWidth} onChange={(event) => setNewWidth(Number(event.target.value))} /></label>
            <label className="text-field"><span>Высота, px</span><input type="number" min={256} max={4096} value={newHeight} onChange={(event) => setNewHeight(Number(event.target.value))} /></label>
          </div>
          <button className="accent-button large" onClick={createProject}>Создать холст</button>
        </div>
      </StudioDialog>

      <StudioDialog open={modal === 'export'} onOpenChange={(open) => !open && setModal(null)} title="Экспорт эскиза" description="Все видимые слои будут объединены. Файл проекта сохранит слои отдельно.">
        <div className="export-list">
          <button className="export-option" disabled={exporting} onClick={() => exportImage(false, false)}><strong>PNG с фоном</strong><span>Для показа клиенту и публикации</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(true, false)}><strong>Прозрачный PNG</strong><span>Для макета, печати и других редакторов</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(true, false, true)}><strong>PNG активного слоя</strong><span>Только чистая линия без скана и остальных слоёв</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(false, true)}><strong>Трафарет PNG</strong><span>Чёрно-белая высококонтрастная версия</span></button>
          <button className="export-option project-option" onClick={saveProject}><strong>Проект со слоями</strong><span>Файл .tattoo.json для продолжения работы</span></button>
        </div>
      </StudioDialog>

      <StudioDialog open={modal === 'help'} onOpenChange={(open) => !open && setModal(null)} title="Быстрый старт" description="Эскиз, линворк и трафарет — в одном локальном рабочем пространстве.">
        <div className="help-content">
          <section><h3>Рабочий цикл</h3><ol><li>Импортируйте скан в правой панели.</li><li>Настройте контраст и масштаб исходника.</li><li>Рисуйте на чистом слое поверх него.</li><li>Проверьте результат в режиме «Трафарет» и экспортируйте PNG.</li></ol></section>
          <section><h3>Клавиши</h3><div className="shortcut-grid"><span><kbd>B</kbd> Кисть</span><span><kbd>E</kbd> Ластик</span><span><kbd>L</kbd> Линия</span><span><kbd>H</kbd> Рука</span><span><kbd>M</kbd> Симметрия</span><span><kbd>T</kbd> Трафарет</span><span><kbd>[ ]</kbd> Размер</span><span><kbd>0</kbd> Вписать</span></div></section>
          <section><h3>Планшет</h3><p>Один контакт рисует, два пальца изменяют масштаб и перемещают холст. «Только перо» отключает рисование касанием, чтобы ладонь не оставляла следов.</p></section>
          <section><h3>Хранение</h3><p>Проект сохраняется только в этом браузере. Очистка данных браузера может удалить автосохранение. Для переноса и резервной копии используйте «Сохранить» или экспорт проекта.</p></section>
        </div>
      </StudioDialog>

      {notice && <div className="toast" role="status">{notice}</div>}
      {!hydrated && <div className="loading-cover"><span className="brand-mark"><i /></span><p>Открываем рабочее пространство…</p></div>}
    </div>
  )
}
