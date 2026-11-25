'use client'

import { NavGroup, useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Меню админки по задачам театра (вместо групп Payload, собранных из коллекций): разделы Payload и
 * свои экраны (возвраты, сертификаты, корпоративы, второй фактор) — в одних группах.
 * Подключено как beforeNavLinks; стандартные группы скрывает src/app/(payload)/custom.scss.
 * Пункт виден, если у пользователя есть право читать раздел (permissions Payload) или роль
 * подходит для своего экрана; права всё равно проверяет сервер. Коллекции, не попавшие
 * в структуру, выводятся в «Прочее», чтобы новый раздел не пропал из меню.
 */

type User = { role?: string | null; systemAdmin?: boolean | null }

type Item =
  | { label: string; collection: string }
  | { label: string; global: string }
  | { label: string; view: string; roles?: string[] }

const MENU: { label: string; items: Item[] }[] = [
  {
    label: 'Афиша',
    items: [
      { label: 'Спектакли', collection: 'shows' },
      { label: 'Показы', collection: 'performances' },
      { label: 'Архив постановок', collection: 'archive' },
    ],
  },
  {
    label: 'Продажи',
    items: [
      { label: 'Категории билетов', collection: 'ticket-types' },
      { label: 'Возвраты', view: 'refunds', roles: ['admin', 'cashier'] },
      { label: 'Подарочные сертификаты', view: 'certificates', roles: ['admin'] },
      { label: 'Заявки на корпоративы', view: 'leads', roles: ['admin'] },
    ],
  },
  {
    label: 'Залы и цены',
    items: [
      { label: 'Площадки', collection: 'venues' },
      { label: 'Шаблоны цен зала', collection: 'seat-price-templates' },
    ],
  },
  {
    label: 'Сайт',
    items: [
      { label: 'Страницы', collection: 'pages' },
      { label: 'Новости', collection: 'news' },
      { label: 'Люди', collection: 'people' },
      { label: 'Отзывы', collection: 'reviews' },
      { label: 'Партнёры', collection: 'partners' },
      { label: 'Документы', collection: 'documents' },
      { label: 'Медиа (файлы)', collection: 'media' },
    ],
  },
  {
    label: 'Настройки',
    items: [
      { label: 'Настройки сайта', global: 'site-settings' },
      { label: 'Сотрудники', collection: 'admin-users' },
      { label: 'Второй фактор', view: 'mfa' },
    ],
  },
]

/** Служебные коллекции (admin.hidden в конфиге; клиентский конфиг этот флаг не передаёт). */
const HIDDEN = /^(payload-|admin-mfa)/

const listed = new Set(
  MENU.flatMap((g) => g.items.flatMap((i) => ('collection' in i ? [i.collection] : []))),
)

export function AdminNav() {
  const { user, permissions } = useAuth<User>()
  const { config } = useConfig()
  const pathname = usePathname() ?? ''
  const admin = config.routes.admin

  const hrefOf = (item: Item) =>
    'collection' in item
      ? `${admin}/collections/${item.collection}`
      : 'global' in item
        ? `${admin}/globals/${item.global}`
        : `${admin}/${item.view}`

  const visible = (item: Item) => {
    if (!user) return false
    if ('collection' in item) return Boolean(permissions?.collections?.[item.collection]?.read)
    if ('global' in item) return Boolean(permissions?.globals?.[item.global]?.read)
    return !item.roles || user.systemAdmin === true || item.roles.includes(user.role ?? '')
  }

  const other: Item[] = config.collections
    .filter(
      (c) =>
        !listed.has(c.slug) &&
        !HIDDEN.test(c.slug) &&
        Boolean(permissions?.collections?.[c.slug]?.read),
    )
    .map((c) => ({
      label: typeof c.labels?.plural === 'string' ? c.labels.plural : c.slug,
      collection: c.slug,
    }))

  const groups = [...MENU, { label: 'Прочее', items: other }]
    .map((g) => ({ ...g, items: g.items.filter(visible) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="turdus-nav">
      {groups.map((group) => (
        <NavGroup key={group.label} label={group.label}>
          {group.items.map((item) => {
            const href = hrefOf(item)
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                className="nav__link"
                aria-current={active ? 'page' : undefined}
              >
                {active && <div className="nav__link-indicator" />}
                <span className="nav__link-label">{item.label}</span>
              </Link>
            )
          })}
        </NavGroup>
      ))}
    </div>
  )
}
