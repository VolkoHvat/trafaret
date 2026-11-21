import { mkdir, writeFile } from 'node:fs/promises'
import { executeVoidProgram, parseVoidProgram } from '../src/lib/void-language.ts'

const source = `
FIELD saturation=1
PEN width=2 diffusion=4 strength=25.132741228718345 aspect=1 angle=0 driftX=0 driftY=0
SOURCE time=0 x=0 y=0 pressure=1
SOURCE time=0.08 x=8 y=4 pressure=0.9
MEASURE time=0 x=0 y=0
MEASURE time=0.2 x=0 y=0
CONTOUR time=0.2 x=0 y=0 angle=0 maxDistance=64 step=0.25
ENERGY time=0.2 x=0 y=0 angle=0
OBSERVE time=0 minX=-20 minY=-20 columns=64 rows=48 gridStep=1
OBSERVE time=0.2 minX=-20 minY=-20 columns=64 rows=48 gridStep=1
OBSERVE time=0.5 minX=-20 minY=-20 columns=64 rows=48 gridStep=1
GUIDE x=16 y=8 pressure=1
GUIDE x=24 y=0 pressure=0.85
GUIDE x=32 y=12 pressure=0.7
REMODEL time=0.2 horizon=0.12 step=0.01 minX=-20 minY=-20 columns=64 rows=48 gridStep=1
`

const result = executeVoidProgram(parseVoidProgram(source))
const panels = [
  { title: 'Фактический процесс · t=0.00', observation: result.observations[0] },
  { title: 'Фактический процесс · t=0.20', observation: result.observations[1] },
  { title: 'Фактический процесс · t=0.50', observation: result.observations[2] },
  { title: 'Ремоделирование · t=0.20', observation: result.previews[0] },
]
const scale = 5, panelWidth = 64 * scale, panelHeight = 48 * scale, gap = 20, margin = 20
const width = margin * 2 + panels.length * panelWidth + (panels.length - 1) * gap
const height = panelHeight + 82
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const renderPanel = (panel, index) => {
  const x = margin + index * (panelWidth + gap)
  const cells = []
  let cell = 0
  for (let row = 0; row < panel.observation.rows; row++) {
    for (let column = 0; column < panel.observation.columns; column++) {
      const saturation = panel.observation.saturation[cell++]
      const value = Math.round(saturation * 255)
      const compression = Math.min(1, Math.max(0, saturation - 1) * 4)
      const fill = saturation > 1
        ? `rgb(${Math.round(180 + 60 * compression)},${Math.round(120 + 80 * compression)},40)`
        : `rgb(${value},${value},${value})`
      cells.push(`<rect x="${x + column * scale}" y="${48 + row * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`)
    }
  }
  return `<text x="${x}" y="30" fill="#171914" font-family="sans-serif" font-size="14">${escape(panel.title)}</text>`
    + `<rect x="${x - 1}" y="47" width="${panelWidth + 2}" height="${panelHeight + 2}" fill="none" stroke="#777"/>`
    + cells.join('')
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  + `<rect width="100%" height="100%" fill="#f3f1e9"/>`
  + panels.map(renderPanel).join('')
  + `<text x="${margin}" y="${height - 12}" fill="#555" font-family="monospace" font-size="12">Белое: S=1 · Чёрное: S=0 · Золотое: буфер S>1 · REMODEL не меняет фактический процесс</text></svg>`
const summarize = observation => ({
  time: observation.time,
  voidCells: observation.saturation.filter(value => value <= 0.05).length,
  changedCells: observation.saturation.filter(value => value < 0.999).length,
  compressedCells: observation.saturation.filter(value => value > 1).length,
  meanSaturation: observation.saturation.reduce((sum, value) => sum + value, 0) / observation.saturation.length,
})
const refillObservation = refill => {
  const sources = Array.from({ length: 7 }, (_, index) => `SOURCE time=${(index * 0.03).toFixed(2)} x=${index * 4} y=0 pressure=1`).join('\n')
  return executeVoidProgram(parseVoidProgram(`
    FIELD saturation=1
    PEN width=2 diffusion=1 strength=25.132741228718345 refill=${refill}
    ${sources}
    OBSERVE time=0.24 minX=-20 minY=-20 columns=64 rows=48 gridStep=1
  `)).observations[0]
}
const persistentRefill = refillObservation(0)
const activeRefill = refillObservation(12)
const refillPanels = [
  { title: 'Без обратного заполнения', observation: persistentRefill },
  { title: 'Обратное заполнение · refill=12', observation: activeRefill },
]
const refillWidth = margin * 2 + refillPanels.length * panelWidth + (refillPanels.length - 1) * gap
const refillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${refillWidth}" height="${height}" viewBox="0 0 ${refillWidth} ${height}">`
  + `<rect width="100%" height="100%" fill="#f3f1e9"/>`
  + refillPanels.map(renderPanel).join('')
  + `<text x="${margin}" y="${height - 12}" fill="#555" font-family="monospace" font-size="12">Новый передний край сохраняет пустоту; старые участки возвращаются к S=1</text></svg>`
const report = {
  sourceCount: result.process.sourceCount,
  predictedCount: result.process.predictedCount,
  measurements: result.measurements,
  contours: result.contours,
  energies: result.energies,
  observations: result.observations.map(summarize),
  remodeling: result.previews.map(summarize),
  refill: { persistent: summarize(persistentRefill), active: summarize(activeRefill) },
}
const outDir = '.tools/void-probe'
await mkdir(outDir, { recursive: true })
await writeFile(`${outDir}/void-probe.svg`, svg)
await writeFile(`${outDir}/void-refill.svg`, refillSvg)
await writeFile(`${outDir}/void-probe.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`SVG: ${outDir}/void-probe.svg`)
