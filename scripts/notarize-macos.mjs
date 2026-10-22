import { runNotarization } from './lib/notarization.mjs'

const [mode, dmgPath, ...extra] = process.argv.slice(2)
if (extra.length || (mode === 'preflight' && dmgPath)) {
  console.error('Usage: node scripts/notarize-macos.mjs preflight | notarize <DMG_PATH>')
  process.exitCode = 1
} else {
  process.exitCode = runNotarization({ mode, dmgPath })
}
