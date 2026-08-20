/**
 * Session-refresh middleware — the Express equivalent of the Next.js
 * middleware pattern for @supabase/ssr. Runs before routes so an expiring
 * auth token gets refreshed (and its updated cookies attached to the
 * response) before any handler needs it.
 *
 * A no-op until Supabase is actually configured and something starts issuing
 * sessions (there's no login flow wired up yet) — safe to mount unconditionally.
 */
import type { NextFunction, Request, Response } from "express";
import { createSupabaseServerClient, supabaseConfigured } from "./supabase.ts";

export async function supabaseSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!supabaseConfigured) return next();
  try {
    const supabase = createSupabaseServerClient(req, res);
    await supabase.auth.getUser();
  } catch (e) {
    console.error("[supabase] Session refresh failed", e);
  }
  next();
}
