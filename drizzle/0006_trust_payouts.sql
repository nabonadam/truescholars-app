CREATE TYPE "public"."withdrawal_status" AS ENUM('REQUESTED', 'PAID', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."dispute_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'PAYOUT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'REVERSAL';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'DISPUTE';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'PAYOUT';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'LEVEL_UP';--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"user_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"status" "withdrawal_status" DEFAULT 'REQUESTED' NOT NULL,
	"method" jsonb NOT NULL,
	"payout_reference" text,
	"note" text,
	"decided_by_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputes" DROP CONSTRAINT "disputes_order_id_unique";--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "milestone_id" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "previous_milestone_status" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "respond_by" timestamp;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "offer_release_minor" integer;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "offer_by_id" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "offer_at" timestamp;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "released_minor" integer;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "refunded_minor" integer;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "resolved_by_id" text;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawals_user" ON "withdrawals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_status" ON "withdrawals" USING btree ("status");--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_offer_by_id_users_id_fk" FOREIGN KEY ("offer_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_order" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "disputes_milestone" ON "disputes" USING btree ("milestone_id");