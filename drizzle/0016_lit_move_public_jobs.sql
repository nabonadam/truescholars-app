-- Retrieval requests sent before private assignment existed were posted as public jobs.
-- Move any that nobody was hired on into the admins' private queue and take the job off the board.
UPDATE "expert_profiles" ep SET "bid_credits" = ep."bid_credits" + p."credits_spent"
FROM "proposals" p, "lit_reviews" r
WHERE p."expert_id" = ep."id" AND p."job_id" = r."job_id" AND r."status" = 'RETRIEVAL' AND r."expert_user_id" IS NULL
  AND p."status" IN ('SUBMITTED', 'SHORTLISTED') AND p."credits_spent" > 0;--> statement-breakpoint
UPDATE "proposals" p SET "status" = 'DECLINED'
FROM "lit_reviews" r
WHERE p."job_id" = r."job_id" AND r."status" = 'RETRIEVAL' AND r."expert_user_id" IS NULL AND p."status" IN ('SUBMITTED', 'SHORTLISTED');--> statement-breakpoint
UPDATE "jobs" j SET "status" = 'CANCELLED'
FROM "lit_reviews" r
WHERE j."id" = r."job_id" AND r."status" = 'RETRIEVAL' AND r."expert_user_id" IS NULL AND j."status" = 'OPEN';--> statement-breakpoint
UPDATE "lit_reviews" SET "status" = 'REQUESTED', "requested_at" = COALESCE("requested_at", "updated_at"), "request_days" = COALESCE("request_days", 7), "job_id" = NULL
WHERE "status" = 'RETRIEVAL' AND "expert_user_id" IS NULL AND "job_id" IS NOT NULL;--> statement-breakpoint
-- Titles that were the research question cut at 120 characters: end them on a whole word instead.
UPDATE "lit_reviews" SET "title" = regexp_replace(left("research_question", 90), '[\s,;:-]*\s+\S*$', '') || '…'
WHERE length("research_question") > 120 AND "title" = left("research_question", 120);
