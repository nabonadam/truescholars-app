CREATE TABLE "stat_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"input" text NOT NULL,
	"mode" text NOT NULL,
	"commands" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"explanation" text,
	"results" jsonb,
	"interpretation" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"title" text NOT NULL,
	"history" text[] DEFAULT '{}'::text[] NOT NULL,
	"n_obs" integer NOT NULL,
	"n_vars" integer NOT NULL,
	"variables" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stat_datasets" ADD CONSTRAINT "stat_datasets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_runs" ADD CONSTRAINT "stat_runs_session_id_stat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_sessions" ADD CONSTRAINT "stat_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_sessions" ADD CONSTRAINT "stat_sessions_dataset_id_stat_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."stat_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stat_datasets_owner_idx" ON "stat_datasets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "stat_runs_session_idx" ON "stat_runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "stat_sessions_owner_idx" ON "stat_sessions" USING btree ("owner_id","updated_at");