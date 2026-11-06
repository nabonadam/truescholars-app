ALTER TYPE "public"."notification_kind" ADD VALUE 'NEW_PROPOSAL';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'HIRED';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'PROPOSAL_DECLINED';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'JOB_MATCH';--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD COLUMN "credits_month" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "timeline_days" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "level" text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "credits_spent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;