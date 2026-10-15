import Image from 'next/image'

import bird from '@/assets/logo-bird.png'

/**
 * Птица из логотипа театра (дрозд — turdus): вырезана из логотипа заказчика (657657.png,
 * прозрачный фон). Стоит сбоку от надписи в шапке и периодически прыгает (CSS в
 * SiteHeader.module.css); при prefers-reduced-motion и в версии для слабовидящих сидит.
 */
export function LogoBird({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <span>
        <Image src={bird} alt="" sizes="64px" />
      </span>
    </span>
  )
}
