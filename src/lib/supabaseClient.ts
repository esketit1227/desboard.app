/**
 * Browser-side Supabase client.
 *
 * Uses the publishable (anon) key, safe to ship to the browser — Supabase's
 * row-level security policies are what actually gate access, not this key.
 */
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => createBrowserClient(supabaseUrl, supabaseKey);
