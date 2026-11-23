import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { wyvernSvg } from '../src/lib/wyvern-artwork.ts'
import { silentiumSvg } from '../src/lib/silentium-artwork.ts'

await mkdir('.tools/void-probe', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const [name, svg, width, height] of [
    ['wyvern', wyvernSvg(), 960, 600],
    ['silentium', silentiumSvg(), 1600, 600],
  ]) {
    await writeFile(`.tools/void-probe/${name}.svg`, svg)
    const page = await browser.newPage({ viewport: { width, height } })
    await page.setContent(svg, { waitUntil: 'load' })
    await page.screenshot({ path: `.tools/void-probe/${name}-vector.png`, fullPage: false, timeout: 60000 })
    await page.close()
    console.log(`.tools/void-probe/${name}.svg`)
  }
} finally { await browser.close() }
