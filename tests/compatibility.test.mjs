import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/client/controller.ts', import.meta.url), 'utf8')
const preset = await readFile(new URL('../scripts/dsh-client-preset.ts', import.meta.url), 'utf8')
const artifact = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('uses the current SessionSnapshot contract', () => {
  assert.match(source, /CurrentSessionSnapshot/)
  assert.match(source, /snapshot\.pendingSubmissions/)
  assert.match(source, /snapshot\.loadingOlder/)
  assert.doesNotMatch(source, /turnEnds\.entries/)
})

test('keeps the host store as a shared browser external', () => {
  assert.match(source, /@deepseek-ai\/dsh-client-store/)
  assert.match(preset, /RUNTIME_STORE_EXEMPTION = '@deepseek-ai\/dsh-client-store'/)
  assert.doesNotMatch(preset, /@deepseek-ai\/dsh-client-runtime\/client/)
})

test('ships the rebuilt browser artifact with the same compatibility seam', () => {
  assert.match(artifact, /@deepseek-ai\/dsh-client-store/)
  assert.match(artifact, /pendingSubmissions/)
  assert.doesNotMatch(artifact, /turnEnds\.entries/)
})
