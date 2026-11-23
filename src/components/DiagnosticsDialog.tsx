import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import type { DeviceDiagnosticsReport, DiagnosticCheck, DiagnosticStatus } from '../lib/diagnostics'
import { StudioDialog } from './UI'

const STATUS_META: Record<DiagnosticStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: 'Готово', icon: CheckCircle2, className: 'diag-pass' },
  review: { label: 'Проверить вручную', icon: AlertTriangle, className: 'diag-review' },
  fail: { label: 'Не поддерживается', icon: XCircle, className: 'diag-fail' },
}

function CheckRow({ check }: { check: DiagnosticCheck }) {
  const meta = STATUS_META[check.status]
  const Icon = meta.icon
  return (
    <article className="diag-check">
      <header>
        <span className={`diag-status ${meta.className}`}><Icon size={13} />{meta.label}</span>
        <strong>{check.label}</strong>
        <span className="diag-required">{check.required ? 'обязательно' : 'необязательно'}</span>
      </header>
      <ul>
        {check.evidence.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </article>
  )
}

export function DiagnosticsDialog({ open, onOpenChange, report }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: DeviceDiagnosticsReport | null
}) {
  return (
    <StudioDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Диагностика устройства"
      description="Проверки Canvas 2D, масок, пера и фильтров выполняются локально на этом устройстве: без сети, без отправки данных и без обращений к железу."
    >
      {!report ? (
        <p className="diag-running"><Loader2 size={16} className="diag-spin" aria-hidden="true" />Диагностика выполняется…</p>
      ) : (
        <div className="diagnostics-content">
          <dl className="diag-counts">
            <div className="diag-count diag-pass"><dt>Готово</dt><dd>{report.counts.pass}</dd></div>
            <div className="diag-count diag-review"><dt>Проверить вручную</dt><dd>{report.counts.review}</dd></div>
            <div className="diag-count diag-fail"><dt>Не поддерживается</dt><dd>{report.counts.fail}</dd></div>
          </dl>

          <p className="diag-facts">
            Мультитач-точек (заявлено ОС): {report.facts.maxTouchPoints} · Плотность пикселей: {report.facts.devicePixelRatio} · {report.facts.userAgent}
          </p>

          <div className="diag-list">
            {report.checks.map(check => <CheckRow key={check.id} check={check} />)}
          </div>

          <section className="diag-limitations">
            <h3><Info size={13} aria-hidden="true" />Что эта диагностика НЕ проверяет</h3>
            <ul>
              {report.limitations.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </section>

          <p className="panel-note">
            Основная работа студии — рисование, маски, слои, экспорт и печать — не требует сети и выполняется
            целиком на этом устройстве. Облачная синхронизация — отдельная опция, которую можно не включать.
          </p>
        </div>
      )}
    </StudioDialog>
  )
}
