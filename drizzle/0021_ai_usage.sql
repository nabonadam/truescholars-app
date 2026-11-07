CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"tool" text NOT NULL,
	"action" text NOT NULL,
	"access" text DEFAULT 'unknown' NOT NULL,
	"units" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" double precision DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_tool_idx" ON "ai_usage" USING btree ("user_id","tool","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");