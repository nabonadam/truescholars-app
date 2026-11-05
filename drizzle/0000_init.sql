CREATE TYPE "public"."application_status" AS ENUM('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('OPEN', 'HIRED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('EXTERNAL', 'ESCROW', 'EXPERT_AVAILABLE', 'PLATFORM_FEES');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('FUND', 'RELEASE', 'FEE', 'REFUND', 'WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('PENDING_FUNDING', 'FUNDED', 'DELIVERED', 'REVISION_REQUESTED', 'APPROVED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('AWAITING_PAYMENT', 'ACTIVE', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CLIENT', 'EXPERT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."seller_level" AS ENUM('NEW', 'LEVEL_1', 'LEVEL_2', 'TOP_RATED');--> statement-breakpoint
CREATE TYPE "public"."tier_name" AS ENUM('BASIC', 'STANDARD', 'PRO');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"milestone_id" text NOT NULL,
	"note" text NOT NULL,
	"files" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"opened_by_id" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"decision" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "expert_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"qualification" text NOT NULL,
	"fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_years" integer NOT NULL,
	"pitch" text NOT NULL,
	"cv_url" text,
	"sample_url" text,
	"id_document_url" text,
	"status" "application_status" DEFAULT 'SUBMITTED' NOT NULL,
	"reviewer_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expert_applications_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "expert_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"headline" text NOT NULL,
	"bio" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"credentials" text[] DEFAULT '{}'::text[] NOT NULL,
	"level" "seller_level" DEFAULT 'NEW' NOT NULL,
	"bid_credits" integer DEFAULT 20 NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expert_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"attachments" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget_min_minor" integer NOT NULL,
	"budget_max_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"deadline" timestamp,
	"status" "job_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account" "ledger_account" NOT NULL,
	"user_id" text,
	"milestone_id" text,
	"type" "ledger_entry_type" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"files" text[] DEFAULT '{}'::text[] NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"due_at" timestamp,
	"revisions_allowed" integer DEFAULT 2 NOT NULL,
	"revisions_used" integer DEFAULT 0 NOT NULL,
	"status" "milestone_status" DEFAULT 'PENDING_FUNDING' NOT NULL,
	"auto_approve_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"service_id" text,
	"tier" "tier_name",
	"proposal_id" text,
	"title" text NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"fee_bps" integer NOT NULL,
	"requirements" jsonb,
	"status" "order_status" DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"user_id" text,
	"purpose" text NOT NULL,
	"milestone_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"timeline_days" integer NOT NULL,
	"pitch" text NOT NULL,
	"milestone_plan" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'SUBMITTED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"author_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"name" "tier_name" NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"delivery_days" integer NOT NULL,
	"revisions" integer NOT NULL,
	"includes" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"expert_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "listing_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_members" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp,
	CONSTRAINT "thread_members_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "threads_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "threads_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"password_hash" text,
	"roles" "role"[] DEFAULT '{CLIENT}'::role[] NOT NULL,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_applications" ADD CONSTRAINT "expert_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_expert_id_users_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_expert_id_expert_profiles_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."expert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tiers" ADD CONSTRAINT "service_tiers_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_expert_id_expert_profiles_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."expert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_account_user" ON "ledger_entries" USING btree ("account","user_id");--> statement-breakpoint
CREATE INDEX "ledger_milestone" ON "ledger_entries" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "ledger_tx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reference_once" ON "ledger_entries" USING btree ("reference","type","account") WHERE "ledger_entries"."reference" is not null;--> statement-breakpoint
CREATE INDEX "messages_thread_time" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_position" ON "milestones" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "one_proposal_per_expert_per_job" ON "proposals" USING btree ("job_id","expert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_review_per_author_per_order" ON "reviews" USING btree ("order_id","author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_tier_unique" ON "service_tiers" USING btree ("service_id","name");