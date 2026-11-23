import { useMemo } from 'react'
import { Info, ListChecks } from 'lucide-react'
import type { AnalysisCategory, AnalysisFinding, ArtworkReport } from '../lib/artwork-analysis'
import type { QualityReport } from '../lib/quality'
import type { VisibleQuality } from '../lib/quality/visible'
import { StudioDialog } from './UI'

const CATEGORY_LABELS: Record<AnalysisCategory, string> = {
  detail: 'Детали',
  vector: 'Вектор',
  composition: 'Композиция',
}

const CATEGORY_ORDER: AnalysisCategory[] = ['detail', 'vector', 'composition']

const SEVERITY_LABELS: Record<AnalysisFinding['severity'], string> = {
  info: 'Инфо',
  review: 'Проверить вручную',
}

const EVIDENCE_LABELS: Record<string, string> = {
  nodes: 'узлов',
  simplified: 'после упрощения',
  reduction: 'сокращение, доля',
  epsilonMm: 'допуск, мм',
  count: 'количество',
  minX: 'min X',
  minY: 'min Y',
  maxX: 'max X',
  maxY: 'max Y',
  fullyOutside: 'полностью за холстом',
  sizeMm: 'размер, мм',
  thresholdMm: 'порог, мм',
  maxAreaMm2: 'макс. площадь, мм²',
  minAreaMm2: 'мин. площадь, мм²',
  speckAreaMm2: 'порог площади, мм²',
  speckSizeMm: 'порог размера, мм',
  vectorObjects: 'векторных объектов',
  inkPixels: 'пикселей чернил',
  marginMm: 'поле, мм',
  violatedLeft: 'слева',
  violatedTop: 'сверху',
  violatedRight: 'справа',
  violatedBottom: 'снизу',
  maxQuadrantShare: 'макс. доля квадранта',
  thresholdQuadrantShare: 'порог квадранта',
  centroidOffsetRatio: 'смещение центра, доля',
  thresholdCentroidOffset: 'порог смещения',
  density: 'плотность, доля',
  thresholdDensity: 'порог плотности',
}

function formatEvidenceValue(value: number): string {
  if (value === 0 || value === 1) return value === 1 ? 'да' : 'нет'
  return String(value)
}

export function AnalysisDialog({ open, onOpenChange, report, qualityReport, qualityStatus, qualityLimit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ArtworkReport | null
  qualityReport: QualityReport | null
  qualityStatus: VisibleQuality['status'] | null
  qualityLimit: number | null
}) {
  const grouped = useMemo(() => {
    const groups = new Map<AnalysisCategory, AnalysisFinding[]>()
    for (const finding of report?.findings ?? []) {
      const list = groups.get(finding.category) ?? []
      list.push(finding)
      groups.set(finding.category, list)
    }
    return CATEGORY_ORDER
      .filter(category => groups.has(category))
      .map(category => ({ category, findings: groups.get(category)! }))
  }, [report])

  const metrics = report?.metrics
  const vector = metrics?.vector
  const raster = metrics?.raster ?? null
  const composition = metrics?.composition

  return (
    <StudioDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Проверка эскиза"
      description="Локальный анализ видимых слоёв: узлы, детали и композиция. Это рекомендации для внимательного взгляда, а не вердикт."
    >
      {metrics && (
        <div className="analysis-content">
          {qualityStatus === 'ready' && qualityReport && (
            <section aria-label="Качество линейной работы">
              <h3>Качество линейной работы</h3>
              <p><strong>{Math.round(qualityReport.score * 100)}%</strong> · {qualityReport.level}</p>
              <dl className="analysis-metrics">
                <div className="analysis-metric"><dt>Непрерывность</dt><dd>{Math.round(qualityReport.metrics.continuity.score * 100)}%</dd></div>
                <div className="analysis-metric"><dt>Резкие изломы</dt><dd>{qualityReport.metrics.sharpTurns.count}</dd></div>
                <div className="analysis-metric"><dt>Равномерность толщины</dt><dd>{Math.round(qualityReport.metrics.thickness.score * 100)}%</dd></div>
                <div className="analysis-metric"><dt>Пересечения</dt><dd>{qualityReport.metrics.intersections.count}</dd></div>
                <div className="analysis-metric"><dt>Шумовые сегменты</dt><dd>{qualityReport.metrics.noise.count}</dd></div>
                <div className="analysis-metric"><dt>Вне документа</dt><dd>{qualityReport.metrics.bounds.count}</dd></div>
              </dl>
              {qualityReport.metrics.motion.available && <p>Скорость: {Math.round(qualityReport.metrics.motion.score * 100)}%</p>}
              {qualityReport.recommendations.length > 0 && <ul>{qualityReport.recommendations.map(item => <li key={item}>{item}</li>)}</ul>}
            </section>
          )}
          {qualityStatus === 'empty' && <p role="status">Нет видимых векторных линий для анализа качества. Растровый документ не оценивается.</p>}
          {qualityStatus === 'limited' && <p role="status">Анализ качества ограничен: объём векторных данных превышает {qualityLimit} узлов. Уменьшите выборку или анализируйте отдельные штрихи.</p>}
          <dl className="analysis-metrics">
            <div className="analysis-metric">
              <dt>Покрытие холста</dt>
              <dd>{composition ? `${(composition.density * 100).toFixed(1)}%` : '—'}</dd>
            </div>
            <div className="analysis-metric">
              <dt>Компонентов чернил</dt>
              <dd>{raster ? raster.componentCount : '—'}</dd>
            </div>
            <div className="analysis-metric">
              <dt>Узлы оригинал → упрощение</dt>
              <dd>{vector ? `${vector.totalNodes} → ${vector.simplifiedNodes}` : '—'}</dd>
            </div>
            <div className="analysis-metric">
              <dt>Макс. доля квадранта</dt>
              <dd>{composition ? `${(composition.maxQuadrantShare * 100).toFixed(1)}%` : '—'}</dd>
            </div>
          </dl>

          {grouped.length === 0 ? (
            <p className="analysis-clean"><ListChecks size={16} />Явных превышений заданных порогов не найдено.</p>
          ) : (
            <div className="analysis-findings">
              {grouped.map(({ category, findings }) => (
                <section key={category} className="finding-group">
                  <h3>{CATEGORY_LABELS[category]}</h3>
                  {findings.map((finding, index) => (
                    <article key={`${finding.code}-${index}`} className="finding-item">
                      <header>
                        <span className={`finding-severity severity-${finding.severity}`}>
                          <Info size={12} />
                          {SEVERITY_LABELS[finding.severity]}
                        </span>
                        <code>{finding.code}</code>
                      </header>
                      <p>{finding.message}</p>
                      <dl className="finding-evidence">
                        {Object.entries(finding.evidence).map(([key, value]) => (
                          <div key={key}>
                            <dt>{EVIDENCE_LABELS[key] ?? key}</dt>
                            <dd>{formatEvidenceValue(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}

          <p className="analysis-disclaimer">
            Проверка выполняется локально и детерминированно: те же слои дают тот же результат.
            Пороги эвристические и настраиваются под задачу. Проверка ничего не удаляет и не меняет
            в эскизе — художественный выбор всегда остаётся за вами.
          </p>
        </div>
      )}
    </StudioDialog>
  )
}
