'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { FloorSvg, hasFloor } from '@/components/show/FloorSvg'
import { formatRub, parseRub, rubInput } from '@/lib/money'
import {
  MAX_SEAT_ZONES,
  blockSlots,
  seatCategoryColor,
  seatPlace,
  type FloorTable,
  type Seat,
  SEAT_ZONE_IDS,
  pricingSummary,
  seatsOf,
  type SeatPricing,
  type SeatingPlan,
} from '@/modules/seating'

import styles from './seatPricing.module.css'

/**
 * Редактор цен по схеме зала: выделить места (клик, протягивание, номер ряда, зона в списке) и
 * назначить им ценовую зону или закрыть с продажи. Управляемый: значение и изменения — снаружи
 * (поле показа, шаблон площадки). `pricing` — полный: каждое место схемы отнесено к зоне.
 * Рендерить с `key={plan.id}`: при смене схемы выделение сбрасывается.
 */
type Props = {
  plan: SeatingPlan
  pricing: SeatPricing
  onChange: (next: SeatPricing) => void
  /** Закрытые места показа; без `onClosedChange` закрывать места нельзя (шаблон). */
  closedSeatIds?: readonly string[]
  onClosedChange?: (next: string[]) => void
  /** Подтверждение «Открыть все закрытые» (окно хозяина формы); без него кнопки нет. */
  confirmOpenAll?: (count: number) => Promise<boolean>
  readOnly?: boolean
  /** Панель над схемой — шаблоны. */
  toolbar?: ReactNode
}

const seatWord = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'место'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'места'
  return 'мест'
}

export function PriceInput({
  value,
  onCommit,
  disabled,
  label,
}: {
  value: number | null
  onCommit: (v: number | null) => void
  disabled?: boolean
  label: string
}) {
  // Пока поле в фокусе — показываем ввод как есть («1 500,»), иначе — сохранённую цену.
  const [editing, setEditing] = useState<string | null>(null)
  const draft = editing ?? rubInput(value)
  const parsed = parseRub(draft)
  return (
    <span className={styles.priceInput} data-invalid={parsed === undefined}>
      <input
        inputMode="decimal"
        aria-label={label}
        placeholder="—"
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setEditing(e.target.value)
          const v = parseRub(e.target.value)
          if (v !== undefined) onCommit(v)
        }}
        onBlur={() => setEditing(null)}
      />
      <span aria-hidden="true">₽</span>
    </span>
  )
}

