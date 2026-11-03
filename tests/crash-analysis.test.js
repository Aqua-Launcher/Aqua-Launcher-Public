import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCrash } from '../electron/core/crash-analysis.js'

test('a clean exit produces no analysis', () => {
  assert.equal(analyzeCrash({ exitCode: 0 }), null)
  assert.equal(analyzeCrash({ text: 'Stopping!' }), null)
})

test('an out-of-memory crash suggests raising the allocation', () => {
  const analysis = analyzeCrash({
    exitCode: 1,
    memory: { maxMb: 4096 },
    text: [
      '[12:00:00] [Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space',
      '[12:00:00] [Render thread/ERROR]: Failed to allocate a texture atlas',
    ].join('\n'),
  })
  assert.equal(analysis.category, 'out-of-memory')
  assert.equal(analysis.confidence, 'high')
  assert.match(analysis.summary, /4096 MB/)
  assert.ok(analysis.actions.some((action) => action.id === 'raise-ram'))
  assert.ok(analysis.evidence.some((line) => line.includes('OutOfMemoryError')))
})

test('a missing dependency is named from the stack trace', () => {
  const analysis = analyzeCrash({
    exitCode: 1,
    text: 'java.lang.NoClassDefFoundError: dev/architectury/ArchitecturyAPI\n\tat com.example.mod.Common.setup(Common.java:21)',
  })
  assert.equal(analysis.category, 'missing-dependency')
  assert.match(analysis.summary, /ArchitecturyAPI/)
  assert.ok(analysis.actions.some((action) => action.id === 'open-content'))
})

test('java version, mixin and graphics failures are separated', () => {
  const java = analyzeCrash({ exitCode: 1, text: 'java.lang.UnsupportedClassVersionError: class file version 65.0' })
  assert.equal(java.category, 'java-version')
  assert.ok(java.actions.some((action) => action.id === 'open-settings'))

  const mixin = analyzeCrash({ exitCode: 1, text: 'Mixin apply failed: mixin.example.json:example.mixins.json:ExampleMixin' })
  assert.equal(mixin.category, 'mixin-failure')
  assert.ok(mixin.actions.some((action) => action.id === 'launch-safe'))

  const graphics = analyzeCrash({ exitCode: -1073741819, text: 'GLFW error 65542: WGL: The driver does not appear to support OpenGL' })
  assert.equal(graphics.category, 'graphics-driver')
})

test('mod conflicts and corrupt installs get their own actions', () => {
  const conflict = analyzeCrash({ exitCode: 1, text: 'Duplicate mods:\n  modid: create\n  files: create-1.jar, create-2.jar' })
  assert.equal(conflict.category, 'mod-conflict')
  assert.match(conflict.summary, /modid/)

  const corrupt = analyzeCrash({ exitCode: 1, text: 'java.util.zip.ZipException: invalid LOC header (bad signature)' })
  assert.equal(corrupt.category, 'corrupt-install')
  assert.ok(corrupt.actions.some((action) => action.id === 'verify-install'))
})

test('a non-zero exit without a known signature is still explained', () => {
  const analysis = analyzeCrash({ exitCode: 137, signal: 'SIGKILL', text: '' })
  assert.equal(analysis.category, 'unknown')
  assert.equal(analysis.confidence, 'low')
  assert.ok(analysis.actions.some((action) => action.id === 'open-logs'))
  assert.ok(analysis.title.length > 5)
})
