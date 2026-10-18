import { createRequire } from 'node:module'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { globSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dsh = resolve(process.argv[2] ?? process.env.DSH_ROOT ?? '')
if (!process.argv[2] && !process.env.DSH_ROOT) throw new Error('Usage: node scripts/use-local-dsh.mjs <DSH checkout>')
const requireDsh = createRequire(join(dsh, 'package.json'))
const ts = requireDsh('typescript')
const config = ts.readConfigFile(join(dsh, 'tsconfig.base.json'), ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))

// Link only inside this plugin. Never install into or modify the DSH checkout.
async function link(name, target) {
  const destination = join(root, 'node_modules', name)
  await mkdir(dirname(destination), { recursive: true })
  try {
    await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error.code !== 'EEXIST' || await realpath(destination) !== await realpath(target)) throw error
  }
}

for (const manifest of globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: dsh })) {
  const path = join(dsh, manifest)
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  await link(pkg.name, dirname(path))
}
const local = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const name of Object.keys(local.devDependencies).filter(name => !name.startsWith('@deepseek-ai/'))) {
  let target
  for (const base of [join(dsh, 'node_modules'), join(dsh, 'packages/client/ui-conversation/node_modules')]) {
    try { target = await realpath(join(base, name)); break } catch {}
  }
  if (!target) throw new Error(`Install DSH dependencies first: missing ${name}`)
  await link(name, target)
}
await mkdir(join(root, '.dsh'), { recursive: true })
await writeFile(join(root, '.dsh/local.json'), JSON.stringify({ root: dsh }) + '\n')
console.log(`Linked DSH sources: ${dsh}`)
