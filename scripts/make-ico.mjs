// Собирает build/icon.ico (256x256) из существующего PNG приложения.
// PNG ресайзится до 256 через Pillow (png ICO-ресурс не требует alpha-конверсии).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const source = join(root, 'public', 'icons', 'icon-512.png')
const targetDir = join(root, 'build')
const resized = join(targetDir, 'icon-256.png')
const target = join(targetDir, 'icon.ico')

execFileSync('python3', ['-c', `
from PIL import Image
img = Image.open(${JSON.stringify(source)})
img = img.convert('RGBA').resize((256, 256), Image.LANCZOS)
img.save(${JSON.stringify(resized)})
`])

const png = readFileSync(resized)
rmSync(resized)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // count

const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // width: 0 означает 256
entry.writeUInt8(0, 1) // height: 0 означает 256
entry.writeUInt8(0, 2) // palette
entry.writeUInt8(0, 3) // reserved
entry.writeUInt16LE(1, 4) // color planes
entry.writeUInt16LE(32, 6) // bits per pixel
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(6 + 16, 12) // offset

mkdirSync(targetDir, { recursive: true })
writeFileSync(target, Buffer.concat([header, entry, png]))
console.log('icon.ico создан (256x256 PNG внутри ICO)')
