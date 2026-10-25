/** Поле вокруг кода в модулях: стандарт требует не меньше 4. */
const QUIET_ZONE = 4

/**
 * Путь SVG для QR со ссылкой otpauth:// (T-023). Матрицу считает уже
 * закреплённый `qrcode-generator` (как QR билетов), картинка — SVG одним путём, без innerHTML.
 * Секрет остаётся только в памяти страницы: в сеть и в логи он отсюда не уходит.
 */
export const otpauthQrPath = (qr: {
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}) => {
  const size = qr.getModuleCount()
  let d = ''
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      if (qr.isDark(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
  return { side: size + QUIET_ZONE * 2, d }
}
