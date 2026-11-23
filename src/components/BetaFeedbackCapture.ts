import { mediaFormats, mediaLimits, mediaName, type ReportMedia } from '../lib/beta-report'

export const captureSeconds = 60
export async function captureFeedback(kind: ReportMedia, signal: AbortSignal, ready: (stop: () => void) => void) {
  const devices = navigator.mediaDevices
  if (typeof MediaRecorder === 'undefined' || !(kind === 'voice' ? devices?.getUserMedia : devices?.getDisplayMedia)) throw Error('Запись здесь недоступна')
  const mimeType = Object.keys(mediaFormats[kind]).find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw Error('Нет поддерживаемого формата записи')
  const stream = kind === 'voice' ? await devices.getUserMedia({ audio: true, video: false }) : await devices.getDisplayMedia({ video: true, audio: false })
  let cleanup = () => {}
  try {
    signal.throwIfAborted()
    const recorder = new MediaRecorder(stream, { mimeType })
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = []
      let size = 0
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop() }
      const abort = () => reject(Error('Запись отменена'))
      const timer = window.setTimeout(stop, captureSeconds * 1000)
      cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        stream.getTracks().forEach(track => track.removeEventListener('ended', stop))
        recorder.onstop = recorder.onerror = recorder.ondataavailable = null
        stop()
      }
      signal.addEventListener('abort', abort, { once: true })
      stream.getTracks().forEach(track => track.addEventListener('ended', stop))
      recorder.ondataavailable = ({ data }) => {
        size += data.size
        if (size > mediaLimits[kind]) reject(Error('Запись превысила лимит размера и удалена'))
        else chunks.push(data)
      }
      recorder.onerror = () => reject(Error('Ошибка записи'))
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks.find(chunk => chunk.type)?.type || recorder.mimeType || mimeType })
        try { mediaName(kind, blob); resolve(blob) } catch (error) { reject(error) }
      }
      recorder.start(250)
      ready(stop)
    })
  } finally {
    try { cleanup() } finally { stream.getTracks().forEach(track => track.stop()) }
  }
}
