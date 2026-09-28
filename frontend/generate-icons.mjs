// generate-icons.mjs — run once to produce public/icons/icon-192.png and icon-512.png
// Usage: node generate-icons.mjs  (from frontend/ directory)
// Requires: npm install --save-dev sharp  (or: npx --yes sharp ...)
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

async function main() {
  let sharp
  try { sharp = (await import('sharp')).default }
  catch { console.error('Install sharp first: npm i -D sharp'); process.exit(1) }

  const svgPath = join(__dir, 'public', 'logo.svg')
  const svgBuf = readFileSync(svgPath)
  mkdirSync(join(__dir, 'public', 'icons'), { recursive: true })

  for (const size of [192, 512]) {
    await sharp(svgBuf)
      .resize(size, size)
      .png()
      .toFile(join(__dir, 'public', 'icons', `icon-${size}.png`))
    console.log(`icon-${size}.png generated`)
  }
  // Also generate favicon.ico (32x32 PNG used as favicon)
  await sharp(svgBuf).resize(32, 32).png().toFile(join(__dir, 'public', 'favicon-32.png'))
  console.log('favicon-32.png generated')

  // Monochrome (white-on-transparent) badge used for Android's push-notification status bar icon.
  // Must be generated from a dedicated silhouette SVG (no background fill), otherwise Android
  // renders the notification badge as a solid white square.
  const badgeSvgPath = join(__dir, 'public', 'icons', 'badge-mono.svg')
  const badgeSvgBuf = readFileSync(badgeSvgPath)
  await sharp(badgeSvgBuf).resize(96, 96).png().toFile(join(__dir, 'public', 'icons', 'badge-96.png'))
  console.log('badge-96.png generated')
}

main()
