import Image from 'next/image'

import logo from '@/assets/logo.webp'
import bird from '@/assets/logo-bird.png'

/**
 * Логотип театра в админке вместо значка Payload: птица — в шапке (ссылка на главную админки),
 * полный логотип — на экране входа. Картинки тёмные на прозрачном; в тёмной теме админки их
 * инвертирует `.turdus-admin-brand` в src/app/(payload)/custom.scss.
 */
export function AdminIcon() {
  return (
    <Image
      src={bird}
      alt="TURDUS"
      className="turdus-admin-brand"
      style={{ width: 'auto', height: 22 }}
    />
  )
}

export function AdminLogo() {
  return (
    <Image
      src={logo}
      alt="TURDUS — модный театр"
      priority
      className="turdus-admin-brand"
      style={{ width: 200, height: 'auto' }}
    />
  )
}
