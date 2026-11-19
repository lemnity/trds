import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_venues_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  CREATE TYPE "public"."enum__venues_v_version_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  CREATE TYPE "public"."enum_seat_price_templates_plan_id" AS ENUM('dom-aktera', 'dom-kultury', 'khlebozavod');
  ALTER TYPE "public"."enum_performances_seating_plan_id" ADD VALUE 'khlebozavod';
  ALTER TYPE "public"."enum__performances_v_version_seating_plan_id" ADD VALUE 'khlebozavod';
  CREATE TABLE "seat_price_templates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"venue_id" integer NOT NULL,
  	"plan_id" "enum_seat_price_templates_plan_id" NOT NULL,
  	"pricing" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "performances" ADD COLUMN "seating_pricing" jsonb;
  ALTER TABLE "_performances_v" ADD COLUMN "version_seating_pricing" jsonb;

  -- Цены категорий (строки массива) → JSON «Цены по схеме зала»: зоны — категории схемы,
  -- раскладка мест пустая (места остаются в категориях схемы «по рядам»).
  UPDATE "performances" p SET "seating_pricing" = jsonb_build_object('zones', z.zones, 'seats', '{}'::jsonb)
  FROM (
    SELECT "_parent_id", jsonb_agg(jsonb_build_object(
      'categoryId', "category_id",
      'title', 'Категория ' || substring("category_id" from 5),
      'priceKopecks', "price_kopecks"::bigint
    ) ORDER BY "_order") AS zones
    FROM "performances_seating_prices"
    WHERE "category_id" ~ '^cat-([1-9]|1[0-2])$' AND "price_kopecks" IS NOT NULL
    GROUP BY "_parent_id"
  ) z
  WHERE z."_parent_id" = p."id";
  UPDATE "_performances_v" v SET "version_seating_pricing" = jsonb_build_object('zones', z.zones, 'seats', '{}'::jsonb)
  FROM (
    SELECT "_parent_id", jsonb_agg(jsonb_build_object(
      'categoryId', "category_id",
      'title', 'Категория ' || substring("category_id" from 5),
      'priceKopecks', "price_kopecks"::bigint
    ) ORDER BY "_order") AS zones
    FROM "_performances_v_version_seating_prices"
    WHERE "category_id" ~ '^cat-([1-9]|1[0-2])$' AND "price_kopecks" IS NOT NULL
    GROUP BY "_parent_id"
  ) z
  WHERE z."_parent_id" = v."id";

  ALTER TABLE "performances_seating_prices" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_performances_v_version_seating_prices" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "performances_seating_prices" CASCADE;
  DROP TABLE "_performances_v_version_seating_prices" CASCADE;
  ALTER TABLE "venues" ADD COLUMN "seating_plan_id" "enum_venues_seating_plan_id";
  ALTER TABLE "_venues_v" ADD COLUMN "version_seating_plan_id" "enum__venues_v_version_seating_plan_id";
  -- Схемы залов в коде привязаны к площадкам по ключу: «dom-aktera», «dk», «baton».
  UPDATE "venues" SET "seating_plan_id" = 'dom-aktera' WHERE "code" = 'dom-aktera';
  UPDATE "venues" SET "seating_plan_id" = 'dom-kultury' WHERE "code" = 'dk';
  UPDATE "venues" SET "seating_plan_id" = 'khlebozavod' WHERE "code" = 'baton';
  UPDATE "_venues_v" SET "version_seating_plan_id" = 'dom-aktera' WHERE "version_code" = 'dom-aktera';
  UPDATE "_venues_v" SET "version_seating_plan_id" = 'dom-kultury' WHERE "version_code" = 'dk';
  UPDATE "_venues_v" SET "version_seating_plan_id" = 'khlebozavod' WHERE "version_code" = 'baton';
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "seat_price_templates_id" integer;
  ALTER TABLE "seat_price_templates" ADD CONSTRAINT "seat_price_templates_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "seat_price_templates_venue_idx" ON "seat_price_templates" USING btree ("venue_id");
  CREATE INDEX "seat_price_templates_plan_id_idx" ON "seat_price_templates" USING btree ("plan_id");
  CREATE INDEX "seat_price_templates_updated_at_idx" ON "seat_price_templates" USING btree ("updated_at");
  CREATE INDEX "seat_price_templates_created_at_idx" ON "seat_price_templates" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_seat_price_templates_fk" FOREIGN KEY ("seat_price_templates_id") REFERENCES "public"."seat_price_templates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_seat_price_templates_id_idx" ON "payload_locked_documents_rels" USING btree ("seat_price_templates_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "performances_seating_prices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"category_id" varchar,
  	"price_kopecks" numeric
  );
  
  CREATE TABLE "_performances_v_version_seating_prices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"category_id" varchar,
  	"price_kopecks" numeric,
  	"_uuid" varchar
  );
  
  ALTER TABLE "seat_price_templates" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "seat_price_templates" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_seat_price_templates_fk";
  
  ALTER TABLE "performances" ALTER COLUMN "seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum_performances_seating_plan_id";
  CREATE TYPE "public"."enum_performances_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury');
  ALTER TABLE "performances" ALTER COLUMN "seating_plan_id" SET DATA TYPE "public"."enum_performances_seating_plan_id" USING "seating_plan_id"::"public"."enum_performances_seating_plan_id";
  ALTER TABLE "_performances_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE text;
  DROP TYPE "public"."enum__performances_v_version_seating_plan_id";
  CREATE TYPE "public"."enum__performances_v_version_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury');
  ALTER TABLE "_performances_v" ALTER COLUMN "version_seating_plan_id" SET DATA TYPE "public"."enum__performances_v_version_seating_plan_id" USING "version_seating_plan_id"::"public"."enum__performances_v_version_seating_plan_id";
  DROP INDEX "payload_locked_documents_rels_seat_price_templates_id_idx";
  ALTER TABLE "performances_seating_prices" ADD CONSTRAINT "performances_seating_prices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_performances_v_version_seating_prices" ADD CONSTRAINT "_performances_v_version_seating_prices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_performances_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "performances_seating_prices_order_idx" ON "performances_seating_prices" USING btree ("_order");
  CREATE INDEX "performances_seating_prices_parent_id_idx" ON "performances_seating_prices" USING btree ("_parent_id");
  CREATE INDEX "_performances_v_version_seating_prices_order_idx" ON "_performances_v_version_seating_prices" USING btree ("_order");
  CREATE INDEX "_performances_v_version_seating_prices_parent_id_idx" ON "_performances_v_version_seating_prices" USING btree ("_parent_id");
  ALTER TABLE "performances" DROP COLUMN "seating_pricing";
  ALTER TABLE "_performances_v" DROP COLUMN "version_seating_pricing";
  ALTER TABLE "venues" DROP COLUMN "seating_plan_id";
  ALTER TABLE "_venues_v" DROP COLUMN "version_seating_plan_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "seat_price_templates_id";
  DROP TYPE "public"."enum_venues_seating_plan_id";
  DROP TYPE "public"."enum__venues_v_version_seating_plan_id";
  DROP TYPE "public"."enum_seat_price_templates_plan_id";`)
}
