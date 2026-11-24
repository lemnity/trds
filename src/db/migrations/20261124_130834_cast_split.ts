import { randomBytes } from 'node:crypto'

import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * «Состав и создатели» → «Создатели» (`credits`) + «Действующие лица и исполнители» (`cast`).
 * Актёрские строки старого состава («В ролях», «Действующие лица», строки с персонажами)
 * переносятся в `cast` — в документах и во всех версиях (черновики открываются из версий).
 * Связи с людьми лежат в *_rels по путям с индексами массивов, поэтому пути пересчитываются.
 */

type Db = MigrateUpArgs['db']
type Row = Record<string, unknown>

const CAST_ROLE = 'Действующие лица и исполнители'
const isCastRole = (role: unknown) =>
  /в ролях|действующие лица|исполнители/i.test(String(role ?? ''))

/** Таблицы одной коллекции: сам документ или его версии. */
type Tables = {
  credits: string
  entries: string
  cast: string
  rels: string
  /** Префикс путей в rels: '' у документа, 'version.' у версий. */
  pre: string
  /** У версий id — serial, а исходный id строки массива лежит в `_uuid`. */
  versioned: boolean
}

const tablesFor = (slug: string): Tables[] => [
  {
    credits: `${slug}_credits`,
    entries: `${slug}_credits_entries`,
    cast: `${slug}_cast`,
    rels: `${slug}_rels`,
    pre: '',
    versioned: false,
  },
  {
    credits: `_${slug}_v_version_credits`,
    entries: `_${slug}_v_version_credits_entries`,
    cast: `_${slug}_v_version_cast`,
    rels: `_${slug}_v_rels`,
    pre: 'version.',
    versioned: true,
  },
]

const rows = async (db: Db, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: Row[] }).rows

const t = (name: string) => sql.identifier(name)
const newId = () => randomBytes(12).toString('hex')

const groupBy = (list: Row[], key: string) => {
  const map = new Map<string, Row[]>()
  for (const r of list) {
    const k = String(r[key])
    map.set(k, [...(map.get(k) ?? []), r])
  }
  for (const group of map.values()) group.sort((a, b) => Number(a._order) - Number(b._order))
  return map
}

const setPath = (db: Db, tb: Tables, parent: string, from: string, to: string) =>
  db.execute(
    sql`UPDATE ${t(tb.rels)} SET path = ${to} WHERE parent_id = ${Number(parent)} AND path = ${from}`,
  )

const insertRow = (
  db: Db,
  tb: Tables,
  table: string,
  order: number,
  parent: unknown,
  cols: Row,
) => {
  const names = Object.keys(cols)
  const values = Object.values(cols)
  const idCol = tb.versioned ? sql`_uuid` : sql`id`
  return rows(
    db,
    sql`INSERT INTO ${t(table)} (_order, _parent_id, ${idCol}, ${sql.join(
      names.map((n) => sql.identifier(n)),
      sql`, `,
    )})
        VALUES (${order}, ${parent}, ${newId()}, ${sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        )}) RETURNING id`,
  )
}

async function splitCast(db: Db, tb: Tables) {
  const credits = await rows(db, sql`SELECT id, _parent_id, _order, role FROM ${t(tb.credits)}`)
  const entries = await rows(
    db,
    sql`SELECT id, _parent_id, _order, character FROM ${t(tb.entries)}`,
  )
  const entriesOf = groupBy(entries, '_parent_id')

  for (const [parent, list] of groupBy(credits, '_parent_id')) {
    const isCast = (c: Row) =>
      isCastRole(c.role) || (entriesOf.get(String(c.id)) ?? []).some((e) => e.character)
    if (!list.some(isCast)) continue

    // 1. Актёрские строки → cast; пути людей: credits.i.entries.j → cast.k.
    let k = 0
    for (const [i, c] of list.entries()) {
      if (!isCast(c)) continue
      for (const [j, e] of (entriesOf.get(String(c.id)) ?? []).entries()) {
        await insertRow(db, tb, tb.cast, k + 1, Number(parent), { character: e.character ?? null })
        await setPath(
          db,
          tb,
          parent,
          `${tb.pre}credits.${i}.entries.${j}.people`,
          `${tb.pre}cast.${k}.people`,
        )
        k++
      }
      await db.execute(sql`DELETE FROM ${t(tb.credits)} WHERE id = ${c.id}`)
    }

    // 2. Оставшиеся создатели сдвигаются вверх: новый индекс всегда меньше старого,
    //    поэтому при обходе по возрастанию целевой путь уже свободен.
    let n = 0
    for (const [i, c] of list.entries()) {
      if (isCast(c)) continue
      if (n !== i) {
        await db.execute(sql`UPDATE ${t(tb.credits)} SET _order = ${n + 1} WHERE id = ${c.id}`)
        for (const j of (entriesOf.get(String(c.id)) ?? []).keys())
          await setPath(
            db,
            tb,
            parent,
            `${tb.pre}credits.${i}.entries.${j}.people`,
            `${tb.pre}credits.${n}.entries.${j}.people`,
          )
      }
      n++
    }
  }
}

