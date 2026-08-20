/**
 * Server-side Supabase client, bound to one Express request/response.
 *
 * @supabase/ssr's createServerClient just needs a way to read incoming cookies
 * and write outgoing ones — Express already does both natively (no
 * cookie-parser needed), matching the manual cookie handling already used in
 * server/portal.ts rather than adding a new dependency for it.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Request, Response } from "express";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = !!supabaseUrl && !!supabaseKey;

function parseCookies(header: string | undefined): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      return name ? { name, value: decodeURIComponent(value) } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}

export function createSupabaseServerClient(req: Request, res: Response) {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured — add VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY to .env");
  }
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return parseCookies(req.headers.cookie);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookie(name, value, options as CookieOptions);
        });
      },
    },
  });
}
