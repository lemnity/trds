import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_performances_seating_plan_id" ADD VALUE 'belinskogo' BEFORE 'khlebozavod';
  ALTER TYPE "public"."enum__performances_v_version_seating_plan_id" ADD VALUE 'belinskogo' BEFORE 'khlebozavod';
  ALTER TYPE "public"."enum_venues_seating_plan_id" ADD VALUE 'belinskogo' BEFORE 'khlebozavod';
  ALTER TYPE "public"."enum__venues_v_version_seating_plan_id" ADD VALUE 'belinskogo' BEFORE 'khlebozavod';
  ALTER TYPE "public"."enum_seat_price_templates_plan_id" ADD VALUE 'belinskogo' BEFORE 'khlebozavod';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "performances" ALTER COLUMN "seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum_performances_seating_plan_id";
  CREATE TYPE "public"."enum_performances_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TABLE "performances" ALTER COLUMN "seating_plan_id" SET DATA TYPE "public"."enum_performances_seating_plan_id" USING "seating_plan_id"::"public"."enum_performances_seating_plan_id";
  ALTER TABLE "_performances_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum__performances_v_version_seating_plan_id";
  CREATE TYPE "public"."enum__performances_v_version_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TABLE "_performances_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE "public"."enum__performances_v_version_seating_plan_id" USING "version_seating_plan_id"::"public"."enum__performances_v_version_seating_plan_id";
  ALTER TABLE "venues" ALTER COLUMN "seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum_venues_seating_plan_id";
  CREATE TYPE "public"."enum_venues_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TABLE "venues" ALTER COLUMN "seating_plan_id" SET DATA TYPE "public"."enum_venues_seating_plan_id" USING "seating_plan_id"::"public"."enum_venues_seating_plan_id";
  ALTER TABLE "_venues_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum__venues_v_version_seating_plan_id";
  CREATE TYPE "public"."enum__venues_v_version_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TABLE "_venues_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE "public"."enum__venues_v_version_seating_plan_id" USING "version_seating_plan_id"::"public"."enum__venues_v_version_seating_plan_id";
  ALTER TABLE "seat_price_templates" ALTER COLUMN "plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum_seat_price_templates_plan_id";
  CREATE TYPE "public"."enum_seat_price_templates_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TABLE "seat_price_templates" ALTER COLUMN "plan_id" SET DATA TYPE "public"."enum_seat_price_templates_plan_id" USING "plan_id"::"public"."enum_seat_price_templates_plan_id";`)
}
