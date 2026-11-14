import type { NextRequest } from 'next/server'

import { apiError } from '@/lib/correlation'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import type { ClaimError, ClaimView } from '@/modules/refund-claims'

export const TICKET = /^TRD-[A-Z0-9]{8}-\d{2}$/

export const session = async (req: NextRequest) => {
  const { auth } = await getAccounts()
  return auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Для зрителя — без внутренних полей (кто решил, ключи хранения файлов). */
export const claimJson = (c: ClaimView) => ({
  id: c.id,
  number: c.number,
  status: c.status,
  orderNumber: c.orderNumber,
  ticketNumbers: c.ticketNumbers,
  reason: c.reason,
  reasonLabel: c.reasonLabel,
  comment: c.comment,
  startsAt: c.startsAt.toISOString(),
  legalPercent: c.legalPercent,
  basis: c.basis,
  documentRequired: c.documentRequired,
  documentDeadline: c.documentDeadline?.toISOString() ?? null,
  filesUntil: c.filesUntil.toISOString(),
  files: c.files.map((f) => ({ id: f.id, name: f.name, uploadedAt: f.uploadedAt.toISOString() })),
  decidedPercent: c.decidedPercent,
  decisionComment: c.decisionComment,
  decidedAt: c.decidedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
})

const ERRORS: Record<ClaimError, [number, string]> = {
  NOT_FOUND: [404, 'Билет или заявка не найдены.'],
  INVALID_REASON: [400, 'Выберите причину возврата.'],
  COMMENT_TOO_LONG: [400, 'Комментарий слишком длинный (до 1000 символов).'],
  NOT_REFUNDABLE: [409, 'Этот билет вернуть нельзя: он уже возвращается или недействителен.'],
  ALREADY_CLAIMED: [409, 'По этому билету уже есть заявка на возврат.'],
  TOO_LATE: [422, 'Заявку на возврат можно подать не позже дня спектакля.'],
  SHOW_TIME_UNKNOWN: [409, 'Не удалось проверить время спектакля. Напишите нам на почту.'],
  CLOSED: [409, 'Заявка уже рассмотрена или отозвана.'],
  FILE_TYPE: [415, 'Подойдёт PDF или фото (JPG, PNG, HEIC, WebP).'],
  FILE_TOO_LARGE: [413, 'Файл больше 10 МБ.'],
  TOO_MANY_FILES: [409, 'К заявке можно приложить не больше 5 файлов.'],
  DOCUMENT_DEADLINE: [
    422,
    'Документы принимаются в течение 14 дней после спектакля — срок прошёл.',
  ],
  INVALID_PERCENT: [400, 'Процент возврата — от 1 до 100.'],
  DECISION_COMMENT: [400, 'Напишите объяснение для зрителя.'],
  REFUND_FAILED: [409, 'Возврат не оформлен.'],
}

export const claimError = (error: ClaimError, correlationId: string) => {
  const [status, message] = ERRORS[error]
  return apiError(status, error.toLowerCase(), message, correlationId)
}
