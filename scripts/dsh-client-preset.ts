/**
 * Client bundle preset for UI plugin packages, vendored from
 * deepseek-harness packages/client/tsdown.client.ts (MIT, © DeepSeek).
 * Slimmed for registry-distributed third-party plugins: no workspace build
 * faces, no repository source-map rebasing. The bundle contract is unchanged:
 * the artifact calls `window.__ModuleLoader__.load({ id, factory })` and
 * resolves externals through the injected require (the loader module table).
 * CSS Modules are compiled by lightningcss inside the bundle: importing
 * `x.module.css` yields the hashed class map, and the css text auto-injects a
 * `<style data-plugin="<id>">` tag at factory execution (the loader removes
 * plugin-owned tags on unload).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts with no
 * runtime identity to share. Everything else under @deepseek-ai/* is either a
 * module-table entry (external) or a leak the purity gate rejects.
 */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Vendored framework libraries: ordinary libraries a browser bundle inlines. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Mirrors `PLATFORM_MODULES` from DSH 0.2.1-rc.2: the module specifiers the
 * shell seeds into the frozen module table.
 */
export const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Externals resolved from the loader module table. */
export const CLIENT_EXTERNALS: readonly string[] = PLATFORM_MODULES

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/**
 * Build the tsdown config for one UI plugin client bundle.
 * @param id - plugin id (package name), stamped into the `__ModuleLoader__.load`
 * handoff and onto the injected style tags.
 * @param options - overrides applied after the preset defaults.
 */
export function clientBundle(id: string, options: UserConfig = {}): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: 'src/client/index.ts' },
    // Browser bundle lands in the shared dist/ dir next to the node half.
    outDir: 'dist',
    format: 'cjs',
    platform: 'browser',
    // Types are checked by tsc; dts here would wrap banner/footer into .d.cts.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle
    // must carry the TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    },
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry). A require() the
    // module table cannot answer is a guaranteed runtime throw, so the rule is
    // the table list itself: no opinion for table entries (external above
    // wins), bundle everything else.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules):
      // platform seed entries stay external, inline-safe wire layers inline,
      // and every other @deepseek-ai value import is a build error — a
      // cross-plugin value import either inlines a duplicate runtime instance
      // or requires a specifier the frozen module table cannot answer.
      // Cross-plugin collaboration goes through cordis services instead.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + relative(process.cwd(), abs).split(sep).join('/') + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const relativeId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        const fileId = resolvePath(relativeId)
        // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: relativeId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})
          .sort(([left], [right]) => left.localeCompare(right))) classMap[local] = exp.name
        // One <style data-plugin> per module file; idempotent under re-evaluation.
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // sourcesContent keeps sources usable without an HTTP route; the
      // basename transform keeps the map self-contained for third-party repos.
      sourcemapPathTransform: (source: string) => basename(source),
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
    ...options,
  }
}
