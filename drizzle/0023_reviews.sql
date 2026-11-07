ALTER TYPE "public"."notification_kind" ADD VALUE 'REVIEW_REQUEST';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "communication" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "quality" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "timeliness" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "recommend" boolean;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reply" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "replied_at" timestamp;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_id");--> statement-breakpoint
UPDATE "orders" SET "completed_at" = "updated_at" WHERE "status" = 'COMPLETED' AND "completed_at" IS NULL;