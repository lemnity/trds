/** Иконка билета для кнопок «Купить билет». Декоративная: текст кнопки остаётся подписью. */
export function TicketIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5V6.75c0-.69.56-1.25 1.25-1.25h14.5c.69 0 1.25.56 1.25 1.25V8.5a2.5 2.5 0 0 0 0 5v1.75c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25V13.5a2.5 2.5 0 0 0 0-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 6v1.5M14.5 10.25v1.5M14.5 14.5V16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
