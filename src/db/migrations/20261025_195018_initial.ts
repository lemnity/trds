import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_shows_event_type" AS ENUM('spectacle', 'immersive', 'performance', 'concert', 'promenade');
  CREATE TYPE "public"."enum_shows_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__shows_v_version_event_type" AS ENUM('spectacle', 'immersive', 'performance', 'concert', 'promenade');
  CREATE TYPE "public"."enum__shows_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_performances_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury');
  CREATE TYPE "public"."enum_performances_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__performances_v_version_seating_plan_id" AS ENUM('dom-aktera', 'dom-kultury');
  CREATE TYPE "public"."enum__performances_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_venues_kind" AS ENUM('bar', 'restaurant', 'loft', 'apartment', 'stage', 'city');
  CREATE TYPE "public"."enum_venues_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__venues_v_version_kind" AS ENUM('bar', 'restaurant', 'loft', 'apartment', 'stage', 'city');
  CREATE TYPE "public"."enum__venues_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_archive_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__archive_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_people_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__people_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_news_tag" AS ENUM('Премьера', 'Анонс');
  CREATE TYPE "public"."enum_news_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__news_v_version_tag" AS ENUM('Премьера', 'Анонс');
  CREATE TYPE "public"."enum__news_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_reviews_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__reviews_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_partners_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__partners_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__pages_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_documents_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__documents_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_admin_users_role" AS ENUM('admin', 'editor', 'cashier');
  CREATE TABLE "accounts_customers" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"email" text NOT NULL,
  	"name" text,
  	"password_hash" text,
  	"created_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "accounts_customers_email_unique" UNIQUE("email")
  );
  
  CREATE TABLE "accounts_auth_codes" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"email" text NOT NULL,
  	"code_hash" text NOT NULL,
  	"purpose" text NOT NULL,
  	"name" text,
  	"password_hash" text,
  	"attempts" integer DEFAULT 0 NOT NULL,
  	"expires_at" timestamp with time zone NOT NULL,
  	"consumed_at" timestamp with time zone,
  	"created_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "accounts_sessions" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"token_hash" text NOT NULL,
  	"customer_id" uuid NOT NULL,
  	"expires_at" timestamp with time zone NOT NULL,
  	"revoked_at" timestamp with time zone,
  	"created_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "accounts_sessions_token_hash_unique" UNIQUE("token_hash")
  );
  
  CREATE TABLE "accounts_consents" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"email" text NOT NULL,
  	"document" text NOT NULL,
  	"version" text NOT NULL,
  	"context" text NOT NULL,
  	"given_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "accounts_identities" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"customer_id" uuid NOT NULL,
  	"provider" text NOT NULL,
  	"subject" text NOT NULL,
  	"created_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "wallet_ledger" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"customer_id" uuid NOT NULL,
  	"kind" text NOT NULL,
  	"amount_kopecks" bigint NOT NULL,
  	"lot_remaining_kopecks" bigint,
  	"expires_at" timestamp with time zone,
  	"source_ref" text,
  	"idempotency_key" text NOT NULL,
  	"related_entry_id" uuid,
  	"created_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "wallet_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
  	CONSTRAINT "wallet_ledger_amount_nonzero" CHECK ("wallet_ledger"."amount_kopecks" <> 0),
  	CONSTRAINT "wallet_ledger_lot_shape" CHECK (("wallet_ledger"."amount_kopecks" > 0) = ("wallet_ledger"."lot_remaining_kopecks" IS NOT NULL AND "wallet_ledger"."expires_at" IS NOT NULL)),
  	CONSTRAINT "wallet_ledger_lot_remaining" CHECK ("wallet_ledger"."lot_remaining_kopecks" IS NULL OR ("wallet_ledger"."lot_remaining_kopecks" >= 0 AND "wallet_ledger"."lot_remaining_kopecks" <= "wallet_ledger"."amount_kopecks"))
  );
  
  CREATE TABLE "wallet_spend_allocations" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"spend_entry_id" uuid NOT NULL,
  	"lot_entry_id" uuid NOT NULL,
  	"kopecks" bigint NOT NULL,
  	CONSTRAINT "wallet_spend_allocations_positive" CHECK ("wallet_spend_allocations"."kopecks" > 0)
  );
  
  CREATE TABLE "wallet_certificates" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"serial" integer GENERATED ALWAYS AS IDENTITY (sequence name "wallet_certificates_serial_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  	"code_hash" text NOT NULL,
  	"last4" text NOT NULL,
  	"amount_kopecks" bigint NOT NULL,
  	"status" text NOT NULL,
  	"valid_until" timestamp with time zone,
  	"issued_by" text NOT NULL,
  	"comment" text,
  	"activated_by_customer" uuid,
  	"activated_at" timestamp with time zone,
  	"created_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "wallet_certificates_serial_unique" UNIQUE("serial"),
  	CONSTRAINT "wallet_certificates_code_hash_unique" UNIQUE("code_hash"),
  	CONSTRAINT "wallet_certificates_amount_positive" CHECK ("wallet_certificates"."amount_kopecks" > 0),
  	CONSTRAINT "wallet_certificates_activation_shape" CHECK (("wallet_certificates"."status" = 'activated') = ("wallet_certificates"."activated_by_customer" IS NOT NULL AND "wallet_certificates"."activated_at" IS NOT NULL))
  );
  
  CREATE TABLE "wallet_referral_codes" (
  	"customer_id" uuid PRIMARY KEY NOT NULL,
  	"code" text NOT NULL,
  	"created_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "wallet_referral_codes_code_unique" UNIQUE("code")
  );
  
  CREATE TABLE "wallet_referrals" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"referrer_id" uuid NOT NULL,
  	"referred_customer_id" uuid NOT NULL,
  	"attached_at" timestamp with time zone NOT NULL,
  	"qualified_at" timestamp with time zone,
  	"reward_entry_id" uuid,
  	CONSTRAINT "wallet_referrals_referred_customer_id_unique" UNIQUE("referred_customer_id"),
  	CONSTRAINT "wallet_referrals_not_self" CHECK ("wallet_referrals"."referrer_id" <> "wallet_referrals"."referred_customer_id")
  );
  
  CREATE TABLE "leads_requests" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"status" text DEFAULT 'new' NOT NULL,
  	"format" text NOT NULL,
  	"name" text NOT NULL,
  	"email" text,
  	"phone" text,
  	"event_date" date,
  	"guests" integer,
  	"budget" text,
  	"comment" text,
  	"source" text NOT NULL,
  	"idempotency_key" text NOT NULL,
  	"payload_hash" text NOT NULL,
  	"duplicate_of" uuid,
  	"assignee" text,
  	"created_at" timestamp with time zone NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "leads_requests_idempotency_key_unique" UNIQUE("idempotency_key"),
  	CONSTRAINT "leads_requests_contact" CHECK ("leads_requests"."email" IS NOT NULL OR "leads_requests"."phone" IS NOT NULL),
  	CONSTRAINT "leads_requests_guests" CHECK ("leads_requests"."guests" IS NULL OR ("leads_requests"."guests" >= 1 AND "leads_requests"."guests" <= 1000)),
  	CONSTRAINT "leads_requests_status" CHECK ("leads_requests"."status" IN ('new', 'in_progress', 'done', 'archived'))
  );
  
  CREATE TABLE "leads_status_history" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"lead_id" uuid NOT NULL,
  	"from_status" text,
  	"to_status" text NOT NULL,
  	"actor" text,
  	"created_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "consent_journal" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"document" text NOT NULL,
  	"version" text NOT NULL,
  	"context" text NOT NULL,
  	"subject_ref" text NOT NULL,
  	"given_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "commerce_inventory" (
  	"performance_id" text NOT NULL,
  	"ticket_type_id" text NOT NULL,
  	"capacity" integer NOT NULL,
  	"sold" integer DEFAULT 0 NOT NULL,
  	"held" integer DEFAULT 0 NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_inventory_performance_id_ticket_type_id_pk" PRIMARY KEY("performance_id","ticket_type_id"),
  	CONSTRAINT "commerce_inventory_capacity_nonneg" CHECK ("commerce_inventory"."capacity" >= 0),
  	CONSTRAINT "commerce_inventory_sold_nonneg" CHECK ("commerce_inventory"."sold" >= 0),
  	CONSTRAINT "commerce_inventory_held_nonneg" CHECK ("commerce_inventory"."held" >= 0),
  	CONSTRAINT "commerce_inventory_within_capacity" CHECK ("commerce_inventory"."sold" + "commerce_inventory"."held" <= "commerce_inventory"."capacity")
  );
  
  CREATE TABLE "commerce_orders" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"number" text NOT NULL,
  	"customer_id" uuid,
  	"email" text NOT NULL,
  	"status" text NOT NULL,
  	"gross_kopecks" bigint NOT NULL,
  	"bonus_kopecks" bigint NOT NULL,
  	"fee_kopecks" bigint NOT NULL,
  	"cash_kopecks" bigint NOT NULL,
  	"currency" text DEFAULT 'RUB' NOT NULL,
  	"hold_until" timestamp with time zone,
  	"idempotency_key" text NOT NULL,
  	"request_hash" text NOT NULL,
  	"payment_provider" text,
  	"provider_payment_id" text,
  	"review_reason" text,
  	"paid_at" timestamp with time zone,
  	"closed_at" timestamp with time zone,
  	"created_at" timestamp with time zone NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_orders_number_unique" UNIQUE("number"),
  	CONSTRAINT "commerce_orders_idempotency_key_unique" UNIQUE("idempotency_key"),
  	CONSTRAINT "commerce_orders_amounts_nonneg" CHECK ("commerce_orders"."gross_kopecks" >= 0 AND "commerce_orders"."bonus_kopecks" >= 0 AND "commerce_orders"."fee_kopecks" >= 0 AND "commerce_orders"."cash_kopecks" >= 0),
  	CONSTRAINT "commerce_orders_bonus_within_gross" CHECK ("commerce_orders"."bonus_kopecks" <= "commerce_orders"."gross_kopecks"),
  	CONSTRAINT "commerce_orders_cash_formula" CHECK ("commerce_orders"."cash_kopecks" = "commerce_orders"."gross_kopecks" - "commerce_orders"."bonus_kopecks" + "commerce_orders"."fee_kopecks"),
  	CONSTRAINT "commerce_orders_currency" CHECK ("commerce_orders"."currency" = 'RUB'),
  	CONSTRAINT "commerce_orders_pending_has_hold" CHECK ("commerce_orders"."status" <> 'PENDING_PAYMENT' OR "commerce_orders"."hold_until" IS NOT NULL),
  	CONSTRAINT "commerce_orders_paid_at" CHECK ("commerce_orders"."status" <> 'PAID' OR "commerce_orders"."paid_at" IS NOT NULL)
  );
  
  CREATE TABLE "commerce_seats" (
  	"performance_id" text NOT NULL,
  	"seat_id" text NOT NULL,
  	"plan_id" text NOT NULL,
  	"plan_version" integer NOT NULL,
  	"category_id" text NOT NULL,
  	"status" text NOT NULL,
  	"hold_id" uuid,
  	"order_id" uuid,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_seats_performance_id_seat_id_pk" PRIMARY KEY("performance_id","seat_id"),
  	CONSTRAINT "commerce_seats_hold_shape" CHECK (("commerce_seats"."status" = 'held') = ("commerce_seats"."hold_id" IS NOT NULL)),
  	CONSTRAINT "commerce_seats_order_shape" CHECK (("commerce_seats"."status" IN ('held', 'sold')) = ("commerce_seats"."order_id" IS NOT NULL))
  );
  
  CREATE TABLE "commerce_holds" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"order_id" uuid NOT NULL,
  	"status" text NOT NULL,
  	"expires_at" timestamp with time zone NOT NULL,
  	"created_at" timestamp with time zone NOT NULL,
  	"closed_at" timestamp with time zone,
  	CONSTRAINT "commerce_holds_order_id_unique" UNIQUE("order_id"),
  	CONSTRAINT "commerce_holds_closed_shape" CHECK (("commerce_holds"."status" = 'ACTIVE') = ("commerce_holds"."closed_at" IS NULL))
  );
  
  CREATE TABLE "commerce_order_items" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"order_id" uuid NOT NULL,
  	"performance_id" text NOT NULL,
  	"ticket_type_id" text NOT NULL,
  	"seat_id" text,
  	"title_snapshot" text NOT NULL,
  	"show_title_snapshot" text,
  	"show_slug_snapshot" text,
  	"starts_at_snapshot" timestamp with time zone,
  	"venue_title_snapshot" text,
  	"venue_address_snapshot" text,
  	"unit_price_kopecks" bigint NOT NULL,
  	"quantity" integer NOT NULL,
  	"line_gross_kopecks" bigint NOT NULL,
  	"line_bonus_kopecks" bigint NOT NULL,
  	"line_cash_kopecks" bigint NOT NULL,
  	"line_fee_kopecks" bigint NOT NULL,
  	CONSTRAINT "commerce_order_items_quantity" CHECK ("commerce_order_items"."quantity" > 0),
  	CONSTRAINT "commerce_order_items_seat_single" CHECK ("commerce_order_items"."seat_id" IS NULL OR "commerce_order_items"."quantity" = 1),
  	CONSTRAINT "commerce_order_items_amounts" CHECK ("commerce_order_items"."unit_price_kopecks" >= 0 AND "commerce_order_items"."line_bonus_kopecks" >= 0 AND "commerce_order_items"."line_fee_kopecks" >= 0),
  	CONSTRAINT "commerce_order_items_gross" CHECK ("commerce_order_items"."line_gross_kopecks" = "commerce_order_items"."unit_price_kopecks" * "commerce_order_items"."quantity"),
  	CONSTRAINT "commerce_order_items_cash" CHECK ("commerce_order_items"."line_bonus_kopecks" <= "commerce_order_items"."line_gross_kopecks" AND "commerce_order_items"."line_cash_kopecks" = "commerce_order_items"."line_gross_kopecks" - "commerce_order_items"."line_bonus_kopecks")
  );
  
  CREATE TABLE "commerce_tickets" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"number" text NOT NULL,
  	"order_id" uuid NOT NULL,
  	"order_item_id" uuid NOT NULL,
  	"performance_id" text NOT NULL,
  	"ticket_type_id" text NOT NULL,
  	"seat_id" text,
  	"token_hash" text NOT NULL,
  	"token_version" integer NOT NULL,
  	"status" text NOT NULL,
  	"price_kopecks" bigint NOT NULL,
  	"bonus_kopecks" bigint NOT NULL,
  	"cash_kopecks" bigint NOT NULL,
  	"fee_kopecks" bigint NOT NULL,
  	"issued_at" timestamp with time zone NOT NULL,
  	"refunded_at" timestamp with time zone,
  	CONSTRAINT "commerce_tickets_number_unique" UNIQUE("number"),
  	CONSTRAINT "commerce_tickets_token_hash_unique" UNIQUE("token_hash"),
  	CONSTRAINT "commerce_tickets_amounts" CHECK ("commerce_tickets"."price_kopecks" >= 0 AND "commerce_tickets"."bonus_kopecks" >= 0 AND "commerce_tickets"."fee_kopecks" >= 0 AND "commerce_tickets"."bonus_kopecks" <= "commerce_tickets"."price_kopecks" AND "commerce_tickets"."cash_kopecks" = "commerce_tickets"."price_kopecks" - "commerce_tickets"."bonus_kopecks"),
  	CONSTRAINT "commerce_tickets_refunded_shape" CHECK (("commerce_tickets"."status" = 'REFUNDED') = ("commerce_tickets"."refunded_at" IS NOT NULL))
  );
  
  CREATE TABLE "commerce_payment_events" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"provider" text NOT NULL,
  	"provider_payment_id" text NOT NULL,
  	"event_id" text NOT NULL,
  	"order_id" uuid,
  	"event_type" text NOT NULL,
  	"payload" jsonb NOT NULL,
  	"correlation_id" text,
  	"received_at" timestamp with time zone NOT NULL,
  	"processed_at" timestamp with time zone,
  	"result" text
  );
  
  CREATE TABLE "commerce_refunds" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"order_id" uuid NOT NULL,
  	"status" text NOT NULL,
  	"kind" text DEFAULT 'customer' NOT NULL,
  	"cash_kopecks" bigint NOT NULL,
  	"bonus_kopecks" bigint NOT NULL,
  	"fee_kopecks" bigint NOT NULL,
  	"bonus_reversal_kopecks" bigint DEFAULT 0 NOT NULL,
  	"idempotency_key" text NOT NULL,
  	"provider" text,
  	"provider_refund_id" text,
  	"provider_status" text,
  	"attempts" integer DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp with time zone,
  	"last_error" text,
  	"reason" text NOT NULL,
  	"requested_by" text NOT NULL,
  	"correlation_id" text,
  	"completed_at" timestamp with time zone,
  	"bonus_settled_at" timestamp with time zone,
  	"created_at" timestamp with time zone NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "commerce_refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
  	CONSTRAINT "commerce_refunds_amounts" CHECK ("commerce_refunds"."cash_kopecks" >= 0 AND "commerce_refunds"."bonus_kopecks" >= 0 AND "commerce_refunds"."fee_kopecks" >= 0 AND "commerce_refunds"."fee_kopecks" <= "commerce_refunds"."cash_kopecks" AND "commerce_refunds"."bonus_reversal_kopecks" >= 0),
  	CONSTRAINT "commerce_refunds_attempts_nonneg" CHECK ("commerce_refunds"."attempts" >= 0),
  	CONSTRAINT "commerce_refunds_completed_shape" CHECK (("commerce_refunds"."status" IN ('SUCCEEDED', 'FAILED')) = ("commerce_refunds"."completed_at" IS NOT NULL))
  );
  
  CREATE TABLE "commerce_refund_tickets" (
  	"refund_id" uuid NOT NULL,
  	"ticket_id" uuid NOT NULL,
  	"cash_kopecks" bigint NOT NULL,
  	"bonus_kopecks" bigint NOT NULL,
  	"fee_kopecks" bigint NOT NULL,
  	"voided_at" timestamp with time zone,
  	CONSTRAINT "commerce_refund_tickets_refund_id_ticket_id_pk" PRIMARY KEY("refund_id","ticket_id"),
  	CONSTRAINT "commerce_refund_tickets_amounts" CHECK ("commerce_refund_tickets"."cash_kopecks" >= 0 AND "commerce_refund_tickets"."bonus_kopecks" >= 0 AND "commerce_refund_tickets"."fee_kopecks" >= 0)
  );
  
  CREATE TABLE "commerce_outbox" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"kind" text NOT NULL,
  	"dedupe_key" text NOT NULL,
  	"aggregate_id" text NOT NULL,
  	"payload" jsonb NOT NULL,
  	"status" text NOT NULL,
  	"attempts" integer DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp with time zone NOT NULL,
  	"last_error" text,
  	"created_at" timestamp with time zone NOT NULL,
  	"processed_at" timestamp with time zone,
  	CONSTRAINT "commerce_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
  	CONSTRAINT "commerce_outbox_attempts_nonneg" CHECK ("commerce_outbox"."attempts" >= 0)
  );
  
  CREATE TABLE "commerce_settings" (
  	"key" text PRIMARY KEY NOT NULL,
  	"value" jsonb NOT NULL,
  	"updated_by" text NOT NULL,
  	"updated_at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "commerce_audit_log" (
  	"id" uuid PRIMARY KEY NOT NULL,
  	"actor" text NOT NULL,
  	"action" text NOT NULL,
  	"entity" text NOT NULL,
  	"entity_id" text NOT NULL,
  	"reason" text,
  	"result" text NOT NULL,
  	"correlation_id" text,
  	"at" timestamp with time zone NOT NULL
  );
  
  CREATE TABLE "ops_rate_limits" (
  	"key_hash" text NOT NULL,
  	"window_start" timestamp with time zone NOT NULL,
  	"bucket" text NOT NULL,
  	"hits" integer NOT NULL,
  	"expires_at" timestamp with time zone NOT NULL,
  	CONSTRAINT "ops_rate_limits_key_hash_window_start_pk" PRIMARY KEY("key_hash","window_start")
  );
  
  CREATE TABLE "shows_credits_entries" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"character" varchar
  );
  
  CREATE TABLE "shows_credits" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"role" varchar
  );
  
  CREATE TABLE "shows_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"image_url" varchar
  );
  
  CREATE TABLE "shows" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar,
  	"title" varchar,
  	"event_type" "enum_shows_event_type" DEFAULT 'spectacle',
  	"genre" varchar,
  	"age_limit" numeric,
  	"duration_minutes" numeric,
  	"premiere" boolean,
  	"pushkin_card" boolean,
  	"student_offer" boolean,
  	"announced_at" timestamp(3) with time zone,
  	"lead" varchar,
  	"description" varchar,
  	"poster_id" integer,
  	"poster_url" varchar,
  	"cover_id" integer,
  	"cover_url" varchar,
  	"cover_focus" varchar,
  	"preview_id" integer,
  	"preview_url" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_shows_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "shows_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  CREATE TABLE "_shows_v_version_credits_entries" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"character" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_shows_v_version_credits" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_shows_v_version_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"image_url" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_shows_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_slug" varchar,
  	"version_title" varchar,
  	"version_event_type" "enum__shows_v_version_event_type" DEFAULT 'spectacle',
  	"version_genre" varchar,
  	"version_age_limit" numeric,
  	"version_duration_minutes" numeric,
  	"version_premiere" boolean,
  	"version_pushkin_card" boolean,
  	"version_student_offer" boolean,
  	"version_announced_at" timestamp(3) with time zone,
  	"version_lead" varchar,
  	"version_description" varchar,
  	"version_poster_id" integer,
  	"version_poster_url" varchar,
  	"version_cover_id" integer,
  	"version_cover_url" varchar,
  	"version_cover_focus" varchar,
  	"version_preview_id" integer,
  	"version_preview_url" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__shows_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_shows_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  CREATE TABLE "performances_seating_prices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"category_id" varchar,
  	"price_kopecks" numeric
  );
  
  CREATE TABLE "performances" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar,
  	"show_id" integer,
  	"venue_id" integer,
  	"starts_at" timestamp(3) with time zone,
  	"sales_start_at" timestamp(3) with time zone,
  	"sales_end_at" timestamp(3) with time zone,
  	"seating_plan_id" "enum_performances_seating_plan_id",
  	"seating_prices_placeholder" boolean,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_performances_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "performances_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_performances_v_version_seating_prices" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"category_id" varchar,
  	"price_kopecks" numeric,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_performances_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_code" varchar,
  	"version_show_id" integer,
  	"version_venue_id" integer,
  	"version_starts_at" timestamp(3) with time zone,
  	"version_sales_start_at" timestamp(3) with time zone,
  	"version_sales_end_at" timestamp(3) with time zone,
  	"version_seating_plan_id" "enum__performances_v_version_seating_plan_id",
  	"version_seating_prices_placeholder" boolean,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__performances_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_performances_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "venues" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar,
  	"title" varchar,
  	"kind" "enum_venues_kind",
  	"address" varchar,
  	"lat" numeric,
  	"lon" numeric,
  	"directions" varchar,
  	"accessibility_notes" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_venues_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_venues_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_code" varchar,
  	"version_title" varchar,
  	"version_kind" "enum__venues_v_version_kind",
  	"version_address" varchar,
  	"version_lat" numeric,
  	"version_lon" numeric,
  	"version_directions" varchar,
  	"version_accessibility_notes" varchar,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__venues_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "archive_credits_entries" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"character" varchar
  );
  
  CREATE TABLE "archive_credits" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"role" varchar
  );
  
  CREATE TABLE "archive" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"genre" varchar,
  	"poster_id" integer,
  	"poster_url" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_archive_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "archive_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  CREATE TABLE "_archive_v_version_credits_entries" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"character" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_archive_v_version_credits" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_archive_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_genre" varchar,
  	"version_poster_id" integer,
  	"version_poster_url" varchar,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__archive_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_archive_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"people_id" integer
  );
  
  CREATE TABLE "ticket_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"performance_id" integer NOT NULL,
  	"code" varchar DEFAULT 'standard' NOT NULL,
  	"title" varchar NOT NULL,
  	"price_kopecks" numeric NOT NULL,
  	"capacity" numeric NOT NULL,
  	"placeholder" boolean,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "people_works" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar
  );
  
  CREATE TABLE "people" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"slug" varchar,
  	"portrait_id" integer,
  	"position" varchar,
  	"bio_title" varchar,
  	"bio" varchar,
  	"quote_text" varchar,
  	"quote_about" varchar,
  	"slide_id" integer,
  	"slide_url" varchar,
  	"leadership" boolean,
  	"sort_order" numeric DEFAULT 0,
  	"source" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_people_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_people_v_version_works" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_people_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar,
  	"version_slug" varchar,
  	"version_portrait_id" integer,
  	"version_position" varchar,
  	"version_bio_title" varchar,
  	"version_bio" varchar,
  	"version_quote_text" varchar,
  	"version_quote_about" varchar,
  	"version_slide_id" integer,
  	"version_slide_url" varchar,
  	"version_leadership" boolean,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_source" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__people_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "news" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"tag" "enum_news_tag" DEFAULT 'Анонс',
  	"summary" varchar,
  	"body" varchar,
  	"cover_id" integer,
  	"cover_url" varchar,
  	"href" varchar,
  	"published_at" timestamp(3) with time zone,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_news_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_news_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_tag" "enum__news_v_version_tag" DEFAULT 'Анонс',
  	"version_summary" varchar,
  	"version_body" varchar,
  	"version_cover_id" integer,
  	"version_cover_url" varchar,
  	"version_href" varchar,
  	"version_published_at" timestamp(3) with time zone,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__news_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "reviews" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"author" varchar,
  	"slug" varchar,
  	"role" varchar,
  	"lead" varchar,
  	"quote" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_reviews_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_reviews_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_author" varchar,
  	"version_slug" varchar,
  	"version_role" varchar,
  	"version_lead" varchar,
  	"version_quote" varchar,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__reviews_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "partners" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"role" varchar,
  	"logo_id" integer,
  	"url" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_partners_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_partners_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar,
  	"version_role" varchar,
  	"version_logo_id" integer,
  	"version_url" varchar,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__partners_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "pages_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"image_url" varchar
  );
  
  CREATE TABLE "pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"lead" varchar,
  	"body" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_pages_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_pages_v_version_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"image_url" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_lead" varchar,
  	"version_body" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__pages_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"body" varchar,
  	"file_id" integer,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_documents_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_documents_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_body" varchar,
  	"version_file_id" integer,
  	"version_sort_order" numeric DEFAULT 0,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__documents_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"credit" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_card_url" varchar,
  	"sizes_card_width" numeric,
  	"sizes_card_height" numeric,
  	"sizes_card_mime_type" varchar,
  	"sizes_card_filesize" numeric,
  	"sizes_card_filename" varchar,
  	"sizes_cover_url" varchar,
  	"sizes_cover_width" numeric,
  	"sizes_cover_height" numeric,
  	"sizes_cover_mime_type" varchar,
  	"sizes_cover_filesize" numeric,
  	"sizes_cover_filename" varchar
  );
  
  CREATE TABLE "admin_users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "admin_users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"role" "enum_admin_users_role" DEFAULT 'editor' NOT NULL,
  	"system_admin" boolean DEFAULT false,
  	"mfa_enabled" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "admin_mfa" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"secret" varchar,
  	"pending_secret" varchar,
  	"last_step" numeric,
  	"failed_attempts" numeric DEFAULT 0,
  	"locked_until" timestamp(3) with time zone,
  	"enabled_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "admin_mfa_recovery_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"hash" varchar NOT NULL,
  	"used_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"shows_id" integer,
  	"performances_id" integer,
  	"venues_id" integer,
  	"archive_id" integer,
  	"ticket_types_id" integer,
  	"people_id" integer,
  	"news_id" integer,
  	"reviews_id" integer,
  	"partners_id" integer,
  	"pages_id" integer,
  	"documents_id" integer,
  	"media_id" integer,
  	"admin_users_id" integer,
  	"admin_mfa_id" integer,
  	"admin_mfa_recovery_codes_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"admin_users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "site_settings_social" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"handle" varchar NOT NULL,
  	"href" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"theatre_name" varchar NOT NULL,
  	"slogan" varchar,
  	"contacts_phone" varchar NOT NULL,
  	"contacts_email" varchar NOT NULL,
  	"contacts_office_address" varchar NOT NULL,
  	"contacts_office_short" varchar NOT NULL,
  	"contacts_hours" varchar NOT NULL,
  	"contacts_map_url" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_site_settings_v_version_social" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"handle" varchar NOT NULL,
  	"href" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_site_settings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_theatre_name" varchar NOT NULL,
  	"version_slogan" varchar,
  	"version_contacts_phone" varchar NOT NULL,
  	"version_contacts_email" varchar NOT NULL,
  	"version_contacts_office_address" varchar NOT NULL,
  	"version_contacts_office_short" varchar NOT NULL,
  	"version_contacts_hours" varchar NOT NULL,
  	"version_contacts_map_url" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "accounts_sessions" ADD CONSTRAINT "accounts_sessions_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "accounts_identities" ADD CONSTRAINT "accounts_identities_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_related_entry_id_wallet_ledger_id_fk" FOREIGN KEY ("related_entry_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "wallet_spend_allocations" ADD CONSTRAINT "wallet_spend_allocations_spend_entry_id_wallet_ledger_id_fk" FOREIGN KEY ("spend_entry_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_spend_allocations" ADD CONSTRAINT "wallet_spend_allocations_lot_entry_id_wallet_ledger_id_fk" FOREIGN KEY ("lot_entry_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_certificates" ADD CONSTRAINT "wallet_certificates_activated_by_customer_accounts_customers_id_fk" FOREIGN KEY ("activated_by_customer") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_referral_codes" ADD CONSTRAINT "wallet_referral_codes_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "wallet_referrals" ADD CONSTRAINT "wallet_referrals_referrer_id_accounts_customers_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_referrals" ADD CONSTRAINT "wallet_referrals_referred_customer_id_accounts_customers_id_fk" FOREIGN KEY ("referred_customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "wallet_referrals" ADD CONSTRAINT "wallet_referrals_reward_entry_id_wallet_ledger_id_fk" FOREIGN KEY ("reward_entry_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "leads_requests" ADD CONSTRAINT "leads_requests_duplicate_of_leads_requests_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."leads_requests"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "leads_status_history" ADD CONSTRAINT "leads_status_history_lead_id_leads_requests_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_customer_id_accounts_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."accounts_customers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_seats" ADD CONSTRAINT "commerce_seats_hold_id_commerce_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."commerce_holds"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_seats" ADD CONSTRAINT "commerce_seats_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_holds" ADD CONSTRAINT "commerce_holds_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_seat_fk" FOREIGN KEY ("performance_id","seat_id") REFERENCES "public"."commerce_seats"("performance_id","seat_id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "commerce_tickets" ADD CONSTRAINT "commerce_tickets_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_tickets" ADD CONSTRAINT "commerce_tickets_order_item_id_commerce_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."commerce_order_items"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_tickets" ADD CONSTRAINT "commerce_tickets_seat_fk" FOREIGN KEY ("performance_id","seat_id") REFERENCES "public"."commerce_seats"("performance_id","seat_id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "commerce_payment_events" ADD CONSTRAINT "commerce_payment_events_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refunds" ADD CONSTRAINT "commerce_refunds_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_tickets" ADD CONSTRAINT "commerce_refund_tickets_refund_id_commerce_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."commerce_refunds"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "commerce_refund_tickets" ADD CONSTRAINT "commerce_refund_tickets_ticket_id_commerce_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."commerce_tickets"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "shows_credits_entries" ADD CONSTRAINT "shows_credits_entries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."shows_credits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "shows_credits" ADD CONSTRAINT "shows_credits_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "shows_gallery" ADD CONSTRAINT "shows_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shows_gallery" ADD CONSTRAINT "shows_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "shows" ADD CONSTRAINT "shows_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shows" ADD CONSTRAINT "shows_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shows" ADD CONSTRAINT "shows_preview_id_media_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shows" ADD CONSTRAINT "shows_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shows_rels" ADD CONSTRAINT "shows_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "shows_rels" ADD CONSTRAINT "shows_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v_version_credits_entries" ADD CONSTRAINT "_shows_v_version_credits_entries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_shows_v_version_credits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v_version_credits" ADD CONSTRAINT "_shows_v_version_credits_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_shows_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v_version_gallery" ADD CONSTRAINT "_shows_v_version_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v_version_gallery" ADD CONSTRAINT "_shows_v_version_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_shows_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v" ADD CONSTRAINT "_shows_v_parent_id_shows_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v" ADD CONSTRAINT "_shows_v_version_poster_id_media_id_fk" FOREIGN KEY ("version_poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v" ADD CONSTRAINT "_shows_v_version_cover_id_media_id_fk" FOREIGN KEY ("version_cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v" ADD CONSTRAINT "_shows_v_version_preview_id_media_id_fk" FOREIGN KEY ("version_preview_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v" ADD CONSTRAINT "_shows_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_shows_v_rels" ADD CONSTRAINT "_shows_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_shows_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_shows_v_rels" ADD CONSTRAINT "_shows_v_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "performances_seating_prices" ADD CONSTRAINT "performances_seating_prices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "performances" ADD CONSTRAINT "performances_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "performances" ADD CONSTRAINT "performances_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "performances_texts" ADD CONSTRAINT "performances_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_performances_v_version_seating_prices" ADD CONSTRAINT "_performances_v_version_seating_prices_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_performances_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_performances_v" ADD CONSTRAINT "_performances_v_parent_id_performances_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."performances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_performances_v" ADD CONSTRAINT "_performances_v_version_show_id_shows_id_fk" FOREIGN KEY ("version_show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_performances_v" ADD CONSTRAINT "_performances_v_version_venue_id_venues_id_fk" FOREIGN KEY ("version_venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_performances_v_texts" ADD CONSTRAINT "_performances_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_performances_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "venues" ADD CONSTRAINT "venues_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_venues_v" ADD CONSTRAINT "_venues_v_parent_id_venues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_venues_v" ADD CONSTRAINT "_venues_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "archive_credits_entries" ADD CONSTRAINT "archive_credits_entries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."archive_credits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "archive_credits" ADD CONSTRAINT "archive_credits_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "archive" ADD CONSTRAINT "archive_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "archive_rels" ADD CONSTRAINT "archive_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "archive_rels" ADD CONSTRAINT "archive_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_archive_v_version_credits_entries" ADD CONSTRAINT "_archive_v_version_credits_entries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_archive_v_version_credits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_archive_v_version_credits" ADD CONSTRAINT "_archive_v_version_credits_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_archive_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_archive_v" ADD CONSTRAINT "_archive_v_parent_id_archive_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."archive"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_archive_v" ADD CONSTRAINT "_archive_v_version_poster_id_media_id_fk" FOREIGN KEY ("version_poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_archive_v_rels" ADD CONSTRAINT "_archive_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_archive_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_archive_v_rels" ADD CONSTRAINT "_archive_v_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "people_works" ADD CONSTRAINT "people_works_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "people" ADD CONSTRAINT "people_portrait_id_media_id_fk" FOREIGN KEY ("portrait_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "people" ADD CONSTRAINT "people_slide_id_media_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "people" ADD CONSTRAINT "people_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_people_v_version_works" ADD CONSTRAINT "_people_v_version_works_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_people_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_people_v" ADD CONSTRAINT "_people_v_parent_id_people_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_people_v" ADD CONSTRAINT "_people_v_version_portrait_id_media_id_fk" FOREIGN KEY ("version_portrait_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_people_v" ADD CONSTRAINT "_people_v_version_slide_id_media_id_fk" FOREIGN KEY ("version_slide_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_people_v" ADD CONSTRAINT "_people_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "news" ADD CONSTRAINT "news_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "news" ADD CONSTRAINT "news_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_news_v" ADD CONSTRAINT "_news_v_parent_id_news_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."news"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_news_v" ADD CONSTRAINT "_news_v_version_cover_id_media_id_fk" FOREIGN KEY ("version_cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_news_v" ADD CONSTRAINT "_news_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_reviews_v" ADD CONSTRAINT "_reviews_v_parent_id_reviews_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_partners_v" ADD CONSTRAINT "_partners_v_parent_id_partners_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_partners_v" ADD CONSTRAINT "_partners_v_version_logo_id_media_id_fk" FOREIGN KEY ("version_logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_photos" ADD CONSTRAINT "pages_photos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_photos" ADD CONSTRAINT "pages_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_version_photos" ADD CONSTRAINT "_pages_v_version_photos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_version_photos" ADD CONSTRAINT "_pages_v_version_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_media_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_documents_v" ADD CONSTRAINT "_documents_v_parent_id_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_documents_v" ADD CONSTRAINT "_documents_v_version_file_id_media_id_fk" FOREIGN KEY ("version_file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "admin_users_sessions" ADD CONSTRAINT "admin_users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "admin_mfa" ADD CONSTRAINT "admin_mfa_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "admin_mfa_recovery_codes" ADD CONSTRAINT "admin_mfa_recovery_codes_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_shows_fk" FOREIGN KEY ("shows_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_performances_fk" FOREIGN KEY ("performances_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_venues_fk" FOREIGN KEY ("venues_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_archive_fk" FOREIGN KEY ("archive_id") REFERENCES "public"."archive"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ticket_types_fk" FOREIGN KEY ("ticket_types_id") REFERENCES "public"."ticket_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_people_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_news_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reviews_fk" FOREIGN KEY ("reviews_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_partners_fk" FOREIGN KEY ("partners_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_documents_fk" FOREIGN KEY ("documents_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_admin_users_fk" FOREIGN KEY ("admin_users_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_admin_mfa_fk" FOREIGN KEY ("admin_mfa_id") REFERENCES "public"."admin_mfa"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_admin_mfa_recovery_codes_fk" FOREIGN KEY ("admin_mfa_recovery_codes_id") REFERENCES "public"."admin_mfa_recovery_codes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_admin_users_fk" FOREIGN KEY ("admin_users_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_social" ADD CONSTRAINT "site_settings_social_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v_version_social" ADD CONSTRAINT "_site_settings_v_version_social_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_site_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "accounts_auth_codes_email_created_idx" ON "accounts_auth_codes" USING btree ("email","created_at");
  CREATE INDEX "accounts_sessions_customer_idx" ON "accounts_sessions" USING btree ("customer_id");
  CREATE UNIQUE INDEX "accounts_identities_provider_subject_uq" ON "accounts_identities" USING btree ("provider","subject");
  CREATE UNIQUE INDEX "accounts_identities_customer_provider_uq" ON "accounts_identities" USING btree ("customer_id","provider");
  CREATE INDEX "wallet_ledger_customer_expires_idx" ON "wallet_ledger" USING btree ("customer_id","expires_at");
  CREATE INDEX "wallet_ledger_customer_created_idx" ON "wallet_ledger" USING btree ("customer_id","created_at");
  CREATE INDEX "wallet_spend_allocations_spend_idx" ON "wallet_spend_allocations" USING btree ("spend_entry_id");
  CREATE INDEX "wallet_certificates_customer_idx" ON "wallet_certificates" USING btree ("activated_by_customer");
  CREATE INDEX "wallet_referrals_referrer_idx" ON "wallet_referrals" USING btree ("referrer_id","qualified_at");
  CREATE INDEX "leads_requests_status_created_idx" ON "leads_requests" USING btree ("status","created_at");
  CREATE INDEX "leads_requests_email_idx" ON "leads_requests" USING btree ("email");
  CREATE INDEX "leads_requests_phone_idx" ON "leads_requests" USING btree ("phone");
  CREATE INDEX "leads_status_history_lead_idx" ON "leads_status_history" USING btree ("lead_id","created_at");
  CREATE INDEX "consent_journal_subject_idx" ON "consent_journal" USING btree ("subject_ref");
  CREATE INDEX "commerce_inventory_ticket_type_idx" ON "commerce_inventory" USING btree ("ticket_type_id");
  CREATE INDEX "commerce_orders_status_hold_idx" ON "commerce_orders" USING btree ("status","hold_until");
  CREATE INDEX "commerce_orders_customer_idx" ON "commerce_orders" USING btree ("customer_id","created_at");
  CREATE INDEX "commerce_orders_email_idx" ON "commerce_orders" USING btree ("email");
  CREATE UNIQUE INDEX "commerce_orders_provider_payment_uq" ON "commerce_orders" USING btree ("payment_provider","provider_payment_id") WHERE "commerce_orders"."provider_payment_id" IS NOT NULL;
  CREATE INDEX "commerce_seats_hold_idx" ON "commerce_seats" USING btree ("hold_id");
  CREATE INDEX "commerce_seats_order_idx" ON "commerce_seats" USING btree ("order_id");
  CREATE INDEX "commerce_holds_status_expires_idx" ON "commerce_holds" USING btree ("status","expires_at");
  CREATE INDEX "commerce_order_items_order_idx" ON "commerce_order_items" USING btree ("order_id");
  CREATE INDEX "commerce_order_items_ticket_type_idx" ON "commerce_order_items" USING btree ("performance_id","ticket_type_id");
  CREATE UNIQUE INDEX "commerce_order_items_category_uq" ON "commerce_order_items" USING btree ("order_id","performance_id","ticket_type_id") WHERE "commerce_order_items"."seat_id" IS NULL;
  CREATE UNIQUE INDEX "commerce_order_items_seat_uq" ON "commerce_order_items" USING btree ("order_id","performance_id","seat_id") WHERE "commerce_order_items"."seat_id" IS NOT NULL;
  CREATE INDEX "commerce_tickets_order_idx" ON "commerce_tickets" USING btree ("order_id");
  CREATE INDEX "commerce_tickets_ticket_type_idx" ON "commerce_tickets" USING btree ("performance_id","ticket_type_id");
  CREATE UNIQUE INDEX "commerce_tickets_seat_live_uq" ON "commerce_tickets" USING btree ("performance_id","seat_id") WHERE "commerce_tickets"."seat_id" IS NOT NULL AND "commerce_tickets"."status" <> 'REFUNDED';
  CREATE UNIQUE INDEX "commerce_payment_events_dedupe_uq" ON "commerce_payment_events" USING btree ("provider","event_id");
  CREATE INDEX "commerce_payment_events_payment_idx" ON "commerce_payment_events" USING btree ("provider","provider_payment_id");
  CREATE INDEX "commerce_payment_events_unprocessed_idx" ON "commerce_payment_events" USING btree ("received_at") WHERE "commerce_payment_events"."processed_at" IS NULL;
  CREATE INDEX "commerce_refunds_order_idx" ON "commerce_refunds" USING btree ("order_id");
  CREATE INDEX "commerce_refunds_status_idx" ON "commerce_refunds" USING btree ("status","updated_at");
  CREATE INDEX "commerce_refunds_next_attempt_idx" ON "commerce_refunds" USING btree ("next_attempt_at") WHERE "commerce_refunds"."status" IN ('REQUESTED', 'PENDING');
  CREATE UNIQUE INDEX "commerce_refunds_provider_refund_uq" ON "commerce_refunds" USING btree ("provider","provider_refund_id") WHERE "commerce_refunds"."provider_refund_id" IS NOT NULL;
  CREATE UNIQUE INDEX "commerce_refund_tickets_live_uq" ON "commerce_refund_tickets" USING btree ("ticket_id") WHERE "commerce_refund_tickets"."voided_at" IS NULL;
  CREATE INDEX "commerce_outbox_status_next_idx" ON "commerce_outbox" USING btree ("status","next_attempt_at");
  CREATE INDEX "commerce_audit_log_entity_idx" ON "commerce_audit_log" USING btree ("entity","entity_id","at");
  CREATE INDEX "commerce_audit_log_at_idx" ON "commerce_audit_log" USING btree ("at");
  CREATE INDEX "ops_rate_limits_expires_idx" ON "ops_rate_limits" USING btree ("expires_at");
  CREATE INDEX "shows_credits_entries_order_idx" ON "shows_credits_entries" USING btree ("_order");
  CREATE INDEX "shows_credits_entries_parent_id_idx" ON "shows_credits_entries" USING btree ("_parent_id");
  CREATE INDEX "shows_credits_order_idx" ON "shows_credits" USING btree ("_order");
  CREATE INDEX "shows_credits_parent_id_idx" ON "shows_credits" USING btree ("_parent_id");
  CREATE INDEX "shows_gallery_order_idx" ON "shows_gallery" USING btree ("_order");
  CREATE INDEX "shows_gallery_parent_id_idx" ON "shows_gallery" USING btree ("_parent_id");
  CREATE INDEX "shows_gallery_image_idx" ON "shows_gallery" USING btree ("image_id");
  CREATE UNIQUE INDEX "shows_slug_idx" ON "shows" USING btree ("slug");
  CREATE INDEX "shows_poster_idx" ON "shows" USING btree ("poster_id");
  CREATE INDEX "shows_cover_idx" ON "shows" USING btree ("cover_id");
  CREATE INDEX "shows_preview_idx" ON "shows" USING btree ("preview_id");
  CREATE INDEX "shows_seo_seo_image_idx" ON "shows" USING btree ("seo_image_id");
  CREATE INDEX "shows_updated_at_idx" ON "shows" USING btree ("updated_at");
  CREATE INDEX "shows_created_at_idx" ON "shows" USING btree ("created_at");
  CREATE INDEX "shows__status_idx" ON "shows" USING btree ("_status");
  CREATE INDEX "shows_rels_order_idx" ON "shows_rels" USING btree ("order");
  CREATE INDEX "shows_rels_parent_idx" ON "shows_rels" USING btree ("parent_id");
  CREATE INDEX "shows_rels_path_idx" ON "shows_rels" USING btree ("path");
  CREATE INDEX "shows_rels_people_id_idx" ON "shows_rels" USING btree ("people_id");
  CREATE INDEX "_shows_v_version_credits_entries_order_idx" ON "_shows_v_version_credits_entries" USING btree ("_order");
  CREATE INDEX "_shows_v_version_credits_entries_parent_id_idx" ON "_shows_v_version_credits_entries" USING btree ("_parent_id");
  CREATE INDEX "_shows_v_version_credits_order_idx" ON "_shows_v_version_credits" USING btree ("_order");
  CREATE INDEX "_shows_v_version_credits_parent_id_idx" ON "_shows_v_version_credits" USING btree ("_parent_id");
  CREATE INDEX "_shows_v_version_gallery_order_idx" ON "_shows_v_version_gallery" USING btree ("_order");
  CREATE INDEX "_shows_v_version_gallery_parent_id_idx" ON "_shows_v_version_gallery" USING btree ("_parent_id");
  CREATE INDEX "_shows_v_version_gallery_image_idx" ON "_shows_v_version_gallery" USING btree ("image_id");
  CREATE INDEX "_shows_v_parent_idx" ON "_shows_v" USING btree ("parent_id");
  CREATE INDEX "_shows_v_version_version_slug_idx" ON "_shows_v" USING btree ("version_slug");
  CREATE INDEX "_shows_v_version_version_poster_idx" ON "_shows_v" USING btree ("version_poster_id");
  CREATE INDEX "_shows_v_version_version_cover_idx" ON "_shows_v" USING btree ("version_cover_id");
  CREATE INDEX "_shows_v_version_version_preview_idx" ON "_shows_v" USING btree ("version_preview_id");
  CREATE INDEX "_shows_v_version_seo_version_seo_image_idx" ON "_shows_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_shows_v_version_version_updated_at_idx" ON "_shows_v" USING btree ("version_updated_at");
  CREATE INDEX "_shows_v_version_version_created_at_idx" ON "_shows_v" USING btree ("version_created_at");
  CREATE INDEX "_shows_v_version_version__status_idx" ON "_shows_v" USING btree ("version__status");
  CREATE INDEX "_shows_v_created_at_idx" ON "_shows_v" USING btree ("created_at");
  CREATE INDEX "_shows_v_updated_at_idx" ON "_shows_v" USING btree ("updated_at");
  CREATE INDEX "_shows_v_latest_idx" ON "_shows_v" USING btree ("latest");
  CREATE INDEX "_shows_v_rels_order_idx" ON "_shows_v_rels" USING btree ("order");
  CREATE INDEX "_shows_v_rels_parent_idx" ON "_shows_v_rels" USING btree ("parent_id");
  CREATE INDEX "_shows_v_rels_path_idx" ON "_shows_v_rels" USING btree ("path");
  CREATE INDEX "_shows_v_rels_people_id_idx" ON "_shows_v_rels" USING btree ("people_id");
  CREATE INDEX "performances_seating_prices_order_idx" ON "performances_seating_prices" USING btree ("_order");
  CREATE INDEX "performances_seating_prices_parent_id_idx" ON "performances_seating_prices" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "performances_code_idx" ON "performances" USING btree ("code");
  CREATE INDEX "performances_show_idx" ON "performances" USING btree ("show_id");
  CREATE INDEX "performances_venue_idx" ON "performances" USING btree ("venue_id");
  CREATE INDEX "performances_starts_at_idx" ON "performances" USING btree ("starts_at");
  CREATE INDEX "performances_updated_at_idx" ON "performances" USING btree ("updated_at");
  CREATE INDEX "performances_created_at_idx" ON "performances" USING btree ("created_at");
  CREATE INDEX "performances__status_idx" ON "performances" USING btree ("_status");
  CREATE INDEX "performances_texts_order_parent" ON "performances_texts" USING btree ("order","parent_id");
  CREATE INDEX "_performances_v_version_seating_prices_order_idx" ON "_performances_v_version_seating_prices" USING btree ("_order");
  CREATE INDEX "_performances_v_version_seating_prices_parent_id_idx" ON "_performances_v_version_seating_prices" USING btree ("_parent_id");
  CREATE INDEX "_performances_v_parent_idx" ON "_performances_v" USING btree ("parent_id");
  CREATE INDEX "_performances_v_version_version_code_idx" ON "_performances_v" USING btree ("version_code");
  CREATE INDEX "_performances_v_version_version_show_idx" ON "_performances_v" USING btree ("version_show_id");
  CREATE INDEX "_performances_v_version_version_venue_idx" ON "_performances_v" USING btree ("version_venue_id");
  CREATE INDEX "_performances_v_version_version_starts_at_idx" ON "_performances_v" USING btree ("version_starts_at");
  CREATE INDEX "_performances_v_version_version_updated_at_idx" ON "_performances_v" USING btree ("version_updated_at");
  CREATE INDEX "_performances_v_version_version_created_at_idx" ON "_performances_v" USING btree ("version_created_at");
  CREATE INDEX "_performances_v_version_version__status_idx" ON "_performances_v" USING btree ("version__status");
  CREATE INDEX "_performances_v_created_at_idx" ON "_performances_v" USING btree ("created_at");
  CREATE INDEX "_performances_v_updated_at_idx" ON "_performances_v" USING btree ("updated_at");
  CREATE INDEX "_performances_v_latest_idx" ON "_performances_v" USING btree ("latest");
  CREATE INDEX "_performances_v_texts_order_parent" ON "_performances_v_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "venues_code_idx" ON "venues" USING btree ("code");
  CREATE INDEX "venues_seo_seo_image_idx" ON "venues" USING btree ("seo_image_id");
  CREATE INDEX "venues_updated_at_idx" ON "venues" USING btree ("updated_at");
  CREATE INDEX "venues_created_at_idx" ON "venues" USING btree ("created_at");
  CREATE INDEX "venues__status_idx" ON "venues" USING btree ("_status");
  CREATE INDEX "_venues_v_parent_idx" ON "_venues_v" USING btree ("parent_id");
  CREATE INDEX "_venues_v_version_version_code_idx" ON "_venues_v" USING btree ("version_code");
  CREATE INDEX "_venues_v_version_seo_version_seo_image_idx" ON "_venues_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_venues_v_version_version_updated_at_idx" ON "_venues_v" USING btree ("version_updated_at");
  CREATE INDEX "_venues_v_version_version_created_at_idx" ON "_venues_v" USING btree ("version_created_at");
  CREATE INDEX "_venues_v_version_version__status_idx" ON "_venues_v" USING btree ("version__status");
  CREATE INDEX "_venues_v_created_at_idx" ON "_venues_v" USING btree ("created_at");
  CREATE INDEX "_venues_v_updated_at_idx" ON "_venues_v" USING btree ("updated_at");
  CREATE INDEX "_venues_v_latest_idx" ON "_venues_v" USING btree ("latest");
  CREATE INDEX "archive_credits_entries_order_idx" ON "archive_credits_entries" USING btree ("_order");
  CREATE INDEX "archive_credits_entries_parent_id_idx" ON "archive_credits_entries" USING btree ("_parent_id");
  CREATE INDEX "archive_credits_order_idx" ON "archive_credits" USING btree ("_order");
  CREATE INDEX "archive_credits_parent_id_idx" ON "archive_credits" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "archive_slug_idx" ON "archive" USING btree ("slug");
  CREATE INDEX "archive_poster_idx" ON "archive" USING btree ("poster_id");
  CREATE INDEX "archive_updated_at_idx" ON "archive" USING btree ("updated_at");
  CREATE INDEX "archive_created_at_idx" ON "archive" USING btree ("created_at");
  CREATE INDEX "archive__status_idx" ON "archive" USING btree ("_status");
  CREATE INDEX "archive_rels_order_idx" ON "archive_rels" USING btree ("order");
  CREATE INDEX "archive_rels_parent_idx" ON "archive_rels" USING btree ("parent_id");
  CREATE INDEX "archive_rels_path_idx" ON "archive_rels" USING btree ("path");
  CREATE INDEX "archive_rels_people_id_idx" ON "archive_rels" USING btree ("people_id");
  CREATE INDEX "_archive_v_version_credits_entries_order_idx" ON "_archive_v_version_credits_entries" USING btree ("_order");
  CREATE INDEX "_archive_v_version_credits_entries_parent_id_idx" ON "_archive_v_version_credits_entries" USING btree ("_parent_id");
  CREATE INDEX "_archive_v_version_credits_order_idx" ON "_archive_v_version_credits" USING btree ("_order");
  CREATE INDEX "_archive_v_version_credits_parent_id_idx" ON "_archive_v_version_credits" USING btree ("_parent_id");
  CREATE INDEX "_archive_v_parent_idx" ON "_archive_v" USING btree ("parent_id");
  CREATE INDEX "_archive_v_version_version_slug_idx" ON "_archive_v" USING btree ("version_slug");
  CREATE INDEX "_archive_v_version_version_poster_idx" ON "_archive_v" USING btree ("version_poster_id");
  CREATE INDEX "_archive_v_version_version_updated_at_idx" ON "_archive_v" USING btree ("version_updated_at");
  CREATE INDEX "_archive_v_version_version_created_at_idx" ON "_archive_v" USING btree ("version_created_at");
  CREATE INDEX "_archive_v_version_version__status_idx" ON "_archive_v" USING btree ("version__status");
  CREATE INDEX "_archive_v_created_at_idx" ON "_archive_v" USING btree ("created_at");
  CREATE INDEX "_archive_v_updated_at_idx" ON "_archive_v" USING btree ("updated_at");
  CREATE INDEX "_archive_v_latest_idx" ON "_archive_v" USING btree ("latest");
  CREATE INDEX "_archive_v_rels_order_idx" ON "_archive_v_rels" USING btree ("order");
  CREATE INDEX "_archive_v_rels_parent_idx" ON "_archive_v_rels" USING btree ("parent_id");
  CREATE INDEX "_archive_v_rels_path_idx" ON "_archive_v_rels" USING btree ("path");
  CREATE INDEX "_archive_v_rels_people_id_idx" ON "_archive_v_rels" USING btree ("people_id");
  CREATE INDEX "ticket_types_performance_idx" ON "ticket_types" USING btree ("performance_id");
  CREATE INDEX "ticket_types_updated_at_idx" ON "ticket_types" USING btree ("updated_at");
  CREATE INDEX "ticket_types_created_at_idx" ON "ticket_types" USING btree ("created_at");
  CREATE INDEX "people_works_order_idx" ON "people_works" USING btree ("_order");
  CREATE INDEX "people_works_parent_id_idx" ON "people_works" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "people_slug_idx" ON "people" USING btree ("slug");
  CREATE INDEX "people_portrait_idx" ON "people" USING btree ("portrait_id");
  CREATE INDEX "people_slide_idx" ON "people" USING btree ("slide_id");
  CREATE INDEX "people_seo_seo_image_idx" ON "people" USING btree ("seo_image_id");
  CREATE INDEX "people_updated_at_idx" ON "people" USING btree ("updated_at");
  CREATE INDEX "people_created_at_idx" ON "people" USING btree ("created_at");
  CREATE INDEX "people__status_idx" ON "people" USING btree ("_status");
  CREATE INDEX "_people_v_version_works_order_idx" ON "_people_v_version_works" USING btree ("_order");
  CREATE INDEX "_people_v_version_works_parent_id_idx" ON "_people_v_version_works" USING btree ("_parent_id");
  CREATE INDEX "_people_v_parent_idx" ON "_people_v" USING btree ("parent_id");
  CREATE INDEX "_people_v_version_version_slug_idx" ON "_people_v" USING btree ("version_slug");
  CREATE INDEX "_people_v_version_version_portrait_idx" ON "_people_v" USING btree ("version_portrait_id");
  CREATE INDEX "_people_v_version_version_slide_idx" ON "_people_v" USING btree ("version_slide_id");
  CREATE INDEX "_people_v_version_seo_version_seo_image_idx" ON "_people_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_people_v_version_version_updated_at_idx" ON "_people_v" USING btree ("version_updated_at");
  CREATE INDEX "_people_v_version_version_created_at_idx" ON "_people_v" USING btree ("version_created_at");
  CREATE INDEX "_people_v_version_version__status_idx" ON "_people_v" USING btree ("version__status");
  CREATE INDEX "_people_v_created_at_idx" ON "_people_v" USING btree ("created_at");
  CREATE INDEX "_people_v_updated_at_idx" ON "_people_v" USING btree ("updated_at");
  CREATE INDEX "_people_v_latest_idx" ON "_people_v" USING btree ("latest");
  CREATE UNIQUE INDEX "news_slug_idx" ON "news" USING btree ("slug");
  CREATE INDEX "news_cover_idx" ON "news" USING btree ("cover_id");
  CREATE INDEX "news_seo_seo_image_idx" ON "news" USING btree ("seo_image_id");
  CREATE INDEX "news_updated_at_idx" ON "news" USING btree ("updated_at");
  CREATE INDEX "news_created_at_idx" ON "news" USING btree ("created_at");
  CREATE INDEX "news__status_idx" ON "news" USING btree ("_status");
  CREATE INDEX "_news_v_parent_idx" ON "_news_v" USING btree ("parent_id");
  CREATE INDEX "_news_v_version_version_slug_idx" ON "_news_v" USING btree ("version_slug");
  CREATE INDEX "_news_v_version_version_cover_idx" ON "_news_v" USING btree ("version_cover_id");
  CREATE INDEX "_news_v_version_seo_version_seo_image_idx" ON "_news_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_news_v_version_version_updated_at_idx" ON "_news_v" USING btree ("version_updated_at");
  CREATE INDEX "_news_v_version_version_created_at_idx" ON "_news_v" USING btree ("version_created_at");
  CREATE INDEX "_news_v_version_version__status_idx" ON "_news_v" USING btree ("version__status");
  CREATE INDEX "_news_v_created_at_idx" ON "_news_v" USING btree ("created_at");
  CREATE INDEX "_news_v_updated_at_idx" ON "_news_v" USING btree ("updated_at");
  CREATE INDEX "_news_v_latest_idx" ON "_news_v" USING btree ("latest");
  CREATE UNIQUE INDEX "reviews_slug_idx" ON "reviews" USING btree ("slug");
  CREATE INDEX "reviews_updated_at_idx" ON "reviews" USING btree ("updated_at");
  CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");
  CREATE INDEX "reviews__status_idx" ON "reviews" USING btree ("_status");
  CREATE INDEX "_reviews_v_parent_idx" ON "_reviews_v" USING btree ("parent_id");
  CREATE INDEX "_reviews_v_version_version_slug_idx" ON "_reviews_v" USING btree ("version_slug");
  CREATE INDEX "_reviews_v_version_version_updated_at_idx" ON "_reviews_v" USING btree ("version_updated_at");
  CREATE INDEX "_reviews_v_version_version_created_at_idx" ON "_reviews_v" USING btree ("version_created_at");
  CREATE INDEX "_reviews_v_version_version__status_idx" ON "_reviews_v" USING btree ("version__status");
  CREATE INDEX "_reviews_v_created_at_idx" ON "_reviews_v" USING btree ("created_at");
  CREATE INDEX "_reviews_v_updated_at_idx" ON "_reviews_v" USING btree ("updated_at");
  CREATE INDEX "_reviews_v_latest_idx" ON "_reviews_v" USING btree ("latest");
  CREATE INDEX "partners_logo_idx" ON "partners" USING btree ("logo_id");
  CREATE INDEX "partners_updated_at_idx" ON "partners" USING btree ("updated_at");
  CREATE INDEX "partners_created_at_idx" ON "partners" USING btree ("created_at");
  CREATE INDEX "partners__status_idx" ON "partners" USING btree ("_status");
  CREATE INDEX "_partners_v_parent_idx" ON "_partners_v" USING btree ("parent_id");
  CREATE INDEX "_partners_v_version_version_logo_idx" ON "_partners_v" USING btree ("version_logo_id");
  CREATE INDEX "_partners_v_version_version_updated_at_idx" ON "_partners_v" USING btree ("version_updated_at");
  CREATE INDEX "_partners_v_version_version_created_at_idx" ON "_partners_v" USING btree ("version_created_at");
  CREATE INDEX "_partners_v_version_version__status_idx" ON "_partners_v" USING btree ("version__status");
  CREATE INDEX "_partners_v_created_at_idx" ON "_partners_v" USING btree ("created_at");
  CREATE INDEX "_partners_v_updated_at_idx" ON "_partners_v" USING btree ("updated_at");
  CREATE INDEX "_partners_v_latest_idx" ON "_partners_v" USING btree ("latest");
  CREATE INDEX "pages_photos_order_idx" ON "pages_photos" USING btree ("_order");
  CREATE INDEX "pages_photos_parent_id_idx" ON "pages_photos" USING btree ("_parent_id");
  CREATE INDEX "pages_photos_image_idx" ON "pages_photos" USING btree ("image_id");
  CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");
  CREATE INDEX "pages_seo_seo_image_idx" ON "pages" USING btree ("seo_image_id");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE INDEX "pages__status_idx" ON "pages" USING btree ("_status");
  CREATE INDEX "_pages_v_version_photos_order_idx" ON "_pages_v_version_photos" USING btree ("_order");
  CREATE INDEX "_pages_v_version_photos_parent_id_idx" ON "_pages_v_version_photos" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_photos_image_idx" ON "_pages_v_version_photos" USING btree ("image_id");
  CREATE INDEX "_pages_v_parent_idx" ON "_pages_v" USING btree ("parent_id");
  CREATE INDEX "_pages_v_version_version_slug_idx" ON "_pages_v" USING btree ("version_slug");
  CREATE INDEX "_pages_v_version_seo_version_seo_image_idx" ON "_pages_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "_pages_v" USING btree ("version_updated_at");
  CREATE INDEX "_pages_v_version_version_created_at_idx" ON "_pages_v" USING btree ("version_created_at");
  CREATE INDEX "_pages_v_version_version__status_idx" ON "_pages_v" USING btree ("version__status");
  CREATE INDEX "_pages_v_created_at_idx" ON "_pages_v" USING btree ("created_at");
  CREATE INDEX "_pages_v_updated_at_idx" ON "_pages_v" USING btree ("updated_at");
  CREATE INDEX "_pages_v_latest_idx" ON "_pages_v" USING btree ("latest");
  CREATE UNIQUE INDEX "documents_slug_idx" ON "documents" USING btree ("slug");
  CREATE INDEX "documents_file_idx" ON "documents" USING btree ("file_id");
  CREATE INDEX "documents_updated_at_idx" ON "documents" USING btree ("updated_at");
  CREATE INDEX "documents_created_at_idx" ON "documents" USING btree ("created_at");
  CREATE INDEX "documents__status_idx" ON "documents" USING btree ("_status");
  CREATE INDEX "_documents_v_parent_idx" ON "_documents_v" USING btree ("parent_id");
  CREATE INDEX "_documents_v_version_version_slug_idx" ON "_documents_v" USING btree ("version_slug");
  CREATE INDEX "_documents_v_version_version_file_idx" ON "_documents_v" USING btree ("version_file_id");
  CREATE INDEX "_documents_v_version_version_updated_at_idx" ON "_documents_v" USING btree ("version_updated_at");
  CREATE INDEX "_documents_v_version_version_created_at_idx" ON "_documents_v" USING btree ("version_created_at");
  CREATE INDEX "_documents_v_version_version__status_idx" ON "_documents_v" USING btree ("version__status");
  CREATE INDEX "_documents_v_created_at_idx" ON "_documents_v" USING btree ("created_at");
  CREATE INDEX "_documents_v_updated_at_idx" ON "_documents_v" USING btree ("updated_at");
  CREATE INDEX "_documents_v_latest_idx" ON "_documents_v" USING btree ("latest");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_card_sizes_card_filename_idx" ON "media" USING btree ("sizes_card_filename");
  CREATE INDEX "media_sizes_cover_sizes_cover_filename_idx" ON "media" USING btree ("sizes_cover_filename");
  CREATE INDEX "admin_users_sessions_order_idx" ON "admin_users_sessions" USING btree ("_order");
  CREATE INDEX "admin_users_sessions_parent_id_idx" ON "admin_users_sessions" USING btree ("_parent_id");
  CREATE INDEX "admin_users_updated_at_idx" ON "admin_users" USING btree ("updated_at");
  CREATE INDEX "admin_users_created_at_idx" ON "admin_users" USING btree ("created_at");
  CREATE UNIQUE INDEX "admin_users_email_idx" ON "admin_users" USING btree ("email");
  CREATE UNIQUE INDEX "admin_mfa_user_idx" ON "admin_mfa" USING btree ("user_id");
  CREATE INDEX "admin_mfa_updated_at_idx" ON "admin_mfa" USING btree ("updated_at");
  CREATE INDEX "admin_mfa_created_at_idx" ON "admin_mfa" USING btree ("created_at");
  CREATE INDEX "admin_mfa_recovery_codes_user_idx" ON "admin_mfa_recovery_codes" USING btree ("user_id");
  CREATE INDEX "admin_mfa_recovery_codes_hash_idx" ON "admin_mfa_recovery_codes" USING btree ("hash");
  CREATE INDEX "admin_mfa_recovery_codes_updated_at_idx" ON "admin_mfa_recovery_codes" USING btree ("updated_at");
  CREATE INDEX "admin_mfa_recovery_codes_created_at_idx" ON "admin_mfa_recovery_codes" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_shows_id_idx" ON "payload_locked_documents_rels" USING btree ("shows_id");
  CREATE INDEX "payload_locked_documents_rels_performances_id_idx" ON "payload_locked_documents_rels" USING btree ("performances_id");
  CREATE INDEX "payload_locked_documents_rels_venues_id_idx" ON "payload_locked_documents_rels" USING btree ("venues_id");
  CREATE INDEX "payload_locked_documents_rels_archive_id_idx" ON "payload_locked_documents_rels" USING btree ("archive_id");
  CREATE INDEX "payload_locked_documents_rels_ticket_types_id_idx" ON "payload_locked_documents_rels" USING btree ("ticket_types_id");
  CREATE INDEX "payload_locked_documents_rels_people_id_idx" ON "payload_locked_documents_rels" USING btree ("people_id");
  CREATE INDEX "payload_locked_documents_rels_news_id_idx" ON "payload_locked_documents_rels" USING btree ("news_id");
  CREATE INDEX "payload_locked_documents_rels_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("reviews_id");
  CREATE INDEX "payload_locked_documents_rels_partners_id_idx" ON "payload_locked_documents_rels" USING btree ("partners_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_documents_id_idx" ON "payload_locked_documents_rels" USING btree ("documents_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_admin_users_id_idx" ON "payload_locked_documents_rels" USING btree ("admin_users_id");
  CREATE INDEX "payload_locked_documents_rels_admin_mfa_id_idx" ON "payload_locked_documents_rels" USING btree ("admin_mfa_id");
  CREATE INDEX "payload_locked_documents_rels_admin_mfa_recovery_codes_i_idx" ON "payload_locked_documents_rels" USING btree ("admin_mfa_recovery_codes_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_admin_users_id_idx" ON "payload_preferences_rels" USING btree ("admin_users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");
  CREATE INDEX "site_settings_social_order_idx" ON "site_settings_social" USING btree ("_order");
  CREATE INDEX "site_settings_social_parent_id_idx" ON "site_settings_social" USING btree ("_parent_id");
  CREATE INDEX "site_settings_seo_seo_image_idx" ON "site_settings" USING btree ("seo_image_id");
  CREATE INDEX "_site_settings_v_version_social_order_idx" ON "_site_settings_v_version_social" USING btree ("_order");
  CREATE INDEX "_site_settings_v_version_social_parent_id_idx" ON "_site_settings_v_version_social" USING btree ("_parent_id");
  CREATE INDEX "_site_settings_v_version_seo_version_seo_image_idx" ON "_site_settings_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_site_settings_v_created_at_idx" ON "_site_settings_v" USING btree ("created_at");
  CREATE INDEX "_site_settings_v_updated_at_idx" ON "_site_settings_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "accounts_customers" CASCADE;
  DROP TABLE "accounts_auth_codes" CASCADE;
  DROP TABLE "accounts_sessions" CASCADE;
  DROP TABLE "accounts_consents" CASCADE;
  DROP TABLE "accounts_identities" CASCADE;
  DROP TABLE "wallet_ledger" CASCADE;
  DROP TABLE "wallet_spend_allocations" CASCADE;
  DROP TABLE "wallet_certificates" CASCADE;
  DROP TABLE "wallet_referral_codes" CASCADE;
  DROP TABLE "wallet_referrals" CASCADE;
  DROP TABLE "leads_requests" CASCADE;
  DROP TABLE "leads_status_history" CASCADE;
  DROP TABLE "consent_journal" CASCADE;
  DROP TABLE "commerce_inventory" CASCADE;
  DROP TABLE "commerce_orders" CASCADE;
  DROP TABLE "commerce_seats" CASCADE;
  DROP TABLE "commerce_holds" CASCADE;
  DROP TABLE "commerce_order_items" CASCADE;
  DROP TABLE "commerce_tickets" CASCADE;
  DROP TABLE "commerce_payment_events" CASCADE;
  DROP TABLE "commerce_refunds" CASCADE;
  DROP TABLE "commerce_refund_tickets" CASCADE;
  DROP TABLE "commerce_outbox" CASCADE;
  DROP TABLE "commerce_settings" CASCADE;
  DROP TABLE "commerce_audit_log" CASCADE;
  DROP TABLE "ops_rate_limits" CASCADE;
  DROP TABLE "shows_credits_entries" CASCADE;
  DROP TABLE "shows_credits" CASCADE;
  DROP TABLE "shows_gallery" CASCADE;
  DROP TABLE "shows" CASCADE;
  DROP TABLE "shows_rels" CASCADE;
  DROP TABLE "_shows_v_version_credits_entries" CASCADE;
  DROP TABLE "_shows_v_version_credits" CASCADE;
  DROP TABLE "_shows_v_version_gallery" CASCADE;
  DROP TABLE "_shows_v" CASCADE;
  DROP TABLE "_shows_v_rels" CASCADE;
  DROP TABLE "performances_seating_prices" CASCADE;
  DROP TABLE "performances" CASCADE;
  DROP TABLE "performances_texts" CASCADE;
  DROP TABLE "_performances_v_version_seating_prices" CASCADE;
  DROP TABLE "_performances_v" CASCADE;
  DROP TABLE "_performances_v_texts" CASCADE;
  DROP TABLE "venues" CASCADE;
  DROP TABLE "_venues_v" CASCADE;
  DROP TABLE "archive_credits_entries" CASCADE;
  DROP TABLE "archive_credits" CASCADE;
  DROP TABLE "archive" CASCADE;
  DROP TABLE "archive_rels" CASCADE;
  DROP TABLE "_archive_v_version_credits_entries" CASCADE;
  DROP TABLE "_archive_v_version_credits" CASCADE;
  DROP TABLE "_archive_v" CASCADE;
  DROP TABLE "_archive_v_rels" CASCADE;
  DROP TABLE "ticket_types" CASCADE;
  DROP TABLE "people_works" CASCADE;
  DROP TABLE "people" CASCADE;
  DROP TABLE "_people_v_version_works" CASCADE;
  DROP TABLE "_people_v" CASCADE;
  DROP TABLE "news" CASCADE;
  DROP TABLE "_news_v" CASCADE;
  DROP TABLE "reviews" CASCADE;
  DROP TABLE "_reviews_v" CASCADE;
  DROP TABLE "partners" CASCADE;
  DROP TABLE "_partners_v" CASCADE;
  DROP TABLE "pages_photos" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "_pages_v_version_photos" CASCADE;
  DROP TABLE "_pages_v" CASCADE;
  DROP TABLE "documents" CASCADE;
  DROP TABLE "_documents_v" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "admin_users_sessions" CASCADE;
  DROP TABLE "admin_users" CASCADE;
  DROP TABLE "admin_mfa" CASCADE;
  DROP TABLE "admin_mfa_recovery_codes" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "site_settings_social" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  DROP TABLE "_site_settings_v_version_social" CASCADE;
  DROP TABLE "_site_settings_v" CASCADE;
  DROP TYPE "public"."enum_shows_event_type";
  DROP TYPE "public"."enum_shows_status";
  DROP TYPE "public"."enum__shows_v_version_event_type";
  DROP TYPE "public"."enum__shows_v_version_status";
  DROP TYPE "public"."enum_performances_seating_plan_id";
  DROP TYPE "public"."enum_performances_status";
  DROP TYPE "public"."enum__performances_v_version_seating_plan_id";
  DROP TYPE "public"."enum__performances_v_version_status";
  DROP TYPE "public"."enum_venues_kind";
  DROP TYPE "public"."enum_venues_status";
  DROP TYPE "public"."enum__venues_v_version_kind";
  DROP TYPE "public"."enum__venues_v_version_status";
  DROP TYPE "public"."enum_archive_status";
  DROP TYPE "public"."enum__archive_v_version_status";
  DROP TYPE "public"."enum_people_status";
  DROP TYPE "public"."enum__people_v_version_status";
  DROP TYPE "public"."enum_news_tag";
  DROP TYPE "public"."enum_news_status";
  DROP TYPE "public"."enum__news_v_version_tag";
  DROP TYPE "public"."enum__news_v_version_status";
  DROP TYPE "public"."enum_reviews_status";
  DROP TYPE "public"."enum__reviews_v_version_status";
  DROP TYPE "public"."enum_partners_status";
  DROP TYPE "public"."enum__partners_v_version_status";
  DROP TYPE "public"."enum_pages_status";
  DROP TYPE "public"."enum__pages_v_version_status";
  DROP TYPE "public"."enum_documents_status";
  DROP TYPE "public"."enum__documents_v_version_status";
  DROP TYPE "public"."enum_admin_users_role";`)
}
