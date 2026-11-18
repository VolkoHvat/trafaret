import { spawnSync } from 'node:child_process'
import process from 'node:process'

const executable = process.platform === 'win32' ? 'cmd.exe' : './gradlew'
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat', 'assembleRelease'] : ['assembleRelease']
const result = spawnSync(executable, args, {
  cwd: 'android',
  stdio: 'inherit',
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
