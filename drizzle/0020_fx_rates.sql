CREATE TABLE "fx_rates" (
	"code" text PRIMARY KEY NOT NULL,
	"ghs_per_unit" double precision NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
