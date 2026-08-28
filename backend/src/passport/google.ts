import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env, isGoogleOAuthConfigured } from "../config/env";
import { prisma } from "../lib/prisma";
import { createEtherealAccount } from "../services/mailer";

export function configurePassport(): void {
  if (!isGoogleOAuthConfigured) {
    console.warn(
      "[auth] GOOGLE_CLIENT_ID/SECRET not set — /api/auth/google will 503 until you add real credentials to backend/.env"
    );
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.googleClientId,
        clientSecret: env.googleClientSecret,
        callbackURL: `${env.backendUrl}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("Google account has no email"));

          let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
          if (!user) {
            user = await prisma.user.create({
              data: {
                googleId: profile.id,
                email,
                name: profile.displayName || email,
                avatarUrl: profile.photos?.[0]?.value,
              },
            });

            // Give every new user one ready-to-use Ethereal sender so they
            // can compose and schedule immediately without a separate
            // "create sender" setup step.
            const smtp = await createEtherealAccount();
            await prisma.sender.create({
              data: {
                userId: user.id,
                email: user.email,
                displayName: user.name,
                ...smtp,
              },
            });
          }

          done(null, { id: user.id });
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}
