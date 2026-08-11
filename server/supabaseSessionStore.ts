import { Store } from "express-session";
import type { SupabaseClient } from "@supabase/supabase-js";

// express-session defaults to an in-memory store — fine for a single
// long-running process, but a login on one Vercel serverless instance is
// invisible to the next request if it lands on a different (or recycled)
// container. Backing sessions in the same Postgres project the app already
// talks to (via the existing service-role client, no new credentials) makes
// login survive across instances without standing up a separate store.
export class SupabaseSessionStore extends Store {
  constructor(private db: SupabaseClient) {
    super();
  }

  async get(sid: string, callback: (err: any, session?: any) => void) {
    try {
      const { data, error } = await this.db.from("sessions").select("sess, expire").eq("sid", sid).maybeSingle();
      if (error) return callback(error);
      if (!data || new Date(data.expire) < new Date()) return callback(null, null);
      callback(null, data.sess);
    } catch (e) {
      callback(e);
    }
  }

  async set(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const maxAge = session.cookie?.maxAge ?? 24 * 60 * 60 * 1000;
      const expire = new Date(Date.now() + maxAge).toISOString();
      const { error } = await this.db.from("sessions").upsert({ sid, sess: session, expire }, { onConflict: "sid" });
      callback?.(error || undefined);
    } catch (e) {
      callback?.(e);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      const { error } = await this.db.from("sessions").delete().eq("sid", sid);
      callback?.(error || undefined);
    } catch (e) {
      callback?.(e);
    }
  }

  async touch(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const maxAge = session.cookie?.maxAge ?? 24 * 60 * 60 * 1000;
      const expire = new Date(Date.now() + maxAge).toISOString();
      const { error } = await this.db.from("sessions").update({ expire }).eq("sid", sid);
      callback?.(error || undefined);
    } catch (e) {
      callback?.(e);
    }
  }
}
