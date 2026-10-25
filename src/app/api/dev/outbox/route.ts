import { withCorrelation } from '@/lib/correlation'
import { devOutbox, isDevEmail } from '@/modules/email'

export const dynamic = 'force-dynamic'

/** Локальный почтовый ящик разработки (коды входа). В production — 404. */
export const GET = withCorrelation('dev.outbox', async () => {
  if (!isDevEmail()) return new Response('Not found', { status: 404 })
  return Response.json(devOutbox.list(), { headers: { 'Cache-Control': 'no-store' } })
})
