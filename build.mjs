// dsh-web-extras 构建脚本（esbuild，自包含，不依赖 DeepSeek Harness monorepo）。
// 产物：
//   lib/index.js   —— Node 半（空 apply，Host Loader 挂载用，ESM）
//   lib/client.js  —— 浏览器半（CJS factory bundle，格式与官方 clientBundle 产物同构：
//                      window.__ModuleLoader__.load({ id, factory: (require) => ... })，
//                      平台模块（react / cordis 等）走 require，由浏览器 loader 模块表回答）
import { build } from 'esbuild'

const PKG_ID = 'dsh-web-extras'

// 与 packages/client/web/src/platform.ts 保持一致：浏览器 loader 模块表提供的平台模块。
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

// Node 半：Host Loader 通过 exports["."] 加载（具名导出 apply）。
await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
})

// 浏览器半：注册进 window.__ModuleLoader__，materialize 时执行 factory(require)。
await build({
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: PLATFORM_EXTERNALS,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

console.log('[dsh-web-extras] built lib/index.js + lib/client.js')
