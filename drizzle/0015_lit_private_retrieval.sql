ALTER TYPE "public"."notification_kind" ADD VALUE 'LIT_REQUEST';--> statement-breakpoint
ALTER TABLE "expert_applications" ADD COLUMN "lit_retriever" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD COLUMN "lit_retriever" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD COLUMN "requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD COLUMN "request_days" integer;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD COLUMN "assigned_at" timestamp;