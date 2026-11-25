import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "reviews" DROP COLUMN "sort_order";
  ALTER TABLE "_reviews_v" DROP COLUMN "version_sort_order";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "reviews" ADD COLUMN "sort_order" numeric DEFAULT 0;
  ALTER TABLE "_reviews_v" ADD COLUMN "version_sort_order" numeric DEFAULT 0;`)
}
