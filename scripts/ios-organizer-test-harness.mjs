import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Load the actual TypeScript without adding a test runtime or invoking Tauri.
export function loadTypeScript(relativePath, dependencies, globals = {}) {
  const code = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const context = {
    exports: {},
    require(name) {
      assert.ok(name in dependencies, `Unexpected import: ${name}`)
      return dependencies[name]
    },
    ...globals,
  }
  vm.runInNewContext(compiled, context, { filename: relativePath })
  return context.exports
}

export const jsx = (type, props) => ({ type, props })

export function findElements(element, predicate) {
  if (Array.isArray(element)) return element.flatMap((child) => findElements(child, predicate))
  if (!element || typeof element !== 'object') return []
  return [
    ...(predicate(element) ? [element] : []),
    ...findElements(element.props?.children, predicate),
  ]
}

export function findElement(element, type) {
  return findElements(element, (child) => child.type === type)[0] ?? null
}

export function renderedText(element) {
  if (Array.isArray(element)) return element.map(renderedText).join(' ')
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  return renderedText(element?.props?.children ?? [])
}
