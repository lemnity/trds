import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_people_groups" AS ENUM('actors', 'creators', 'leadership');
  CREATE TYPE "public"."enum__people_v_version_groups" AS ENUM('actors', 'creators', 'leadership');
  CREATE TABLE "people_groups" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_people_groups",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_people_v_version_groups" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__people_v_version_groups",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "people_groups" ADD CONSTRAINT "people_groups_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_people_v_version_groups" ADD CONSTRAINT "_people_v_version_groups_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_people_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "people_groups_order_idx" ON "people_groups" USING btree ("order");
  CREATE INDEX "people_groups_parent_idx" ON "people_groups" USING btree ("parent_id");
  CREATE INDEX "_people_v_version_groups_order_idx" ON "_people_v_version_groups" USING btree ("order");
  CREATE INDEX "_people_v_version_groups_parent_idx" ON "_people_v_version_groups" USING btree ("parent_id");

  -- Раздел по составам: в «Действующих лицах» (cast) — актёры, в «Создателях» (credits) — создатели.
  CREATE TEMP TABLE "_credited" ON COMMIT DROP AS
    SELECT DISTINCT people_id AS pid, 'actors' AS v, 1 AS o FROM (
      SELECT people_id, path FROM "shows_rels" UNION ALL SELECT people_id, path FROM "archive_rels"
    ) r WHERE people_id IS NOT NULL AND path LIKE 'cast.%'
    UNION
    SELECT DISTINCT people_id, 'creators', 2 FROM (
      SELECT people_id, path FROM "shows_rels" UNION ALL SELECT people_id, path FROM "archive_rels"
    ) r WHERE people_id IS NOT NULL AND path LIKE 'credits.%';

  -- Руководство — из прежней галочки «Руководство театра».
  INSERT INTO "people_groups" ("order", "parent_id", "value")
  SELECT row_number() OVER (PARTITION BY g.pid ORDER BY g.o), g.pid, g.v::"enum_people_groups"
  FROM (
    SELECT pid, v, o FROM "_credited" WHERE pid IN (SELECT id FROM "people")
    UNION SELECT id, 'leadership', 3 FROM "people" WHERE "leadership"
  ) g;

  INSERT INTO "_people_v_version_groups" ("order", "parent_id", "value")
  SELECT row_number() OVER (PARTITION BY g.vid ORDER BY g.o), g.vid, g.v::"enum__people_v_version_groups"
  FROM (
    SELECT v.id AS vid, c.v, c.o FROM "_people_v" v JOIN "_credited" c ON c.pid = v.parent_id
    UNION SELECT id, 'leadership', 3 FROM "_people_v" WHERE "version_leadership"
  ) g;

  ALTER TABLE "people" DROP COLUMN "leadership";
  ALTER TABLE "_people_v" DROP COLUMN "version_leadership";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "people" ADD COLUMN "leadership" boolean;
  ALTER TABLE "_people_v" ADD COLUMN "version_leadership" boolean;
  UPDATE "people" SET "leadership" = true
    WHERE id IN (SELECT parent_id FROM "people_groups" WHERE value = 'leadership');
  UPDATE "_people_v" SET "version_leadership" = true
    WHERE id IN (SELECT parent_id FROM "_people_v_version_groups" WHERE value = 'leadership');
  DROP TABLE "people_groups" CASCADE;
  DROP TABLE "_people_v_version_groups" CASCADE;
  DROP TYPE "public"."enum_people_groups";
  DROP TYPE "public"."enum__people_v_version_groups";`)
}
