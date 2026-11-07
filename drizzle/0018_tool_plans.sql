ALTER TABLE "payment_events" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "months" integer;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "applied_at" timestamp;