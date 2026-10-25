'use client'

import { useEffect, useState } from 'react'

import { otpauthQrPath } from './mfaQrPath'

/** QR со ссылкой otpauth:// на экране настройки второго фактора (T-023); ключ вручную — рядом. */
export function MfaQr({ value }: { value: string }) {
  const [shape, setShape] = useState<{ side: number; d: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Библиотека грузится только на экране настройки — в остальной админке её нет.
    import('qrcode-generator')
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, 'M')
        qr.addData(value, 'Byte')
        qr.make()
        if (!cancelled) setShape(otpauthQrPath(qr))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [value])

  if (failed) return <p>QR не построился — введите ключ вручную.</p>
  if (!shape) return <p aria-busy="true">Готовим QR…</p>
  return (
    <svg
      viewBox={`0 0 ${shape.side} ${shape.side}`}
      width={208}
      height={208}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR-код для приложения-аутентификатора"
      style={{ display: 'block', background: '#ffffff', borderRadius: 4 }}
    >
      <rect width="100%" height="100%" fill="#ffffff" />
      <path fill="#000000" d={shape.d} />
    </svg>
  )
}
