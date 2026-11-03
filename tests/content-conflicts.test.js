import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareVersions,
  findConflicts,
  satisfiesVersionRange,
} from '../electron/core/content-conflicts.js'

function file(filename, metadata, enabled = true) {
  return {
    filename,
    enabled,
    metadata: {
      modId: null,
      name: null,
      version: null,
      authors: [],
      loader: 'fabric',
      mcRange: null,
      requiredDependencies: [],
      ...metadata,
    },
  }
}

test('version ranges cover comparators, wildcards, Maven and hyphen forms', () => {
  assert.equal(compareVersions('1.21.1', '1.21.0'), 1)
  assert.equal(compareVersions('1.21', '1.21.0'), 0)
  assert.equal(satisfiesVersionRange('1.21.1', '>=1.20 <1.22'), true)
  assert.equal(satisfiesVersionRange('1.22', '>=1.20 <1.22'), false)
  assert.equal(satisfiesVersionRange('1.21.1', '1.21.x'), true)
  assert.equal(satisfiesVersionRange('1.20.1', '1.21.x'), false)
  assert.equal(satisfiesVersionRange('1.20.5', '[1.20.1,1.21)'), true)
  assert.equal(satisfiesVersionRange('1.21', '[1.20.1,1.21)'), false)
  assert.equal(satisfiesVersionRange('1.20.5', '1.20.1 - 1.21'), true)
  assert.equal(satisfiesVersionRange('1.20.5', '~1.20.1'), true)
  assert.equal(satisfiesVersionRange('1.21', '~1.20.1'), false)
  assert.equal(satisfiesVersionRange('1.21.1', 'not-a-range'), null)
  assert.equal(satisfiesVersionRange('1.21.1', ''), true)
})

test('a healthy mod set has no conflicts', () => {
  const conflicts = findConflicts({
    loader: 'fabric',
    gameVersion: '1.21.1',
    files: [
      file('fabric-api.jar', { modId: 'fabric-api', name: 'Fabric API', mcRange: '>=1.20' }),
      file('sodium.jar', {
        modId: 'sodium',
        name: 'Sodium',
        mcRange: '>=1.20 <1.22',
        requiredDependencies: ['minecraft', 'fabricloader', 'fabric-api'],
      }),
    ],
  })

  assert.equal(conflicts.total, 0)
  assert.deepEqual(conflicts.missingDependencies, [])
  assert.deepEqual(conflicts.duplicateIds, [])
  assert.deepEqual(conflicts.loaderMismatch, [])
  assert.deepEqual(conflicts.versionMismatch, [])
  assert.deepEqual(conflicts.knownIncompatible, [])
})

test('missing required dependencies name the dependent mod and ignore optional ones', () => {
  const conflicts = findConflicts({
    files: [
      file('create.jar', {
        modId: 'create',
        name: 'Create',
        requiredDependencies: ['fabric-api', 'minecraft', 'java'],
      }),
    ],
  })

  assert.equal(conflicts.missingDependencies.length, 1)
  assert.deepEqual(conflicts.missingDependencies[0], {
    dependencyId: 'fabric-api',
    filename: 'create.jar',
    modId: 'create',
    modName: 'Create',
  })
  assert.equal(conflicts.total, 1)
})

test('duplicate mod IDs list every enabled file', () => {
  const conflicts = findConflicts({
    files: [
      file('sodium.jar', { modId: 'sodium', name: 'Sodium', version: '1' }),
      file('sodium-copy.jar', { modId: 'sodium', name: 'Sodium copy', version: '2' }),
      file('sodium-old.jar', { modId: 'sodium', name: 'Sodium old' }, false),
    ],
  })

  assert.equal(conflicts.duplicateIds.length, 1)
  assert.equal(conflicts.duplicateIds[0].modId, 'sodium')
  assert.deepEqual(conflicts.duplicateIds[0].files.map((entry) => entry.filename), ['sodium.jar', 'sodium-copy.jar'])
})

test('wrong loader and incompatible Minecraft versions are reported', () => {
  const conflicts = findConflicts({
    loader: 'fabric',
    gameVersion: '1.21.1',
    files: [
      file('forge-mod.jar', { modId: 'example', name: 'Example', loader: 'forge', mcRange: '<1.21' }),
    ],
  })

  assert.equal(conflicts.loaderMismatch.length, 1)
  assert.deepEqual(conflicts.loaderMismatch[0], {
    filename: 'forge-mod.jar',
    name: 'Example',
    modId: 'example',
    loader: 'forge',
    expectedLoader: 'fabric',
  })
  assert.equal(conflicts.versionMismatch.length, 1)
  assert.equal(conflicts.versionMismatch[0].range, '<1.21')
  assert.equal(conflicts.versionMismatch[0].gameVersion, '1.21.1')
})

test('known incompatible pairs are conservative and reported once', () => {
  const conflicts = findConflicts({
    files: [
      file('sodium.jar', { modId: 'sodium', name: 'Sodium' }),
      file('optifine.jar', { modId: 'optifine', name: 'OptiFine' }),
    ],
  })

  assert.equal(conflicts.knownIncompatible.length, 1)
  assert.equal(conflicts.knownIncompatible[0].left.name, 'Sodium')
  assert.equal(conflicts.knownIncompatible[0].right.name, 'OptiFine')
  assert.match(conflicts.knownIncompatible[0].source, /Sodium/i)
})

test('disabled files never satisfy dependencies or create duplicates', () => {
  const conflicts = findConflicts({
    files: [
      file('fabric-api.jar.disabled', { modId: 'fabric-api', name: 'Fabric API' }, false),
      file('create.jar', { modId: 'create', name: 'Create', requiredDependencies: ['fabric-api'] }),
    ],
  })

  assert.equal(conflicts.duplicateIds.length, 0)
  assert.equal(conflicts.missingDependencies.length, 1)
  assert.equal(conflicts.missingDependencies[0].dependencyId, 'fabric-api')
})
