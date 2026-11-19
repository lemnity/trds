import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "shows" ADD COLUMN "seats_per_performance" numeric;
  ALTER TABLE "_shows_v" ADD COLUMN "version_seats_per_performance" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "shows" DROP COLUMN "seats_per_performance";
  ALTER TABLE "_shows_v" DROP COLUMN "version_seats_per_performance";`)
}
