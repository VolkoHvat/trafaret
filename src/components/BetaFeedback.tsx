import { useEffect, useRef, useState } from 'react'
import { buildBetaReport, mediaFormats, mediaLimits, mediaName, type BetaDiagnostics, type ReportMedia } from '../lib/beta-report'
import { captureFeedback, captureSeconds } from './BetaFeedbackCapture'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { betaFeedbackUrl } from '../lib/beta-feedback-url'
import './BetaFeedback.css'

const nativeFeedback = registerPlugin<{ openForm(): Promise<void> }>('TrafaretFeedback')

const labels = { voice: 'Голос', screen: 'Экран' }
const kinds = ['voice', 'screen'] as const
function diagnostics(): BetaDiagnostics {
  const ua = navigator.userAgent
  return { browser: /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : 'other', platform: /Android/i.test(ua) ? 'android' : 'unknown', input: 'unknown' }
}
function Preview({ kind, blob }: { kind: ReportMedia; blob: Blob }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = document.createElement(kind === 'voice' ? 'audio' : 'video')
    const url = URL.createObjectURL(blob)
    media.controls = true; media.src = url; media.setAttribute('aria-label', labels[kind]); ref.current!.append(media)
    return () => { media.pause(); media.remove(); URL.revokeObjectURL(url) }
  }, [kind, blob])
  return <div ref={ref} />
}
function ReportDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const session = useRef<AbortController | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const [text, setText] = useState(''), [diag, setDiag] = useState(false)
  const [media, setMedia] = useState<Partial<Record<ReportMedia, Blob>>>({})
  const [active, setActive] = useState<ReportMedia | null>(null), [stop, setStop] = useState<(() => void) | null>(null)
  const [status, setStatus] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => {
    const el = dialog.current!, life = new AbortController(); lifetime.current = life; el.showModal()
    return () => { life.abort(); session.current?.abort(); el.close() }
  }, [])
  function attach(kind: ReportMedia, blob?: Blob) {
    if (blob) mediaName(kind, blob)
    setMedia(old => ({ ...old, [kind]: blob })); setStatus(blob ? 'Вложение добавлено' : 'Вложение удалено')
  }
  async function record(kind: ReportMedia) {
    if (session.current) return
    const controller = new AbortController(); session.current = controller
    setActive(kind); setStatus('Ожидание разрешения…')
    try {
      const blob = await captureFeedback(kind, controller.signal, fn => { setStop(() => fn); setStatus('Идёт запись') })
      if (!controller.signal.aborted) attach(kind, blob)
    } catch (e) {
      if (!controller.signal.aborted) setStatus(`${e instanceof Error && e.name === 'NotAllowedError' ? 'Нет разрешения на запись' : e instanceof Error ? e.message : 'Запись не удалась'}. Выберите файл или оставьте текст.`)
    } finally {
      if (session.current === controller) { session.current = null; setActive(null); setStop(null) }
    }
  }
  async function download() {
    const life = lifetime.current!
    setSaving(true); setStatus('Создаём архив…')
    try {
      const blob = await buildBetaReport(text, { localExport: true, diagnostics: diag, voice: !!media.voice, screen: !!media.screen }, { diagnostics, voice: () => media.voice!, screen: () => media.screen! })
      if (life.signal.aborted) return
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trafaret-beta-report.zip'; document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); setStatus('Архив передан браузеру для скачивания')
    } catch (e) { if (!life.signal.aborted) setStatus(e instanceof Error ? e.message : 'Не удалось создать архив') }
    finally { if (!life.signal.aborted) setSaving(false) }
  }
  return <dialog className="beta-dialog" ref={dialog} aria-labelledby="beta-title" onCancel={e => { e.preventDefault(); close() }} onKeyDown={e => e.stopPropagation()}>
    <h2 id="beta-title">Создать отчёт</h2>
    <p>Ничего не отправляется. Оставьте текст или голос. После закрытия черновик удаляется.</p>
    <fieldset disabled={saving}><label>Текст отзыва (до 64 КиБ)<textarea maxLength={65536} value={text} onChange={e => setText(e.target.value)} /></label>
    {kinds.map(kind => <fieldset key={kind}><legend>{labels[kind]} · до {mediaLimits[kind] / 1048576} МиБ</legend>
      <p>{kind === 'voice' ? 'Запись включает микрофон.' : 'Запись без звука. Выберите окно без личных данных.'} До {captureSeconds} секунд. Выбранный файл попадёт в ZIP без изменений.</p>
      {active === kind ? <button onClick={() => { if (stop) stop(); else { session.current?.abort(); session.current = null; setActive(null); setStatus('Запрос отменён') } }}>{stop ? 'Остановить запись' : 'Отменить запрос'}</button> : <button disabled={!!active || !!media[kind]} onClick={() => void record(kind)}>Записать: {labels[kind]}</button>}
      <label>Выбрать файл: {labels[kind]}<input type="file" disabled={!!active || !!media[kind]} accept={Object.keys(mediaFormats[kind]).join(',')} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) try { attach(kind, file) } catch (err) { setStatus((err as Error).message) } }} /></label>
      {media[kind] && <><Preview kind={kind} blob={media[kind]} /><button onClick={() => attach(kind)}>Удалить: {labels[kind]}</button></>}
    </fieldset>)}
    <label><input type="checkbox" checked={diag} onChange={e => setDiag(e.target.checked)} /> Добавить диагностику: семейство браузера, платформа и тип ввода (если известны)</label></fieldset>
    <section aria-label="Отзыв на GitHub"><h3>Публичный отзыв на GitHub</h3>
      <p>Скопируйте только текст, откройте форму и вставьте его вручную. Issue будет виден всем. Вход или регистрация нужны только на GitHub для публикации, не для работы в Трафарете. Архив, медиа, диагностика и документ не передаются.</p>
      <button disabled={!text.trim() || !!active} onClick={async () => { try { await navigator.clipboard.writeText(text); setStatus('Текст скопирован') } catch { setStatus('Выделите и скопируйте текст отзыва вручную') } }}>Скопировать текст отзыва</button>
      <button disabled={!!active} onClick={() => {
        if (Capacitor.isNativePlatform()) void nativeFeedback.openForm().catch(() => setStatus(`Откройте форму вручную: ${betaFeedbackUrl}`))
        else window.open(betaFeedbackUrl, '_blank', 'noopener,noreferrer')
      }}>Открыть форму GitHub</button></section>
    <p role="status">{status}</p><footer className="beta-actions"><button disabled={saving || !!active || (!text.trim() && !media.voice)} onClick={() => void download()}>Скачать ZIP</button><button onClick={close}>Закрыть</button></footer>
  </dialog>
}
export default function BetaFeedback() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  function closeReport() {
    setOpen(false)
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }))
  }
  return <><button ref={opener} className="beta-launch" aria-haspopup="dialog" onClick={() => setOpen(true)}>Создать отчёт</button>{open && <ReportDialog close={closeReport} />}</>
}
