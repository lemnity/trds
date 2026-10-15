import { cardVariants } from '@heroui/styles'

/**
 * Класс карточки HeroUI (Card) для любого семантического элемента: article, li, form,
 * fieldset. Вид (фон, скругление, тень) — из темы HeroUI на наших токенах; раскладку
 * задаёт модуль компонента.
 */
export const cardClass = (className?: string) => cardVariants().base({ className })
