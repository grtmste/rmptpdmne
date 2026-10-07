import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { sendMagicLink } from "@/lib/email";

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

// Räsi, mille vastu kontrollitakse olematu kasutaja korral, et vastuse aeg ei paljastaks,
// kas e-post on registreeritud.
let dummyHash: Promise<string> | undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]),
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        if (!(await limitAuthAttempt("login", email))) throw new RateLimitedSignin();

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          dummyHash ??= hashPassword("timing-equalizer-password");
          await verifyPassword(await dummyHash, password);
          return null;
        }
        if (!(await verifyPassword(user.passwordHash, password))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "dev",
      from: process.env.EMAIL_FROM ?? "LILY SOKID <noreply@example.com>",
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLink(identifier, url);
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Magic link: lubame ainult olemasolevaid kasutajaid (registreerimine käib eraldi vormiga).
      if (account?.provider === "resend") {
        const email = user.email?.toLowerCase();
        if (!email) return false;
        if (!(await limitAuthAttempt("magic", email))) return false;
        const exists = await db.user.findUnique({ where: { email }, select: { id: true } });
        return Boolean(exists);
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
