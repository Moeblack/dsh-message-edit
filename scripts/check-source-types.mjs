import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const local = JSON.parse(await readFile(join(root, '.dsh/local.json'), 'utf8'))
const base = ts.readConfigFile(join(local.root, 'tsconfig.base.json'), ts.sys.readFile)
if (base.error) throw new Error(ts.flattenDiagnosticMessageText(base.error.messageText, '\n'))
const paths = Object.fromEntries(Object.entries(base.config.compilerOptions.paths)
  .map(([name, values]) => [name, values.map(value => resolve(local.root, value))]))
const diagnostics = []
for (const side of ['host', 'client']) {
  const configFile = join(root, `tsconfig.${side}.json`)
  const config = ts.readConfigFile(configFile, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {
    paths, incremental: false, types: ['node'],
  }, configFile)
  diagnostics.push(...parsed.errors)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  diagnostics.push(...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics())
  // Check the consumer against actual master sources. DSH's own implementation
  // files belong to their separate project configs (especially vendored Cordis).
  for (const file of program.getSourceFiles()) {
    const path = relative(join(root, 'src'), file.fileName)
    if (!isAbsolute(path) && !path.startsWith('..')) {
      diagnostics.push(...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file))
    }
  }
}
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log(`Source API typecheck passed: ${local.root}`)
