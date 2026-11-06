/** Fiverr-style services: experts create them with up to three tiers; clients browse and search. */

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, expertProfiles, services, serviceTiers, users } from "@/db/schema";

export class ServiceError extends Error {}

export type TierName = "BASIC" | "STANDARD" | "PRO";
export interface TierInput {
  name: TierName;
  priceMinor: number;
  deliveryDays: number;
  revisions: number;
  includes: string[];
}
export interface ServiceInput {
  title: string;
  categoryId: string;
  description: string;
  requirements: string[];
  tiers: TierInput[]; // BASIC required; STANDARD and PRO optional
}

const TIER_ORDER: TierName[] = ["BASIC", "STANDARD", "PRO"];

export function validateTiers(tiers: TierInput[]): void {
  if (!tiers.some((t) => t.name === "BASIC")) throw new ServiceError("A Basic package is required.");
  const names = new Set(tiers.map((t) => t.name));
  if (names.size !== tiers.length) throw new ServiceError("Each package can only appear once.");
  for (const t of tiers) {
    if (!Number.isSafeInteger(t.priceMinor) || t.priceMinor < 1_000) throw new ServiceError(`${t.name}: minimum price is GH₵10.`);
    if (!Number.isInteger(t.deliveryDays) || t.deliveryDays < 1 || t.deliveryDays > 90) throw new ServiceError(`${t.name}: delivery must be 1–90 days.`);
    if (!Number.isInteger(t.revisions) || t.revisions < 0 || t.revisions > 10) throw new ServiceError(`${t.name}: revisions must be 0–10.`);
  }
  const sorted = [...tiers].sort((a, b) => TIER_ORDER.indexOf(a.name) - TIER_ORDER.indexOf(b.name));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].priceMinor <= sorted[i - 1].priceMinor) throw new ServiceError("Higher packages must cost more than lower ones.");
  }
}

export async function listCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function getExpertProfileByUser(db: DB, userId: string) {
  const [p] = await db.select().from(expertProfiles).where(eq(expertProfiles.userId, userId));
  return p ?? null;
}

async function writeTiers(tx: DB, serviceId: string, tiers: TierInput[]) {
  await tx.delete(serviceTiers).where(eq(serviceTiers.serviceId, serviceId));
  await tx.insert(serviceTiers).values(tiers.map((t) => ({ ...t, serviceId, currency: "GHS" })));
}

/** Creates (or, with serviceId, updates) a service owned by this expert. Published immediately as ACTIVE. */
export async function saveService(db: DB, userId: string, input: ServiceInput, serviceId?: string) {
  validateTiers(input.tiers);
  const profile = await getExpertProfileByUser(db, userId);
  if (!profile) throw new ServiceError("Only approved experts can create services.");

  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const fields = {
      title: input.title,
      categoryId: input.categoryId,
      description: input.description,
      requirements: input.requirements,
    };
    if (serviceId) {
      const [existing] = await tx.select().from(services).where(eq(services.id, serviceId));
      if (!existing || existing.expertId !== profile.id) throw new ServiceError("Service not found.");
      await tx.update(services).set(fields).where(eq(services.id, serviceId));
      await writeTiers(t, serviceId, input.tiers);
      return serviceId;
    }
    const [created] = await tx.insert(services).values({ ...fields, expertId: profile.id, status: "ACTIVE" }).returning();
    await writeTiers(t, created.id, input.tiers);
    return created.id;
  });
}

export async function setServiceStatus(db: DB, userId: string, serviceId: string, status: "ACTIVE" | "PAUSED") {
  const profile = await getExpertProfileByUser(db, userId);
  if (!profile) throw new ServiceError("Not an expert.");
  const res = await db
    .update(services)
    .set({ status })
    .where(and(eq(services.id, serviceId), eq(services.expertId, profile.id)))
    .returning({ id: services.id });
  if (res.length === 0) throw new ServiceError("Service not found.");
}

/** Public search over ACTIVE services, with the lowest price ("from") per service. */
export async function searchServices(db: DB, opts: { q?: string; category?: string; limit?: number } = {}) {
  const conditions = [eq(services.status, "ACTIVE")];
  if (opts.category) conditions.push(eq(categories.slug, opts.category));
  if (opts.q?.trim()) {
    const term = `%${opts.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(services.title, term), ilike(services.description, term), ilike(categories.name, term))!);
  }
  return db
    .select({
      id: services.id,
      title: services.title,
      categoryName: categories.name,
      categorySlug: categories.slug,
      expertName: users.name,
      expertUserId: users.id,
      expertHeadline: expertProfiles.headline,
      level: expertProfiles.level,
      createdAt: services.createdAt,
      fromMinor: sql<number>`min(${serviceTiers.priceMinor})`.mapWith(Number),
      fastestDays: sql<number>`min(${serviceTiers.deliveryDays})`.mapWith(Number),
    })
    .from(services)
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .innerJoin(expertProfiles, eq(expertProfiles.id, services.expertId))
    .innerJoin(users, eq(users.id, expertProfiles.userId))
    .innerJoin(serviceTiers, eq(serviceTiers.serviceId, services.id))
    .where(and(...conditions))
    .groupBy(services.id, categories.id, expertProfiles.id, users.id)
    .orderBy(desc(services.createdAt))
    .limit(opts.limit ?? 48);
}

/** A service with its tiers and expert, for the service page. */
export async function getService(db: DB, serviceId: string) {
  const [row] = await db
    .select({
      service: services,
      categoryName: categories.name,
      categorySlug: categories.slug,
      expert: {
        userId: users.id,
        name: users.name,
        headline: expertProfiles.headline,
        bio: expertProfiles.bio,
        skills: expertProfiles.skills,
        level: expertProfiles.level,
        verifiedAt: expertProfiles.verifiedAt,
      },
    })
    .from(services)
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .innerJoin(expertProfiles, eq(expertProfiles.id, services.expertId))
    .innerJoin(users, eq(users.id, expertProfiles.userId))
    .where(eq(services.id, serviceId));
  if (!row) return null;
  const tiers = await db.select().from(serviceTiers).where(eq(serviceTiers.serviceId, serviceId));
  tiers.sort((a, b) => TIER_ORDER.indexOf(a.name) - TIER_ORDER.indexOf(b.name));
  return { ...row, tiers };
}

export async function listServicesForExpert(db: DB, userId: string) {
  const profile = await getExpertProfileByUser(db, userId);
  if (!profile) return [];
  const rows = await db
    .select({ id: services.id, title: services.title, status: services.status, categoryName: categories.name, updatedAt: services.updatedAt })
    .from(services)
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(eq(services.expertId, profile.id))
    .orderBy(desc(services.updatedAt));
  if (rows.length === 0) return [];
  const tiers = await db.select().from(serviceTiers).where(inArray(serviceTiers.serviceId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    ...r,
    fromMinor: Math.min(...tiers.filter((t) => t.serviceId === r.id).map((t) => t.priceMinor)),
  }));
}
