import { buttonVariants } from '@heroui/styles'
import Link from 'next/link'
import type { ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost'

type Props = ComponentProps<typeof Link> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  isIconOnly?: boolean
}

/**
 * Ссылка Next.js в виде кнопки HeroUI (официальный способ — классы buttonVariants):
 * остаётся ссылкой для навигации и SEO, выглядит как Button.
 */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isIconOnly = false,
  className,
  ...props
}: Props) {
  return (
    <Link
      {...props}
      className={buttonVariants({ variant, size, fullWidth, isIconOnly, className })}
    />
  )
}
