import { Breadcrumbs } from '@heroui/react'

/** Хлебные крошки HeroUI. Ссылки идут через RouterProvider (клиентская навигация Next). */
export function PageCrumbs({
  items,
  className,
}: {
  items: Array<{ label: string; href?: string }>
  className?: string
}) {
  return (
    <Breadcrumbs aria-label="Хлебные крошки" className={className}>
      {items.map((item) => (
        <Breadcrumbs.Item key={item.label} href={item.href}>
          {item.label}
        </Breadcrumbs.Item>
      ))}
    </Breadcrumbs>
  )
}