export function SeatPricingEditor({
  plan,
  pricing,
  onChange,
  closedSeatIds,
  onClosedChange,
  confirmOpenAll,
  readOnly,
  toolbar,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [newTitle, setNewTitle] = useState('')
  const [newPrice, setNewPrice] = useState('')
  /** Режим «зона → места»: новая (zoneId null) или существующая зона, места — в `selected`. */
  const [zoneDraft, setZoneDraft] = useState<{
    zoneId: string | null
    title: string
    price: string
  } | null>(null)
  const drag = useRef<{ mode: 'add' | 'remove'; seen: Set<string> } | null>(null)

  const closed = useMemo(() => new Set(closedSeatIds ?? []), [closedSeatIds])
  const canClose = !!onClosedChange
  const allSeats = useMemo(() => seatsOf(plan), [plan])
  const zoneById = useMemo(
    () => new Map(pricing.zones.map((z) => [z.categoryId, z])),
    [pricing.zones],
  )
  const summary = useMemo(
    () => pricingSummary(plan, pricing, closedSeatIds ?? []),
    [plan, pricing, closedSeatIds],
  )
  const freeZoneId = SEAT_ZONE_IDS.find((id) => !zoneById.has(id))
  const floorPlan = hasFloor(plan) ? plan : null
  const seatTitle = (
    seat: Seat,
    zone: { title: string; priceKopecks: number | null } | undefined,
    isClosed: boolean,
  ) =>
    [
      seatPlace(plan, seat),
      zone?.title ?? seat.categoryId,
      zone?.priceKopecks != null ? formatRub(zone.priceKopecks) : 'без цены',
      ...(isClosed ? ['закрыто'] : []),
    ].join(' · ')
  const colorOf = (zoneId: string) => zoneById.get(zoneId)?.color ?? seatCategoryColor(plan, zoneId)
  /** Секции, которые есть в этом зале (у Белинского нет центра). */
  const usedSections = (['left', 'center', 'right'] as const).filter((section) =>
    plan.rows.some((r) => r.blocks.some((b) => b.section === section)),
  )
  const rowColumns = `24px repeat(${usedSections.length}, auto) 24px`

  useEffect(() => {
    const stop = () => (drag.current = null)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const apply = useCallback(
    (ids: Iterable<string>, mode: 'add' | 'remove' | 'toggle') =>
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          const add = mode === 'add' || (mode === 'toggle' && !next.has(id))
          if (add) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    [],
  )

  const seatAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-seat]')
      ?.dataset.seat

  const onPointerDown = (e: React.PointerEvent, seatId: string) => {
    if (readOnly || e.button !== 0) return
    e.preventDefault()
    const mode = selected.has(seatId) ? 'remove' : 'add'
    drag.current = { mode, seen: new Set([seatId]) }
    apply([seatId], mode)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const id = seatAt(e.clientX, e.clientY)
    if (!id || d.seen.has(id)) return
    d.seen.add(id)
    apply([id], d.mode)
  }

  const rowSeatIds = (rowNumber: number) =>
    plan.rows.find((r) => r.number === rowNumber)!.blocks.flatMap((b) => b.seats.map((s) => s.id))

  const toggleGroup = (ids: string[]) => {
    const all = ids.every((id) => selected.has(id))
    apply(ids, all ? 'remove' : 'add')
  }

  const assign = (zoneId: string) => {
    const seats = { ...pricing.seats }
    for (const id of selected) seats[id] = zoneId
    onChange({ ...pricing, seats })
    setSelected(new Set())
  }

  const createZone = () => {
    const title = newTitle.trim()
    const price = parseRub(newPrice)
    if (!freeZoneId || !title || price === undefined) return
    const seats = { ...pricing.seats }
    for (const id of selected) seats[id] = freeZoneId
    onChange({
      zones: [...pricing.zones, { categoryId: freeZoneId, title, priceKopecks: price }],
      seats,
    })
    setSelected(new Set())
    setNewTitle('')
    setNewPrice('')
  }

  const updateZone = (
    zoneId: string,
    patch: Partial<{ title: string; priceKopecks: number | null; color: string }>,
  ) =>
    onChange({
      ...pricing,
      zones: pricing.zones.map((z) => (z.categoryId === zoneId ? { ...z, ...patch } : z)),
    })

  const removeZone = (zoneId: string) =>
    onChange({ ...pricing, zones: pricing.zones.filter((z) => z.categoryId !== zoneId) })

  const setClosed = (close: boolean) => {
    if (!onClosedChange) return
    const next = new Set(closed)
    for (const id of selected) {
      if (close) next.add(id)
      else next.delete(id)
    }
    onClosedChange([...next].sort())
    setSelected(new Set())
  }

  const seatsInZone = (zoneId: string) =>
    allSeats.filter((s) => (pricing.seats[s.id] ?? s.categoryId) === zoneId).map((s) => s.id)

  const startNewZone = () => {
    setZoneDraft({ zoneId: null, title: '', price: '' })
    setSelected(new Set())
  }

  const startEditZone = (zoneId: string) => {
    const zone = zoneById.get(zoneId)
    if (!zone) return
    setZoneDraft({ zoneId, title: zone.title, price: rubInput(zone.priceKopecks) })
    setSelected(new Set(seatsInZone(zoneId)))
  }

  const cancelZoneDraft = () => {
    setZoneDraft(null)
    setSelected(new Set())
  }

  const draftPrice = zoneDraft ? parseRub(zoneDraft.price) : null
  const draftZoneId = zoneDraft ? (zoneDraft.zoneId ?? freeZoneId) : undefined
  const canSaveDraft =
    !!zoneDraft && !!zoneDraft.title.trim() && draftPrice !== undefined && !!draftZoneId

  /**
   * Сохранить зону: выбранные места — в зону; места, которые из неё убрали, возвращаются в
   * категорию схемы «по рядам» (если это не она же).
   */
  const saveZoneDraft = () => {
    if (!zoneDraft || !canSaveDraft || !draftZoneId) return
    const title = zoneDraft.title.trim()
    const priceKopecks = draftPrice ?? null
    const seats = { ...pricing.seats }
    for (const s of allSeats)
      if (
        (seats[s.id] ?? s.categoryId) === draftZoneId &&
        !selected.has(s.id) &&
        s.categoryId !== draftZoneId
      )
        seats[s.id] = s.categoryId
    for (const id of selected) seats[id] = draftZoneId
    const zones = zoneDraft.zoneId
      ? pricing.zones.map((z) => (z.categoryId === draftZoneId ? { ...z, title, priceKopecks } : z))
      : [...pricing.zones, { categoryId: draftZoneId, title, priceKopecks }]
    onChange({ zones, seats })
    cancelZoneDraft()
  }

  const openAllClosed = async () => {
    if (!onClosedChange || !confirmOpenAll || closed.size === 0) return
    const ok = await confirmOpenAll?.(closed.size)
    if (!ok) return
    onClosedChange([])
    setSelected(new Set())
  }

  const selectedClosed = [...selected].filter((id) => closed.has(id)).length
  const newPriceParsed = parseRub(newPrice)

  return (
    <div className={styles.root}>
      {toolbar}

      <div className={styles.layout}>
        {/* --- Схема --- */}
        <div className={styles.hall}>
          {floorPlan ? (
            <div className={styles.floor} onPointerMove={onPointerMove}>
              <FloorSvg
                plan={floorPlan}
                lockTouch
                ariaLabel={`${plan.title}: выделите места, чтобы назначить цену`}
                classes={{
                  room: styles.floorRoom,
                  bar: styles.floorBar,
                  barIcon: styles.floorBarIcon,
                  column: styles.floorColumn,
                  stage: styles.floorStage,
                  stageLabel: styles.floorStageLabel,
                  table: styles.floorTable,
                  tableLabel: styles.floorTableLabel,
                }}
                {...(!readOnly && {
                  onTableClick: (t: FloorTable) => toggleGroup(rowSeatIds(t.row)),
                })}
                tableTitle={(t) => `Стол ${t.row}: выделить все места`}
                renderSeat={(seat) => {
                  const zoneId = pricing.seats[seat.id] ?? seat.categoryId
                  const zone = zoneById.get(zoneId)
                  const isClosed = closed.has(seat.id)
                  const isSelected = selected.has(seat.id)
                  return (
                    <g
                      key={seat.id}
                      data-seat={seat.id}
                      className={styles.floorSeat}
                      data-closed={isClosed}
                      data-unpriced={zone?.priceKopecks == null}
                      aria-pressed={isSelected}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      style={{ '--zone': colorOf(zoneId) } as React.CSSProperties}
                      onPointerDown={(e) => onPointerDown(e, seat.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          apply([seat.id], 'toggle')
                        }
                      }}
                    >
                      <title>{seatTitle(seat, zone, isClosed)}</title>
                      <circle cx={seat.x} cy={seat.y} r={isClosed ? 4.5 : 7} />
                    </g>
                  )
                }}
              />
            </div>
          ) : (
            <>
              <div className={styles.stage}>Сцена</div>
              <div
                className={styles.grid}
                onPointerMove={onPointerMove}
                role="group"
                aria-label={`${plan.title}: выделите места, чтобы назначить цену`}
              >
                {plan.rows.map((row) => {
                  const sections = new Map(row.blocks.map((b) => [b.section, b]))
                  return (
                    <div
                      key={row.number}
                      className={styles.row}
                      style={{ gridTemplateColumns: rowColumns }}
                    >
                      <button
                        type="button"
                        className={styles.rowNum}
                        onClick={() => toggleGroup(rowSeatIds(row.number))}
                        disabled={readOnly}
                        title={`Выделить: ${row.label ?? `ряд ${row.number}`}`}
                      >
                        {row.number}
                      </button>
                      {usedSections.map((section) => (
                        <span
                          key={section}
                          className={`${styles.block} ${usedSections.length === 3 ? styles[section] : ''}`}
                          data-section={section}
                        >
                          {(sections.get(section) ? blockSlots(sections.get(section)!) : []).map(
                            (seat, i) => {
                              if (!seat)
                                return (
                                  <span key={`gap-${i}`} className={styles.gap} title="Места нет" />
                                )
                              const zoneId = pricing.seats[seat.id] ?? seat.categoryId
                              const zone = zoneById.get(zoneId)
                              const isClosed = closed.has(seat.id)
                              const isSelected = selected.has(seat.id)
                              return (
                                <button
                                  key={seat.id}
                                  type="button"
                                  data-seat={seat.id}
                                  className={styles.seat}
                                  data-closed={isClosed}
                                  data-unpriced={zone?.priceKopecks == null}
                                  aria-pressed={isSelected}
                                  disabled={readOnly}
                                  style={
                                    {
                                      '--zone': colorOf(zoneId),
                                    } as React.CSSProperties
                                  }
                                  title={seatTitle(seat, zone, isClosed)}
                                  onPointerDown={(e) => onPointerDown(e, seat.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      apply([seat.id], 'toggle')
                                    }
                                  }}
                                >
                                  {seat.number}
                                </button>
                              )
                            },
                          )}
                        </span>
                      ))}
                      <span className={styles.rowNum} aria-hidden="true">
                        {row.number}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!readOnly && (
            <div className={styles.hint}>
              {floorPlan
                ? 'Клик или протягивание — выделить места, клик по столу — все его места, «Выделить» у зоны — все её места.'
                : 'Клик или протягивание — выделить места, номер ряда — весь ряд, «Выделить» у зоны — все её места.'}{' '}
              <button
                type="button"
                className={styles.link}
                onClick={() =>
                  apply(
                    allSeats.map((s) => s.id),
                    'add',
                  )
                }
              >
                Выделить весь зал
              </button>
            </div>
          )}
        </div>

        {/* --- Зоны --- */}
        <div className={styles.side}>
          <div className={styles.sideHead}>
            <h4 className={styles.sideTitle}>Ценовые зоны</h4>
            {!readOnly && (
              <button
                type="button"
                className={styles.chip}
                disabled={!freeZoneId || !!zoneDraft}
                title={
                  freeZoneId ? 'Новая зона: название, цена и места на схеме' : 'Не больше 12 зон'
                }
                onClick={startNewZone}
              >
                + Добавить
              </button>
            )}
          </div>
          <ul className={styles.zones}>
            {summary.zones.map((z) => (
              <li
                key={z.categoryId}
                className={styles.zone}
                data-active={zoneDraft?.zoneId === z.categoryId}
              >
                <label
                  className={styles.colorPicker}
                  style={{ '--zone': colorOf(z.categoryId) } as React.CSSProperties}
                  title="Цвет зоны"
                >
                  <input
                    type="color"
                    aria-label={`Цвет зоны «${z.title}»`}
                    value={colorOf(z.categoryId)}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateZone(z.categoryId, { color: e.target.value.toLowerCase() })
                    }
                  />
                </label>
                <input
                  className={styles.zoneTitle}
                  aria-label="Название зоны"
                  value={z.title}
                  disabled={readOnly}
                  onChange={(e) => updateZone(z.categoryId, { title: e.target.value })}
                />
                <PriceInput
                  label={`Цена зоны «${z.title}», ₽`}
                  value={z.priceKopecks}
                  disabled={readOnly}
                  onCommit={(v) => updateZone(z.categoryId, { priceKopecks: v })}
                />
                <span className={styles.zoneMeta}>
                  {z.seats} {seatWord(z.seats)}
                  {z.closed > 0 && ` · ${z.closed} закрыто`}
                  {z.priceKopecks === null && z.seats > 0 && (
                    <span className={styles.warn}> · не продаётся</span>
                  )}
                </span>
                {!readOnly && (
                  <span className={styles.zoneActions}>
                    <button
                      type="button"
                      className={styles.link}
                      disabled={!!zoneDraft}
                      onClick={() => startEditZone(z.categoryId)}
                    >
                      Места
                    </button>
                    <button
                      type="button"
                      className={styles.link}
                      disabled={z.seats === 0}
                      onClick={() => toggleGroup(seatsInZone(z.categoryId))}
                    >
                      Выделить
                    </button>
                    <button
                      type="button"
                      className={styles.link}
                      disabled={seatsInZone(z.categoryId).length > 0}
                      title={
                        seatsInZone(z.categoryId).length > 0
                          ? 'Сначала переназначьте места этой зоны'
                          : 'Удалить зону'
                      }
                      onClick={() => removeZone(z.categoryId)}
                    >
                      Удалить
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>

          <dl className={styles.summary}>
            <div>
              <dt>В продаже</dt>
              <dd>{summary.onSale}</dd>
            </div>
            <div>
              <dt>Без цены</dt>
              <dd data-warn={summary.unpriced > 0}>{summary.unpriced}</dd>
            </div>
            {canClose && (
              <div>
                <dt>Закрыто</dt>
                <dd>{summary.closed}</dd>
              </div>
            )}
            <div className={styles.revenue}>
              <dt>Полный зал</dt>
              <dd>{formatRub(summary.revenueKopecks)}</dd>
            </div>
          </dl>
          {canClose && summary.closed > 0 && (
            <div className={styles.closedNote}>
              <p>Закрыты с продажи. Выделите места и нажмите «Вернуть в продажу».</p>
              {!readOnly && confirmOpenAll && (
                <button type="button" className={styles.link} onClick={openAllClosed}>
                  Открыть все закрытые
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* --- Зона: название, цена и места --- */}
      {!readOnly && zoneDraft && (
        <form
          className={styles.actions}
          aria-label={zoneDraft.zoneId ? 'Места зоны' : 'Новая зона'}
          onSubmit={(e) => {
            e.preventDefault()
            saveZoneDraft()
          }}
        >
          <div className={styles.actionsHead}>
            <strong>
              {zoneDraft.zoneId ? 'Места зоны' : 'Новая ценовая зона'} · выбрано {selected.size}{' '}
              {seatWord(selected.size)}
            </strong>
            <span className={styles.muted}>
              Отметьте места на схеме: клик, протягивание или номер ряда
            </span>
          </div>
          <div className={styles.newZone}>
            {draftZoneId && (
              <span
                className={styles.swatch}
                style={{ '--zone': colorOf(draftZoneId) } as React.CSSProperties}
                aria-hidden="true"
              />
            )}
            <input
              className={styles.zoneTitle}
              placeholder="Название, например «Задние ряды»"
              aria-label="Название зоны"
              value={zoneDraft.title}
              autoFocus={!zoneDraft.zoneId}
              onChange={(e) => setZoneDraft({ ...zoneDraft, title: e.target.value })}
            />
            <span className={styles.priceInput} data-invalid={draftPrice === undefined}>
              <input
                inputMode="decimal"
                placeholder="Цена"
                aria-label="Цена зоны, ₽"
                value={zoneDraft.price}
                onChange={(e) => setZoneDraft({ ...zoneDraft, price: e.target.value })}
              />
              <span aria-hidden="true">₽</span>
            </span>
            <span className={styles.toolbarSpacer} />
            <button type="button" className={styles.chip} onClick={cancelZoneDraft}>
              Отмена
            </button>
            <button type="submit" className={styles.primary} disabled={!canSaveDraft}>
              Сохранить
            </button>
          </div>
        </form>
      )}

      {/* --- Действия с выделением --- */}
      {!readOnly && !zoneDraft && selected.size > 0 && (
        <div className={styles.actions} role="region" aria-label="Выделенные места">
          <div className={styles.actionsHead}>
            <strong>
              Выбрано {selected.size} {seatWord(selected.size)}
            </strong>
            <button type="button" className={styles.link} onClick={() => setSelected(new Set())}>
              Снять выделение
            </button>
          </div>
          <div className={styles.assign}>
            <span className={styles.muted}>Назначить зону:</span>
            {pricing.zones.map((z) => (
              <button
                key={z.categoryId}
                type="button"
                className={styles.chip}
                style={{ '--zone': colorOf(z.categoryId) } as React.CSSProperties}
                onClick={() => assign(z.categoryId)}
              >
                <span className={styles.swatch} aria-hidden="true" />
                {z.title}
                <span className={styles.muted}>
                  {z.priceKopecks !== null ? formatRub(z.priceKopecks) : 'без цены'}
                </span>
              </button>
            ))}
          </div>
          {pricing.zones.length < MAX_SEAT_ZONES && (
            <form
              className={styles.newZone}
              onSubmit={(e) => {
                e.preventDefault()
                createZone()
              }}
            >
              <span className={styles.muted}>или новая зона:</span>
              <input
                className={styles.zoneTitle}
                placeholder="Название, например «VIP»"
                aria-label="Название новой зоны"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <span className={styles.priceInput} data-invalid={newPriceParsed === undefined}>
                <input
                  inputMode="decimal"
                  placeholder="Цена"
                  aria-label="Цена новой зоны, ₽"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
                <span aria-hidden="true">₽</span>
              </span>
              <button
                type="submit"
                className={styles.primary}
                disabled={!newTitle.trim() || newPriceParsed === undefined}
              >
                Создать и назначить
              </button>
            </form>
          )}
          {canClose && (
            <div className={styles.assign}>
              <span className={styles.muted}>Продажа:</span>
              {selectedClosed < selected.size && (
                <button type="button" className={styles.chip} onClick={() => setClosed(true)}>
                  Закрыть с продажи
                </button>
              )}
              {selectedClosed > 0 && (
                <button type="button" className={styles.chip} onClick={() => setClosed(false)}>
                  Вернуть в продажу
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
