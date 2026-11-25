import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "reviews_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  CREATE TABLE "_reviews_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  ALTER TABLE "reviews" ADD COLUMN "show_id" integer;
  ALTER TABLE "_reviews_v" ADD COLUMN "version_show_id" integer;
  ALTER TABLE "reviews_rels" ADD CONSTRAINT "reviews_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "reviews_rels" ADD CONSTRAINT "reviews_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_reviews_v_rels" ADD CONSTRAINT "_reviews_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_reviews_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_reviews_v_rels" ADD CONSTRAINT "_reviews_v_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "reviews_rels_order_idx" ON "reviews_rels" USING btree ("order");
  CREATE INDEX "reviews_rels_parent_idx" ON "reviews_rels" USING btree ("parent_id");
  CREATE INDEX "reviews_rels_path_idx" ON "reviews_rels" USING btree ("path");
  CREATE INDEX "reviews_rels_people_id_idx" ON "reviews_rels" USING btree ("people_id");
  CREATE INDEX "_reviews_v_rels_order_idx" ON "_reviews_v_rels" USING btree ("order");
  CREATE INDEX "_reviews_v_rels_parent_idx" ON "_reviews_v_rels" USING btree ("parent_id");
  CREATE INDEX "_reviews_v_rels_path_idx" ON "_reviews_v_rels" USING btree ("path");
  CREATE INDEX "_reviews_v_rels_people_id_idx" ON "_reviews_v_rels" USING btree ("people_id");
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_reviews_v" ADD CONSTRAINT "_reviews_v_version_show_id_shows_id_fk" FOREIGN KEY ("version_show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "reviews_show_idx" ON "reviews" USING btree ("show_id");
  CREATE INDEX "_reviews_v_version_version_show_idx" ON "_reviews_v" USING btree ("version_show_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "reviews_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_reviews_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "reviews_rels" CASCADE;
  DROP TABLE "_reviews_v_rels" CASCADE;
  ALTER TABLE "reviews" DROP CONSTRAINT "reviews_show_id_shows_id_fk";
  
  ALTER TABLE "_reviews_v" DROP CONSTRAINT "_reviews_v_version_show_id_shows_id_fk";
  
  DROP INDEX "reviews_show_idx";
  DROP INDEX "_reviews_v_version_version_show_idx";
  ALTER TABLE "reviews" DROP COLUMN "show_id";
  ALTER TABLE "_reviews_v" DROP COLUMN "version_show_id";`)
}
