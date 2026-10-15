/**
 * Ключ версии для слабовидящих в localStorage. Отдельный модуль без 'use client':
 * серверный layout подставляет его во встроенный скрипт — экспорт из клиентского
 * модуля на сервере превратился бы в client reference, а не в строку.
 */
export const LOW_VISION_KEY = 'turdus:low-vision'
