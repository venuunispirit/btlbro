// Admin auth middleware — extracted from server/index.js so both the Google
// Drive routes and the Sheet sync routes share the same protection.
// In production, use proper session/JWT auth.
export function adminAuth(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
}
