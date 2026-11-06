/** In-app notifications (the bell) plus email alerts for the moments that need action. */

import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { notifications, users } from "@/db/schema";
import { renderEmail, sendEmail } from "@/lib/mailer";

export type NotificationKind = (typeof notifications.$inferInsert)["kind"];

const CTA: Record<NotificationKind, string> = {
  MESSAGE: "Read the message",
  ORDER_PAID: "Open the order",
  DELIVERED: "Review the delivery",
  REVISION_REQUESTED: "See what to change",
  PAYMENT_RELEASED: "View your earnings",
  REVIEW_RECEIVED: "See the review",
  APPLICATION_DECIDED: "View your application",
};

/**
 * Creates a notification and emails the user. For messages, only the first unread one per order
 * is emailed, so a busy conversation doesn't flood the inbox. Never throws.
 */
export async function notify(
  db: DB,
  p: { userId: string; kind: NotificationKind; title: string; body?: string; link: string; orderId?: string },
) {
  try {
    let shouldEmail = true;
    if (p.kind === "MESSAGE" && p.orderId) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, p.userId), eq(notifications.kind, "MESSAGE"), eq(notifications.orderId, p.orderId), isNull(notifications.readAt)));
      shouldEmail = Number(n) === 0;
    }
    await db.insert(notifications).values({
      userId: p.userId,
      kind: p.kind,
      title: p.title,
      body: p.body ?? null,
      link: p.link,
      orderId: p.orderId ?? null,
    });
    if (shouldEmail) {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.userId));
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      if (u?.email) {
        await sendEmail({
          to: u.email,
          subject: p.title,
          html: renderEmail({ title: p.title, body: p.body, ctaLabel: CTA[p.kind], ctaUrl: `${base}${p.link}` }),
        });
      }
    }
  } catch (err) {
    console.error("notify failed", err);
  }
}

export async function unreadNotificationCount(db: DB, userId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(n);
}

export async function listNotifications(db: DB, userId: string, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markAllRead(db: DB, userId: string) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** Opening an order counts as reading its notifications. */
export async function markOrderNotificationsRead(db: DB, userId: string, orderId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.orderId, orderId), isNull(notifications.readAt)));
}
