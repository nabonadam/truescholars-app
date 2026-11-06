ALTER TYPE "public"."notification_kind" ADD VALUE 'TOOL_ACCESS';--> statement-breakpoint
ALTER TABLE "stat_access" ADD COLUMN "upgrade_requested_at" timestamp;