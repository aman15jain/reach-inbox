import { Router } from "express";
import passport from "passport";
import { env, isGoogleOAuthConfigured } from "../config/env";
import { prisma } from "../lib/prisma";
import { requireAuth, signAuthToken } from "../middleware/requireAuth";

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
    // Handed off via URL fragment, not a cookie: fragments are never sent
    // to any server (ours or anyone else's) on subsequent requests, and
    // this sidesteps cross-site cookie blocking entirely. The frontend
    // reads it once on load, stores it, and attaches it as a Bearer token
    // from then on (see frontend/src/context/AuthContext.tsx).
    res.redirect(`${env.frontendUrl}/dashboard#token=${token}`);
  }
);

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });
});

authRouter.post("/logout", (_req, res) => {
  // Stateless JWT — nothing to invalidate server-side. The frontend drops
  // the token from localStorage; this endpoint exists for API symmetry.
  res.json({ ok: true });
});