/** Обратно: cast → последняя строка состава «Действующие лица и исполнители». */
async function mergeCast(db: Db, tb: Tables) {
  const cast = await rows(db, sql`SELECT _parent_id, _order, character FROM ${t(tb.cast)}`)
  const credits = await rows(db, sql`SELECT _parent_id FROM ${t(tb.credits)}`)
  const count = new Map<string, number>()
  for (const c of credits)
    count.set(String(c._parent_id), (count.get(String(c._parent_id)) ?? 0) + 1)

  for (const [parent, list] of groupBy(cast, '_parent_id')) {
    const i = count.get(parent) ?? 0
    const [credit] = await insertRow(db, tb, tb.credits, i + 1, Number(parent), {
      role: CAST_ROLE,
    })
    for (const [k, e] of list.entries()) {
      await insertRow(db, tb, tb.entries, k + 1, credit!.id, { character: e.character ?? null })
      await setPath(
        db,
        tb,
        parent,
        `${tb.pre}cast.${k}.people`,
        `${tb.pre}credits.${i}.entries.${k}.people`,
      )
    }
  }
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "shows_cast" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"character" varchar
  );

  CREATE TABLE "_shows_v_version_cast" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"character" varchar,
  	"_uuid" varchar
  );

  CREATE TABLE "archive_cast" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"character" varchar
  );

  CREATE TABLE "_archive_v_version_cast" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"character" varchar,
  	"_uuid" varchar
  );

  ALTER TABLE "shows_cast" ADD CONSTRAINT "shows_cast_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v_version_cast" ADD CONSTRAINT "_shows_v_version_cast_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_shows_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "archive_cast" ADD CONSTRAINT "archive_cast_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_archive_v_version_cast" ADD CONSTRAINT "_archive_v_version_cast_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_archive_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "shows_cast_order_idx" ON "shows_cast" USING btree ("_order");
  CREATE INDEX "shows_cast_parent_id_idx" ON "shows_cast" USING btree ("_parent_id");
  CREATE INDEX "_shows_v_version_cast_order_idx" ON "_shows_v_version_cast" USING btree ("_order");
  CREATE INDEX "_shows_v_version_cast_parent_id_idx" ON "_shows_v_version_cast" USING btree ("_parent_id");
  CREATE INDEX "archive_cast_order_idx" ON "archive_cast" USING btree ("_order");
  CREATE INDEX "archive_cast_parent_id_idx" ON "archive_cast" USING btree ("_parent_id");
  CREATE INDEX "_archive_v_version_cast_order_idx" ON "_archive_v_version_cast" USING btree ("_order");
  CREATE INDEX "_archive_v_version_cast_parent_id_idx" ON "_archive_v_version_cast" USING btree ("_parent_id");`)

  for (const slug of ['shows', 'archive']) for (const tb of tablesFor(slug)) await splitCast(db, tb)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const slug of ['shows', 'archive']) for (const tb of tablesFor(slug)) await mergeCast(db, tb)

  await db.execute(sql`
   DROP TABLE "shows_cast" CASCADE;
  DROP TABLE "_shows_v_version_cast" CASCADE;
  DROP TABLE "archive_cast" CASCADE;
  DROP TABLE "_archive_v_version_cast" CASCADE;`)
}
