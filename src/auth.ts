import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { grantRole, isAdminEmail } from "@/server/vetting";
import { clearLimit, clientIp, hit } from "@/server/rateLimit";

/** Shown on the sign-in form when an account or address has had too many failed tries. */
export class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5Ib3bBZtzDLkPDKfcFXSY.NnKQ26gNe";

type AppRole = "CLIENT" | "EXPERT" | "ADMIN";

declare module "@auth/core/jwt" {
  interface JWT {
    roles?: AppRole[];
    sv?: number;
  }
}

declare module "next-auth" {
  interface Session {
    user: { id: string; roles: AppRole[] } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Lazy config: the database is only touched when a request needs it (not at build time).
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb();
  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "jwt" }, // required for email/password sign-in
    pages: { signIn: "/sign-in" },
    providers: [
      ...(process.env.AUTH_GOOGLE_ID ? [Google({ allowDangerousEmailAccountLinking: false })] : []),
      Credentials({
        credentials: { email: {}, password: {} },
        async authorize(raw, request) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const email = parsed.data.email.toLowerCase();
          // Password guessing: at most 8 tries per account and 40 per address every 15 minutes.
          const ip = request instanceof Request ? clientIp(request.headers) : "unknown";
          const [perEmail, perIp] = await Promise.all([hit(db, `signin:email:${email}`, 8, 900), hit(db, `signin:ip:${ip}`, 40, 900)]);
          if (!perEmail || !perIp) throw new TooManyAttempts();
          const [user] = await db.select().from(users).where(eq(users.email, email));
          if (!user?.passwordHash) {
            await bcrypt.compare(parsed.data.password, DUMMY_HASH); // same timing whether or not the account exists
            return null;
          }
          const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
          if (!ok) return null;
          await clearLimit(db, `signin:email:${email}`);
          return { id: user.id, name: user.name, email: user.email, image: user.image };
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user }) {
        const userId = user?.id ?? token.sub;
        if (userId) {
          const [row] = await db
            .select({ roles: users.roles, email: users.email, emailVerified: users.emailVerified, name: users.name, image: users.image, sv: users.sessionVersion })
            .from(users)
            .where(eq(users.id, userId));
          if (!row) return null; // account removed
          // A password change bumps the version: sessions from before it end here (other devices are signed out).
          if (user) token.sv = row.sv;
          else if ((token.sv ?? 0) !== row.sv) return null;
          token.name = row.name; // name and photo changes show up straight away
          token.picture = row.image;
          let roles = row?.roles ?? ["CLIENT"];
          // Emails listed in ADMIN_EMAILS are promoted to ADMIN the next time their session refreshes, but only
          // once the address is proven (verified by email link or Google): signing up with it isn't enough.
          if (row && row.emailVerified && isAdminEmail(row.email) && !roles.includes("ADMIN")) {
            await grantRole(db, userId, "ADMIN");
            roles = [...roles, "ADMIN"];
          }
          token.roles = roles;
        }
        return token;
      },
      async session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        session.user.name = (token.name as string | null | undefined) ?? session.user.name;
        session.user.image = (token.picture as string | null | undefined) ?? null;
        session.user.roles = (token.roles as AppRole[] | undefined) ?? ["CLIENT"];
        return session;
      },
    },
  };
});

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
