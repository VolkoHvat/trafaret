/**
 * Встроенная локальная диагностика устройства. Без сети, AI и внешних
 * зависимостей — только DOM API текущего браузера. Проверки повторяют приёмы
 * движка рисования (маски через destination-in, обрезка слоя по нижнему,
 * фильтр трафарета), но на крошечных отсоединённых canvas не больше 16×16.
 * Диагностика не измеряет железо и не сертифицирует драйверы — проверяется
 * только API-слой.
 */

export type DiagnosticStatus = 'pass' | 'review' | 'fail'

export interface DiagnosticCheck {
  id: string
  label: string
  status: DiagnosticStatus
  required: boolean
  evidence: string[]
}

export interface DeviceFacts {
  /** Заявленное ОС число одновременных касаний — факт, а не измерение. */
  maxTouchPoints: number
  devicePixelRatio: number
  userAgent: string
}

export interface DeviceDiagnosticsReport {
  checks: DiagnosticCheck[]
  counts: Record<DiagnosticStatus, number>
  facts: DeviceFacts
  limitations: string[]
  ranAt: string
}

export const DIAGNOSTIC_LIMITATIONS: string[] = [
  'Реальное давление перьевых планшетов (Wacom, WinTab, Windows Ink) в этом браузере не проверяется — NOT_TESTED. Проверяется только API-слой PointerEvent, а не драйвер и не сенсор планшета.',
  'Физический multitouch не проверяется — число касаний заявляет ОС, реальный дигитайзер устройства NOT_TESTED.',
  'Графические чипы Intel, AMD, NVIDIA и графика Android не проверяются — NOT_TESTED: диагностика не обращается к GPU-драйверам.',
  'Дигитайзер устройства (сенсор пера) NOT_TESTED.',
  'Проверки API не являются сертификацией драйверов: статус «Готово» означает лишь, что браузер поддерживает нужные вызовы, а не что оборудование работает.',
  'WebGL и WebGPU намеренно не проверяются и не требуются: основная работа приложения построена на Canvas 2D.',
]

