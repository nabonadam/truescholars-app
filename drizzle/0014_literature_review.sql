ALTER TYPE "public"."notification_kind" ADD VALUE 'LIT_REVIEW';--> statement-breakpoint
CREATE TABLE "lit_analyses" (
	"review_id" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lit_paper_text" (
	"paper_id" text PRIMARY KEY NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lit_papers" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"n" integer NOT NULL,
	"source" text DEFAULT 'CLIENT' NOT NULL,
	"status" text DEFAULT 'ACCEPTED' NOT NULL,
	"reject_reason" text,
	"file_key" text,
	"file_name" text,
	"size_bytes" integer,
	"pages" integer,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verify" jsonb,
	"note" text,
	"card" jsonb,
	"card_status" text DEFAULT 'none' NOT NULL,
	"card_error" text,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lit_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"research_question" text DEFAULT '' NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" text DEFAULT 'apa' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"job_id" text,
	"order_id" text,
	"expert_user_id" text,
	"search_log" jsonb,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lit_analyses" ADD CONSTRAINT "lit_analyses_review_id_lit_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."lit_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_paper_text" ADD CONSTRAINT "lit_paper_text_paper_id_lit_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."lit_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_papers" ADD CONSTRAINT "lit_papers_review_id_lit_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."lit_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_papers" ADD CONSTRAINT "lit_papers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD CONSTRAINT "lit_reviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD CONSTRAINT "lit_reviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lit_reviews" ADD CONSTRAINT "lit_reviews_expert_user_id_users_id_fk" FOREIGN KEY ("expert_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lit_papers_review_idx" ON "lit_papers" USING btree ("review_id","n");--> statement-breakpoint
CREATE INDEX "lit_reviews_owner_idx" ON "lit_reviews" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "lit_reviews_job_idx" ON "lit_reviews" USING btree ("job_id");