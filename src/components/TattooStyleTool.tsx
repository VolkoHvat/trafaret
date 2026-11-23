import { useState } from 'react'
import { analyzeTattooSection } from '../lib/tattoo-style-check'
import { TATTOO_STYLE_PROFILES } from '../lib/tattoo-style-profiles'

export function useTattooStyleTool(field: Float64Array, width: number, height: number, widthMm: number, disabled: boolean, apply: readonly ((hex: string) => void)[]) {
  const [profileId, setProfileId] = useState(TATTOO_STYLE_PROFILES[0].id)
  const profile = TATTOO_STYLE_PROFILES.find(p => p.id === profileId)!
  const [hex, setHex] = useState(profile.colors[0])
  const [row, setRow] = useState('')
  const [report, setReport] = useState('')
  const roles = ['Контур', 'Основное пятно', 'Акцент']
  const hints = [profile.line, profile.fill, profile.mix]
  const check = () => {
    const y = Number(row) - 1
    if (!row || !Number.isInteger(y) || y < 0 || y >= height || field.length !== width * height) {
      setReport('Нет данных: выберите строку текущего поля.'); return
    }
    const result = analyzeTattooSection(Array.from(field.subarray(y * width, (y + 1) * width)), widthMm * (width - 1) / width)
    const mm = (v: number | null) => v === null ? 'нет данных' : `${v.toFixed(3)} мм`
    setReport(`${profile.name} · Снимок строки ${y + 1} поля плотности (${width} отсчётов). Шаг: ${mm(result.samplePitchMm)}; минимальная полоса: ${mm(result.minInkMm)} (${result.inkSeriesCount} полных серий); минимальный просвет: ${mm(result.minGapMm)} (${result.gapSeriesCount} полных серий); покрытие: ${result.coverage === null ? 'нет данных' : `${(result.coverage * 100).toFixed(1)}%`}.`)
  }
  return <details><summary>Мастер стиля</summary>
    <label>Художественный профиль <select value={profileId} onChange={e => {const next = TATTOO_STYLE_PROFILES.find(p => p.id === e.target.value)!; setProfileId(next.id); setHex(next.colors[0]); setReport('')}}>{TATTOO_STYLE_PROFILES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <p>Цель: {profile.focus}. Это отправная точка, не рейтинг и не правило выбора цвета.</p>
    {profile.colors.map((c,i) => <button key={i} type="button" title={hints[i]} aria-pressed={c === hex.toLowerCase()} onClick={() => setHex(c)}><span aria-hidden="true" style={{color:c, textShadow:'0 0 1px currentColor'}}>■ </span>{roles[i]} {c}</button>)}
    <p>{hints.join(' · ')}. Просвет оставляет кожу без пигмента; #ffffff — белый пигмент.</p>
    <label>Свой HEX <input value={hex} maxLength={7} placeholder="#rrggbb" onChange={e => setHex(e.target.value)}/></label>
    <fieldset disabled={disabled || !/^#[a-f\d]{6}$/i.test(hex)}><legend>Для следующего действия</legend>{['Для линии','Для заливки','Для смеси'].map((name,i) => <button key={name} onClick={() => apply[i](hex.toLowerCase())}>{name}</button>)}</fieldset>
    <label>Строка поля (1–{height}) <input type="number" min={1} max={height} value={row} onChange={e => {setRow(e.target.value); setReport('')}}/></label>
    <button onClick={check}>Проверка эскиза</button><output aria-live="polite">{report}</output>
    <p>Только трафарет плотности вдоль выбранной строки, по масштабу листа, не тела. Краевые полосы не измеряются. Цвет, подложка и заживление не оцениваются.</p>
  </details>
}
