ALTER TYPE "public"."notification_kind" ADD VALUE 'STUDY_RESPONSE';--> statement-breakpoint
CREATE TABLE "qual_analyses" (
	"study_id" text PRIMARY KEY NOT NULL,
	"research_question" text DEFAULT '' NOT NULL,
	"background" text DEFAULT '' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qual_audio" (
	"key" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qual_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"study_id" text NOT NULL,
	"secret" text NOT NULL,
	"name" text,
	"email" text,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qual_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"token" text NOT NULL,
	"title" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qual_studies_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tool_access" (
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"trial_started_at" timestamp DEFAULT now() NOT NULL,
	"access_until" timestamp,
	"upgrade_requested_at" timestamp,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tool_access_user_id_tool_pk" PRIMARY KEY("user_id","tool")
);
--> statement-breakpoint
ALTER TABLE "qual_analyses" ADD CONSTRAINT "qual_analyses_study_id_qual_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."qual_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qual_responses" ADD CONSTRAINT "qual_responses_study_id_qual_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."qual_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qual_studies" ADD CONSTRAINT "qual_studies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_access" ADD CONSTRAINT "tool_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qual_responses_study_idx" ON "qual_responses" USING btree ("study_id","created_at");--> statement-breakpoint
CREATE INDEX "qual_studies_owner_idx" ON "qual_studies" USING btree ("owner_id");