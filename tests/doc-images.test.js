import assert from 'node:assert/strict'
import test from 'node:test'
import { DocImageService, MAX_IMAGE_BYTES, parseDocImageUrl } from '../electron/core/doc-images.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])

function response(body, { type = 'image/png', status = 200, length = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name).toLowerCase()
        if (key === 'content-type') return type
        if (key === 'content-length') return length == null ? null : String(length)
        return null
      },
    },
    async arrayBuffer() {
      return body
    },
  }
}

test('document image addresses must be public https URLs', () => {
  assert.equal(parseDocImageUrl('https://aqua.ch1n.dev/assets/og.jpg').hostname, 'aqua.ch1n.dev')
  assert.throws(() => parseDocImageUrl('http://aqua.ch1n.dev/assets/og.jpg'), /https/)
  assert.throws(() => parseDocImageUrl('https://localhost/image.png'), /host/)
  assert.throws(() => parseDocImageUrl('https://192.168.1.20/image.png'), /host/)
  assert.throws(() => parseDocImageUrl('https://user:pass@example.com/image.png'), /not allowed/)
  assert.throws(() => parseDocImageUrl(''), /required/)
  assert.throws(() => parseDocImageUrl('not a url'), /valid/)
})

test('a document image becomes a data URL and is cached', async () => {
  let calls = 0
  const service = new DocImageService({
    fetchImpl: async () => {
      calls += 1
      return response(PNG)
    },
  })

  const first = await service.load('https://aqua.ch1n.dev/assets/og.jpg')
  const second = await service.load('https://aqua.ch1n.dev/assets/og.jpg')

  assert.match(first, /^data:image\/png;base64,/)
  assert.equal(second, first)
  assert.equal(calls, 1, 'the same address is fetched once')
})

test('non-images, oversized headers and oversized bodies are refused', async () => {
  const html = new DocImageService({ fetchImpl: async () => response(Buffer.from('<html>'), { type: 'text/html' }) })
  await assert.rejects(html.load('https://example.com/page'), /not return an image/)

  const declared = new DocImageService({
    fetchImpl: async () => response(PNG, { length: MAX_IMAGE_BYTES + 1 }),
  })
  await assert.rejects(declared.load('https://example.com/huge.png'), /too large/)

  const actual = new DocImageService({
    fetchImpl: async () => response(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
  })
  await assert.rejects(actual.load('https://example.com/huge.png'), /too large/)
})

test('a failed load is not cached, so a retry can succeed', async () => {
  let calls = 0
  const service = new DocImageService({
    fetchImpl: async () => {
      calls += 1
      return calls === 1 ? response(PNG, { status: 503, type: 'text/html' }) : response(PNG)
    },
  })

  await assert.rejects(service.load('https://aqua.ch1n.dev/assets/og.jpg'), /HTTP 503/)
  const dataUrl = await service.load('https://aqua.ch1n.dev/assets/og.jpg')
  assert.match(dataUrl, /^data:image\/png;base64,/)
  assert.equal(calls, 2)
})
