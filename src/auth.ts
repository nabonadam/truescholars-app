import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { grantRole, isAdminEmail } from "@/server/vetting";

type AppRole = "CLIENT" | "EXPERT" | "ADMIN";

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
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const email = parsed.data.email.toLowerCase();
          const [user] = await db.select().from(users).where(eq(users.email, email));
          if (!user?.passwordHash) return null;
          const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
          return ok ? { id: user.id, name: user.name, email: user.email, image: user.image } : null;
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user }) {
        const userId = user?.id ?? token.sub;
        if (userId) {
          const [row] = await db.select({ roles: users.roles, email: users.email }).from(users).where(eq(users.id, userId));
          let roles = row?.roles ?? ["CLIENT"];
          // Emails listed in ADMIN_EMAILS are promoted to ADMIN the next time their session refreshes.
          if (row && isAdminEmail(row.email) && !roles.includes("ADMIN")) {
            await grantRole(db, userId, "ADMIN");
            roles = [...roles, "ADMIN"];
          }
          token.roles = roles;
        }
        return token;
      },
      async session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        session.user.roles = (token.roles as AppRole[] | undefined) ?? ["CLIENT"];
        return session;
      },
    },
  };
});

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
