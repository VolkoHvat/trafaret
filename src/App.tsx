import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BoxSelect, Brush, Cloud, CloudOff, Columns2, Download, Eraser, FileCode2, FilePlus2,
  FlipHorizontal2, FolderOpen, Hand, HelpCircle, LassoSelect, Layers3,
  Maximize, Minus, MousePointer2, PaintBucket, PenTool, Pipette, Printer,
  Redo2, Save, ScanLine, ScanSearch, Shapes, SlidersHorizontal, Stethoscope, Trash2, Undo2,
  ZoomIn, ZoomOut,
} from 'lucide-react'
import { get, set } from 'idb-keyval'
import { StudioCanvas, type StudioHandle } from './components/StudioCanvas'
import { AnalysisDialog } from './components/AnalysisDialog'
import { DiagnosticsDialog } from './components/DiagnosticsDialog'
import { BrushPanel } from './components/BrushPanel'
import { LayersPanel } from './components/LayersPanel'
import { ScanPanel } from './components/ScanPanel'
import { DocumentPanel } from './components/DocumentPanel'
import { StudioDialog } from './components/UI'
import { CloudDialog } from './components/CloudDialog'
import { useCloudSync } from './hooks/useCloudSync'
import type { ArtworkReport } from './lib/artwork-analysis'
import { runEnvironmentDiagnostics, type DeviceDiagnosticsReport } from './lib/diagnostics'
import { BRUSH_ORDER, DEFAULT_BRUSHES } from './lib/brushes'
import { blobToDataUrl, makeVectorSvg, withPngDpi } from './lib/output'
import {
  createLayerMask, disposeLayerCanvases, downloadBlob, fileToDataURL, loadImage, makeCanvas,
  makePaintLayer, makeVectorLayer, redrawImageLayer, restoreProject,
  safeFilename, snapshotProject, uid,
} from './lib/project'
import { cloneObjects } from './lib/vector'
import type {
  BrushConfig, BrushId, BrushPreset, DocModel, GuideMode, LayerModel,
  ProjectSnapshot, SelectionModel, ShapeKind, SymmetryMode, ToolId, ViewState,
} from './types'
import './App.css'

const AUTOSAVE_KEY = 'trafaret-autosave-v1'
const SETTINGS_KEY = 'trafaret-settings-v1'
const initialDoc: DocModel = { width: 2048, height: 2048, title: 'Новый эскиз', dpi: 300 }

interface WorkspaceSettings {
  brushId?: BrushId
  brushes?: Partial<Record<BrushId, Partial<BrushConfig>>>
  customPresets?: BrushPreset[]
  color?: string
  stylusOnly?: boolean
}

function readWorkspaceSettings(): WorkspaceSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as WorkspaceSettings }
  catch { return {} }
}

