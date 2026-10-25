import { crc32, deflateSync } from 'node:zlib'

import qrcode from 'qrcode-generator'

/**
 * Изображение QR (T-046). Матрицу считает `qrcode-generator` (без зависимостей), картинку — мы:
 * SVG одним путём (чёткий при любом масштабе, для кабинета) и PNG без внешних библиотек
 * (zlib из Node, для писем — почтовые клиенты не показывают SVG). В QR кодируется только
 * переданная строка — токен билета без ПД.
 */

/** Поле вокруг кода в модулях: стандарт требует не меньше 4. */
const QUIET_ZONE = 4

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean }

export const qrMatrix = (data: string): QrMatrix => {
  // Уровень M (~15% восстановления): переживает блики экрана и не раздувает код.
  const qr = qrcode(0, 'M')
  qr.addData(data, 'Byte')
  qr.make()
  const size = qr.getModuleCount()
  return { size, dark: (row, col) => qr.isDark(row, col) }
}

export const qrSvg = (data: string, title = 'QR-код билета') => {
  const m = qrMatrix(data)
  const full = m.size + QUIET_ZONE * 2
  let path = ''
  for (let row = 0; row < m.size; row++)
    for (let col = 0; col < m.size; col++)
      if (m.dark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
  const safeTitle = title.replace(/[<>&"]/g, '')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img">` +
    `<title>${safeTitle}</title><rect width="100%" height="100%" fill="#ffffff"/>` +
    `<path fill="#000000" d="${path}"/></svg>`
  )
}

const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** PNG в оттенках серого (1 байт на пиксель), `scale` пикселей на модуль. */
export const qrPng = (data: string, scale = 8) => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new RangeError('scale 1..32')
  const m = qrMatrix(data)
  const side = (m.size + QUIET_ZONE * 2) * scale
  const raw = Buffer.alloc((side + 1) * side, 0xff)
  for (let y = 0; y < side; y++) {
    raw[y * (side + 1)] = 0 // фильтр строки: None
    const row = Math.floor(y / scale) - QUIET_ZONE
    if (row < 0 || row >= m.size) continue
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / scale) - QUIET_ZONE
      if (col >= 0 && col < m.size && m.dark(row, col)) raw[y * (side + 1) + 1 + x] = 0
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8 // бит на канал
  header[9] = 0 // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
