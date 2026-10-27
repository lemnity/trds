import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "people_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"shows_id" integer,
  	"archive_id" integer
  );
  
  CREATE TABLE "_people_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"shows_id" integer,
  	"archive_id" integer
  );
  
  ALTER TABLE "people_works" ADD COLUMN "character" varchar;
  ALTER TABLE "_people_v_version_works" ADD COLUMN "character" varchar;
  ALTER TABLE "people_rels" ADD CONSTRAINT "people_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "people_rels" ADD CONSTRAINT "people_rels_shows_fk" FOREIGN KEY ("shows_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "people_rels" ADD CONSTRAINT "people_rels_archive_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_people_v_rels" ADD CONSTRAINT "_people_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_people_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_people_v_rels" ADD CONSTRAINT "_people_v_rels_shows_fk" FOREIGN KEY ("shows_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_people_v_rels" ADD CONSTRAINT "_people_v_rels_archive_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "people_rels_order_idx" ON "people_rels" USING btree ("order");
  CREATE INDEX "people_rels_parent_idx" ON "people_rels" USING btree ("parent_id");
  CREATE INDEX "people_rels_path_idx" ON "people_rels" USING btree ("path");
  CREATE INDEX "people_rels_shows_id_idx" ON "people_rels" USING btree ("shows_id");
  CREATE INDEX "people_rels_archive_id_idx" ON "people_rels" USING btree ("archive_id");
  CREATE INDEX "_people_v_rels_order_idx" ON "_people_v_rels" USING btree ("order");
  CREATE INDEX "_people_v_rels_parent_idx" ON "_people_v_rels" USING btree ("parent_id");
  CREATE INDEX "_people_v_rels_path_idx" ON "_people_v_rels" USING btree ("path");
  CREATE INDEX "_people_v_rels_shows_id_idx" ON "_people_v_rels" USING btree ("shows_id");
  CREATE INDEX "_people_v_rels_archive_id_idx" ON "_people_v_rels" USING btree ("archive_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "people_rels" CASCADE;
  DROP TABLE "_people_v_rels" CASCADE;
  ALTER TABLE "people_works" DROP COLUMN "character";
  ALTER TABLE "_people_v_version_works" DROP COLUMN "character";`)
}