const initialView: ViewState = { zoom: 0.25, panX: 80, panY: 80 }
type ModalId = 'new' | 'export' | 'print' | 'help' | 'cloud' | 'analysis' | 'diagnostics' | null
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export default function App() {
  const workspaceSettings = useRef(readWorkspaceSettings()).current
  const [doc, setDoc] = useState<DocModel>(initialDoc)
  const [projectId, setProjectId] = useState(() => uid())
  const [revision, setRevision] = useState(0)
  const [layers, setLayers] = useState<LayerModel[]>(() => [makePaintLayer(initialDoc, 'Линия 1')])
  const [activeLayerId, setActiveLayerId] = useState(() => layers[0].id)
  const [tool, setTool] = useState<ToolId>('brush')
  const [brushId, setBrushId] = useState<BrushId>(() => workspaceSettings.brushId && BRUSH_ORDER.includes(workspaceSettings.brushId) ? workspaceSettings.brushId : 'fineline')
  const [brushes, setBrushes] = useState<Record<BrushId, BrushConfig>>(() => Object.fromEntries(
    BRUSH_ORDER.map(id => [id, { ...DEFAULT_BRUSHES[id], ...workspaceSettings.brushes?.[id] }]),
  ) as Record<BrushId, BrushConfig>)
  const [customPresets, setCustomPresets] = useState<BrushPreset[]>(() => Array.isArray(workspaceSettings.customPresets) ? workspaceSettings.customPresets : [])
  const [activeCustomIndex, setActiveCustomIndex] = useState<number | null>(null)
  const [color, setColor] = useState(workspaceSettings.color ?? '#171914')
  const [symmetry, setSymmetry] = useState<SymmetryMode>('off')
  const [radialCount, setRadialCount] = useState(6)
  const [guide, setGuide] = useState<GuideMode>('none')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('ellipse')
  const [areaShape, setAreaShape] = useState<'rectangle' | 'ellipse'>('rectangle')
  const [selection, setSelection] = useState<SelectionModel | null>(null)
  const [maskEditing, setMaskEditing] = useState(false)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
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
  const [analysisReport, setAnalysisReport] = useState<ArtworkReport | null>(null)
  const [diagnosticsReport, setDiagnosticsReport] = useState<DeviceDiagnosticsReport | null>(null)
  const [saveStatus, setSaveStatus] = useState('Только на этом устройстве')
  const [hydrated, setHydrated] = useState(false)
  const [newTitle, setNewTitle] = useState('Новый эскиз')
  const [newWidth, setNewWidth] = useState(2048)
  const [newHeight, setNewHeight] = useState(2048)
  const [newDpi, setNewDpi] = useState(300)
  const [printWidthMm, setPrintWidthMm] = useState(initialDoc.width / initialDoc.dpi * 25.4)
  const [printHeightMm, setPrintHeightMm] = useState(initialDoc.height / initialDoc.dpi * 25.4)
  const [printStencil, setPrintStencil] = useState(true)
  const [exporting, setExporting] = useState(false)
  const studioRef = useRef<StudioHandle>(null)
  const openProjectRef = useRef<HTMLInputElement>(null)
  const activeLayer = layers.find(layer => layer.id === activeLayerId)
  const activeImage = activeLayer?.kind === 'image' ? activeLayer : undefined
  const currentBrush = activeCustomIndex !== null && customPresets[activeCustomIndex]
    ? customPresets[activeCustomIndex].config
    : brushes[brushId]

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ brushId, brushes, customPresets, color, stylusOnly })) }
    catch { /* Settings persistence is optional when storage is unavailable. */ }
  }, [brushId, brushes, customPresets, color, stylusOnly])

  const showNotice = useCallback((message: string) => setNotice(message), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3600)
    return () => clearTimeout(timer)
  }, [notice])

  const mutate = useCallback(() => {
    setRevision(value => value + 1)
    setSaveVersion(value => value + 1)
    setRenderToken(value => value + 1)
  }, [])

  const changeLayers = useCallback((next: LayerModel[]) => {
    setLayers(next)
    mutate()
  }, [mutate])

  // Mirrors the current layers for imperative paths (dispose on document
  // replace) without running side effects inside a setLayers updater.
  const layersRef = useRef<LayerModel[]>(layers)
  useEffect(() => { layersRef.current = layers }, [layers])

  const resetEditorContext = () => {
    setSelection(null)
    setSelectedObjectId(null)
    setMaskEditing(false)
  }

  const loadProject = useCallback(async (snapshot: ProjectSnapshot) => {
    const restored = await restoreProject(snapshot)
    disposeLayerCanvases(layersRef.current)
    setDoc(restored.doc)
    setLayers(restored.layers)
    setActiveLayerId(restored.activeLayerId)
    // Стабильный ID и ревизия восстанавливаются из файла; у проектов v1/v2 без ID
    // назначается новый — данные при этом не теряются.
    setProjectId(snapshot.projectId || uid())
    setRevision(typeof snapshot.revision === 'number' && Number.isFinite(snapshot.revision) ? snapshot.revision : 0)
    setProjectSession(value => value + 1)
    setView(initialView)
    resetEditorContext()
    // Загрузка/применение облачной версии — не локальная правка: ревизия не растёт.
    setSaveVersion(value => value + 1)
    setRenderToken(value => value + 1)
    setTimeout(() => studioRef.current?.fitView(), 80)
  }, [])

  const takeSnapshot = useCallback(() => {
    try { return JSON.stringify(snapshotProject(doc, layers, activeLayerId, { projectId, revision })) }
    catch { return null }
  }, [doc, layers, activeLayerId, projectId, revision])

  const cloud = useCloudSync({
    projectId, revision, takeSnapshot, hydrated,
    applyRemote: async (json: string) => {
      try {
        await loadProject(JSON.parse(json) as ProjectSnapshot)
        showNotice('Применена облачная версия проекта')
      } catch {
        showNotice('Не удалось применить облачную версию')
      }
    },
  })
  const notifyCloudRef = useRef(cloud.notifyLocalChange)
  useEffect(() => {
    notifyCloudRef.current = cloud.notifyLocalChange
  })

  useEffect(() => {
    let cancelled = false
    get<ProjectSnapshot>(AUTOSAVE_KEY).then(async saved => {
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
        const snapshot = snapshotProject(doc, layers, activeLayerId, { projectId, revision })
        set(AUTOSAVE_KEY, snapshot)
          .then(() => {
            setSaveStatus(`Сохранено локально · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`)
            notifyCloudRef.current()
          })
          .catch(() => setSaveStatus('Не удалось сохранить — экспортируйте проект'))
      } catch {
        setSaveStatus('Не удалось сохранить — экспортируйте проект')
      }
    }, 1100)
    return () => clearTimeout(timer)
  }, [doc, layers, activeLayerId, saveVersion, hydrated, projectId, revision])

  useEffect(() => {
    if (maskEditing && !activeLayer?.mask) setMaskEditing(false)
  }, [activeLayer, maskEditing])

  // Локальная диагностика устройства: один запуск после первого рендера,
  // в idle-периоде, чтобы не конкурировать с отрисовкой холста.
  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      try { setDiagnosticsReport(runEnvironmentDiagnostics()) }
      catch { setDiagnosticsReport(null) }
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: 2000 })
      return () => { cancelled = true; window.cancelIdleCallback(handle) }
    }
    const timer = window.setTimeout(run, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  const createProject = () => {
    const nextDoc: DocModel = {
      width: Math.max(256, Math.min(4096, Math.round(newWidth))),
      height: Math.max(256, Math.min(4096, Math.round(newHeight))),
      title: newTitle.trim() || 'Новый эскиз',
      dpi: Math.max(72, Math.min(1200, Math.round(newDpi))),
    }
    const layer = makePaintLayer(nextDoc, 'Линия 1')
    disposeLayerCanvases(layersRef.current)
    setDoc(nextDoc)
    setLayers([layer])
    setActiveLayerId(layer.id)
    setProjectId(uid())
    setRevision(0)
    setProjectSession(value => value + 1)
    setView(initialView)
    resetEditorContext()
    setModal(null)
    mutate()
    setTimeout(() => studioRef.current?.fitView(), 80)
  }

  const saveProject = useCallback(() => {
    const snapshot = snapshotProject(doc, layers, activeLayerId, { projectId, revision })
    downloadBlob(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }), `${safeFilename(doc.title)}.tattoo.json`)
    showNotice('Проект v2 сохранён: слои, векторы, маски и DPI')
  }, [doc, layers, activeLayerId, projectId, revision, showNotice])

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
      const line = makePaintLayer(doc, `Линия ${layers.filter(item => item.kind === 'paint').length + 1}`)
      changeLayers([layer, ...layers, line])
      setActiveLayerId(line.id)
      resetEditorContext()
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
    if (patch.mask === undefined && Object.prototype.hasOwnProperty.call(patch, 'mask')) setMaskEditing(false)
    changeLayers(layers.map(layer => layer.id === activeLayer.id ? next : layer))
  }

  const addLayer = () => {
    const layer = makePaintLayer(doc, `Линия ${layers.filter(item => item.kind === 'paint').length + 1}`)
    changeLayers([...layers, layer])
    setActiveLayerId(layer.id)
    setMaskEditing(false)
    setSelectedObjectId(null)
  }

  const addVectorLayer = useCallback(() => {
    const layer = makeVectorLayer(doc, `Вектор ${layers.filter(item => item.kind === 'vector').length + 1}`)
    changeLayers([...layers, layer])
    setActiveLayerId(layer.id)
    setMaskEditing(false)
    setSelectedObjectId(null)
    return layer
  }, [changeLayers, doc, layers])

  const chooseTool = useCallback((next: ToolId) => {
    if ((next === 'shape' || next === 'pen') && (activeLayer?.kind !== 'vector' || maskEditing)) addVectorLayer()
    if (next !== 'object') setSelectedObjectId(null)
    setTool(next)
  }, [activeLayer, addVectorLayer, maskEditing])

  const deleteLayer = () => {
    if (layers.length <= 1) return showNotice('В проекте должен остаться хотя бы один слой')
    if (!activeLayer) return
    const index = layers.indexOf(activeLayer)
    const next = layers.filter(layer => layer.id !== activeLayer.id)
    studioRef.current?.dropHistoryFor(activeLayer.id)
    changeLayers(next)
    setActiveLayerId(next[Math.min(index, next.length - 1)].id)
    resetEditorContext()
  }

  const duplicateLayer = () => {
    if (!activeLayer) return
    const canvas = makeCanvas(doc.width, doc.height)
    canvas.getContext('2d')!.drawImage(activeLayer.canvas, 0, 0)
    let mask: HTMLCanvasElement | undefined
    if (activeLayer.mask) {
      mask = makeCanvas(doc.width, doc.height)
      mask.getContext('2d')!.drawImage(activeLayer.mask, 0, 0)
    }
    const copy: LayerModel = {
      ...activeLayer, id: uid(), name: `${activeLayer.name} · копия`, canvas, mask,
      objects: cloneObjects(activeLayer.objects), filterCache: undefined, filterKey: undefined,
      dataCache: undefined, maskCache: undefined, pixelVersion: activeLayer.pixelVersion + 1,
      maskVersion: (activeLayer.maskVersion ?? 0) + 1,
    }
    const index = layers.indexOf(activeLayer)
    const next = [...layers]
    next.splice(index + 1, 0, copy)
    changeLayers(next)
    setActiveLayerId(copy.id)
    setSelectedObjectId(null)
    setMaskEditing(false)
  }

  const exportImage = async (transparent: boolean, stencilMode: boolean, onlyActive = false) => {
    if (!studioRef.current) return
    setExporting(true)
    try {
      const raw = await studioRef.current.exportImage(transparent, stencilMode, onlyActive)
      const blob = await withPngDpi(raw, doc.dpi)
      const suffix = onlyActive ? '-active-layer' : stencilMode ? '-stencil' : transparent ? '-transparent' : ''
      downloadBlob(blob, `${safeFilename(doc.title)}${suffix}.png`)
      setModal(null)
      showNotice(`PNG экспортирован с ${doc.dpi} dpi`)
    } catch {
      showNotice('Не удалось экспортировать PNG')
    } finally {
      setExporting(false)
    }
  }

  const exportSvg = () => {
    if (!layers.some(layer => layer.visible && layer.kind === 'vector' && layer.objects?.length)) {
      showNotice('Добавьте векторные объекты для SVG-экспорта')
      return
    }
    const blob = new Blob([makeVectorSvg(doc, layers)], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(blob, `${safeFilename(doc.title)}-vector.svg`)
    setModal(null)
    showNotice('Редактируемый SVG экспортирован')
  }

  const openPrint = () => {
    setPrintWidthMm(doc.width / doc.dpi * 25.4)
    setPrintHeightMm(doc.height / doc.dpi * 25.4)
    setModal('print')
  }

  const runAnalysis = () => {
    if (!studioRef.current) return
    try {
      const report = studioRef.current.analyzeArtwork()
      setAnalysisReport(report)
      setModal('analysis')
    } catch {
      showNotice('Не удалось выполнить проверку эскиза')
    }
  }

  const updatePrintWidth = (width: number) => {
    const safe = Math.max(10, Math.min(2000, width || 10))
    setPrintWidthMm(safe)
    setPrintHeightMm(safe * doc.height / doc.width)
  }

  const updatePrintHeight = (height: number) => {
    const safe = Math.max(10, Math.min(2000, height || 10))
    setPrintHeightMm(safe)
    setPrintWidthMm(safe * doc.width / doc.height)
  }

  const printDocument = async () => {
    if (!studioRef.current) return
    setExporting(true)
    try {
      const blob = await studioRef.current.exportImage(false, printStencil)
      const dataUrl = await blobToDataUrl(blob)
      const frame = document.createElement('iframe')
      frame.className = 'print-frame'
      frame.title = 'Печать tattoo-эскиза'
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>@page{size:${printWidthMm.toFixed(2)}mm ${printHeightMm.toFixed(2)}mm;margin:0}html,body{margin:0;padding:0;width:${printWidthMm.toFixed(2)}mm;height:${printHeightMm.toFixed(2)}mm;overflow:hidden}img{display:block;width:${printWidthMm.toFixed(2)}mm;height:${printHeightMm.toFixed(2)}mm;object-fit:contain}</style></head><body><img src="${dataUrl}" alt=""></body></html>`
      document.body.appendChild(frame)
      frame.onload = () => {
        const image = frame.contentDocument?.querySelector('img')
        const print = () => {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          setTimeout(() => frame.remove(), 60_000)
        }
        if (image?.complete) print()
        else if (image) image.onload = print
      }
      setModal(null)
      showNotice(`Печать подготовлена: ${printWidthMm.toFixed(1)} × ${printHeightMm.toFixed(1)} мм`)
    } catch {
      showNotice('Не удалось подготовить печать')
    } finally {
      setExporting(false)
    }
  }

  const updateCurrentBrush = useCallback((patch: Partial<BrushConfig>) => {
    if (activeCustomIndex !== null) {
      setCustomPresets(current => current.map((preset, index) => index === activeCustomIndex ? { ...preset, config: { ...preset.config, ...patch } } : preset))
    } else {
      setBrushes(current => ({ ...current, [brushId]: { ...current[brushId], ...patch } }))
    }
  }, [activeCustomIndex, brushId])

  const saveBrushPreset = () => {
    const config = { ...currentBrush }
    setCustomPresets(current => [...current, { name: `${config.name} · ${current.length + 1}`, config }])
    setActiveCustomIndex(customPresets.length)
    showNotice('Пользовательский пресет сохранён в этом браузере')
  }

  const deleteBrushPreset = () => {
    if (activeCustomIndex === null) return
    setCustomPresets(current => current.filter((_, index) => index !== activeCustomIndex))
    setActiveCustomIndex(null)
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
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault(); studioRef.current?.redo(); return
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault(); saveProject(); return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault(); setSelection(null); return
      }
      if (key === 'delete' || key === 'backspace') {
        if (selectedObjectId) studioRef.current?.deleteSelectedObject()
        else if (selection) studioRef.current?.clearActive()
        return
      }
      if (key === 'enter' && tool === 'pen') {
        event.preventDefault(); studioRef.current?.commitPen(event.shiftKey); return
      }
      if (key === 'escape') {
        studioRef.current?.cancelDraft(); setSelection(null); setSelectedObjectId(null); return
      }
      const tools: Record<string, ToolId> = {
        v: 'object', b: 'brush', e: 'eraser', l: 'line', s: 'shape', p: 'pen',
        g: 'fill', a: 'area', w: 'lasso', h: 'pan', i: 'picker',
      }
      if (tools[key]) chooseTool(tools[key])
      else if (key === 'c') setModal('cloud')
      else if (key === 'm') setSymmetry(value => value === 'off' ? 'vertical' : 'off')
      else if (key === 't') setStencil(value => !value)
      else if (key === '[' || key === ']') {
        const delta = key === '[' ? -1 : 1
        const size = Math.max(1, Math.min(120, currentBrush.size + delta))
        updateCurrentBrush({ size })
      } else if (key === '+' || key === '=') setView(current => ({ ...current, zoom: Math.min(8, current.zoom * 1.2) }))
      else if (key === '-') setView(current => ({ ...current, zoom: Math.max(0.03, current.zoom / 1.2) }))
      else if (key === '0') studioRef.current?.fitView()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [chooseTool, currentBrush, modal, saveProject, selectedObjectId, selection, tool, updateCurrentBrush])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const debug = {
      getState: () => ({
        doc: { ...doc },
        projectId, revision,
        layers: layers.map(layer => ({
          id: layer.id, name: layer.name, kind: layer.kind, visible: layer.visible, locked: layer.locked,
          opacity: layer.opacity, blend: layer.blend, objects: cloneObjects(layer.objects),
          hasMask: Boolean(layer.mask), maskEnabled: layer.maskEnabled, clipToBelow: layer.clipToBelow,
          pixelVersion: layer.pixelVersion, maskVersion: layer.maskVersion,
        })),
        activeLayerId, tool, brushId, activeCustomIndex, customPresets, symmetry, radialCount,
        guide, shapeKind, areaShape, selection, maskEditing, selectedObjectId,
        stencil, zoom: view.zoom, historyPixels: studioRef.current?.historyPixels() ?? 0,
      }),
      getLayerData: (layerId: string, channel: 'content' | 'mask' = 'content') => {
        const layer = layers.find(item => item.id === layerId)
        const canvas = channel === 'mask' ? layer?.mask : layer?.canvas
        return canvas?.toDataURL('image/png') ?? null
      },
      snapshot: () => snapshotProject(doc, layers, activeLayerId, { projectId, revision }),
      analyzeArtwork: () => studioRef.current?.analyzeArtwork() ?? null,
      runDiagnostics: () => runEnvironmentDiagnostics(),
    }
    Object.assign(window, { __tattooStudio: debug })
    return () => { delete (window as Window & { __tattooStudio?: unknown }).__tattooStudio }
  }, [doc, layers, activeLayerId, projectId, revision, tool, brushId, activeCustomIndex, customPresets, symmetry, radialCount, guide, shapeKind, areaShape, selection, maskEditing, selectedObjectId, stencil, view.zoom, saveVersion])

  const toolButtons: { id: ToolId; label: string; icon: React.ReactNode; key: string }[] = [
    { id: 'object', label: 'Объект и трансформация', icon: <MousePointer2 size={20} />, key: 'V' },
    { id: 'brush', label: 'Кисть', icon: <Brush size={20} />, key: 'B' },
    { id: 'eraser', label: 'Ластик', icon: <Eraser size={20} />, key: 'E' },
    { id: 'line', label: 'Прямая линия', icon: <Minus size={20} />, key: 'L' },
    { id: 'shape', label: 'Фигура', icon: <Shapes size={20} />, key: 'S' },
    { id: 'pen', label: 'Перьевой контур', icon: <PenTool size={20} />, key: 'P' },
    { id: 'fill', label: 'Заливка', icon: <PaintBucket size={20} />, key: 'G' },
    { id: 'area', label: 'Выделение области', icon: <BoxSelect size={20} />, key: 'A' },
    { id: 'lasso', label: 'Лассо', icon: <LassoSelect size={20} />, key: 'W' },
    { id: 'pan', label: 'Перемещение холста', icon: <Hand size={20} />, key: 'H' },
    { id: 'picker', label: 'Пипетка', icon: <Pipette size={20} />, key: 'I' },
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <div><strong>ТРАФАРЕТ</strong><small>PRO LINEWORK STUDIO</small></div>
        </div>
        <input className="document-title" value={doc.title} onChange={event => { setDoc({ ...doc, title: event.target.value }); setRevision(value => value + 1) }} aria-label="Название проекта" />
        <nav className="file-actions" aria-label="Проект">
          <button className="text-button" onClick={() => setModal('new')}><FilePlus2 size={16} /><span>Новый</span></button>
          <button className="text-button" onClick={() => openProjectRef.current?.click()}><FolderOpen size={16} /><span>Открыть</span></button>
          <button className="text-button" onClick={saveProject}><Save size={16} /><span>Сохранить</span></button>
          <button className="text-button" onClick={() => setModal('diagnostics')} title="Локальная диагностика Canvas, пера и фильтров"><Stethoscope size={16} /><span>Диагностика устройства</span></button>
        </nav>
        <div className="top-actions">
          <button className="icon-button" disabled={!canUndo} onClick={() => studioRef.current?.undo()} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={18} /></button>
          <button className="icon-button" disabled={!canRedo} onClick={() => studioRef.current?.redo()} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить"><Redo2 size={18} /></button>
          <button className="icon-button print-top" onClick={openPrint} title="Печать по физическому размеру" aria-label="Печать"><Printer size={17} /></button>
          <button className="icon-button" onClick={runAnalysis} title="Проверка эскиза" aria-label="Проверка эскиза"><ScanSearch size={18} /></button>
          <button className={`icon-button cloud-button cloud-${cloud.status.state}`} onClick={() => setModal('cloud')} title="Облачная синхронизация (C)" aria-label="Облачная синхронизация">
            {cloud.status.state === 'offline' || (cloud.status.state === 'error' && !cloud.online) ? <CloudOff size={18} /> : <Cloud size={18} />}
          </button>
          <button className="accent-button" onClick={() => setModal('export')}><Download size={16} /><span>Экспорт</span></button>
          <button className="icon-button help-button" onClick={() => setModal('help')} aria-label="Справка"><HelpCircle size={18} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="Инструменты">
          <div className="rail-top">
            {toolButtons.map(item => (
              <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => chooseTool(item.id)} aria-label={`${item.label} (${item.key})`} title={`${item.label} · ${item.key}`} aria-pressed={tool === item.id}>{item.icon}</button>
            ))}
          </div>
          <div className="rail-bottom">
            <button className="tool-button panel-toggle" onClick={() => setLeftOpen(value => !value)} aria-label="Настройки кисти"><SlidersHorizontal size={20} /></button>
            <button className="tool-button" onClick={() => studioRef.current?.clearActive()} aria-label="Очистить активный слой или выделение" title="Очистить активный слой или выделение"><Trash2 size={18} /></button>
            <button className="tool-button panel-toggle" onClick={() => setRightOpen(value => !value)} aria-label="Слои и скан"><Layers3 size={20} /></button>
          </div>
        </aside>

        <aside className={`left-panel ${leftOpen ? 'open' : ''}`}>
          <button className="panel-backdrop" onClick={() => setLeftOpen(false)} aria-label="Закрыть настройки" />
          <div className="panel-inner">
            <BrushPanel
              brushes={brushes} activeId={brushId} customPresets={customPresets} activeCustomIndex={activeCustomIndex}
              onSelect={id => { setBrushId(id); setActiveCustomIndex(null); setTool('brush') }}
              onSelectCustom={index => { setActiveCustomIndex(index); setTool('brush') }}
              onSavePreset={saveBrushPreset} onDeletePreset={deleteBrushPreset} onUpdate={updateCurrentBrush}
              color={color} onColor={setColor} stylusOnly={stylusOnly} onStylusOnly={setStylusOnly}
            />
            <DocumentPanel
              symmetry={symmetry} radialCount={radialCount} guide={guide} shapeKind={shapeKind}
              areaShape={areaShape} selection={selection} onSymmetry={setSymmetry} onRadialCount={setRadialCount}
              onGuide={setGuide} onShapeKind={setShapeKind} onAreaShape={setAreaShape}
              onSelectionChange={setSelection} onCommitPen={closed => studioRef.current?.commitPen(closed)}
              onCancelDraft={() => studioRef.current?.cancelDraft()}
            />
          </div>
        </aside>

        <main className="canvas-area">
          <div className="canvas-context">
            <span>{activeLayer?.name ?? 'Нет слоя'}</span>
            <i />
            <span>{maskEditing ? 'РЕДАКТИРОВАНИЕ МАСКИ' : activeLayer?.kind === 'vector' ? 'ВЕКТОРНЫЙ КОНТУР' : activeLayer?.kind === 'image' ? 'ИСХОДНИК' : 'РАСТРОВЫЙ СЛОЙ'}</span>
            {selection && <><i /><span>{selection.inverse ? 'ИНВЕРСНОЕ ВЫДЕЛЕНИЕ' : 'ВЫДЕЛЕНИЕ АКТИВНО'}</span></>}
          </div>
          <StudioCanvas
            key={projectSession} ref={studioRef} projectSession={projectSession} doc={doc} layers={layers} activeLayerId={activeLayerId}
            tool={tool} brush={currentBrush} color={color} symmetry={symmetry} radialCount={radialCount}
            guide={guide} shapeKind={shapeKind} areaShape={areaShape} selection={selection}
            maskEditing={maskEditing} selectedObjectId={selectedObjectId} stencil={stencil}
            stylusOnly={stylusOnly} flipped={flipped} view={view} renderToken={renderToken}
            onViewChange={setView} onMutated={mutate} onHistoryChange={(undo, redo) => { setCanUndo(undo); setCanRedo(redo) }}
            onPickColor={picked => { setColor(picked); setTool('brush') }} onNotice={showNotice}
            onSelectionChange={setSelection} onSelectObject={setSelectedObjectId}
          />
        </main>

        <aside className={`right-panel ${rightOpen ? 'open' : ''}`}>
          <button className="panel-backdrop" onClick={() => setRightOpen(false)} aria-label="Закрыть слои" />
          <div className="panel-inner">
            <LayersPanel
              layers={layers} activeId={activeLayerId} maskEditing={maskEditing}
              onSelect={id => { setActiveLayerId(id); setMaskEditing(false); setSelectedObjectId(null) }}
              onChange={changeLayers} onAdd={addLayer} onAddVector={addVectorLayer}
              onDelete={deleteLayer} onDuplicate={duplicateLayer}
              onAddMask={() => {
                if (!activeLayer) return
                const next = { ...activeLayer }
                createLayerMask(next)
                changeLayers(layers.map(layer => layer.id === next.id ? next : layer))
                setMaskEditing(true)
              }}
              onMaskEditing={setMaskEditing}
            />
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
          <button className={symmetry !== 'off' ? 'active' : ''} onClick={() => setSymmetry(symmetry === 'off' ? 'vertical' : 'off')} aria-pressed={symmetry !== 'off'}><Columns2 size={15} /><span>Симметрия</span></button>
          <button className={stencil ? 'active' : ''} onClick={() => setStencil(!stencil)} aria-pressed={stencil}><ScanLine size={15} /><span>Трафарет</span></button>
          <button className={flipped ? 'active' : ''} onClick={() => setFlipped(!flipped)} aria-pressed={flipped}><FlipHorizontal2 size={15} /><span>Отразить</span></button>
        </div>
      </footer>

      <input ref={openProjectRef} type="file" accept=".json,.tattoo,application/json" hidden onChange={async event => {
        const file = event.target.files?.[0]
        if (file) {
          try { await loadProject(JSON.parse(await file.text()) as ProjectSnapshot); showNotice('Проект открыт') }
          catch { showNotice('Не удалось открыть проект') }
        }
        event.target.value = ''
      }} />

      <StudioDialog open={modal === 'new'} onOpenChange={open => !open && setModal(null)} title="Новый эскиз" description="Задайте разрешение и физический размер для линворка и печати.">
        <div className="form-stack">
          <label className="text-field"><span>Название</span><input value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={80} /></label>
          <div className="preset-row">
            <button className="secondary-button" onClick={() => { setNewWidth(2048); setNewHeight(2048); setNewDpi(300) }}>Квадрат</button>
            <button className="secondary-button" onClick={() => { setNewWidth(2480); setNewHeight(3508); setNewDpi(300) }}>A4 · 300 dpi</button>
            <button className="secondary-button" onClick={() => { setNewWidth(1600); setNewHeight(2400); setNewDpi(300) }}>2 : 3</button>
          </div>
          <div className="dimension-fields">
            <label className="text-field"><span>Ширина, px</span><input type="number" min={256} max={4096} value={newWidth} onChange={event => setNewWidth(Number(event.target.value))} /></label>
            <label className="text-field"><span>Высота, px</span><input type="number" min={256} max={4096} value={newHeight} onChange={event => setNewHeight(Number(event.target.value))} /></label>
          </div>
          <label className="text-field"><span>Разрешение, dpi</span><input type="number" min={72} max={1200} value={newDpi} onChange={event => setNewDpi(Number(event.target.value))} /></label>
          <p className="physical-size">{(newWidth / Math.max(1, newDpi) * 25.4).toFixed(1)} × {(newHeight / Math.max(1, newDpi) * 25.4).toFixed(1)} мм при печати</p>
          <button className="accent-button large" onClick={createProject}>Создать холст</button>
        </div>
      </StudioDialog>

      <StudioDialog open={modal === 'export'} onOpenChange={open => !open && setModal(null)} title="Профессиональный экспорт" description="PNG получает DPI документа. SVG содержит редактируемые векторные контуры без сканов и направляющих.">
        <div className="export-list">
          <button className="export-option" disabled={exporting} onClick={() => exportImage(false, false)}><strong>PNG с фоном</strong><span>Для показа клиенту и публикации · {doc.dpi} dpi</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(true, false)}><strong>Прозрачный PNG</strong><span>Для макета и других редакторов · {doc.dpi} dpi</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(true, false, true)}><strong>PNG активного слоя</strong><span>Чистая линия с учётом маски активного слоя</span></button>
          <button className="export-option" disabled={exporting} onClick={() => exportImage(false, true)}><strong>Трафарет PNG</strong><span>Чёрно-белая высококонтрастная версия</span></button>
          <button className="export-option" disabled={exporting} onClick={exportSvg}><strong><FileCode2 size={16} />Векторный SVG</strong><span>Контуры, узлы, фигуры, цвет и трансформации</span></button>
          <button className="export-option" disabled={exporting} onClick={openPrint}><strong><Printer size={16} />Печать по размеру</strong><span>Точный размер в миллиметрах и режим трафарета</span></button>
          <button className="export-option project-option" onClick={saveProject}><strong>Проект v2 со слоями</strong><span>Файл .tattoo.json: растр, векторы, маски, сканы и DPI</span></button>
        </div>
      </StudioDialog>

      <StudioDialog open={modal === 'print'} onOpenChange={open => !open && setModal(null)} title="Печать по физическому размеру" description={`${doc.width} × ${doc.height} px · ${doc.dpi} dpi. В системном диалоге выберите масштаб 100% / «Фактический размер».`}>
        <div className="form-stack">
          <div className="dimension-fields">
            <label className="text-field"><span>Ширина, мм</span><input type="number" min={10} max={2000} step={0.1} value={Number(printWidthMm.toFixed(2))} onChange={event => updatePrintWidth(Number(event.target.value))} /></label>
            <label className="text-field"><span>Высота, мм</span><input type="number" min={10} max={2000} step={0.1} value={Number(printHeightMm.toFixed(2))} onChange={event => updatePrintHeight(Number(event.target.value))} /></label>
          </div>
          <label className="text-field"><span>DPI документа</span><input type="number" min={72} max={1200} value={doc.dpi} onChange={event => setDoc({ ...doc, dpi: Math.max(72, Math.min(1200, Number(event.target.value) || 300)) })} /></label>
          <label className="check-row"><input type="checkbox" checked={printStencil} onChange={event => setPrintStencil(event.target.checked)} /><span>Подготовить чёрно-белый трафарет</span></label>
          <p className="panel-note">Размер изображения задаётся в миллиметрах независимо от экранного масштаба. Не используйте «По размеру страницы» в диалоге печати.</p>
          <button className="accent-button large" disabled={exporting} onClick={printDocument}><Printer size={17} />Открыть диалог печати</button>
        </div>
      </StudioDialog>

      <StudioDialog open={modal === 'help'} onOpenChange={open => !open && setModal(null)} title="Профессиональный рабочий цикл" description="Растровая живопись и редактируемый векторный линворк в одном локальном документе.">
        <div className="help-content">
          <section><h3>Линворк</h3><ol><li>Импортируйте скан в правой панели.</li><li>Добавьте растровый слой для свободной кисти или векторный для редактируемых контуров.</li><li>На векторном слое рисуйте кистью, линией, фигурами и пером. Инструмент «Объект» перемещает, масштабирует и вращает объекты; узлы пера редактируются отдельно.</li><li>Проверьте трафарет и экспортируйте PNG, SVG или печать в миллиметрах.</li><li>«Проверка эскиза» запускает локальный анализ узлов, деталей и композиции — это рекомендации, а не ошибки.</li></ol></section>
          <section><h3>Выделения и маски</h3><p>Область, эллипс и лассо ограничивают кисть, заливку и очистку. Инструмент «Объект» перемещает выделенные растровые пиксели. Маска не удаляет исходник: кисть показывает, ластик скрывает.</p></section>
          <section><h3>Клавиши</h3><div className="shortcut-grid"><span><kbd>V</kbd> Объект</span><span><kbd>B</kbd> Кисть</span><span><kbd>E</kbd> Ластик</span><span><kbd>P</kbd> Перо</span><span><kbd>S</kbd> Фигура</span><span><kbd>G</kbd> Заливка</span><span><kbd>A</kbd> Область</span><span><kbd>W</kbd> Лассо</span><span><kbd>M</kbd> Симметрия</span><span><kbd>T</kbd> Трафарет</span><span><kbd>[ ]</kbd> Размер</span><span><kbd>0</kbd> Вписать</span></div></section>
          <section><h3>Планшет и Windows</h3><p>Один контакт рисует, два пальца масштабируют холст. «Только перо» блокирует следы ладони. На Windows 10/11 приложение работает в Edge или Chrome и устанавливается как PWA. «Диагностика устройства» в верхней панели локально проверяет Canvas 2D, маски, нажим пера и фильтры трафарета — без сети и без отправки данных.</p></section>
          <section><h3>Хранение</h3><p>Автосохранение локально для этого браузера. Для резервной копии и переноса используйте проект v2 .tattoo.json. Старые проекты v1 открываются автоматически.</p></section>
        </div>
      </StudioDialog>

      {notice && <div className="toast" role="status">{notice}</div>}

      <AnalysisDialog open={modal === 'analysis'} onOpenChange={open => !open && setModal(null)} report={analysisReport} />

      <DiagnosticsDialog open={modal === 'diagnostics'} onOpenChange={open => !open && setModal(null)} report={diagnosticsReport} />

      <CloudDialog open={modal === 'cloud'} onOpenChange={open => !open && setModal(null)} cloud={cloud} projectId={projectId} />
      {!hydrated && <div className="loading-cover"><span className="brand-mark"><i /></span><p>Открываем рабочее пространство…</p></div>}
    </div>
  )
}
