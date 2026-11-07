// The True Scholars — marketplace data model (Drizzle + PostgreSQL).
// Money is always stored as integer minor units (pesewas for GHS).
// Wallet balances are never stored: they are summed from ledger_entries.

import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

// ───────────────────────── Enums ─────────────────────────

export const roleEnum = pgEnum("role", ["CLIENT", "EXPERT", "ADMIN"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "SUBMITTED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export const sellerLevelEnum = pgEnum("seller_level", ["NEW", "LEVEL_1", "LEVEL_2", "TOP_RATED"]);
export const listingStatusEnum = pgEnum("listing_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "PAUSED",
  "REJECTED",
]);
export const tierNameEnum = pgEnum("tier_name", ["BASIC", "STANDARD", "PRO"]);
export const jobStatusEnum = pgEnum("job_status", ["OPEN", "HIRED", "CLOSED", "CANCELLED"]);
export const proposalStatusEnum = pgEnum("proposal_status", [
  "SUBMITTED",
  "SHORTLISTED",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "AWAITING_PAYMENT",
  "ACTIVE",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
]);
export const milestoneStatusEnum = pgEnum("milestone_status", [
  "PENDING_FUNDING",
  "FUNDED",
  "DELIVERED",
  "REVISION_REQUESTED",
  "APPROVED",
  "REFUNDED",
]);
export const ledgerAccountEnum = pgEnum("ledger_account", [
  "EXTERNAL", // money outside the platform (Paystack in / payouts out)
  "ESCROW", // held for a specific milestone
  "EXPERT_AVAILABLE", // an expert's withdrawable earnings
  "PLATFORM_FEES", // platform revenue
  "PAYOUT_PENDING", // withdrawals requested by experts, waiting to be paid out
]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "FUND",
  "RELEASE",
  "FEE",
  "REFUND",
  "WITHDRAWAL",
  "REVERSAL",
]);
export const disputeStatusEnum = pgEnum("dispute_status", [
  "OPEN",
  "RESOLVED_RELEASE",
  "RESOLVED_PARTIAL",
  "RESOLVED_REFUND",
  "CANCELLED",
]);
export const withdrawalStatusEnum = pgEnum("withdrawal_status", ["REQUESTED", "PAID", "REJECTED"]);

// ───────────────────────── Accounts (Auth.js tables + ours) ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  roles: roleEnum("roles").array().notNull().default(sql`'{CLIENT}'::role[]`),
  country: text("country"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0), // bumped on password change: signs out other devices
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Profile photos, stored small (the browser resizes them to 320 px before upload). */
// Statistics Assistant access: a free trial clock (starts on first use) and any access granted after it.
export const statAccess = pgTable("stat_access", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  trialStartedAt: timestamp("trial_started_at", { mode: "date" }).notNull().defaultNow(),
  accessUntil: timestamp("access_until", { mode: "date" }),
  upgradeRequestedAt: timestamp("upgrade_requested_at", { mode: "date" }),
  note: text("note"),
  updatedAt: updatedAt(),
});

