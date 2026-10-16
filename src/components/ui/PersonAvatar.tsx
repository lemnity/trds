import { Avatar } from '@heroui/react'
import Image, { type StaticImageData } from 'next/image'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)

/**
 * Аватар человека театра: портрет, если театр его передал (или он подписан на сайте театра),
 * иначе инициалы (Avatar.Fallback). Размер и скругление (круг, 3px…) задаёт className.
 */
export function PersonAvatar({
  name,
  photo,
  size = 'lg',
  className,
}: {
  name: string
  photo?: StaticImageData
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  if (photo)
    return (
      <span
        className={className}
        style={{ position: 'relative', display: 'block', overflow: 'hidden' }}
      >
        <Image
          src={photo}
          alt={name}
          fill
          sizes="10rem"
          style={{ objectFit: 'cover', objectPosition: '50% 18%' }}
        />
      </span>
    )
  return (
    <Avatar size={size} className={className} aria-hidden="true">
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  )
}
