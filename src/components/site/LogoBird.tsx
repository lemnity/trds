/**
 * Птица из логотипа театра (дрозд — turdus) — силуэт над надписью в шапке.
 * Прыгает по верху слова при загрузке и при наведении/фокусе на логотип (CSS в
 * SiteHeader.module.css); при prefers-reduced-motion просто сидит. Декоративная.
 */
export function LogoBird({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 120 80" focusable="false">
        <path d="M2 74 L38 50 C44 40 54 30 66 26 C72 18 80 12 88 13 L118 9 L92 22 C94 30 92 40 84 48 C78 54 70 57 60 58 L8 78 Z" />
        <path
          d="M64 56 L62 73 M73 55 L75 73"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="89" cy="17" r="1.8" fill="#ffffff" />
      </svg>
    </span>
  )
}
