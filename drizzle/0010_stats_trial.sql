CREATE TABLE "stat_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"trial_started_at" timestamp DEFAULT now() NOT NULL,
	"access_until" timestamp,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stat_access" ADD CONSTRAINT "stat_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;