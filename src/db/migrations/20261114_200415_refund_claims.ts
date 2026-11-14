import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "commerce_refund_claims" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"number" text NOT NULL,
  	"order_id" uuid NOT NULL,
  	"customer_id" uuid NOT NULL,
  	"reason" text NOT NULL,
  	"comment" text,
  	"status" text NOT NULL,
  	"starts_at" timestamp with time zone NOT NULL,
  	"legal_percent" integer NOT NULL,
  	"basis" text NOT NULL,
  	"include_fee" boolean NOT NULL,
  	"document_required" boolean NOT NULL,
  	"document_deadline" timestamp with time zone,
  	"decided_percent" integer,
  	"decision_comment" text,
  	"decided_by" text,
  	"decided_at" timestamp with time zone,
  	"refund_id" uuid,
  	"created_at" timestamp with time zone NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_refund_claims_number_unique" UNIQUE("number"),
  	CONSTRAINT "commerce_refund_claims_percent" CHECK ("commerce_refund_claims"."legal_percent" BETWEEN 0 AND 100 AND ("commerce_refund_claims"."decided_percent" IS NULL OR "commerce_refund_claims"."decided_percent" BETWEEN 1 AND 100)),
  	CONSTRAINT "commerce_refund_claims_decided_shape" CHECK (("commerce_refund_claims"."status" IN ('APPROVED', 'REJECTED')) = ("commerce_refund_claims"."decided_at" IS NOT NULL) AND ("commerce_refund_claims"."status" = 'APPROVED') = ("commerce_refund_claims"."refund_id" IS NOT NULL))
  );
  
  CREATE TABLE "commerce_refund_claim_tickets" (
  	"claim_id" uuid NOT NULL,
  	"ticket_id" uuid NOT NULL,
  	"open" boolean NOT NULL,
  	CONSTRAINT "commerce_refund_claim_tickets_claim_id_ticket_id_pk" PRIMARY KEY("claim_id","ticket_id")
  );
  
  CREATE TABLE "commerce_refund_claim_files" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"claim_id" uuid NOT NULL,
  	"original_name" text NOT NULL,
  	"mime_type" text NOT NULL,
  	"size_bytes" integer NOT NULL,
  	"storage_key" text NOT NULL,
  	"uploaded_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_refund_claim_files_storage_key_unique" UNIQUE("storage_key"),
  	CONSTRAINT "commerce_refund_claim_files_size" CHECK ("commerce_refund_claim_files"."size_bytes" > 0)
  );
  
  ALTER TABLE "ticket_types" ADD COLUMN "promo" boolean DEFAULT false;
  ALTER TABLE "commerce_refund_claims" ADD CONSTRAINT "commerce_refund_claims_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_claims" ADD CONSTRAINT "commerce_refund_claims_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_claims" ADD CONSTRAINT "commerce_refund_claims_refund_id_commerce_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."commerce_refunds"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_claim_tickets" ADD CONSTRAINT "commerce_refund_claim_tickets_ticket_id_commerce_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."commerce_tickets"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_claim_tickets" ADD CONSTRAINT "commerce_refund_claim_tickets_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."commerce_refund_claims"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "commerce_refund_claim_files" ADD CONSTRAINT "commerce_refund_claim_files_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."commerce_refund_claims"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "commerce_refund_claims_status_idx" ON "commerce_refund_claims" USING btree ("status","created_at");
  CREATE INDEX "commerce_refund_claims_customer_idx" ON "commerce_refund_claims" USING btree ("customer_id","created_at");
  CREATE INDEX "commerce_refund_claims_order_idx" ON "commerce_refund_claims" USING btree ("order_id");
  CREATE UNIQUE INDEX "commerce_refund_claim_tickets_open_uq" ON "commerce_refund_claim_tickets" USING btree ("ticket_id") WHERE "commerce_refund_claim_tickets"."open";
  CREATE INDEX "commerce_refund_claim_files_claim_idx" ON "commerce_refund_claim_files" USING btree ("claim_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "commerce_refund_claims" CASCADE;
  DROP TABLE "commerce_refund_claim_tickets" CASCADE;
  DROP TABLE "commerce_refund_claim_files" CASCADE;
  ALTER TABLE "ticket_types" DROP COLUMN "promo";`)
}
