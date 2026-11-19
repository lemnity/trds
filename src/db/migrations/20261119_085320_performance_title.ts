import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "performances" ADD COLUMN "title" varchar;
  ALTER TABLE "_performances_v" ADD COLUMN "version_title" varchar;
  -- Название существующих показов: «Спектакль · 15 марта 19:00 · Площадка» (время театра); нет данных — ключ показа.
  UPDATE "performances" SET "title" = COALESCE(NULLIF(concat_ws(' · ',
    (SELECT "title" FROM "shows" WHERE "shows"."id" = "performances"."show_id"),
    CASE WHEN "starts_at" IS NULL THEN NULL ELSE
      extract(day FROM "starts_at" AT TIME ZONE 'Asia/Yekaterinburg')::int::text || ' ' ||
      (ARRAY['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'])[extract(month FROM "starts_at" AT TIME ZONE 'Asia/Yekaterinburg')::int] || ' ' ||
      to_char("starts_at" AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') END,
    (SELECT "title" FROM "venues" WHERE "venues"."id" = "performances"."venue_id")
  ), ''), "code");
  UPDATE "_performances_v" SET "version_title" = COALESCE(NULLIF(concat_ws(' · ',
    (SELECT "title" FROM "shows" WHERE "shows"."id" = "_performances_v"."version_show_id"),
    CASE WHEN "version_starts_at" IS NULL THEN NULL ELSE
      extract(day FROM "version_starts_at" AT TIME ZONE 'Asia/Yekaterinburg')::int::text || ' ' ||
      (ARRAY['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'])[extract(month FROM "version_starts_at" AT TIME ZONE 'Asia/Yekaterinburg')::int] || ' ' ||
      to_char("version_starts_at" AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') END,
    (SELECT "title" FROM "venues" WHERE "venues"."id" = "_performances_v"."version_venue_id")
  ), ''), "version_code");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "performances" DROP COLUMN "title";
  ALTER TABLE "_performances_v" DROP COLUMN "version_title";`)
}
