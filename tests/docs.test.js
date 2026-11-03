import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseRoadmap } from '../src/lib/roadmap.ts'
import { badgeLabel, parseMarkdown } from '../src/lib/markdown.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const readDoc = (name) => fs.readFileSync(path.join(root, '..', name), 'utf8')

test('the roadmap reader keeps outcomes and drops the build instructions', () => {
  const phases = parseRoadmap(readDoc('ROADMAP.md'))

  assert.ok(phases.length >= 5, 'phases come from the roadmap at a glance table')
  const features = phases.flatMap((phase) => phase.features)
  assert.ok(features.length >= 25, `expected the full package list, got ${features.length}`)

  for (const feature of features) {
    assert.match(feature.id, /^P\d\.\d$/)
    assert.ok(feature.title.length > 3, `${feature.id} needs a title`)
    assert.ok(feature.outcome.length > 20, `${feature.id} needs a sentence a player can read`)
    for (const marker of ['**', '`', 'Done when', 'Verify:', 'Out of scope', 'IPC:', 'Depends on']) {
      assert.ok(!feature.outcome.includes(marker), `${feature.id} leaked "${marker}" into its outcome`)
    }
  }

  // Phase 5 is decision-gated scope with no Outcome paragraph, so it is dropped
  // rather than shown as a promise.
  assert.ok(!phases.some((phase) => phase.number === 5))
})

test('the roadmap reader reports shipped and planned state', () => {
  const features = parseRoadmap(readDoc('ROADMAP.md')).flatMap((phase) => phase.features)
  const byId = Object.fromEntries(features.map((feature) => [feature.id, feature]))

  assert.equal(byId['P1.6'].title, 'Disk usage and cleanup')
  assert.equal(byId['P1.6'].status, 'done')
  assert.match(byId['P1.6'].outcome, /^Users can see where/)

  assert.equal(byId['P1.1'].title, 'Crash Guard')
  assert.equal(byId['P1.7'].status, 'blocked')
  assert.ok(features.some((feature) => feature.status === 'todo'))
})

test('the roadmap reader groups packages under their own phase', () => {
  const source = [
    '## 5. Roadmap at a glance',
    '',
    '| Phase | Theme | Packages | Exit outcome |',
    '|---|---|---|---|',
    '| 1 | Trust | P1.1–P1.2 | A crash is explained. |',
    '| 2 | Content depth | P2.1 | Installed content is legible. |',
    '',
    '## 7. Phase 1 — Trust',
    '',
    '### P1.1 · Crash Guard',
    '',
    '`A2` · **Effort L** · **Depends on:** nothing',
    '',
    '**Outcome:** A non-zero exit becomes an explained failure with next steps.',
    '',
    '**Build:**',
    '- `electron/core/crash-analysis.js` with rules.',
    '- Category table.',
    '',
    '**Done when:**',
    '- [ ] An OOM fixture produces an explanation.',
    '',
    '**Verify:** `node --test tests/crash.test.js`',
    '',
    '### P1.2 · Safe Mode',
    '',
    '**Outcome:** One click launches',
    'without mods, and restores afterwards.',
    '',
    '**Build:**',
    '- `electron/core/safe-mode.js`',
    '',
    '## 8. Phase 2 — Content depth',
    '',
    '### P2.1 · Panel without an outcome',
    '',
    '**Build:**',
    '- Something internal.',
    '',
    '**Out of scope:** everything else.',
  ].join('\n')

  const phases = parseRoadmap(source)
  assert.equal(phases.length, 1, 'a phase with no readable package is not shown')
  assert.equal(phases[0].number, 1)
  assert.equal(phases[0].title, 'Trust')
  assert.equal(phases[0].summary, 'A crash is explained.')
  assert.deepEqual(
    phases[0].features.map((feature) => feature.id),
    ['P1.1', 'P1.2'],
  )
  assert.equal(
    phases[0].features[1].outcome,
    'One click launches without mods, and restores afterwards.',
    'a wrapped outcome is joined into one sentence',
  )
  assert.equal(phases[0].features[0].status, 'todo', 'an untracked package is planned')
})

test('markdown blocks cover headings, lists, code, tables and quotes', () => {
  const blocks = parseMarkdown(
    [
      '# Title',
      '',
      'A paragraph that',
      'wraps over two lines.',
      '',
      '- first item',
      '- second item with `code`',
      '',
      '1. ordered one',
      '2. ordered two',
      '',
      '```bash',
      'npm test',
      '```',
      '',
      '| Platform | Directory |',
      '| --- | --- |',
      '| Windows | `%APPDATA%` |',
      '',
      '> A quoted line.',
      '',
      '---',
    ].join('\n'),
  )

  assert.deepEqual(blocks[0], { kind: 'heading', level: 1, text: 'Title' })
  assert.deepEqual(blocks[1], { kind: 'paragraph', text: 'A paragraph that wraps over two lines.' })
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: ['first item', 'second item with `code`'] })
  assert.deepEqual(blocks[3], { kind: 'list', ordered: true, items: ['ordered one', 'ordered two'] })
  assert.deepEqual(blocks[4], { kind: 'code', text: 'npm test' })
  assert.deepEqual(blocks[5], {
    kind: 'table',
    head: ['Platform', 'Directory'],
    rows: [['Windows', '`%APPDATA%`']],
  })
  assert.deepEqual(blocks[6], { kind: 'quote', text: 'A quoted line.' })
  assert.deepEqual(blocks[7], { kind: 'rule' })
})

test('the README renders as blocks without a Markdown dependency', () => {
  const blocks = parseMarkdown(readDoc('README.md'))
  const kinds = new Set(blocks.map((block) => block.kind))
  for (const kind of ['heading', 'paragraph', 'list', 'code', 'table', 'image']) {
    assert.ok(kinds.has(kind), `the README should produce ${kind} blocks`)
  }
  for (const block of blocks) {
    const text = block.kind === 'code' ? '' : JSON.stringify(block)
    assert.ok(!text.includes('```'), 'fence markers never reach the rendered text')
    assert.ok(!text.includes('|---'), 'table separator rows are dropped')
  }
})

test('the README banner and Markdown images become image blocks', () => {
  const blocks = parseMarkdown(
    [
      '<p align="center">',
      '  <img src="https://aqua.ch1n.dev/assets/og.jpg" alt="Aqua Website" width="100%">',
      '</p>',
      '',
      'A paragraph with ![a badge](https://img.shields.io/badge/Electron-45-2b2e3a) inline.',
    ].join('\n'),
  )

  assert.deepEqual(blocks[0], {
    kind: 'image',
    src: 'https://aqua.ch1n.dev/assets/og.jpg',
    alt: 'Aqua Website',
    width: '100%',
    align: 'center',
  })
  assert.equal(blocks[1].kind, 'paragraph')
  assert.match(blocks[1].text, /!\[a badge\]\(https:\/\/img\.shields\.io/)
})

test('shields badges become the text they would have drawn', () => {
  assert.equal(badgeLabel('https://img.shields.io/badge/Electron-45-2b2e3a'), 'Electron 45')
  assert.equal(badgeLabel('https://img.shields.io/badge/platform-Windows-0d6efd'), 'platform Windows')
  assert.equal(badgeLabel('https://img.shields.io/badge/React-19-149eca'), 'React 19')
  assert.equal(badgeLabel('https://example.com/badge.png', 'Plain alt'), null)
})
