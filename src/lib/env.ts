import { z } from 'zod'

// Обязательные переменные сервера (app и worker). Новые переменные добавляются вместе
// с модулем, который их использует (платёж, почта, S3, QR — см. architecture.md §15).
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)
const required = (schema: z.ZodString) => z.preprocess(emptyToUndefined, schema)

const serverEnvSchema = z.object({
  DATABASE_URL: required(
    z.string({ error: 'required' }).regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  ),
  PAYLOAD_SECRET: required(
    z.string({ error: 'required' }).min(32, 'must be at least 32 characters'),
  ),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export type EnvParseResult = { ok: true; env: ServerEnv } | { ok: false; problems: string[] }

type EnvSource = Record<string, string | undefined>

/**
 * Проверяет окружение. Сообщения содержат только имя переменной и правило —
 * никогда значение: в нём может быть пароль или секрет (rules.md §4).
 */
export const parseServerEnv = (source: EnvSource): EnvParseResult => {
  const result = serverEnvSchema.safeParse(source)
  if (result.success) return { ok: true, env: result.data }
  return {
    ok: false,
    problems: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}

type Process = {
  write: (text: string) => void
  exit: (code: number) => void
}

/** Вызывается при старте app (src/bin/start-app.ts) и worker: без валидного env процесс не стартует. */
export const assertServerEnv = (
  source: EnvSource = process.env,
  proc: Process = { write: (t) => process.stderr.write(t), exit: (c) => process.exit(c) },
): ServerEnv | undefined => {
  const result = parseServerEnv(source)
  if (result.ok) return result.env
  proc.write(
    `Invalid server environment, refusing to start:\n${result.problems.map((p) => `  - ${p}`).join('\n')}\n`,
  )
  proc.exit(1)
  return undefined
}
