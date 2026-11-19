import { APIError } from 'payload'

/**
 * Публичная ошибка с текстом для админки. Payload (formatErrors) отдаёт `message` только если
 * у ошибки непустой `data` либо непустое `name`; в продакшн-сборке Next имя класса теряется
 * при минификации (`name === ''`), и админка показывает «An unknown error occurred.». Поэтому
 * имя задаём явно, а `data` делаем непустым.
 */
export const publicError = (message: string, status = 400): APIError => {
  const err = new APIError(message, status, { message }, true)
  err.name = 'APIError'
  return err
}
