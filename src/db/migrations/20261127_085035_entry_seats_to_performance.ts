import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "performances" ADD COLUMN "entry_seats" numeric;
  ALTER TABLE "_performances_v" ADD COLUMN "version_entry_seats" numeric;

  -- «Мест на показ (без схемы зала)» переезжает со спектакля в его показы без схемы зала.
  UPDATE "performances" p SET "entry_seats" = s."seats_per_performance"
    FROM "shows" s
    WHERE s."id" = p."show_id" AND s."seats_per_performance" IS NOT NULL AND p."seating_plan_id" IS NULL;
  UPDATE "_performances_v" v SET "version_entry_seats" = s."seats_per_performance"
    FROM "shows" s
    WHERE s."id" = v."version_show_id" AND s."seats_per_performance" IS NOT NULL
      AND v."version_seating_plan_id" IS NULL;

  ALTER TABLE "shows" DROP COLUMN "seats_per_performance";
  ALTER TABLE "_shows_v" DROP COLUMN "version_seats_per_performance";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "shows" ADD COLUMN "seats_per_performance" numeric;
  ALTER TABLE "_shows_v" ADD COLUMN "version_seats_per_performance" numeric;
  -- Обратно: спектаклю — наибольшая вместимость его показов.
  UPDATE "shows" s SET "seats_per_performance" = m.seats
    FROM (SELECT "show_id", max("entry_seats") AS seats FROM "performances"
          WHERE "entry_seats" IS NOT NULL GROUP BY "show_id") m
    WHERE m."show_id" = s."id";
  ALTER TABLE "performances" DROP COLUMN "entry_seats";
  ALTER TABLE "_performances_v" DROP COLUMN "version_entry_seats";`)
}
