import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

import { checkHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'

const CHECK_TIMEOUT_MS = 2000

export async function GET() {
  const result = await checkHealth(
    {
      database: async () => {
        const payload = await getPayload({ config })
        await payload.db.drizzle.execute(sql`select 1`)
      },
    },
    CHECK_TIMEOUT_MS,
  )
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
