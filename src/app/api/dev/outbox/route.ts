import { devOutbox, isDevEmail } from '@/modules/email'

export const dynamic = 'force-dynamic'

/** Локальный почтовый ящик разработки (коды входа). В production — 404. */
export async function GET() {
  if (!isDevEmail()) return new Response('Not found', { status: 404 })
  return Response.json(devOutbox.list(), { headers: { 'Cache-Control': 'no-store' } })
}
