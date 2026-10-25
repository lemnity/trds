/**
 * Версии документов, под которыми даётся согласие (PRD OPS-02): журнал хранит документ и версию,
 * чтобы после смены текста было видно, кто на что соглашался. Тексты пока не утверждены
 * театром (memory.md §5) — версии черновые; при утверждении — новая версия, старые записи остаются.
 */
export const CONSENT_DOCUMENTS = {
  'personal-data': { version: 'draft-2026-10', title: 'Согласие на обработку персональных данных' },
  cookies: { version: 'draft-2026-10', title: 'Использование cookie' },
} as const

export type ConsentDocument = keyof typeof CONSENT_DOCUMENTS

/** Где дано согласие — для журнала. */
export type ConsentContext = 'register' | 'lead'

export type ConsentRecord = {
  id: string
  document: ConsentDocument
  version: string
  context: ConsentContext
  /** Ссылка на объект без персональных данных, например `lead:<uuid>`. */
  subjectRef: string
  givenAt: Date
}
