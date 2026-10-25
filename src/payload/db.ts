import type { PayloadRequest } from 'payload'

type AdapterLike<Db> = {
  drizzle: Db
  sessions?: Record<string | number, { db?: Db } | undefined>
}

/**
 * Drizzle текущей транзакции запроса Payload (как getTransaction в @payloadcms/drizzle):
 * журнал и синхронизация остатков пишутся атомарно с правкой в CMS — откат правки откатывает их.
 */
export const transactionDb = async <Db>(req: PayloadRequest): Promise<Db> => {
  const adapter = req.payload.db as unknown as AdapterLike<Db>
  const id = req.transactionID ? await req.transactionID : undefined
  return (id !== undefined && adapter.sessions?.[id]?.db) || adapter.drizzle
}
