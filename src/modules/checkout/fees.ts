/**
 * Сервисный сбор — ЗАГЛУШКА из референса заказчика (200 ₽ за билет). Есть ли сбор и какой,
 * театр не подтвердил; перед запуском продаж уточнить вместе с банком и параметрами чека
 * (T-001/T-002) — в чеке сбор должен быть отдельной позицией.
 */
export const SERVICE_FEE = { perTicketKopecks: 20_000, placeholder: true } as const

export const serviceFee = (ticketCount: number) => ticketCount * SERVICE_FEE.perTicketKopecks
