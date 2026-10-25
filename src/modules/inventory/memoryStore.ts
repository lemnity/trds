import type {
  AuditRow,
  CommerceStore,
  CommerceTx,
  HoldRow,
  InventoryKey,
  InventoryRow,
  OrderItemRow,
  OrderRow,
  OutboxRow,
  PaymentEventRow,
  RefundRow,
  RefundTicketRow,
  SeatRow,
  SettingRow,
  TicketRow,
} from './store'

/** Ошибка, которую хранилище в памяти считает повторяемой (как deadlock в PostgreSQL). */
export class RetryableTestError extends Error {}

/**
 * Хранилище в памяти — для тестов и dev без базы. Не для production. Моделирует PostgreSQL,
 * чтобы параллельные тесты были содержательными: блокировки строк до конца транзакции,
 * SKIP LOCKED, ожидание на уникальном ключе чужой незавершённой транзакции, CHECK-ограничения,
 * откат при ошибке. Между операциями — `setImmediate`, чтобы транзакции реально чередовались.
 *
 * `faults` — только для тестов: снять блокировки и условия, чтобы доказать, что тест
 * конкурентности их действительно ловит.
 */
export function memoryCommerceStore(
  faults: { noLocks?: boolean; noGuards?: boolean; noChecks?: boolean } = {},
) {
  const inventory = new Map<string, InventoryRow>()
  const seats = new Map<string, SeatRow>()
  const holds: HoldRow[] = []
  const orders: OrderRow[] = []
  const items: OrderItemRow[] = []
  const tickets: TicketRow[] = []
  const outbox: OutboxRow[] = []
  const audit: AuditRow[] = []
  const paymentEvents: PaymentEventRow[] = []
  const refunds: RefundRow[] = []
  const refundTickets: RefundTicketRow[] = []
  const settings = new Map<string, SettingRow>()
  let retryableFailures = 0

  const locks = new Map<string, Promise<void>>()
  const pendingKeys = new Map<string, Promise<void>>()
  const pause = () => new Promise<void>((resolve) => setImmediate(resolve))
  const copy = <T extends object>(row: T): T => ({ ...row })
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const invId = (k: InventoryKey) => `${k.performanceId}\u0000${k.ticketTypeId}`
  const seatId = (performanceId: string, id: string) => `${performanceId}\u0000${id}`

  /** CHECK-ограничения схемы — как в БД, последняя линия защиты. */
  const checkInventory = (r: InventoryRow) => {
    if (faults.noChecks) return
    if (r.capacity < 0 || r.sold < 0 || r.held < 0 || r.sold + r.held > r.capacity)
      throw new Error('check constraint commerce_inventory_within_capacity violated')
  }
  const checkSeat = (s: SeatRow) => {
    if (faults.noChecks) return
    if ((s.status === 'held') !== (s.holdId !== null))
      throw new Error('check constraint commerce_seats_hold_shape violated')
    if ((s.status === 'held' || s.status === 'sold') !== (s.orderId !== null))
      throw new Error('check constraint commerce_seats_order_shape violated')
  }
  const checkTicketSeat = (t: TicketRow) => {
    if (faults.noChecks || t.seatId === null) return
    if (
      tickets.some(
        (x) =>
          x.performanceId === t.performanceId && x.seatId === t.seatId && x.status !== 'REFUNDED',
      )
    )
      throw new Error('unique index commerce_tickets_seat_live_uq violated')
  }

  const store: CommerceStore = {
    isRetryable: (error) => error instanceof RetryableTestError,

    async transaction(fn) {
      if (retryableFailures > 0) {
        retryableFailures--
        await pause()
        throw new RetryableTestError('deadlock detected (simulated)')
      }
      const undo: (() => void)[] = []
      const held = new Map<string, () => void>()
      const ownKeys = new Set<string>()
      let settleTx!: () => void
      const done = new Promise<void>((resolve) => (settleTx = resolve))

      const take = (key: string) => {
        let release!: () => void
        locks.set(key, new Promise<void>((resolve) => (release = resolve)))
        held.set(key, () => {
          locks.delete(key)
          release()
        })
      }
      const lock = async (key: string) => {
        await pause()
        if (faults.noLocks || held.has(key)) return
        for (let current = locks.get(key); current; current = locks.get(key)) await current
        take(key)
      }
      const tryLock = (key: string) => {
        if (faults.noLocks || held.has(key)) return true
        if (locks.has(key)) return false
        take(key)
        return true
      }
      /** Ожидание на уникальном индексе: чужая незавершённая вставка того же ключа. */
      const awaitUnique = async (key: string) => {
        await pause()
        for (
          let pending = pendingKeys.get(key);
          pending && !ownKeys.has(key);
          pending = pendingKeys.get(key)
        )
          await pending
      }
      const claimUnique = (key: string) => {
        ownKeys.add(key)
        pendingKeys.set(key, done)
      }
      const pushRow = <T>(table: T[], row: T) => {
        table.push(row)
        undo.push(() => table.splice(table.indexOf(row), 1))
      }
      const mutate = <T extends object>(row: T, set: Partial<T>) => {
        const before = copy(row)
        Object.assign(row, set)
        undo.push(() => Object.assign(row, before))
      }

      const tx: CommerceTx = {
        async lockInventory(keys) {
          const sorted = [...keys].sort(
            (a, b) => cmp(a.performanceId, b.performanceId) || cmp(a.ticketTypeId, b.ticketTypeId),
          )
          const rows: InventoryRow[] = []
          for (const key of sorted) {
            await lock(`inv:${invId(key)}`)
            const row = inventory.get(invId(key))
            if (row) rows.push(copy(row))
          }
          return rows
        },
        async insertInventory(row) {
          const key = `inv:${invId(row)}`
          await awaitUnique(key)
          if (inventory.has(invId(row))) return false
          checkInventory(row)
          inventory.set(invId(row), copy(row))
          claimUnique(key)
          undo.push(() => inventory.delete(invId(row)))
          return true
        },
        async adjustInventory(key, delta, at) {
          await pause()
          const row = inventory.get(invId(key))
          if (!row) return false
          if (faults.noGuards) {
            // Небезопасный «прочитал — потом записал»: значение читается до паузы.
            const before = { held: row.held, sold: row.sold }
            await pause()
            const next = { ...row, held: before.held + delta.held, sold: before.sold + delta.sold }
            checkInventory(next)
            mutate(row, { held: next.held, sold: next.sold, updatedAt: at })
            return true
          }
          // Один условный UPDATE: проверка и запись без await между ними.
          const held = row.held + delta.held
          const sold = row.sold + delta.sold
          if (held < 0 || sold < 0 || sold + held > row.capacity) return false
          mutate(row, { held, sold, updatedAt: at })
          return true
        },
        async setCapacity(key, capacity, at) {
          await pause()
          const row = inventory.get(invId(key))
          if (!row || capacity < row.sold + row.held) return false
          mutate(row, { capacity, updatedAt: at })
          return true
        },
        async lockSeats(performanceId, seatIds) {
          const ids = (
            seatIds ??
            [...seats.values()]
              .filter((s) => s.performanceId === performanceId)
              .map((s) => s.seatId)
          ).sort(cmp)
          const rows: SeatRow[] = []
          for (const id of ids) {
            await lock(`seat:${seatId(performanceId, id)}`)
            const row = seats.get(seatId(performanceId, id))
            if (row) rows.push(copy(row))
          }
          return rows
        },
        async insertSeats(rows) {
          await pause()
          for (const row of rows) {
            const id = seatId(row.performanceId, row.seatId)
            if (seats.has(id)) continue
            checkSeat(row)
            seats.set(id, copy(row))
            undo.push(() => seats.delete(id))
          }
        },
        async updateSeats(performanceId, seatIds, where, set, at) {
          await pause()
          let changed = 0
          for (const id of seatIds) {
            const row = seats.get(seatId(performanceId, id))
            if (!row) continue
            if (
              !faults.noGuards &&
              (row.status !== where.status ||
                (where.holdId !== undefined && row.holdId !== where.holdId) ||
                (where.orderId !== undefined && row.orderId !== where.orderId))
            )
              continue
            checkSeat({ ...row, ...set })
            mutate(row, { ...set, updatedAt: at })
            changed++
          }
          return changed
        },
        async retagSeat(performanceId, id, set, at) {
          await pause()
          const row = seats.get(seatId(performanceId, id))
          if (!row || (row.status !== 'free' && row.status !== 'blocked')) return false
          mutate(row, { ...set, updatedAt: at })
          return true
        },
        async insertHold(row) {
          const key = `hold-order:${row.orderId}`
          await awaitUnique(key)
          if (holds.some((h) => h.orderId === row.orderId))
            throw new Error('unique constraint commerce_holds_order_id violated')
          claimUnique(key)
          pushRow(holds, copy(row))
        },
        async lockHold(orderId) {
          await lock(`hold:${orderId}`)
          const row = holds.find((h) => h.orderId === orderId)
          return row ? copy(row) : null
        },
        async closeHold(id, to, at) {
          await pause()
          const row = holds.find((h) => h.id === id)
          if (!row || row.status !== 'ACTIVE') return false
          mutate(row, { status: to, closedAt: at })
          return true
        },
        async insertOrder(row) {
          const key = `order-key:${row.idempotencyKey}`
          await awaitUnique(key)
          if (
            orders.some((o) => o.idempotencyKey === row.idempotencyKey || o.number === row.number)
          )
            return false
          claimUnique(key)
          pushRow(orders, copy(row))
          return true
        },
        async findOrderByKey(key) {
          await pause()
          const row = orders.find((o) => o.idempotencyKey === key)
          return row ? copy(row) : null
        },
        async lockOrder(id) {
          await lock(`order:${id}`)
          const row = orders.find((o) => o.id === id)
          return row ? copy(row) : null
        },
        async claimExpired(now, limit) {
          await pause()
          return orders
            .filter((o) => o.status === 'PENDING_PAYMENT' && o.holdUntil && o.holdUntil <= now)
            .sort((a, b) => a.holdUntil!.getTime() - b.holdUntil!.getTime() || cmp(a.id, b.id))
            .filter((o) => tryLock(`order:${o.id}`))
            .slice(0, limit)
            .map(copy)
        },
        async updateOrder(id, from, set, at) {
          await pause()
          const row = orders.find((o) => o.id === id)
          if (!row || (!faults.noGuards && row.status !== from)) return false
          mutate(row, { ...set, updatedAt: at })
          return true
        },
        async insertItems(rows) {
          await pause()
          for (const row of rows) pushRow(items, copy(row))
        },
        async listItems(orderId) {
          await pause()
          return items.filter((i) => i.orderId === orderId).map(copy)
        },
        async listTickets(orderId) {
          await pause()
          return tickets.filter((t) => t.orderId === orderId).map(copy)
        },
        async insertTickets(rows) {
          await pause()
          for (const row of rows) {
            checkTicketSeat(row)
            pushRow(tickets, copy(row))
          }
        },
        async insertOutbox(row) {
          const key = `outbox:${row.dedupeKey}`
          await awaitUnique(key)
          if (outbox.some((o) => o.dedupeKey === row.dedupeKey)) return false
          claimUnique(key)
          pushRow(outbox, copy(row))
          return true
        },
        async insertAudit(row) {
          await pause()
          pushRow(audit, copy(row))
        },
        async insertPaymentEvent(row) {
          const key = `payment-event:${row.provider}\u0000${row.eventId}`
          await awaitUnique(key)
          if (paymentEvents.some((e) => e.provider === row.provider && e.eventId === row.eventId))
            return false
          claimUnique(key)
          pushRow(paymentEvents, copy(row))
          return true
        },
        async lockTickets(orderId) {
          const ids = tickets
            .filter((t) => t.orderId === orderId)
            .map((t) => t.id)
            .sort(cmp)
          const rows: TicketRow[] = []
          for (const id of ids) {
            await lock(`ticket:${id}`)
            const row = tickets.find((t) => t.id === id)
            if (row) rows.push(copy(row))
          }
          return rows
        },
        async updateTickets(ids, from, set) {
          await pause()
          let changed = 0
          for (const id of ids) {
            const row = tickets.find((t) => t.id === id)
            if (!row || (!faults.noGuards && row.status !== from)) continue
            if (!faults.noChecks && (set.status === 'REFUNDED') !== (set.refundedAt !== null))
              throw new Error('check constraint commerce_tickets_refunded_shape violated')
            mutate(row, set)
            changed++
          }
          return changed
        },
        async insertRefund(row) {
          const key = `refund-key:${row.idempotencyKey}`
          await awaitUnique(key)
          if (refunds.some((r) => r.idempotencyKey === row.idempotencyKey)) return false
          claimUnique(key)
          pushRow(refunds, copy(row))
          return true
        },
        async findRefundByKey(key) {
          await pause()
          const row = refunds.find((r) => r.idempotencyKey === key)
          return row ? copy(row) : null
        },
        async lockRefund(id) {
          await lock(`refund:${id}`)
          const row = refunds.find((r) => r.id === id)
          return row ? copy(row) : null
        },
        async updateRefund(id, from, set, at) {
          await pause()
          const row = refunds.find((r) => r.id === id)
          if (!row || (!faults.noGuards && row.status !== from)) return false
          mutate(row, { ...set, updatedAt: at })
          return true
        },
        async insertRefundTickets(rows) {
          for (const row of rows) {
            // Частичный уникальный индекс живых долей: ждём чужую незавершённую вставку билета.
            const key = `refund-ticket:${row.ticketId}`
            await awaitUnique(key)
            if (
              !faults.noGuards &&
              refundTickets.some((r) => r.ticketId === row.ticketId && r.voidedAt === null)
            )
              return false
            claimUnique(key)
            pushRow(refundTickets, copy(row))
          }
          return true
        },
        async listRefundTickets(refundId) {
          await pause()
          return refundTickets
            .filter((r) => r.refundId === refundId)
            .sort((a, b) => cmp(a.ticketId, b.ticketId))
            .map(copy)
        },
        async voidRefundTickets(refundId, at) {
          await pause()
          for (const row of refundTickets)
            if (row.refundId === refundId && row.voidedAt === null) mutate(row, { voidedAt: at })
        },
        async liveRefundOfTicket(ticketId) {
          await pause()
          const share = refundTickets.find((r) => r.ticketId === ticketId && r.voidedAt === null)
          const row = share && refunds.find((r) => r.id === share.refundId)
          return row ? copy(row) : null
        },
        async upsertSetting(row) {
          await pause()
          const before = settings.get(row.key)
          settings.set(row.key, copy(row))
          undo.push(() => (before ? settings.set(row.key, before) : settings.delete(row.key)))
        },
      }

      try {
        return await fn(tx)
      } catch (error) {
        for (const step of undo.reverse()) step()
        throw error
      } finally {
        for (const key of ownKeys) if (pendingKeys.get(key) === done) pendingKeys.delete(key)
        settleTx()
        for (const release of held.values()) release()
      }
    },

    async inventory(performanceId) {
      return [...inventory.values()].filter((r) => r.performanceId === performanceId).map(copy)
    },
    async seats(performanceId) {
      return [...seats.values()].filter((s) => s.performanceId === performanceId).map(copy)
    },
    async inventoryOf(performanceIds) {
      const ids = new Set(performanceIds)
      return [...inventory.values()].filter((r) => ids.has(r.performanceId)).map(copy)
    },
    async takenSeatsOf(performanceIds) {
      const ids = new Set(performanceIds)
      return [...seats.values()]
        .filter((s) => ids.has(s.performanceId) && s.status !== 'free')
        .map((s) => ({ performanceId: s.performanceId, seatId: s.seatId }))
    },
    async order(id) {
      const row = orders.find((o) => o.id === id)
      return row ? copy(row) : null
    },
    async hasLiveOrder(customerId, exceptOrderId) {
      return orders.some(
        (o) =>
          o.customerId === customerId &&
          o.id !== exceptOrderId &&
          (o.status === 'PAID' || o.status === 'PARTIALLY_REFUNDED'),
      )
    },
    async overdueOrders(now, limit) {
      return orders
        .filter((o) => o.status === 'PENDING_PAYMENT' && o.holdUntil && o.holdUntil <= now)
        .sort((a, b) => a.holdUntil!.getTime() - b.holdUntil!.getTime() || cmp(a.id, b.id))
        .slice(0, limit)
        .map(copy)
    },
    async ordersInStatus(statuses, updatedSince, limit) {
      return orders
        .filter((o) => statuses.includes(o.status) && o.updatedAt >= updatedSince)
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || cmp(a.id, b.id))
        .slice(0, limit)
        .map(copy)
    },
    async items(orderId) {
      return items.filter((i) => i.orderId === orderId).map(copy)
    },
    async tickets(orderId) {
      return tickets.filter((t) => t.orderId === orderId).map(copy)
    },
    async orderByNumber(number) {
      const row = orders.find((o) => o.number === number)
      return row ? copy(row) : null
    },
    async ticketByNumber(number) {
      const row = tickets.find((t) => t.number === number)
      return row ? copy(row) : null
    },
    async refund(id) {
      const row = refunds.find((r) => r.id === id)
      return row ? copy(row) : null
    },
    async refundsOfOrder(orderId) {
      return refunds
        .filter((r) => r.orderId === orderId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || cmp(a.id, b.id))
        .map(copy)
    },
    async refundTickets(refundId) {
      return refundTickets
        .filter((r) => r.refundId === refundId)
        .sort((a, b) => cmp(a.ticketId, b.ticketId))
        .map(copy)
    },
    async refundsDue(statuses, now, limit) {
      return refunds
        .filter((r) => statuses.includes(r.status) && r.nextAttemptAt && r.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt!.getTime() - b.nextAttemptAt!.getTime() || cmp(a.id, b.id))
        .slice(0, limit)
        .map(copy)
    },
    async refundsUnsettled(limit) {
      return refunds
        .filter((r) => r.status === 'SUCCEEDED' && r.bonusSettledAt === null)
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || cmp(a.id, b.id))
        .slice(0, limit)
        .map(copy)
    },
    async recentRefunds(limit) {
      return [...refunds]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || cmp(b.id, a.id))
        .slice(0, limit)
        .map(copy)
    },
    async setting(key) {
      const row = settings.get(key)
      return row ? copy(row) : null
    },
  }

  return Object.assign(store, {
    /** Следующие `count` транзакций упадут повторяемой ошибкой (проверка retry). */
    failNextTransactions(count: number) {
      retryableFailures = count
    },
    dump: () => ({
      inventory: [...inventory.values()].map(copy),
      seats: [...seats.values()].map(copy),
      holds: holds.map(copy),
      orders: orders.map(copy),
      items: items.map(copy),
      tickets: tickets.map(copy),
      outbox: outbox.map(copy),
      audit: audit.map(copy),
      paymentEvents: paymentEvents.map(copy),
      refunds: refunds.map(copy),
      refundTickets: refundTickets.map(copy),
    }),
  })
}

export type MemoryCommerceStore = ReturnType<typeof memoryCommerceStore>
