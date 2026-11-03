import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSearchFacets,
  normalizeContentFilters,
  normalizeSearchFilters,
} from '../electron/core/modrinth.js'

test('search filters validate and build Modrinth facet groups', () => {
  const filters = normalizeSearchFilters({
    contentType: 'mod',
    sort: 'downloads',
    categories: ['optimization', 'library', 'not-a-category'],
    environment: 'client',
    license: 'mit',
    openSource: true,
    gameVersion: '1.21.1',
    loader: 'fabric',
  })

  assert.equal(filters.sort, 'downloads')
  assert.deepEqual(filters.categories, ['optimization', 'library'])
  assert.equal(filters.environment, 'client')
  assert.equal(filters.license, 'mit')
  assert.equal(filters.openSource, true)

  assert.deepEqual(buildSearchFacets(filters), [
    ['project_type:mod'],
    ['categories:optimization', 'categories:library'],
    ['categories:fabric'],
    ['versions:1.21.1'],
    ['client_side:required', 'client_side:optional'],
    ['license:mit'],
    ['open_source:true'],
  ])
})

test('invalid filter values fall back instead of reaching the API', () => {
  const filters = normalizeSearchFilters({
    contentType: 'mod',
    sort: 'popular',
    categories: ['magic', 'orbital-strike'],
    environment: 'everywhere',
    license: 'proprietary',
    openSource: 'yes',
    gameVersion: '../../etc/passwd',
    loader: 'liteloader',
  })

  assert.equal(filters.sort, 'relevance')
  assert.deepEqual(filters.categories, ['magic'])
  assert.equal(filters.environment, 'any')
  assert.equal(filters.license, null)
  assert.equal(filters.openSource, false)
  assert.equal(filters.gameVersion, null)
  assert.equal(filters.loader, null)
  assert.deepEqual(buildSearchFacets(filters), [['project_type:mod'], ['categories:magic']])
})

test('categories are scoped to the content type and modpacks ignore loader filters', () => {
  const shader = normalizeSearchFilters({ contentType: 'shader', categories: ['optimization', 'realistic'] })
  assert.deepEqual(shader.categories, ['realistic'])
  assert.equal(shader.loader, null)

  const modpack = normalizeSearchFilters({
    contentType: 'modpack',
    gameVersion: '1.21.1',
    loader: 'fabric',
    environment: 'server',
  })
  assert.equal(modpack.gameVersion, null)
  assert.equal(modpack.loader, null)
  assert.deepEqual(buildSearchFacets(modpack), [
    ['project_type:modpack'],
    ['server_side:required', 'server_side:optional'],
  ])
})

test('stored content filters keep only known keys and values', () => {
  const stored = normalizeContentFilters({
    mod: {
      categories: ['optimization', 'not-a-category', 'optimization', 'magic'],
      environment: 'client',
      license: 'mit',
      openSource: true,
      sort: 'newest',
      gameVersion: '1.21.1',
      loader: 'fabric',
    },
    shader: { categories: ['optimization', 'realistic'], sort: 'invalid' },
    notAContentType: { categories: ['optimization'] },
  })

  assert.deepEqual(stored, {
    mod: {
      categories: ['optimization', 'magic'],
      environment: 'client',
      license: 'mit',
      openSource: true,
      sort: 'newest',
    },
    shader: {
      categories: ['realistic'],
      environment: 'any',
      license: null,
      openSource: false,
      sort: 'relevance',
    },
  })
  assert.deepEqual(normalizeContentFilters(null), {})
})

test('settings normalize persisted content filters', async () => {
  const { createDefaultSettings, normalizeSettings } = await import('../electron/core/settings.js')
  const defaults = createDefaultSettings({ totalMemMb: 16_384, instancesRoot: 'C:\\Aqua\\instances' })
  const normalized = normalizeSettings(
    {
      contentFilters: {
        mod: { categories: ['optimization', 'bad'], environment: 'client', license: 'mit', openSource: true, sort: 'downloads' },
      },
    },
    defaults,
  )

  assert.deepEqual(normalized.contentFilters, {
    mod: {
      categories: ['optimization'],
      environment: 'client',
      license: 'mit',
      openSource: true,
      sort: 'downloads',
    },
  })
})
