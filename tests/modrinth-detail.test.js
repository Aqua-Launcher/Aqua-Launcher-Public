import assert from 'node:assert/strict'
import test from 'node:test'
import { filterVersions, normalizeProjectDetail, normalizeVersion } from '../electron/core/modrinth.js'

test('project details normalize links and tolerate missing fields', () => {
  const project = normalizeProjectDetail({
    id: 'abc123',
    slug: 'sodium',
    title: 'Sodium',
    description: 'Rendering engine',
    body: 'Fast rendering.',
    icon_url: 'https://cdn.modrinth.com/data/abc123/icon.png',
    downloads: '1234',
    followers: 5,
    categories: ['optimization', 7],
    gallery: [{ url: 'http://insecure.example/image.png' }, { url: 'https://cdn.modrinth.com/a.png', featured: true }],
    license: { id: 'MIT', name: 'MIT License', url: 'https://opensource.org/license/mit' },
    source_url: 'https://github.com/CaffeineMC/sodium',
    wiki_url: 'javascript:alert(1)',
  })

  assert.equal(project.id, 'abc123')
  assert.equal(project.iconUrl, 'https://cdn.modrinth.com/data/abc123/icon.png')
  assert.equal(project.downloads, 1234)
  assert.deepEqual(project.categories, ['optimization'])
  assert.equal(project.gallery.length, 1)
  assert.equal(project.gallery[0].url, 'https://cdn.modrinth.com/a.png')
  assert.equal(project.wikiUrl, null)
  assert.equal(project.license.name, 'MIT License')
  assert.equal(project.issuesUrl, null)
})

test('a project without an id is rejected', () => {
  assert.equal(normalizeProjectDetail(null), null)
  assert.equal(normalizeProjectDetail({ title: 'Missing id' }), null)
})

test('versions normalize files and dependencies and drop invalid entries', () => {
  const version = normalizeVersion({
    id: 'ver1',
    name: 'Sodium 0.6',
    version_number: '0.6.0',
    version_type: 'release',
    game_versions: ['1.21.1'],
    loaders: ['fabric'],
    date_published: '2026-01-02T00:00:00Z',
    files: [
      { url: 'https://cdn.modrinth.com/sodium.jar', filename: 'sodium.jar', size: 100, primary: true },
      { url: 'http://insecure.example/bad.jar', filename: 'bad.jar' },
    ],
    dependencies: [
      { project_id: 'fabric-api', dependency_type: 'required' },
      { dependency_type: 'required' },
    ],
  })

  assert.equal(version.id, 'ver1')
  assert.equal(version.files.length, 1)
  assert.equal(version.files[0].primary, true)
  assert.equal(version.dependencies.length, 1)
  assert.equal(version.dependencies[0].projectId, 'fabric-api')
  assert.equal(normalizeVersion({ name: 'No id' }), null)
})

test('versions filter by game version and loader and sort newest first', () => {
  const versions = [
    { id: 'old', gameVersions: ['1.20.1'], loaders: ['forge'], datePublished: '2025-01-01T00:00:00Z' },
    { id: 'new', gameVersions: ['1.21.1'], loaders: ['Fabric'], datePublished: '2026-01-01T00:00:00Z' },
    { id: 'other', gameVersions: ['1.21.1'], loaders: ['forge'], datePublished: '2026-02-01T00:00:00Z' },
  ]

  assert.deepEqual(
    filterVersions(versions, { gameVersion: '1.21.1', loader: 'fabric' }).map((version) => version.id),
    ['new'],
  )
  assert.deepEqual(
    filterVersions(versions, { gameVersion: '1.21.1' }).map((version) => version.id),
    ['other', 'new'],
  )
  assert.equal(filterVersions(versions).length, 3)
  assert.equal(filterVersions(null).length, 0)
})
