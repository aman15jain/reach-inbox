import { Router } from "express";
import passport from "passport";
import { env, isGoogleOAuthConfigured } from "../config/env";
import { prisma } from "../lib/prisma";
import { AUTH_COOKIE_NAME, requireAuth, signAuthToken } from "../middleware/requireAuth";

export const authRouter = Router();

authRouter.get("/google", (req, res, next) => {
  if (!isGoogleOAuthConfigured) {
    return res.status(503).json({
      error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env",
    });
  }
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
});

authRouter.get(
  "/google/callback",
  (req, res, next) => {
    if (!isGoogleOAuthConfigured) return res.redirect(`${env.frontendUrl}/login?error=oauth_not_configured`);
    passport.authenticate("google", { session: false, failureRedirect: `${env.frontendUrl}/login?error=oauth_failed` })(
      req,
      res,
      next
    );
  },
  (req, res) => {
    const user = req.user as { id: string };
    const token = signAuthToken(user.id);
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${env.frontendUrl}/dashboard`);
  }
);

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.json({ ok: true });
});
