/** Значки соцсетей — линейные, цвет текста. Ключ — название сети из `contacts.social`. */
const PATHS: Record<string, string> = {
  Telegram: 'M21 4 3 11l6 2.2M21 4l-3 16-9-6.8M21 4 9 13.2v5.3l3.2-3.4',
  ВКонтакте:
    'M3.5 7h3.2c.6 3 2.2 5.2 3.6 5.7V7h3v3.5c1.4-.2 2.8-1.8 3.3-3.5h3c-.5 2.4-2.2 4.2-3.4 4.9 1.2.6 3.1 2.1 3.8 4.6h-3.3c-.6-1.6-1.9-2.9-3.4-3V16.5h-.4C7.2 16.5 4 13.4 3.5 7Z',
}

export function SocialIcon({ name, size = 24 }: { name: string; size?: number }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
