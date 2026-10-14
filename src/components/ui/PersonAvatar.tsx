import { Avatar } from '@heroui/react'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)

/** Аватар человека театра. Фото театр ещё не передал — показываем инициалы (Avatar.Fallback). */
export function PersonAvatar({
  name,
  size = 'lg',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <Avatar size={size} className={className} aria-hidden="true">
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  )
}
