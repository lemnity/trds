import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

// Архитектурные границы (architecture.md §4, rules.md §2). Запускается тестом
// tests/unit/architecture-boundaries.test.ts, поэтому нарушение ломает CI.

export type BoundaryViolation = {
  file: string
  specifier: string
  reason: string
}

type Layer = 'ui' | 'domain' | 'payment-provider' | 'other'

type Rule = {
  appliesTo: Layer[]
  matches: (specifier: string) => boolean
  reason: string
}

const PAYMENT_SDK = /^(@a2seven\/yoo-checkout|yookassa|@tinkoff\/|tinkoff|t-bank)/

const RULES: Rule[] = [
  {
    appliesTo: ['ui', 'domain', 'other'],
    matches: (s) => PAYMENT_SDK.test(s),
    reason: 'SDK провайдера используется только в src/modules/payments/providers/*',
  },
  {
    appliesTo: ['ui'],
    matches: (s) => /^@\/modules\/payments(\/|$)/.test(s),
    reason: 'UI не обращается к платёжному слою напрямую — только через доменный use-case',
  },
  {
    appliesTo: ['ui'],
    matches: (s) => /^@\/modules\/[^/]+\/.+/.test(s),
    reason: 'UI импортирует модуль только через публичный вход @/modules/<name>',
  },
  {
    appliesTo: ['ui'],
    matches: (s) => /^@\/db(\/|$)/.test(s),
    reason: 'UI не обращается к БД напрямую',
  },
  {
    appliesTo: ['ui'],
    matches: (s) => /^(\.\.\/)+(.*\/)?(modules|db)(\/|$)/.test(s),
    reason: 'Нельзя обходить границы относительными путями — используйте алиас @/',
  },
  {
    appliesTo: ['domain', 'payment-provider'],
    matches: (s) => /^(next|react|react-dom)(\/|$)/.test(s),
    reason: 'Доменный слой не зависит от Next.js/React',
  },
  {
    appliesTo: ['domain', 'payment-provider'],
    matches: (s) => /^@\/(app|components)(\/|$)/.test(s),
    reason: 'Доменный слой не импортирует UI',
  },
]

const layerOf = (filePath: string): Layer => {
  const p = filePath.split(path.sep).join('/')
  if (p.startsWith('src/app/') || p.startsWith('src/components/')) return 'ui'
  if (p.startsWith('src/modules/payments/providers/')) return 'payment-provider'
  if (p.startsWith('src/modules/')) return 'domain'
  return 'other'
}

/** Проверяет один файл. `filePath` — путь относительно корня репозитория. */
export const findBoundaryViolations = (filePath: string, source: string): BoundaryViolation[] => {
  const layer = layerOf(filePath)
  const { importedFiles } = ts.preProcessFile(source, true, true)
  const violations: BoundaryViolation[] = []
  for (const { fileName: specifier } of importedFiles) {
    const rule = RULES.find((r) => r.appliesTo.includes(layer) && r.matches(specifier))
    if (rule) violations.push({ file: filePath, specifier, reason: rule.reason })
  }
  return violations
}

// Сгенерированные Payload файлы не проверяем — они перезаписываются генератором.
const IGNORED = ['src/app/(payload)/', 'src/payload-types.ts']
const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs|jsx)$/

/** Проверяет все исходники в src/. */
export const scanProject = async (root: string): Promise<BoundaryViolation[]> => {
  const entries = await readdir(path.join(root, 'src'), { recursive: true, withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile() && SOURCE_FILE.test(e.name))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .filter((f) => !IGNORED.some((ignored) => f.startsWith(ignored)))
    .sort()
  const results = await Promise.all(
    files.map(async (f) => findBoundaryViolations(f, await readFile(path.join(root, f), 'utf8'))),
  )
  return results.flat()
}