export const avatars = pgTable("avatars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ───────────────────────── Experts & vetting ─────────────────────────

export const expertApplications = pgTable("expert_applications", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  qualification: text("qualification").notNull(),
  fields: textArray("fields"),
  experienceYears: integer("experience_years").notNull(),
  pitch: text("pitch").notNull(),
  cvUrl: text("cv_url"),
  sampleUrl: text("sample_url"),
  idDocumentUrl: text("id_document_url"),
  litRetriever: boolean("lit_retriever").notNull().default(false), // wants private literature retrieval assignments
  status: applicationStatusEnum("status").notNull().default("SUBMITTED"),
  reviewerNote: text("reviewer_note"),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const expertProfiles = pgTable("expert_profiles", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline").notNull(),
  bio: text("bio"),
  skills: textArray("skills"),
  credentials: textArray("credentials"),
  level: sellerLevelEnum("level").notNull().default("NEW"),
  bidCredits: integer("bid_credits").notNull().default(20),
  creditsMonth: text("credits_month"), // "2026-11": month the free allowance was last topped up
  verifiedAt: timestamp("verified_at", { mode: "date" }),
  // Literature retrievers are assigned privately by an admin; their requests never appear on the job board.
  litRetriever: boolean("lit_retriever").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── Catalogue ─────────────────────────

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

// Fiverr-style packaged service
export const services = pgTable("services", {
  id: id(),
  expertId: text("expert_id")
    .notNull()
    .references(() => expertProfiles.id, { onDelete: "cascade" }),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  requirements: textArray("requirements"), // questions the client answers at checkout
  status: listingStatusEnum("status").notNull().default("DRAFT"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const serviceTiers = pgTable(
  "service_tiers",
  {
    id: id(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    name: tierNameEnum("name").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull().default("GHS"),
    deliveryDays: integer("delivery_days").notNull(),
    revisions: integer("revisions").notNull(),
    includes: textArray("includes"),
  },
  (t) => [uniqueIndex("service_tier_unique").on(t.serviceId, t.name)],
);

// Upwork-style job with bidding
export const jobs = pgTable("jobs", {
  id: id(),
  clientId: text("client_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  attachments: textArray("attachments"),
  budgetMinMinor: integer("budget_min_minor").notNull(),
  budgetMaxMinor: integer("budget_max_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  deadline: timestamp("deadline", { mode: "date" }),
  timelineDays: integer("timeline_days"), // how soon the client needs it; null = flexible
  skills: textArray("skills"),
  level: text("level").notNull().default("any"), // any | masters | phd

  status: jobStatusEnum("status").notNull().default("OPEN"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type MilestonePlanItem = { title: string; amountMinor: number; dueInDays: number };

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    expertId: text("expert_id")
      .notNull()
      .references(() => expertProfiles.id, { onDelete: "cascade" }),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull().default("GHS"),
    timelineDays: integer("timeline_days").notNull(),
    pitch: text("pitch").notNull(),
    milestonePlan: jsonb("milestone_plan").$type<MilestonePlanItem[]>().notNull(),
    status: proposalStatusEnum("status").notNull().default("SUBMITTED"),
    creditsSpent: integer("credits_spent").notNull().default(0),
    viewedAt: timestamp("viewed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("one_proposal_per_expert_per_job").on(t.jobId, t.expertId)],
);

// ───────────────────────── Orders & escrow ─────────────────────────

export const orders = pgTable("orders", {
  id: id(),
  clientId: text("client_id")
    .notNull()
    .references(() => users.id),
  expertId: text("expert_id")
    .notNull()
    .references(() => users.id),
  serviceId: text("service_id").references(() => services.id),
  tier: tierNameEnum("tier"),
  proposalId: text("proposal_id")
    .unique()
    .references(() => proposals.id),
  title: text("title").notNull(),
  totalMinor: integer("total_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  feeBps: integer("fee_bps").notNull(), // platform fee locked at order creation
  requirements: jsonb("requirements"),
  status: orderStatusEnum("status").notNull().default("AWAITING_PAYMENT"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    dueAt: timestamp("due_at", { mode: "date" }),
    revisionsAllowed: integer("revisions_allowed").notNull().default(2),
    revisionsUsed: integer("revisions_used").notNull().default(0),
    status: milestoneStatusEnum("status").notNull().default("PENDING_FUNDING"),
    autoApproveAt: timestamp("auto_approve_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("milestone_position").on(t.orderId, t.position)],
);

export const deliveries = pgTable("deliveries", {
  id: id(),
  milestoneId: text("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  files: textArray("files"),
  createdAt: createdAt(),
});

// Double-entry ledger: every money movement is a group of entries that sums to zero.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    transactionId: text("transaction_id").notNull(), // groups the entries of one movement
    account: ledgerAccountEnum("account").notNull(),
    userId: text("user_id").references(() => users.id), // owner for EXPERT_AVAILABLE
    milestoneId: text("milestone_id").references(() => milestones.id), // owner for ESCROW
    type: ledgerEntryTypeEnum("type").notNull(),
    amountMinor: integer("amount_minor").notNull(), // signed: + credit, - debit
    currency: text("currency").notNull().default("GHS"),
    reference: text("reference"), // Paystack reference or internal id
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_account_user").on(t.account, t.userId),
    index("ledger_milestone").on(t.milestoneId),
    index("ledger_tx").on(t.transactionId),
    // A given external reference can only be booked once per movement type (idempotency).
    uniqueIndex("ledger_reference_once")
      .on(t.reference, t.type, t.account)
      .where(sql`${t.reference} is not null`),
  ],
);

// Raw payment events from Paystack (webhook + verify), stored once per reference
export const paymentEvents = pgTable("payment_events", {
  id: id(),
  reference: text("reference").notNull().unique(),
  userId: text("user_id").references(() => users.id),
  purpose: text("purpose").notNull(), // "milestone" | "tool" | "test"
  milestoneId: text("milestone_id").references(() => milestones.id),
  plan: text("plan"), // tool plans: stats | qual | lit | all
  months: integer("months"),
  appliedAt: timestamp("applied_at", { mode: "date" }), // when a tool plan's access was switched on (once only)
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(), // "initialized" | "success" | "failed"
  raw: jsonb("raw"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── Notifications ─────────────────────────

export const notificationKindEnum = pgEnum("notification_kind", [
  "MESSAGE",
  "ORDER_PAID",
  "DELIVERED",
  "REVISION_REQUESTED",
  "PAYMENT_RELEASED",
  "REVIEW_RECEIVED",
  "APPLICATION_DECIDED",
  "NEW_PROPOSAL",
  "HIRED",
  "PROPOSAL_DECLINED",
  "JOB_MATCH",
  "DISPUTE",
  "PAYOUT",
  "LEVEL_UP",
  "TOOL_ACCESS",
  "STUDY_RESPONSE",
  "LIT_REVIEW",
  "LIT_REQUEST",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_time").on(t.userId, t.createdAt)],
);

// ───────────────────────── Files ─────────────────────────



// Uploaded files (deliveries, message attachments). Stored in Postgres for now (max 10 MB each);
// can move to object storage later without changing callers.
export const files = pgTable(
  "files",
  {
    id: id(),
    orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_order").on(t.orderId)],
);

// ───────────────────────── Messaging, reviews, disputes ─────────────────────────

export const threads = pgTable("threads", {
  id: id(),
  orderId: text("order_id")
    .unique()
    .references(() => orders.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .unique()
    .references(() => jobs.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const threadMembers = pgTable(
  "thread_members",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { mode: "date" }),
    starred: boolean("starred").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    files: textArray("files"),
    flagged: boolean("flagged").notNull().default(false), // e.g. contact details before hiring
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_time").on(t.threadId, t.createdAt)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    subjectId: text("subject_id")
      .notNull()
      .references(() => users.id),
    rating: integer("rating").notNull(), // 1–5
    body: text("body"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("one_review_per_author_per_order").on(t.orderId, t.authorId)],
);

export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").references(() => milestones.id, { onDelete: "cascade" }),
    openedById: text("opened_by_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(), // reason code: QUALITY | NOT_DELIVERED | LATE | SCOPE | UNRESPONSIVE | OTHER
    details: text("details"),
    evidence: textArray("evidence"),
    status: disputeStatusEnum("status").notNull().default("OPEN"),
    previousMilestoneStatus: text("previous_milestone_status"),
    respondBy: timestamp("respond_by", { mode: "date" }), // after this, our team can decide
    offerReleaseMinor: integer("offer_release_minor"), // latest settlement offer: amount to the expert
    offerById: text("offer_by_id").references(() => users.id),
    offerAt: timestamp("offer_at", { mode: "date" }),
    releasedMinor: integer("released_minor"),
    refundedMinor: integer("refunded_minor"),
    decision: text("decision"),
    resolvedById: text("resolved_by_id").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("disputes_order").on(t.orderId),
    index("disputes_milestone").on(t.milestoneId),
    uniqueIndex("one_open_dispute_per_milestone").on(t.milestoneId).where(sql`${t.status} = 'OPEN'`),
  ],
);

export const payoutMethods = pgTable("payout_methods", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // momo | bank
  provider: text("provider").notNull(), // MTN, Telecel, AirtelTigo, or the bank's name
  accountName: text("account_name").notNull(),
  accountNumber: text("account_number").notNull(),
  updatedAt: updatedAt(),
});

export type PayoutSnapshot = { kind: string; provider: string; accountName: string; accountNumber: string };

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("GHS"),
    status: withdrawalStatusEnum("status").notNull().default("REQUESTED"),
    method: jsonb("method").$type<PayoutSnapshot>().notNull(),
    payoutReference: text("payout_reference"), // e.g. the Mobile Money transaction ID
    note: text("note"),
    decidedById: text("decided_by_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("withdrawals_user").on(t.userId), index("withdrawals_status").on(t.status)],
);

// ───────────────────────── Statistics Assistant ─────────────────────────
// Uploaded datasets live here; the Python engine (stats/) reads them by id.
// A session is one workspace on one dataset. `history` holds the data-changing
// commands applied so far, so the engine can rebuild the working data exactly,
// and so the do-file reproduces everything.

export const statDatasets = pgTable(
  "stat_datasets",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("stat_datasets_owner_idx").on(t.ownerId)],
);

export const statSessions = pgTable(
  "stat_sessions",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => statDatasets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    history: textArray("history"),
    nObs: integer("n_obs").notNull(),
    nVars: integer("n_vars").notNull(),
    variables: jsonb("variables").notNull(),
    lastEstimation: text("last_estimation"), // the last model, so predict / estat / margins work later
    lastMargins: text("last_margins"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("stat_sessions_owner_idx").on(t.ownerId, t.updatedAt)],
);

export const statRuns = pgTable(
  "stat_runs",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => statSessions.id, { onDelete: "cascade" }),
    input: text("input").notNull(),
    mode: text("mode").notNull(), // STATA | ENGLISH
    commands: textArray("commands"),
    status: text("status").notNull(), // PLAN | DONE | ERROR | CANCELLED | CLARIFY
    explanation: text("explanation"),
    results: jsonb("results"),
    interpretation: text("interpretation"),
    createdAt: createdAt(),
  },
  (t) => [index("stat_runs_session_idx").on(t.sessionId, t.createdAt)],
);

// ───────────────────────── AI tool access (Qualitative Studio, and tools after it) ─────────────────────────
// Each tool has its own free trial, started the first time someone opens it.

export const toolAccess = pgTable(
  "tool_access",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(), // "qual"
    trialStartedAt: timestamp("trial_started_at", { mode: "date" }).notNull().defaultNow(),
    accessUntil: timestamp("access_until", { mode: "date" }),
    upgradeRequestedAt: timestamp("upgrade_requested_at", { mode: "date" }),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tool] })],
);

// ───────────────────────── Qualitative Studio ─────────────────────────
// A study is a voice/text survey shared by one public link; responses arrive without accounts.
// Audio lives in object storage (R2), or in qual_audio when R2 isn't configured.

export const qualStudies = pgTable(
  "qual_studies",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(), // the public link: /s/<token>
    title: text("title").notNull(),
    intro: text("intro").notNull().default(""), // information sheet and consent text shown before the questions
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`), // the draft being edited
    published: jsonb("published"), // what respondents see (a copy taken at publish)
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("DRAFT"), // DRAFT | LIVE | CLOSED
    publishedAt: timestamp("published_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("qual_studies_owner_idx").on(t.ownerId)],
);

export const qualResponses = pgTable(
  "qual_responses",
  {
    id: id(),
    studyId: text("study_id")
      .notNull()
      .references(() => qualStudies.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(), // the respondent's browser holds this to keep answering
    name: text("name"),
    email: text("email"),
    status: text("status").notNull().default("IN_PROGRESS"), // IN_PROGRESS | SUBMITTED
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    flagged: boolean("flagged").notNull().default(false), // a test response: left out of exports and analysis
    tags: textArray("tags"),
    userAgent: text("user_agent"),
    startedAt: createdAt(),
    submittedAt: timestamp("submitted_at", { mode: "date" }),
    updatedAt: updatedAt(),
  },
  (t) => [index("qual_responses_study_idx").on(t.studyId, t.startedAt)],
);

export const qualAudio = pgTable("qual_audio", {
  key: text("key").primaryKey(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

export const qualAnalyses = pgTable("qual_analyses", {
  studyId: text("study_id")
    .primaryKey()
    .references(() => qualStudies.id, { onDelete: "cascade" }),
  researchQuestion: text("research_question").notNull().default(""),
  background: text("background").notNull().default(""),
  state: jsonb("state").notNull().default(sql`'{}'::jsonb`), // familiarisation, codes, codebook, themes, matrix, report
  updatedAt: updatedAt(),
});

// ───────────────────────── Literature Review ─────────────────────────
// A review: the research question and brief, the papers (uploaded by the client or delivered by an expert
// through a marketplace job), and the AI analysis built from the accepted papers.

export const litReviews = pgTable(
  "lit_reviews",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    researchQuestion: text("research_question").notNull().default(""),
    brief: jsonb("brief").notNull().default(sql`'{}'::jsonb`), // purpose, discipline, papers wanted, years, scope, inclusion/exclusion…
    style: text("style").notNull().default("apa"), // apa | harvard | mla | chicago | vancouver
    // DRAFT → (REQUESTED → RETRIEVAL → REVIEWING, when an expert finds the papers) → ANALYSIS
    // REQUESTED: sent privately to the admins, who assign a dedicated literature retriever (never a public job)
    status: text("status").notNull().default("DRAFT"),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    orderId: text("order_id"),
    expertUserId: text("expert_user_id").references(() => users.id, { onDelete: "set null" }),
    searchLog: jsonb("search_log"), // the expert's databases, search strings, criteria and PRISMA counts
    deliveredAt: timestamp("delivered_at", { mode: "date" }),
    requestedAt: timestamp("requested_at", { mode: "date" }),
    requestDays: integer("request_days"), // how soon the client needs the literature
    assignedAt: timestamp("assigned_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lit_reviews_owner_idx").on(t.ownerId), index("lit_reviews_job_idx").on(t.jobId)],
);

export const litPapers = pgTable(
  "lit_papers",
  {
    id: id(),
    reviewId: text("review_id")
      .notNull()
      .references(() => litReviews.id, { onDelete: "cascade" }),
    n: integer("n").notNull(), // paper number within the review (P01, P02…)
    source: text("source").notNull().default("CLIENT"), // CLIENT | EXPERT
    status: text("status").notNull().default("ACCEPTED"), // PENDING (expert-delivered, awaiting the client) | ACCEPTED | REJECTED
    rejectReason: text("reject_reason"),
    fileKey: text("file_key"), // the PDF in storage (null for a DOI-only entry)
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    pages: integer("pages"),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`), // title, authors, year, journal, doi, abstract
    verify: jsonb("verify"), // Crossref check: found, title match, retraction
    note: text("note"), // the expert's relevance note
    summary: text("summary"), // the expert's own summary of the paper
    confirmedAt: timestamp("confirmed_at", { mode: "date" }), // the expert read it and entered its details by hand
    card: jsonb("card"), // the AI reading card
    cardStatus: text("card_status").notNull().default("none"), // none | done | failed
    cardError: text("card_error"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("lit_papers_review_idx").on(t.reviewId, t.n)],
);

export const litPaperText = pgTable("lit_paper_text", {
  paperId: text("paper_id")
    .primaryKey()
    .references(() => litPapers.id, { onDelete: "cascade" }),
  pages: jsonb("pages").notNull().default(sql`'[]'::jsonb`), // text of each page, for reading and checking quotes
});

export const litAnalyses = pgTable("lit_analyses", {
  reviewId: text("review_id")
    .primaryKey()
    .references(() => litReviews.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull().default(sql`'{}'::jsonb`), // synthesis, outline, sections
  updatedAt: updatedAt(),
});

// ───────────────────────── Scheduled jobs ─────────────────────────

/** One row per reminder already sent by the hourly job, so each is sent once. */
export const cronMarks = pgTable("cron_marks", {
  key: text("key").primaryKey(),
  sentAt: timestamp("sent_at", { mode: "date" }).notNull().defaultNow(),
});

/** Exchange rates (cedis per unit of the currency), refreshed daily by the hourly job. */
export const fxRates = pgTable("fx_rates", {
  code: text("code").primaryKey(), // "USD"
  ghsPerUnit: doublePrecision("ghs_per_unit").notNull(),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
