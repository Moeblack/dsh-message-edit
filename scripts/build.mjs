import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: pluginRoot, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`))
    })
  })
}

const dist = join(pluginRoot, 'dist')
await rm(dist, { recursive: true, force: true })
await run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.host.json'])
await run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.client.json'])
await run(process.execPath, [require.resolve('tsdown/run'), '--config', 'tsdown.config.ts'])
await copyFile(join(dist, 'index.js'), join(pluginRoot, 'index.mjs'))
await copyFile(join(dist, 'client.js'), join(pluginRoot, 'client.js'))
await copyFile(join(dist, 'client.js.map'), join(pluginRoot, 'client.js.map'))
await rm(dist, { recursive: true, force: true })