interface ProbeResult {
  status: DiagnosticStatus
  evidence: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Отсоединённый canvas не больше 16×16; в finally ужимается до 1×1. */
function probeCanvas<T>(size: number, probe: (ctx: CanvasRenderingContext2D) => T): T {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.min(16, Math.round(size)))
  canvas.height = Math.max(1, Math.min(16, Math.round(size)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('getContext("2d") вернул null')
  try {
    return probe(ctx)
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

function checkCanvas2d(): ProbeResult {
  return probeCanvas(2, ctx => {
    ctx.fillStyle = 'rgb(12, 34, 56)'
    ctx.fillRect(0, 0, 2, 2)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return r === 12 && g === 34 && b === 56 && a === 255
      ? { status: 'pass', evidence: [`fill + getImageData дали точные RGBA ${r},${g},${b},${a}`] }
      : { status: 'fail', evidence: [`Ожидалось 12,34,56,255 — получено ${r},${g},${b},${a}`] }
  })
}

function checkPath2d(): ProbeResult {
  if (typeof Path2D !== 'function') return { status: 'fail', evidence: ['Конструктор Path2D отсутствует'] }
  return probeCanvas(4, ctx => {
    const path = new Path2D()
    path.rect(0, 0, 3, 3)
    ctx.fillStyle = 'rgb(200, 30, 40)'
    ctx.fill(path)
    const [r, g, b, a] = ctx.getImageData(1, 1, 1, 1).data
    return a === 255 && r === 200 && g === 30 && b === 40
      ? { status: 'pass', evidence: [`Контур Path2D залит точным цветом ${r},${g},${b},${a}`] }
      : { status: 'fail', evidence: [`Заливка по Path2D дала ${r},${g},${b},${a} вместо 200,30,40,255`] }
  })
}

function checkClip(): ProbeResult {
  return probeCanvas(4, ctx => {
    ctx.fillStyle = 'rgb(220, 40, 40)'
    ctx.fillRect(0, 0, 4, 4)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, 2, 2)
    ctx.clip()
    ctx.fillStyle = 'rgb(30, 60, 200)'
    ctx.fillRect(0, 0, 4, 4)
    ctx.restore()
    const inside = ctx.getImageData(0, 0, 1, 1).data
    const outside = ctx.getImageData(3, 3, 1, 1).data
    return inside[0] === 30 && inside[2] === 200 && outside[0] === 220 && outside[2] === 40
      ? { status: 'pass', evidence: ['Внутри clip: 30,60,200,255; снаружи clip исходный цвет сохранён'] }
      : {
          status: 'fail',
          evidence: [
            `clip не сработал: внутри ${inside[0]},${inside[1]},${inside[2]},${inside[3]}; снаружи ${outside[0]},${outside[1]},${outside[2]},${outside[3]}`,
          ],
        }
  })
}

function checkAlphaMask(): ProbeResult {
  return probeCanvas(4, ctx => {
    ctx.fillStyle = 'rgb(200, 30, 40)'
    ctx.fillRect(0, 0, 4, 4)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = 'rgb(255, 255, 255)'
    ctx.fillRect(0, 0, 1, 1)
    ctx.globalCompositeOperation = 'source-over'
    const kept = ctx.getImageData(0, 0, 1, 1).data
    const cut = ctx.getImageData(2, 2, 1, 1).data
    return kept[3] === 255 && kept[0] === 200 && cut[3] === 0
      ? { status: 'pass', evidence: [`Под маской пиксель сохранён (${kept[0]},${kept[1]},${kept[2]},${kept[3]}), вне маски alpha обнулена (${cut[3]})`] }
      : { status: 'fail', evidence: [`destination-in дал: под маской ${kept[0]},${kept[3]}; вне маски alpha ${cut[3]} (ожидалось 200,255 и 0)`] }
  })
}

/** Повторяет композит «Обрезать по нижнему слою» из StudioCanvas: source-over, затем destination-in с нижним слоем. */
function checkClipToBelow(): ProbeResult {
  const below = document.createElement('canvas')
  below.width = 4
  below.height = 4
  const belowCtx = below.getContext('2d', { willReadFrequently: true })
  if (!belowCtx) return { status: 'fail', evidence: ['Не удалось создать canvas нижнего слоя'] }
  try {
    belowCtx.fillStyle = 'rgb(255, 255, 255)'
    belowCtx.fillRect(0, 0, 2, 4)
    return probeCanvas(4, ctx => {
      ctx.fillStyle = 'rgb(200, 30, 40)'
      ctx.fillRect(0, 0, 4, 4)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(below, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      const kept = ctx.getImageData(0, 1, 1, 1).data
      const clipped = ctx.getImageData(3, 1, 1, 1).data
      return kept[3] === 255 && kept[0] === 200 && clipped[3] === 0
        ? { status: 'pass', evidence: [`Над нижним слоем пиксель сохранён (${kept[0]},${kept[1]},${kept[2]},${kept[3]}), вне нижнего слоя обрезан (alpha ${clipped[3]})`] }
        : { status: 'fail', evidence: [`Обрезка по нижнему слою дала: над слоем ${kept[0]},${kept[3]}; вне слоя alpha ${clipped[3]}`] }
    })
  } finally {
    below.width = 1
    below.height = 1
  }
}

/** Фильтр «grayscale(1) contrast(1.55)» — тот, что использует режим «Трафарет». Без него — review, не fail. */
function checkStencilFilter(): ProbeResult {
  return probeCanvas(4, ctx => {
    if (typeof ctx.filter !== 'string') {
      return {
        status: 'review',
        evidence: ['ctx.filter недоступен: режим «Трафарет» на экране не сможет усилить контраст (grayscale + contrast(1.55)). Проверьте вид трафарета перед печатью.'],
      }
    }
    ctx.filter = 'grayscale(1) contrast(1.55)'
    const accepted = ctx.filter === 'grayscale(1) contrast(1.55)'
    if (!accepted) {
      ctx.filter = 'none'
      return {
        status: 'review',
        evidence: [`Браузер не сохранил фильтр «grayscale(1) contrast(1.55)» (ctx.filter = "${ctx.filter}"): предпросмотр трафарета будет без усиления контраста. Проверьте вид трафарета перед печатью.`],
      }
    }
    ctx.fillStyle = 'rgb(100, 150, 200)'
    ctx.fillRect(0, 0, 2, 2)
    ctx.filter = 'none'
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    const grayish = a === 255 && Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && r !== 100
    return grayish
      ? { status: 'pass', evidence: [`Фильтр применён: rgb(100,150,200) → ${r},${g},${b} (оттенки серого, контраст усилен)`] }
      : {
          status: 'review',
          evidence: [`Фильтр принят, но пиксели не изменились (${r},${g},${b},${a}): предпросмотр трафарета может выглядеть без усиления контраста`],
        }
  })
}

/** Справочная проверка: движок OffscreenCanvas не использует, поэтому отсутствие — review, не fail. */
function checkOffscreen(): ProbeResult {
  if (typeof OffscreenCanvas !== 'function') {
    return { status: 'review', evidence: ['OffscreenCanvas отсутствует. Приложение его не требует — проверка справочная, на работу не влияет.'] }
  }
  try {
    const canvas = new OffscreenCanvas(2, 2)
    const ctx = canvas.getContext('2d')
    return ctx
      ? { status: 'pass', evidence: ['OffscreenCanvas создан, 2D-контекст доступен (справочно — движок его не использует)'] }
      : { status: 'review', evidence: ['OffscreenCanvas создан, но 2D-контекст недоступен. Приложение его не использует — справочно.'] }
  } catch (error) {
    return { status: 'review', evidence: [`OffscreenCanvas бросил исключение: ${errorMessage(error)}. Приложение его не использует — справочно.`] }
  }
}

function checkPointerEvents(): ProbeResult {
  const api = typeof PointerEvent === 'function'
  const target = 'onpointerdown' in window
  return api && target
    ? { status: 'pass', evidence: ['PointerEvent конструируется, onpointerdown есть на window'] }
    : { status: 'fail', evidence: [`PointerEvent: ${api ? 'да' : 'нет'}, onpointerdown: ${target ? 'да' : 'нет'} — рисование указателем недоступно`] }
}

/** Синтетическое событие пера: подтверждает лишь, что браузер корректно несёт нажим через API. */
function checkPenPressure(): ProbeResult {
  try {
    const event = new PointerEvent('pointermove', { pointerId: 7, pointerType: 'pen', pressure: 0.42, clientX: 2, clientY: 2 })
    const ok = event.pointerType === 'pen' && Math.abs(event.pressure - 0.42) < 1e-6
    return ok
      ? { status: 'pass', evidence: [`Событие пера сохранило pointerType "pen" и pressure 0.42 — браузер корректно передаёт нажим через API`] }
      : { status: 'review', evidence: [`pointerType "${event.pointerType}", pressure ${event.pressure} — нажим пера не подтверждён API, проверьте реальный планшет`] }
  } catch (error) {
    return { status: 'review', evidence: [`Конструктор PointerEvent недоступен: ${errorMessage(error)} — нажим пера не подтверждён`] }
  }
}

function checkCoalesced(): ProbeResult {
  if (typeof PointerEvent !== 'function') {
    return { status: 'review', evidence: ['PointerEvent недоступен — сглаживание пера не подтверждено'] }
  }
  return typeof PointerEvent.prototype.getCoalescedEvents === 'function'
    ? { status: 'pass', evidence: ['getCoalescedEvents доступен: кривая пера собирается из всех сэмплов между кадрами'] }
    : { status: 'review', evidence: ['getCoalescedEvents отсутствует: линия строится по одному событию на кадр, плавность пера проверьте вручную'] }
}

function runCheck(id: string, label: string, required: boolean, probe: () => ProbeResult): DiagnosticCheck {
  try {
    const { status, evidence } = probe()
    return { id, label, status, required, evidence }
  } catch (error) {
    return { id, label, status: required ? 'fail' : 'review', required, evidence: [`Исключение при проверке: ${errorMessage(error)}`] }
  }
}

export function runEnvironmentDiagnostics(): DeviceDiagnosticsReport {
  const checks = [
    runCheck('canvas-2d', 'Canvas 2D: запись и чтение пикселей', true, checkCanvas2d),
    runCheck('path2d', 'Контуры Path2D', true, checkPath2d),
    runCheck('clip', 'Обрезка кисти выделением (clip)', true, checkClip),
    runCheck('alpha-mask', 'Маски слоёв (destination-in)', true, checkAlphaMask),
    runCheck('clip-to-below', 'Обрезка слоя по нижнему (clipToBelow)', true, checkClipToBelow),
    runCheck('stencil-filter', 'Фильтр трафарета: grayscale + contrast', true, checkStencilFilter),
    runCheck('offscreen', 'OffscreenCanvas (справочно)', false, checkOffscreen),
    runCheck('pointer-events', 'Pointer Events API', true, checkPointerEvents),
    runCheck('pen-pressure', 'Нажим пера через PointerEvent', false, checkPenPressure),
    runCheck('coalesced-events', 'Сглаживание пера (getCoalescedEvents)', false, checkCoalesced),
  ]
  const counts: Record<DiagnosticStatus, number> = { pass: 0, review: 0, fail: 0 }
  for (const check of checks) counts[check.status] += 1
  return {
    checks,
    counts,
    facts: {
      maxTouchPoints: navigator.maxTouchPoints,
      devicePixelRatio: window.devicePixelRatio || 1,
      userAgent: navigator.userAgent,
    },
    limitations: [...DIAGNOSTIC_LIMITATIONS],
    ranAt: new Date().toISOString(),
  }
}
