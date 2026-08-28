import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export function signAuthToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "7d" });
}

// Bearer token in the Authorization header, not a cookie: frontend and
// backend are deployed on different sites, and cross-site cookies are
// increasingly blocked by browsers (SameSite + third-party cookie
// restrictions) regardless of attributes. The frontend attaches this
// header itself on every request, sidestepping that entirely.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
