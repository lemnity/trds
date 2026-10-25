import qrcode from 'qrcode-generator'
import { describe, expect, it } from 'vitest'

import { otpauthUrl } from '../../src/payload/auth/totp'
import { otpauthQrPath } from '../../src/payload/components/mfaQrPath'

// T-023: QR на экране настройки MFA — тот же otpauth://, что и ссылка; поле 4 модуля.
describe('MFA setup QR', () => {
  const url = otpauthUrl({
    issuer: 'TURDUS CMS',
    account: 'admin@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
  })
  const qr = qrcode(0, 'M')
  qr.addData(url, 'Byte')
  qr.make()

  it('draws every dark module once, inside a 4-module quiet zone', () => {
    const { side, d } = otpauthQrPath(qr)
    const size = qr.getModuleCount()
    expect(side).toBe(size + 8)
    let dark = 0
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) dark++
    expect(d.match(/M/g)).toHaveLength(dark)
    // Левый верхний модуль поискового узора — со смещением на поле.
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true)
  })

  it('is deterministic for the same otpauth URI', () => {
    const again = qrcode(0, 'M')
    again.addData(url, 'Byte')
    again.make()
    expect(otpauthQrPath(again)).toEqual(otpauthQrPath(qr))
  })
})
