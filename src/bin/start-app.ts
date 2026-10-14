import { assertServerEnv } from '../lib/env'

// Точка входа контейнера app: проверяет окружение до запуска Next.js.
// Standalone-сервер Next 16 не вызывает instrumentation register() при старте,
// поэтому проверка вынесена сюда (проверено вручную в T-013).
assertServerEnv()

// server.js создаёт `next build` (output: 'standalone'); в образе он лежит рядом с start.mjs.
await import(new URL('./server.js', import.meta.url).href)
