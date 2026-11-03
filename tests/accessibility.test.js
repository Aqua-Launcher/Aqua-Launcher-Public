import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createDefaultSettings, normalizeSettings } from '../electron/core/settings.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(root, '..', 'src', 'styles', 'base.css'), 'utf8')

function hex(value) {
  return value.replace('#', '').match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255)
}

function luminance(value) {
  return hex(value)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

test('high-contrast tokens keep body text above the WCAG AA contrast floor', () => {
  const block = css.match(/html\[data-contrast='high'\]\s*\{([\s\S]*?)\n\}/)
  assert.ok(block, 'high-contrast token block exists')
  const tokens = Object.fromEntries(
    [...block[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]),
  )
  for (const surface of ['bg', 'panel', 'panel-2']) {
    for (const ink of ['text', 'text-secondary', 'body', 'muted', 'dim', 'accent-text', 'danger', 'warning', 'success']) {
      assert.ok(tokens[surface], `${surface} token exists`)
      assert.ok(tokens[ink], `${ink} token exists`)
      const ratio = contrast(tokens[ink], tokens[surface])
      assert.ok(ratio >= 4.5, `${ink} on ${surface} is ${ratio.toFixed(2)}:1`)
    }
  }
})

test('high-contrast and reduced-transparency preferences normalize safely', () => {
  const defaults = createDefaultSettings({ totalMemMb: 16_384, instancesRoot: path.join(os.tmpdir(), 'aqua-a11y') })
  assert.equal(defaults.highContrast, false)
  assert.equal(defaults.reduceTransparency, false)

  const enabled = normalizeSettings({ highContrast: true, reduceTransparency: true }, defaults)
  assert.equal(enabled.highContrast, true)
  assert.equal(enabled.reduceTransparency, true)

  const invalid = normalizeSettings({ highContrast: 'yes', reduceTransparency: 1 }, defaults)
  assert.equal(invalid.highContrast, false)
  assert.equal(invalid.reduceTransparency, false)
})

test('reduced-motion mode removes animation and transition duration', () => {
  assert.match(
    css,
    /\[data-reduce-motion='true'\] \*,[\s\S]*?animation: none !important;[\s\S]*?transition: none !important;/,
  )
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;[\s\S]*?transition: none !important;/,
  )
})
