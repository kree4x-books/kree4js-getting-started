// 3rd
import globals from 'globals'
import { FlatCompat } from '@eslint/eslintrc'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// `eslint-config-standard` (v17) is still an eslint-8-era legacy config. We
// bridge it into eslint 9's flat-config system via FlatCompat so the project
// keeps the exact same StandardJS ruleset while the parser upgrades to
// espree 10 (which can parse `with { type: 'json' }` import attributes).
const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  {
    // Build outputs and CJS-only tooling configs are not lint sources.
    ignores: [
      'node_modules/**',
      '_book/**',
      '**/dist/**',
      '**/types/**',
      '**/*.d.ts',
      '**/.prettierrc.cjs',
      '**/.eslintrc.js'
    ]
  },
  ...compat.extends('standard'),
  { // Placed AFTER the standard config so these win.
    // - ecmaVersion 2025 lets espree 10 (bundled with eslint 9) parse
    //   `with { type: 'json' }` import attributes.
    // - node globals mirror the legacy `.eslintrc.js` `env: { node: true }`
    //   block that sat alongside `extends: ['standard']`; eslint-config-standard
    //   itself does not provide them, so without this `no-undef` would wrongly
    //   flag `process`, `console`, `Buffer`, etc. in Node-side `.mjs` examples.
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  }
]
