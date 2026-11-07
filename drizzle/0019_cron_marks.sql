CREATE TABLE "cron_marks" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
