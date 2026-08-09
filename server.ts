import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { createServer } from "http";
import helmet from "helmet";
import session from "express-session";
import cron from "node-cron";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import { scoreSlot } from "./server/services/slotEngine.js";
import { estimateDurationMinutes, estimateEndTime, intervalsOverlap } from "./server/services/appointmentDuration.js";
import { checkAppointmentCapacity, hourBucket } from "./server/services/appointmentCapacity.js";
import { evaluateReading, isReadingStale, STALE_READING_HOURS } from "./server/services/reeferMonitor.js";
import { evaluateSla, isNoShow, isOnTimeArrival } from "./server/services/complianceMonitor.js";
import { shouldNotifyExpiry } from "./server/services/vehicleExpiry.js";
import { nextExpiryAlertLevel, missingDocumentTypes } from "./server/services/documentExpiry.js";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import PDFDocument from "pdfkit";
import multer from "multer";
import { db, unwrap } from "./server/supabaseClient.js";
import { logger } from "./server/logger.js";
import { getCurrentTemperature } from "./server/services/smhiWeather.js";
import { generateSecret as generateTotpSecret, verifyToken as verifyTotpToken, otpauthUrl as totpUri } from "./server/services/totp.js";
import { checkStageTransition, isLoadReady } from "./server/services/gatePassStages.js";
import { isDockSlaBreached } from "./server/services/dockSla.js";
import { countTodayNoShows, countExpectedArrivalsToday, countBusyHostlers, summarizeZoneOccupancy, matchExceptionPlatesToSpotIds } from "./server/services/todayOps.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production — refusing to start with a hardcoded fallback secret.");
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (isProd && allowedOrigins.length === 0) {
  throw new Error("ALLOWED_ORIGINS must be set in production — refusing to start with CORS open to all origins.");
}

const corsOriginCheck = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!isProd || !origin || allowedOrigins.includes(origin)) return callback(null, true);
  callback(new Error("Not allowed by CORS"));
};

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: isProd ? allowedOrigins : "*" }
  });

  const facilityPresence: Record<number, any[]> = {};

  io.on("connection", (socket) => {
    socket.on("join-facility", ({ facilityId, user }) => {
      socket.join(`facility-${facilityId}`);
      if (!facilityPresence[facilityId]) facilityPresence[facilityId] = [];

      facilityPresence[facilityId] = facilityPresence[facilityId].filter(u => u.id !== user.id);
      facilityPresence[facilityId].push({ ...user, socketId: socket.id });

      io.to(`facility-${facilityId}`).emit("presence-update", facilityPresence[facilityId]);
    });

    socket.on("cursor-move", ({ facilityId, x, y }) => {
      socket.to(`facility-${facilityId}`).emit("cursor-update", { socketId: socket.id, x, y });
    });

    socket.on("disconnect", () => {
      for (const fId in facilityPresence) {
        facilityPresence[fId] = facilityPresence[fId].filter(u => u.socketId !== socket.id);
        io.to(`facility-${fId}`).emit("presence-update", facilityPresence[fId]);
      }
    });
  });

  const PORT = Number(process.env.PORT) || 4000;

  if (isProd) app.set("trust proxy", 1);

  app.use(session({
    secret: process.env.SESSION_SECRET || "skyyard-secret-v4-quantum",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProd, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 }
  }));

  app.use(helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "wss:", "https:"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
          },
        }
      : false, // Disable for Vite dev (HMR needs inline/eval)
  }));

  // --- Yard status (the single read that powers Dashboard, Gate Console, Dispatch, Live Tracking) ---
  const getYardStatus = async (facilityId: number) => {
    const { data: statsData } = await db.rpc("get_yard_stats", { f_id: facilityId });

    const { data: spots } = await db
      .from("spots")
      .select("*, trailers!trailers_spot_id_fkey(id, plate, carrier, status, check_in_time, checked_in_at, equipment_type, seal_number, driver_license, po_number, sku_summary, reefer_temp_setpoint, hazmat_class, tare_weight_kg, damage_photos, cargo_status)")
      .eq("facility_id", facilityId);

    const flatSpots = (spots || []).map((s: any) => {
      const trailer = Array.isArray(s.trailers) ? s.trailers.find((t: any) => t.status !== "DISPATCHED") : null;
      const { trailers, ...rest } = s;
      return {
        ...rest,
        trailer_id: trailer?.id,
        plate: trailer?.plate,
        carrier: trailer?.carrier,
        trailer_status: trailer?.status,
        check_in_time: trailer?.check_in_time,
        checked_in_at: trailer?.checked_in_at,
        equipment_type: trailer?.equipment_type,
        seal_number: trailer?.seal_number,
        driver_license: trailer?.driver_license,
        po_number: trailer?.po_number,
        sku_summary: trailer?.sku_summary,
        reefer_temp_setpoint: trailer?.reefer_temp_setpoint,
        hazmat_class: trailer?.hazmat_class,
        tare_weight_kg: trailer?.tare_weight_kg,
        damage_photos: trailer?.damage_photos,
        cargo_status: trailer?.cargo_status,
      };
    });

    const { data: moveRows } = await db
      .from("move_orders")
      .select("*, trailers(plate), from_spot:spots!move_orders_from_spot_id_fkey(name), to_spot:spots!move_orders_to_spot_id_fkey(name), assignee:users!move_orders_assigned_to_fkey(id, name)")
      .eq("facility_id", facilityId)
      .neq("status", "COMPLETED");

    const priorityWeight: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
    const moves = (moveRows || [])
      .map((m: any) => ({
        ...m,
        plate: m.trailers?.plate,
        from_name: m.from_spot?.name,
        to_name: m.to_spot?.name,
        assignee_name: m.assignee?.name || null,
      }))
      .sort((a: any, b: any) => (priorityWeight[b.priority] ?? 1) - (priorityWeight[a.priority] ?? 1) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const { data: fSettings } = await db.from("facility_settings").select("detention_threshold_hours").eq("facility_id", facilityId).maybeSingle();

    // Dashboard's "Avg. Dwell" and "Daily Velocity" were literal hardcoded
    // constants (42 and 128) — never computed from anything, displayed as
    // if real on the very first screen a manager sees. Real numbers,
    // computed from today's actual departures.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: departedToday } = await db.from("trailers").select("checked_in_at, checked_out_at").eq("facility_id", facilityId).not("checked_out_at", "is", null).gte("checked_out_at", todayStart.toISOString());
    const dwellSamples = (departedToday || []).filter((t: any) => t.checked_in_at).map((t: any) => (new Date(t.checked_out_at).getTime() - new Date(t.checked_in_at).getTime()) / 60000);
    const avgDwellMinutes = dwellSamples.length ? Math.round(dwellSamples.reduce((a, b) => a + b, 0) / dwellSamples.length) : null;
    const dailyVelocity = (departedToday || []).length;

    // Command Center gap: the "Today's Operations" answer (expected
    // arrivals / no-shows / active moves) didn't exist anywhere as a
    // headline number — reuses this same todayStart boundary rather than
    // introducing a second definition of "today".
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: todaysAppointments } = await db
      .from("appointments")
      .select("status, start_time, no_show_flag")
      .eq("facility_id", facilityId)
      .gte("start_time", todayStart.toISOString())
      .lt("start_time", todayEnd);
    const { count: totalHostlers } = await db.from("users").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).eq("role", "HOSTLER");
    const busyHostlers = countBusyHostlers(moves);
    const today = {
      expectedArrivals: countExpectedArrivalsToday(todaysAppointments || [], todayStart.toISOString(), todayEnd),
      noShows: countTodayNoShows(todaysAppointments || [], todayStart.toISOString()),
      activeMoves: moves.length,
      hostlersBusy: busyHostlers,
      hostlersAvailable: Math.max(0, (totalHostlers || 0) - busyHostlers),
    };

    const zones = summarizeZoneOccupancy(flatSpots);

    // Phase K: safety incidents had a free-text `location` with no real
    // link to the yard map — location: "Dock D12" can't be reliably
    // matched back to an actual spot. Added a real spot_id column instead
    // (nullable — not every incident happens at a numbered spot) so the
    // map can mark exactly where unresolved incidents are.
    const { data: unresolvedIncidents } = await db.from("safety_incidents").select("spot_id").eq("facility_id", facilityId).neq("status", "resolved").not("spot_id", "is", null);
    const unresolvedSafetySpotIds = [...new Set((unresolvedIncidents || []).map((i: any) => i.spot_id))];

    const { data: equipmentRows } = await db.from("equipment").select("status").eq("facility_id", facilityId);
    const equipmentDown = (equipmentRows || []).filter((e: any) => e.status === "maintenance" || e.status === "broken").length;

    const { data: openTrailerExceptions } = await db.from("exceptions").select("entity_id").eq("facility_id", facilityId).eq("entity_type", "TRAILER").neq("status", "resolved");
    const spotsWithOpenExceptions = matchExceptionPlatesToSpotIds((openTrailerExceptions || []).map((e: any) => e.entity_id), flatSpots);

    return { stats: statsData, spots: flatSpots, moves, detentionThresholdHours: fSettings?.detention_threshold_hours || 24, avgDwellMinutes, dailyVelocity, today, zones, unresolvedSafetySpotIds, equipmentDown, equipmentTotal: (equipmentRows || []).length, spotsWithOpenExceptions };
  };

  const emitUpdate = async (event = "yard_update", payload: any = null) => {
    if (payload) {
      io.emit(event, payload);
    } else {
      const status = await getYardStatus(1);
      io.emit("yard_update", status);
    }
  };

  // Twilio Client Lazy Init
  let twilioClient: any = null;
  const getTwilioClient = () => {
    if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    return twilioClient;
  };

  const sendSms = async (to: string, body: string) => {
    const client = getTwilioClient();
    if (!client) {
      logger.warn("[Twilio] Client not configured. Logging SMS instead:", { to, body });
      return { success: false, error: "Twilio not configured" };
    }
    try {
      await client.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
      logger.info(`[Twilio] SMS sent to ${to}`);
      return { success: true };
    } catch (e: any) {
      logger.error(`[Twilio] Error sending SMS to ${to}: ${e.message}`);
      return { success: false, error: e.message };
    }
  };

  // Hash-chained, append-only audit log
  const logAudit = async (data: any) => {
    try {
      const facilityId = data.facility_id || 1;
      const { data: prev } = await db
        .from("audit_logs")
        .select("record_hash")
        .eq("facility_id", facilityId)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      const previousHash = prev?.record_hash || "GENESIS";
      const recordData = JSON.stringify({
        userId: data.userId || "SYSTEM",
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        details: data.details,
        timestamp: new Date().toISOString(),
      });
      const recordHash = crypto.createHash("sha256").update(previousHash + recordData).digest("hex");

      await db.from("audit_logs").insert({
        userId: data.userId || "SYSTEM",
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        details: data.details,
        ipAddress: data.ip,
        facility_id: facilityId,
        record_hash: recordHash,
        previous_hash: previousHash,
        severity: data.severity || "info",
      });
    } catch (e) {
      logger.error("Audit logging failed", { error: e });
    }
  };

  // Exception Management Center — this app already detects a real set of
  // operational exceptions (blacklist blocks, seal mismatches, reefer
  // critical readings, SLA critical breaches, no-shows), but each one only
  // ever wrote to audit_logs, a append-only trail nobody works as a queue.
  // There was no owner, no status, no resolution — just a fact that
  // happened. This gives each one a real lifecycle: open -> acknowledged ->
  // resolved, with an owner and resolution notes, exactly like the
  // exception center every real YMS has.
  const raiseException = async (data: {
    facility_id: number; exception_type: string; severity?: "info" | "warning" | "critical";
    entity_type?: string; entity_id?: string; title: string; description?: string; source?: string;
  }) => {
    try {
      const { data: row, error } = await db.from("exceptions").insert({
        facility_id: data.facility_id, exception_type: data.exception_type, severity: data.severity || "warning",
        entity_type: data.entity_type || null, entity_id: data.entity_id || null,
        title: data.title, description: data.description || null, source: data.source || null,
      }).select().single();
      if (error) throw error;
      emitUpdate("exception_created", row);
      enqueueWebhook("EXCEPTION_CREATED", row, data.facility_id);
      return row;
    } catch (e) {
      logger.error("Exception logging failed", { error: e });
      return null;
    }
  };

  // Event-driven webhook delivery already existed as a fully-built consumer
  // (cron worker below, HMAC-signed, retried with backoff) reading from
  // webhook_queue — but nothing anywhere ever inserted a row into that
  // table. No subscriptions table existed either, so there was no way to
  // register an endpoint in the first place. This is the producer side:
  // looks up active subscriptions for the facility that opted into this
  // event type, and enqueues one delivery job per subscription. Fire-and-
  // forget from the caller's perspective — a webhook failing to enqueue
  // must never fail the operation that triggered it.
  const enqueueWebhook = async (eventType: string, payload: any, facilityId: number) => {
    try {
      const { data: subs } = await db.from("webhook_subscriptions").select("id, url, secret")
        .eq("facility_id", facilityId).eq("active", true).contains("events", [eventType]);
      if (!subs || subs.length === 0) return;
      const rows = subs.map((s: any) => ({
        facility_id: facilityId, event_type: eventType,
        payload_json: { event: eventType, timestamp: new Date().toISOString(), data: payload },
        webhook_url: s.url, webhook_secret: s.secret, status: "pending", attempts: 0,
      }));
      await db.from("webhook_queue").insert(rows);
      await db.from("webhook_subscriptions").update({ last_triggered_at: new Date().toISOString() }).in("id", subs.map((s: any) => s.id));
    } catch (e) {
      logger.error("Webhook enqueue failed", { error: e, eventType });
    }
  };

  // Middlewares
  const requireRole = (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.session.user.role)) {
      logAudit({
        action: "ACCESS_DENIED", entityType: "USER", entityId: String(req.session.user.id),
        details: { path: req.path, role: req.session.user.role, requiredRoles: roles },
        ip: req.ip, facility_id: req.session.user.facility_id || 1, severity: "warning",
      });
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  const requireDriverAuth = (req: any, res: any, next: any) => {
    if (!req.session?.driver_id) return res.status(401).json({ error: "Driver session required" });
    next();
  };

  const requireCarrierAuth = (req: any, res: any, next: any) => {
    if (!req.session?.carrier_id) return res.status(401).json({ error: "Carrier session required" });
    next();
  };

  // In-app + queued (SMS/email) notifications
  const notify = async ({ type, recipientType, recipientId, data }: any) => {
    try {
      let prefs: any = { channel_sms: 1, channel_email: 0, channel_inapp: true };
      if (recipientId) {
        const { data: p } = await db
          .from("notification_preferences")
          .select("*")
          .eq("user_id", recipientId)
          .eq("user_type", recipientType)
          .eq("event_type", type)
          .maybeSingle();
        if (p) prefs = p;
      }

      // channel_inapp defaults true, but was never actually checked — the
      // insert fired unconditionally regardless of this preference.
      if (prefs.channel_inapp !== false) {
        await db.from("in_app_notifications").insert({
          user_id: recipientId,
          user_type: recipientType,
          title: data.title,
          body: data.body,
          link: data.link,
        });
      }

      if (prefs.channel_sms && data.phone) {
        await db.from("notifications_queue").insert({
          type, recipient_type: recipientType, recipient_id: recipientId, channel: "sms",
          payload_json: { phone: data.phone, message: data.body },
        });
      }
      if (prefs.channel_email && data.email) {
        await db.from("notifications_queue").insert({
          type, recipient_type: recipientType, recipient_id: recipientId, channel: "email",
          payload_json: { to: data.email, subject: data.title, body: data.body },
        });
      }

      emitUpdate("new_notification", { userId: recipientId, userType: recipientType });
    } catch (e) {
      logger.error("Notification failed", { error: e });
    }
  };

  // SECURITY FIX: this used to build the PostgREST OR-filter by interpolating
  // `plate`/`carrierName` directly into the filter string — both are
  // attacker-controlled on public, unauthenticated routes (self-service
  // walk-in check-in, carrier self-booking). PostgREST's or()/and() syntax
  // treats commas/parens/dots as structural, so a crafted plate value like
  // `X),or(1.eq.1,x.eq.` could reshape the query — in the best case erroring
  // the request, in the worst case forging a filter that matches nothing (or
  // everything) and silently bypassing the blacklist block this function
  // exists to enforce. Rewritten to use .eq() for the attacker-controlled
  // values, which supabase-js sends as plain filter values, not
  // structurally-parsed filter syntax — no interpolation-based injection
  // surface. `now` is server-generated, not user input, so interpolating it
  // into the expiry OR-clause remains safe.
  const checkBlacklist = async (facilityId: number, plate: string, carrierName?: string) => {
    const now = new Date().toISOString();
    const notExpired = (q: any) => q.or(`expires_at.is.null,expires_at.gt.${now}`).limit(1).maybeSingle();

    const [{ data: plateHit }, { data: carrierHit }] = await Promise.all([
      plate
        ? notExpired(db.from("blacklist").select("*").eq("facility_id", facilityId).eq("entity_type", "plate").eq("entity_value", plate))
        : Promise.resolve({ data: null } as any),
      carrierName
        ? notExpired(db.from("blacklist").select("*").eq("facility_id", facilityId).eq("entity_type", "carrier").eq("entity_value", carrierName))
        : Promise.resolve({ data: null } as any),
    ]);
    return plateHit || carrierHit;
  };

  // Neither the staff-entered appointment endpoint nor the carrier
  // self-service booking endpoint enforced any capacity limit — any number
  // of trucks could be booked into the same hour, and there was no way to
  // block out a maintenance window or holiday closure. Pure decision logic
  // lives in appointmentCapacity.ts; this just gathers the DB state it needs.
  const enforceAppointmentCapacity = async (facilityId: number, startTime: string, endTime: string, excludeAppointmentId?: number) => {
    const { data: settings } = await db.from("facility_settings").select("max_appointments_per_hour").eq("facility_id", facilityId).maybeSingle();
    const bucket = hourBucket(startTime);
    let countQuery = db.from("appointments").select("*", { count: "exact", head: true }).eq("facility_id", facilityId)
      .not("status", "in", "(CANCELLED,no_show)").gte("start_time", bucket.start).lt("start_time", bucket.end);
    if (excludeAppointmentId) countQuery = countQuery.neq("id", excludeAppointmentId);
    const [{ count: appointmentsInSameHour }, { data: blackouts }] = await Promise.all([
      countQuery,
      db.from("appointment_blackouts").select("start_time, end_time, reason").eq("facility_id", facilityId)
        .lt("start_time", endTime).gt("end_time", startTime),
    ]);
    return checkAppointmentCapacity({
      startTime, endTime,
      maxAppointmentsPerHour: settings?.max_appointments_per_hour ?? null,
      appointmentsInSameHour: appointmentsInSameHour || 0,
      blackouts: blackouts || [],
    });
  };

  const evaluateWorkflows = async (event: string, data: any, facilityId: number) => {
    const { data: rules } = await db.from("workflow_rules").select("*").eq("facility_id", facilityId).eq("trigger_event", event).eq("active", true);
    for (const rule of rules || []) {
      const fieldValue = data[rule.condition_field];
      let conditionMet = false;
      if (rule.condition_operator === "equals") conditionMet = String(fieldValue) === rule.condition_value;
      else if (rule.condition_operator === "greater_than") conditionMet = Number(fieldValue) > Number(rule.condition_value);
      else if (rule.condition_operator === "contains") conditionMet = String(fieldValue).includes(rule.condition_value);

      if (conditionMet) {
        const params = rule.action_params;
        if (rule.action_type === "set_field" && data.id) {
          await db.from("appointments").update({ [params.field]: params.value }).eq("id", data.id);
        } else if (rule.action_type === "send_notification") {
          notify({
            type: "WORKFLOW_ALERT", recipientType: params.user_type || "admin", recipientId: 1,
            data: { title: params.title, body: params.body?.replace("{{carrier}}", data.carrier || "") },
          });
        }
      }
    }
  };

  app.use(cors({ origin: corsOriginCheck, credentials: true }));
  // Raised from the 100kb default to fit a compressed gate-kiosk selfie
  // (base64 JPEG) in the same JSON body as the rest of the walk-in form —
  // still capped well below anything that could be used for a DoS payload.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true })); // Twilio's inbound SMS webhook posts form-encoded, not JSON

  // Brute-force protection: staff/carrier login, capped per-IP.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts. Try again in 15 minutes." },
  });

  // OTP request: capped per-IP+phone so one number can't be SMS-bombed and one IP can't farm codes across numbers.
  const otpRequestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${ipKeyGenerator(req.ip)}:${req.body?.phone || ""}`,
    message: { error: "Too many code requests. Try again in 10 minutes." },
  });

  // OTP verify: 6-digit code has 1e6 combinations — cap attempts per-IP+phone so it can't be brute-forced.
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${ipKeyGenerator(req.ip)}:${req.body?.phone || ""}`,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });

  // Public self-service walk-in (unmanned gate QR): capped per-IP+driver-session
  // so the open, unauthenticated-by-staff endpoint can't be hammered.
  const publicWalkinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${ipKeyGenerator(req.ip)}:${req.session?.driver_id || ""}`,
    message: { error: "Too many registration attempts. Try again in 15 minutes." },
  });

  // TOTP is a 6-digit code same as the driver OTP — same brute-force math,
  // same fix: cap attempts per-IP+session so it can't be scripted.
  const totpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${ipKeyGenerator(req.ip)}:${req.session?.pending_2fa_user_id || req.session?.user?.id || ""}`,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });

  // Carrier self-booking (POST /api/book/:token) had no rate limiting at
  // all — a fully public endpoint, gated only by a token that's routinely
  // shared/forwarded, that writes appointments and sends a real SMS to
  // whatever driver_phone the caller supplies. Unbounded, that's both a
  // capacity-flooding DoS against real carriers (fill every slot) and an
  // SMS-bombing vector against an arbitrary phone number at the operator's
  // expense. Capped per-IP+token, same family as the other public limiters.
  const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${ipKeyGenerator(req.ip)}:${req.params?.token || ""}`,
    message: { error: "Too many booking attempts. Try again in 15 minutes." },
  });

  // --- Staff Authentication ---
  app.post("/api/auth/login", loginLimiter, async (req: any, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    try {
      const { data: user } = await db.from("users").select("*").eq("email", String(email).toLowerCase()).maybeSingle();
      if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        logAudit({ action: "STAFF_LOGIN_FAILED", entityType: "USER", entityId: String(email), details: {}, ip: req.ip, facility_id: 1, severity: "warning" });
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (user.totp_enabled) {
        // Password correct, but don't set session.user yet — that's what every
        // requireRole check gates on. Second factor required before the
        // session actually counts as authenticated.
        req.session.pending_2fa_user_id = user.id;
        logAudit({ action: "STAFF_LOGIN_PASSWORD_OK_AWAITING_2FA", entityType: "USER", entityId: String(user.id), details: {}, ip: req.ip, facility_id: user.facility_id || 1 });
        return res.json({ success: false, requiresTotp: true });
      }

      req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role, facility_id: user.facility_id };
      if (user.facility_id) req.session.facility_id = user.facility_id;
      logAudit({ action: "STAFF_LOGIN", entityType: "USER", entityId: String(user.id), details: { email: user.email }, ip: req.ip, facility_id: user.facility_id || 1 });
      res.json({ success: true, user: req.session.user });
    } catch (e: any) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/login/2fa-verify", totpVerifyLimiter, async (req: any, res) => {
    const { code } = req.body;
    const pendingUserId = req.session?.pending_2fa_user_id;
    if (!pendingUserId) return res.status(401).json({ error: "No login in progress" });
    try {
      const { data: user } = await db.from("users").select("*").eq("id", pendingUserId).maybeSingle();
      if (!user || !user.totp_secret || !verifyTotpToken(user.totp_secret, code)) {
        logAudit({ action: "STAFF_LOGIN_2FA_FAILED", entityType: "USER", entityId: String(pendingUserId), details: {}, ip: req.ip, facility_id: user?.facility_id || 1, severity: "warning" });
        return res.status(401).json({ error: "Invalid or expired code" });
      }
      delete req.session.pending_2fa_user_id;
      req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role, facility_id: user.facility_id };
      if (user.facility_id) req.session.facility_id = user.facility_id;
      logAudit({ action: "STAFF_LOGIN", entityType: "USER", entityId: String(user.id), details: { email: user.email, via2fa: true }, ip: req.ip, facility_id: user.facility_id || 1 });
      res.json({ success: true, user: req.session.user });
    } catch (e: any) {
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.get("/api/auth/me", (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: req.session.user });
  });

  app.get("/api/auth/2fa/status", (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    (async () => {
      const { data: user } = await db.from("users").select("totp_enabled").eq("id", req.session.user.id).maybeSingle();
      res.json({ enabled: !!user?.totp_enabled });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });

  app.post("/api/auth/logout", (req: any, res) => {
    req.session?.destroy(() => res.json({ success: true }));
  });

  // --- Staff 2FA (TOTP) self-service setup ---
  app.post("/api/auth/2fa/setup", (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    (async () => {
      const secret = generateTotpSecret();
      await db.from("users").update({ totp_secret: secret, totp_enabled: false }).eq("id", req.session.user.id);
      res.json({ secret, otpauth_url: totpUri(secret, req.session.user.email) });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });

  app.post("/api/auth/2fa/confirm", totpVerifyLimiter, (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    (async () => {
      const { code } = req.body;
      const { data: user } = await db.from("users").select("totp_secret").eq("id", req.session.user.id).maybeSingle();
      if (!user?.totp_secret || !verifyTotpToken(user.totp_secret, code)) {
        return res.status(401).json({ error: "Invalid code — check your authenticator app and try again" });
      }
      await db.from("users").update({ totp_enabled: true }).eq("id", req.session.user.id);
      logAudit({ action: "STAFF_2FA_ENABLED", entityType: "USER", entityId: String(req.session.user.id), details: {}, ip: req.ip, facility_id: req.session.user.facility_id || 1 });
      res.json({ success: true });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });

  app.post("/api/auth/2fa/disable", (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    (async () => {
      const { password } = req.body;
      const { data: user } = await db.from("users").select("password_hash").eq("id", req.session.user.id).maybeSingle();
      if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      await db.from("users").update({ totp_enabled: false, totp_secret: null }).eq("id", req.session.user.id);
      logAudit({ action: "STAFF_2FA_DISABLED", entityType: "USER", entityId: String(req.session.user.id), details: {}, ip: req.ip, facility_id: req.session.user.facility_id || 1, severity: "warning" });
      res.json({ success: true });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });

  // Facility Middleware
  const facilityContext = (req: any, res: any, next: any) => {
    if (req.session?.user?.role === "superadmin" && req.query.facility_id) {
      req.session.facility_id = parseInt(req.query.facility_id);
    }
    req.facilityId = req.session?.facility_id || 1;
    res.locals.facilityId = req.facilityId;
    next();
  };
  app.use(facilityContext);

  // Universal Search
  // Global search only ever covered trailers/appointments/carriers by
  // plate or name — drivers, exceptions, and gate passes are all real,
  // fully-built entities in this app with no way to find them from search
  // at all, despite the requested feature list explicitly asking search to
  // cover drivers/tasks/exceptions alongside trucks/trailers/carriers.
  // Drivers aren't facility-scoped in the schema (a driver isn't owned by
  // one facility), matching how /api/driver/lookup already treats them
  // elsewhere in this file — so unlike the other four queries here, the
  // driver query intentionally has no facility_id filter.
  app.get("/api/search", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const q = String(req.query.q || "");
    if (q.length < 2) return res.json([]);
    try {
      const facilityId = req.facilityId;
      const pattern = `%${q}%`;
      // Each column gets its own .ilike() call (a plain filter value, not
      // structurally parsed) rather than a hand-built .or() string — same
      // fix as checkBlacklist earlier this session. Interpolating `q`
      // straight into an or() filter string would let PostgREST's own
      // comma/paren/dot syntax be reshaped by the search text itself.
      const [{ data: trailers }, { data: appts }, { data: carriers }, { data: driversByName }, { data: driversByPhone }, { data: driversByPlate }, { data: exceptions }, { data: passesByNumber }, { data: passesByPlate }] = await Promise.all([
        db.from("trailers").select("id, plate, carrier").eq("facility_id", facilityId).ilike("plate", pattern).limit(5),
        db.from("appointments").select("id, plate, carrier").eq("facility_id", facilityId).ilike("plate", pattern).limit(5),
        db.from("carriers").select("id, name").ilike("name", pattern).limit(5),
        db.from("drivers").select("id, name, phone, default_plate").ilike("name", pattern).limit(5),
        db.from("drivers").select("id, name, phone, default_plate").ilike("phone", pattern).limit(5),
        db.from("drivers").select("id, name, phone, default_plate").ilike("default_plate", pattern).limit(5),
        db.from("exceptions").select("id, title, exception_type, status").eq("facility_id", facilityId).ilike("title", pattern).limit(5),
        db.from("gate_passes").select("id, pass_number, plate, carrier_name").eq("facility_id", facilityId).ilike("pass_number", pattern).limit(5),
        db.from("gate_passes").select("id, pass_number, plate, carrier_name").eq("facility_id", facilityId).ilike("plate", pattern).limit(5),
      ]);
      const dedupe = <T extends { id: any }>(rows: T[]) => Array.from(new Map(rows.map((r) => [r.id, r])).values());
      const drivers = dedupe([...(driversByName || []), ...(driversByPhone || []), ...(driversByPlate || [])]).slice(0, 5);
      const gatePasses = dedupe([...(passesByNumber || []), ...(passesByPlate || [])]).slice(0, 5);
      const results = [
        ...(trailers || []).map((t: any) => ({ id: `trailer-${t.id}`, title: t.plate, subtitle: `Trailer · ${t.carrier || ""}`, url: `/status/${t.id}` })),
        ...(appts || []).map((a: any) => ({ id: `appt-${a.id}`, title: a.plate, subtitle: `Appointment · ${a.carrier || ""}`, url: `/status/${a.id}` })),
        ...(carriers || []).map((c: any) => ({ id: `carrier-${c.id}`, title: c.name, subtitle: "Carrier", url: `/network` })),
        ...drivers.map((d: any) => ({ id: `driver-${d.id}`, title: d.name || d.phone, subtitle: `Driver · ${d.default_plate || d.phone || ""}`, url: `/gate` })),
        ...(exceptions || []).map((e: any) => ({ id: `exception-${e.id}`, title: e.title, subtitle: `Exception · ${e.status}`, url: `/exceptions` })),
        ...gatePasses.map((g: any) => ({ id: `pass-${g.id}`, title: g.pass_number, subtitle: `Gate pass · ${g.plate} · ${g.carrier_name || ""}`, url: `/pipeline` })),
      ];
      res.json(results);
    } catch (e: any) {
      logger.error(`Search Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Custom Reports API
  // SECURITY FIX: this and the five other /api/admin/* endpoints fixed in
  // this pass (analytics, analytics/heatmap, carrier-balances, gate-logs)
  // had no requireRole guard at all — same missing-auth pattern already
  // found and fixed earlier this session on the appointments/GDPR
  // endpoints, just not caught for these. Anyone, unauthenticated, could
  // read saved report configs, carrier names/dwell/volume analytics,
  // outstanding carrier balances (real financial data), and gate entry/
  // exit logs with guard names. Role sets match each endpoint's actual
  // frontend consumer's route guard in src/lib/permissions.ts.
  app.get("/api/admin/reports", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { data } = await db.from("custom_reports").select("*").eq("facility_id", req.facilityId);
    res.json(data || []);
  });

  app.post("/api/admin/reports", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { name, description, config } = req.body;
    try {
      await db.from("custom_reports").insert({ facility_id: req.facilityId, name, description, config_json: config });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // General facility settings
  app.get("/api/settings/general", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.session?.facility_id || req.facilityId || 1;
    try {
      const [{ data: facility }, { data: settings }] = await Promise.all([
        db.from("facilities").select("*").eq("id", facilityId).maybeSingle(),
        db.from("facility_settings").select("*").eq("facility_id", facilityId).maybeSingle(),
      ]);
      res.json({ facility, settings });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings/general", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.session?.facility_id || req.facilityId || 1;
    const { currency, locale, timezone, detention_rate_per_hour, detention_threshold_hours, dock_sla_minutes, max_appointments_per_hour, required_document_types, document_policy } = req.body;
    try {
      const patch: any = { updated_at: new Date().toISOString() };
      if (currency) patch.currency = currency;
      if (locale) patch.locale = locale;
      if (timezone) patch.timezone = timezone;
      if (detention_rate_per_hour !== undefined) patch.detention_rate_per_hour = detention_rate_per_hour;
      if (detention_threshold_hours !== undefined) patch.detention_threshold_hours = detention_threshold_hours;
      if (dock_sla_minutes !== undefined) patch.dock_sla_minutes = dock_sla_minutes;
      if (max_appointments_per_hour !== undefined) patch.max_appointments_per_hour = max_appointments_per_hour === "" ? null : Number(max_appointments_per_hour);
      if (Array.isArray(required_document_types)) patch.required_document_types = required_document_types;
      if (document_policy) patch.document_policy = document_policy;
      await db.from("facility_settings").update(patch).eq("facility_id", facilityId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/blackouts", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId || 1;
    try {
      const { data, error } = await db.from("appointment_blackouts").select("*, creator:users!appointment_blackouts_created_by_fkey(name)")
        .eq("facility_id", facilityId).gte("end_time", new Date().toISOString()).order("start_time", { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/blackouts", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { start_time, end_time, reason } = req.body;
    const facilityId = req.facilityId || 1;
    const userId = req.session?.user?.id || null;
    if (!start_time || !end_time || !reason) return res.status(400).json({ error: "start_time, end_time and reason are required" });
    if (new Date(end_time).getTime() <= new Date(start_time).getTime()) return res.status(400).json({ error: "end_time must be after start_time" });
    try {
      const { data, error } = await db.from("appointment_blackouts").insert({ facility_id: facilityId, start_time, end_time, reason, created_by: userId }).select().single();
      if (error) throw error;
      logAudit({ action: "BLACKOUT_CREATED", entityType: "BLACKOUT", entityId: String(data.id), details: { start_time, end_time, reason }, ip: req.ip, facility_id: facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/blackouts/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId || 1;
    try {
      await db.from("appointment_blackouts").delete().eq("id", req.params.id).eq("facility_id", facilityId);
      logAudit({ action: "BLACKOUT_REMOVED", entityType: "BLACKOUT", entityId: req.params.id, ip: req.ip, facility_id: facilityId });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Notification Preferences API
  app.get("/api/settings/notifications", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId;
    const userId = req.session?.user?.id || 1;
    const { data } = await db.from("notification_preferences").select("*").eq("user_id", userId);
    res.json(data || []);
  });

  app.post("/api/settings/notifications", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { preferences } = req.body;
    const userId = req.session?.user?.id || 1;
    try {
      for (const p of preferences || []) {
        await db.from("notification_preferences").upsert({
          user_id: userId, user_type: "staff", event_type: p.event_type,
          channel_sms: !!p.channel_sms, channel_email: !!p.channel_email, channel_inapp: p.channel_inapp !== false,
        }, { onConflict: "user_id,user_type,event_type" });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Enhanced Appointments API
  app.get("/api/appointments", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { start, end } = req.query;
    const facilityId = req.facilityId || 1;
    try {
      let query = db.from("appointments").select("*, spots(name)").eq("facility_id", facilityId);
      if (start && end) {
        query = query.gte("start_time", String(start)).lte("start_time", String(end));
      } else {
        const today = new Date().toISOString().split("T")[0];
        query = query.gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`);
      }
      const { data, error } = await query.order("start_time", { ascending: true });
      if (error) throw error;
      const rows = (data || []).map((a: any) => ({ ...a, dock_name: a.spots?.name }));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create/edit/delete were all wide open — no requireRole at all, unlike
  // every other staff-mutation endpoint in this file. Any unauthenticated
  // caller could create, retime, or delete appointments in the yard.
  app.post("/api/appointments", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { plate, carrier, start_time, duration_minutes, dock_id, load_type, priority_level, special_instructions, customer_id } = req.body;
    const facilityId = req.facilityId || 1;
    try {
      // customer_id was accepted with no facility check — an appointment
      // could be linked to another facility's customer, and that customer's
      // portal would then show this facility's shipment. Same class of gap
      // as facility-scoping bugs fixed earlier this session.
      if (customer_id) {
        const { data: customer } = await db.from("customers").select("id").eq("id", customer_id).eq("facility_id", facilityId).maybeSingle();
        if (!customer) return res.status(400).json({ error: "Invalid customer" });
      }

      const endTime = new Date(new Date(start_time).getTime() + (duration_minutes || estimateDurationMinutes(load_type)) * 60_000).toISOString();

      const capacity = await enforceAppointmentCapacity(facilityId, start_time, endTime);
      if (!capacity.allowed) return res.status(409).json({ error: "CAPACITY_BLOCKED", reason: capacity.reason });

      const { data: newAppt, error } = await db.from("appointments").insert({
        plate, carrier, start_time,
        actual_duration_minutes: duration_minutes || 60,
        end_time: endTime,
        dock_id: dock_id || null,
        load_type: load_type || "LOAD",
        priority_level: priority_level || 2,
        special_instructions: special_instructions || null,
        customer_id: customer_id || null,
        facility_id: facilityId,
        status: "SCHEDULED",
      }).select().single();
      if (error) throw error;

      emitUpdate("appointment_created", newAppt);
      evaluateWorkflows("appointment_created", newAppt, facilityId);
      enqueueWebhook("APPOINTMENT_CREATED", newAppt, facilityId);
      res.json(newAppt);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/appointments/:id", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { id } = req.params;
    const updates = req.body;
    const facilityId = req.facilityId || 1;
    try {
      const allowedFields = ["plate", "carrier", "start_time", "actual_duration_minutes", "status", "priority_level", "dock_id", "special_instructions", "customer_id"];
      const patch: any = {};
      for (const field of allowedFields) if (updates[field] !== undefined) patch[field] = updates[field];

      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      if (patch.customer_id) {
        const { data: customer } = await db.from("customers").select("id").eq("id", patch.customer_id).eq("facility_id", facilityId).maybeSingle();
        if (!customer) return res.status(400).json({ error: "Invalid customer" });
      }

      // Rescheduling into an over-capacity hour or a blackout window hit no
      // check at all — same gap as the create path, just reachable via drag/
      // reschedule instead of new-booking. Check before writing, against the
      // *prospective* window, excluding this appointment's own current row.
      if (patch.start_time) {
        const { data: existing } = await db.from("appointments").select("actual_duration_minutes, load_type").eq("id", id).eq("facility_id", facilityId).maybeSingle();
        const minutes = patch.actual_duration_minutes || existing?.actual_duration_minutes || estimateDurationMinutes(existing?.load_type);
        const prospectiveEnd = new Date(new Date(patch.start_time).getTime() + minutes * 60_000).toISOString();
        const capacity = await enforceAppointmentCapacity(facilityId, patch.start_time, prospectiveEnd, Number(id));
        if (!capacity.allowed) return res.status(409).json({ error: "CAPACITY_BLOCKED", reason: capacity.reason });
      }

      let { data: updated, error } = await db.from("appointments").update(patch).eq("id", id).eq("facility_id", facilityId).select().single();
      if (error) throw error;

      // Rescheduling (start_time or duration change) without recomputing
      // end_time would leave a stale window behind — the duration-aware
      // overlap checks in /api/slots (Phase M) would keep scoring dock
      // availability against the appointment's old time slot. Recompute
      // from `updated.start_time` (Postgres's own parse of whatever the
      // client sent) rather than re-parsing the raw client string with JS
      // Date — an offset-less datetime-local value like "2026-08-11T14:00"
      // parses as UTC in Postgres but as *local* time in V8, and those two
      // parses silently disagreeing produced an end_time before start_time.
      if (patch.start_time || patch.actual_duration_minutes) {
        const minutes = updated.actual_duration_minutes || estimateDurationMinutes(updated.load_type);
        const endTime = new Date(new Date(updated.start_time).getTime() + minutes * 60_000).toISOString();
        const { data: withEnd, error: endError } = await db.from("appointments").update({ end_time: endTime }).eq("id", id).eq("facility_id", facilityId).select().single();
        if (endError) throw endError;
        updated = withEnd;
      }

      emitUpdate("appointment_updated", updated);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/appointments/:id", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { id } = req.params;
    const facilityId = req.facilityId || 1;
    try {
      // Fetched before delete — a webhook subscriber needs to know which
      // appointment was cancelled (plate/carrier/time), not just an id
      // that no longer resolves to anything by the time they receive it.
      const { data: existing } = await db.from("appointments").select("*").eq("id", id).eq("facility_id", facilityId).maybeSingle();
      await db.from("appointments").delete().eq("id", id).eq("facility_id", facilityId);
      emitUpdate("appointment_deleted", { id });
      if (existing) enqueueWebhook("APPOINTMENT_CANCELLED", existing, facilityId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/yard-status", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const facilityId = req.facilityId || 1;
    try {
      const yardData = await getYardStatus(facilityId);
      const today = new Date().toISOString().split("T")[0];
      const { data: appointments } = await db
        .from("appointments")
        .select("*, spots(name)")
        .eq("status", "SCHEDULED")
        .eq("facility_id", facilityId)
        .gte("start_time", `${today}T00:00:00`)
        .lte("start_time", `${today}T23:59:59`)
        .order("start_time", { ascending: true });

      const appts = (appointments || []).map((a: any) => ({ ...a, dock_name: a.spots?.name }));
      res.json({ ...yardData, appointments: appts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/walkin/register", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { driver_name, carrier_name, phone, truck_plate, trailer_number, load_type, direction, po_number, sku_summary, reefer_setpoint } = req.body;
    const facilityId = req.facilityId || 1;

    if (!driver_name || !carrier_name || !truck_plate || !phone) {
      return res.status(400).json({ error: "Biometric and contact data incomplete" });
    }

    try {
      // Flagged earlier this session, never actually fixed here — only the
      // self-service /api/public/walkin-checkin endpoint got a blacklist
      // check. The guard-operated path had the exact same gap.
      const blacklistHit = await checkBlacklist(facilityId, truck_plate, carrier_name);
      if (blacklistHit && blacklistHit.severity === "block") {
        logAudit({ action: "BLACKLIST_BLOCKED_GUARD_WALKIN", entityType: "TRAILER", entityId: truck_plate, details: { reason: blacklistHit.reason }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        raiseException({ facility_id: facilityId, exception_type: "blacklist_block", severity: "warning", entity_type: "TRAILER", entity_id: truck_plate, title: `Blacklisted entry blocked: ${truck_plate}`, description: blacklistHit.reason, source: "guard_walkin" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason });
      }

      // driver_ratings has existed since before this session (punctuality/
      // cooperation/compliance, written on gate-pass exit) but nothing ever
      // read it back — a guard re-registering a driver with a history of
      // problems had no way to know without remembering it themselves.
      // Non-blocking: surfaced as a caution, not a gate.
      let driverCaution: { average: number; count: number } | null = null;
      const { data: matchedDriver } = await db.from("drivers").select("id").eq("phone", phone).maybeSingle();
      if (matchedDriver) {
        const { data: ratings } = await db.from("driver_ratings").select("rating").eq("driver_id", matchedDriver.id).order("created_at", { ascending: false }).limit(20);
        if (ratings && ratings.length > 0) {
          const avg = ratings.reduce((s, r: any) => s + (r.rating || 0), 0) / ratings.length;
          if (avg <= 2) driverCaution = { average: Math.round(avg * 10) / 10, count: ratings.length };
        }
      }

      const { data: walkin, error } = await db.from("walkin_registrations").insert({
        driver_name, carrier_name, phone, truck_plate, trailer_number: trailer_number || null,
        load_type, direction, status: "pending", facility_id: facilityId,
      }).select().single();
      if (error) throw error;

      const { data: assign } = await db.rpc("walkin_autoassign_tx", {
        p_walkin_id: walkin.id, p_truck_plate: truck_plate, p_carrier_name: carrier_name, p_facility_id: facilityId,
      });

      if (assign?.assigned) {
        logAudit({ action: "WALKIN_AUTO_CHECKIN", entityType: "WALKIN", entityId: String(walkin.id), details: { truck_plate, spot: assign.spotName }, ip: req.ip, facility_id: facilityId });
        notify({ type: "WALKIN_CONFIRMED", recipientType: "driver", recipientId: walkin.id, data: { phone, title: "Registration Sync", body: `SkyYard: Walk-in confirmed for ${truck_plate}. Proceeds to parking spot: ${assign.spotName}. Reference: WK-${walkin.id}` } });
        if (po_number || sku_summary) {
          await db.from("trailers").update({ po_number: po_number || null, sku_summary: sku_summary || null }).eq("plate", truck_plate).eq("facility_id", facilityId);
        }
        if (load_type === "reefer") {
          // equipment_type never gets set from load_type anywhere else either
          // — without this, a trailer checked in as a reefer load stays
          // equipment_type "standard" and the reefer-reading endpoint
          // (Phase N) rejects every reading for it with "not equipment_type
          // reefer", making reefer monitoring unreachable through this path.
          const patch: any = { equipment_type: "reefer" };
          if (reefer_setpoint != null && reefer_setpoint !== "" && !isNaN(Number(reefer_setpoint))) patch.reefer_temp_setpoint = Number(reefer_setpoint);
          await db.from("trailers").update(patch).eq("plate", truck_plate).eq("facility_id", facilityId);
        }
        const pass = await issueGatePass({ facilityId, plate: truck_plate, carrierName: carrier_name, spotName: assign.spotName, issuedBy: req.session?.user?.id, entrySource: "guard_walkin" });
        emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
        return res.json({ success: true, id: `WK-${walkin.id}`, spotName: assign.spotName, passNumber: pass?.pass_number, driverCaution });
      }

      logAudit({ action: "WALKIN_REGISTERED", entityType: "WALKIN", entityId: String(walkin.id), details: { truck_plate }, ip: req.ip, facility_id: facilityId });
      notify({ type: "WALKIN_QUEUED", recipientType: "driver", recipientId: walkin.id, data: { phone, title: "Registration Queued", body: `SkyYard: You are in queue. Reference: WK-${walkin.id}. Please wait for spot assignment.` } });
      notify({ type: "WALKIN_NEEDS_ATTENTION", recipientType: "ADMIN", recipientId: null, data: { title: "Walk-in waiting for a spot", body: `${driver_name} (${carrier_name}, ${truck_plate}) is queued at the gate — yard is at capacity. Ref: WK-${walkin.id}`, link: "/gate" } });

      emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
      res.json({ success: true, id: `WK-${walkin.id}`, status: "QUEUED", driverCaution });
    } catch (e: any) {
      logger.error("Walk-in registration failed", { error: e });
      res.status(500).json({ error: "System Neural Failure: " + e.message });
    }
  });

  // --- Unmanned gate self-service (shared QR -> OTP-verified public form -> admin approval) ---
  // Distinct from /api/walkin/register above: that one is guard-operated and
  // auto-assigns a spot immediately. With no guard, auto-assign has no human
  // backstop, so this path always lands in "pending_approval" and waits for
  // an explicit admin decision (in-app, or SMS reply — see /api/twilio/inbound-sms).

  // Unified in-pass record — every entry path (staff gate checkin, badge
  // scan, self-service walk-in approval) issues one of these instead of
  // just a gate_logs row. Gives every vehicle a trackable pipeline stage
  // (IN_PASS -> PARKED -> LOADING/UNLOADING -> READY_FOR_EXIT -> OUT_PASS ->
  // EXITED) and a human-readable pass number, instead of only "it's in the
  // yard somewhere" that trailers.status alone provided.
  const issueGatePass = async (params: {
    facilityId: number; plate: string; carrierName?: string | null; trailerId?: number | null;
    driverId?: number | null; spotName?: string | null; issuedBy?: number | null; entrySource: string;
  }) => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const passNumber = `IN-${today}-${Math.floor(1000 + Math.random() * 9000)}`;

    const [{ data: vehicle }, { data: spot }] = await Promise.all([
      db.from("vehicles").select("id").eq("plate", params.plate).maybeSingle(),
      params.spotName ? db.from("spots").select("id").eq("facility_id", params.facilityId).eq("name", params.spotName).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const { data: pass, error } = await db.from("gate_passes").insert({
      facility_id: params.facilityId, pass_number: passNumber, plate: params.plate,
      carrier_name: params.carrierName || null, trailer_id: params.trailerId || null,
      driver_id: params.driverId || null, vehicle_id: vehicle?.id || null, spot_id: spot?.id || null,
      stage: "IN_PASS", entry_source: params.entrySource, issued_by: params.issuedBy || null,
    }).select().single();
    if (error) {
      logger.error("Gate pass issuance failed", { error: error.message, plate: params.plate });
      return null;
    }
    return pass;
  };

  const approveWalkin = async (walkinId: number, adminUserId: number | null, facilityId: number): Promise<{ ok: boolean; error?: string; spotName?: string | null }> => {
    const { data: walkin } = await db.from("walkin_registrations").select("*").eq("id", walkinId).eq("facility_id", facilityId).maybeSingle();
    if (!walkin) return { ok: false, error: "Not found" };
    if (walkin.status !== "pending_approval") return { ok: false, error: `Already ${walkin.status}` };

    const { data: assign } = await db.rpc("walkin_autoassign_tx", {
      p_walkin_id: walkin.id, p_truck_plate: walkin.truck_plate, p_carrier_name: walkin.carrier_name, p_facility_id: facilityId,
    });

    if (assign?.assigned) {
      await db.from("walkin_registrations").update({ reviewed_by: adminUserId, reviewed_at: new Date().toISOString() }).eq("id", walkinId);
      if (walkin.po_number || walkin.sku_summary) {
        await db.from("trailers").update({ po_number: walkin.po_number || null, sku_summary: walkin.sku_summary || null }).eq("plate", walkin.truck_plate).eq("facility_id", facilityId);
      }
      logAudit({ action: "WALKIN_APPROVED", entityType: "WALKIN", entityId: String(walkinId), details: { spot: assign.spotName }, facility_id: facilityId });
      notify({ type: "WALKIN_APPROVED", recipientType: "driver", recipientId: walkin.driver_id, data: { phone: walkin.phone, title: "Entry Approved", body: `SkyYard: You're approved. Proceed to spot ${assign.spotName}. Reference: WK-${walkinId}` } });
      await issueGatePass({ facilityId, plate: walkin.truck_plate, carrierName: walkin.carrier_name, driverId: walkin.driver_id, spotName: assign.spotName, issuedBy: adminUserId, entrySource: "self_service_approved" });
      emitUpdate("yard_update", { type: "WALKIN", id: walkinId });
      return { ok: true, spotName: assign.spotName };
    }

    await db.from("walkin_registrations").update({ status: "approved_awaiting_spot", reviewed_by: adminUserId, reviewed_at: new Date().toISOString() }).eq("id", walkinId);
    notify({ type: "WALKIN_APPROVED_QUEUED", recipientType: "driver", recipientId: walkin.driver_id, data: { phone: walkin.phone, title: "Entry Approved — Queued", body: `SkyYard: You're approved but the yard is full. Please wait. Reference: WK-${walkinId}` } });
    return { ok: true, spotName: null };
  };

  const rejectWalkin = async (walkinId: number, adminUserId: number | null, facilityId: number, reason: string): Promise<{ ok: boolean; error?: string; spotName?: string | null }> => {
    const { data: walkin } = await db.from("walkin_registrations").select("*").eq("id", walkinId).eq("facility_id", facilityId).maybeSingle();
    if (!walkin) return { ok: false, error: "Not found" };
    if (walkin.status !== "pending_approval") return { ok: false, error: `Already ${walkin.status}` };

    await db.from("walkin_registrations").update({ status: "rejected", rejection_reason: reason || "Denied by admin", reviewed_by: adminUserId, reviewed_at: new Date().toISOString() }).eq("id", walkinId);
    logAudit({ action: "WALKIN_REJECTED", entityType: "WALKIN", entityId: String(walkinId), details: { reason }, facility_id: facilityId, severity: "warning" });
    notify({ type: "WALKIN_REJECTED", recipientType: "driver", recipientId: walkin.driver_id, data: { phone: walkin.phone, title: "Entry Denied", body: `SkyYard: Entry denied. Reason: ${reason || "Not specified"}. Reference: WK-${walkinId}` } });
    emitUpdate("yard_update", { type: "WALKIN", id: walkinId });
    return { ok: true };
  };

  app.post("/api/public/walkin-checkin", requireDriverAuth, publicWalkinLimiter, async (req: any, res) => {
    const { truck_plate, carrier_name, trailer_number, load_type, direction, consent, website, po_number, sku_summary, photo_base64 } = req.body;
    const facilityId = req.body.facility_id || 1;

    // Honeypot: a hidden field real drivers never see or fill; only bots fill every field.
    if (website) return res.status(400).json({ error: "Invalid submission" });
    if (!truck_plate || !carrier_name) return res.status(400).json({ error: "Plate and carrier are required" });
    if (consent !== true) return res.status(400).json({ error: "Consent to data processing is required" });

    // Kiosk camera capture only — never a file upload. A data: URL under
    // ~1.5MB is a plausible compressed webcam snapshot; anything else (a
    // huge payload, or a non-image scheme) gets silently dropped rather
    // than stored, since it's optional and never blocks the check-in.
    const photoUrl = typeof photo_base64 === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(photo_base64) && photo_base64.length < 1_500_000
      ? photo_base64
      : null;

    try {
      const { data: driver } = await db.from("drivers").select("id, phone, name").eq("id", req.session.driver_id).maybeSingle();
      if (!driver) return res.status(401).json({ error: "Driver session invalid" });

      const blacklistHit = await checkBlacklist(facilityId, truck_plate, carrier_name);
      if (blacklistHit && blacklistHit.severity === "block") {
        const { data: rejected } = await db.from("walkin_registrations").insert({
          driver_name: driver.name || "Unknown", carrier_name, phone: driver.phone, truck_plate,
          trailer_number: trailer_number || null, load_type, direction, status: "rejected",
          rejection_reason: `Blacklisted: ${blacklistHit.reason}`, reviewed_at: new Date().toISOString(),
          driver_id: driver.id, facility_id: facilityId, source: "self_service_qr", consent_given: true, photo_url: photoUrl,
        }).select("id, status_token").single();
        logAudit({ action: "BLACKLIST_BLOCKED_SELF_SERVICE", entityType: "TRAILER", entityId: truck_plate, details: { reason: blacklistHit.reason }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        raiseException({ facility_id: facilityId, exception_type: "blacklist_block", severity: "warning", entity_type: "TRAILER", entity_id: truck_plate, title: `Blacklisted entry blocked: ${truck_plate}`, description: blacklistHit.reason, source: "self_service_qr" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason, status_token: rejected?.status_token });
      }

      const { data: walkin, error } = await db.from("walkin_registrations").insert({
        driver_name: driver.name || "Unknown", carrier_name, phone: driver.phone, truck_plate,
        trailer_number: trailer_number || null, load_type, direction, status: "pending_approval",
        driver_id: driver.id, facility_id: facilityId, source: "self_service_qr", consent_given: true,
        po_number: po_number || null, sku_summary: sku_summary || null, photo_url: photoUrl,
      }).select("id, status_token").single();
      if (error) throw error;

      logAudit({ action: "WALKIN_SELF_SERVICE_SUBMITTED", entityType: "WALKIN", entityId: String(walkin.id), details: { truck_plate, carrier_name }, ip: req.ip, facility_id: facilityId });

      const { data: admins } = await db.from("users").select("id, name, phone").eq("facility_id", facilityId).in("role", ["ADMIN", "superadmin"]);
      for (const admin of admins || []) {
        notify({
          type: "WALKIN_APPROVAL_NEEDED", recipientType: "ADMIN", recipientId: admin.id,
          data: {
            phone: admin.phone,
            title: "Gate entry needs approval",
            body: `${driver.name || "Driver"} (${carrier_name}, ${truck_plate}) is requesting entry at the gate. Reply YES ${walkin.id} or NO ${walkin.id}, or open the app. Ref: WK-${walkin.id}`,
            link: "/gate",
          },
        });
      }

      emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
      res.json({ success: true, id: walkin.id, status: "pending_approval", status_token: walkin.status_token });
    } catch (e: any) {
      logger.error("Self-service walk-in failed", { error: e });
      res.status(500).json({ error: "Registration failed: " + e.message });
    }
  });

  // Public — token is the secret, no auth needed. Drivers land here after
  // submitting to watch their approval status update in real time.
  app.get("/api/public/walkin/status/:token", async (req, res) => {
    const { token } = req.params;
    const { data: walkin } = await db.from("walkin_registrations").select("id, status, truck_plate, carrier_name, rejection_reason, assigned_dock_id, spots:assigned_dock_id(name)").eq("status_token", token).maybeSingle();
    if (!walkin) return res.status(404).json({ error: "Not found" });
    res.json({
      id: walkin.id, status: walkin.status, plate: walkin.truck_plate, carrier: walkin.carrier_name,
      rejection_reason: walkin.rejection_reason, spotName: (walkin as any).spots?.name || null,
    });
  });

  app.post("/api/admin/walkin/:id/approve", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const result = await approveWalkin(Number(req.params.id), req.session.user.id, req.facilityId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, spotName: result.spotName });
  });

  app.post("/api/admin/walkin/:id/reject", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const result = await rejectWalkin(Number(req.params.id), req.session.user.id, req.facilityId, req.body?.reason);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  app.get("/api/admin/hostlers", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { data } = await db.from("users").select("id, name").eq("facility_id", req.facilityId).eq("role", "HOSTLER").order("name", { ascending: true });
    res.json(data || []);
  });

  app.get("/api/admin/walkin/pending", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { data } = await db.from("walkin_registrations").select("*").eq("facility_id", req.facilityId).eq("status", "pending_approval").order("created_at", { ascending: true });
    res.json(data || []);
  });

  // --- Phase M: Workforce & Shift Management ---
  // Not payroll — just "who's on, what's open, what does the next
  // person need to know." Handover notes are generated, not typed from
  // scratch, from the same open-item counts the Action Center already
  // tracks, so nothing gets forgotten between shifts.
  app.post("/api/shifts/start", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const userId = req.session.user.id;
    const facilityId = req.facilityId;
    try {
      const { data: existing } = await db.from("shifts").select("id").eq("user_id", userId).is("ended_at", null).maybeSingle();
      if (existing) return res.status(409).json({ error: "You already have an open shift" });
      const { data, error } = await db.from("shifts").insert({ facility_id: facilityId, user_id: userId }).select().single();
      if (error) throw error;
      logAudit({ action: "SHIFT_STARTED", entityType: "SHIFT", entityId: String(data.id), details: {}, ip: req.ip, facility_id: facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/shifts/current", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { data } = await db.from("shifts").select("*").eq("user_id", req.session.user.id).is("ended_at", null).maybeSingle();
    res.json(data || null);
  });

  app.post("/api/shifts/:id/end", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const facilityId = req.facilityId;
    try {
      const { data: shift } = await db.from("shifts").select("*").eq("id", req.params.id).eq("user_id", req.session.user.id).maybeSingle();
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      if (shift.ended_at) return res.status(409).json({ error: "Shift already ended" });

      const in4h = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const [{ count: pending }, { count: exceptions }, { count: safety }, { count: unassigned }, { count: upcoming }] = await Promise.all([
        db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "pending_approval"),
        db.from("exceptions").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).neq("status", "resolved"),
        db.from("safety_incidents").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).neq("status", "resolved"),
        db.from("move_orders").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "PENDING").is("assigned_to", null),
        db.from("appointments").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).eq("status", "SCHEDULED").is("checked_in_at", null).gte("start_time", new Date().toISOString()).lte("start_time", in4h),
      ]);
      const parts = [
        `${pending || 0} gate entry approval(s) pending`,
        `${exceptions || 0} open exception(s)`,
        `${safety || 0} unresolved safety incident(s)`,
        `${unassigned || 0} unclaimed move order(s)`,
        `${upcoming || 0} appointment(s) expected in the next 4h`,
      ];
      const handoverNotes = parts.join(" · ");

      const { data, error } = await db.from("shifts").update({ ended_at: new Date().toISOString(), handover_notes: handoverNotes }).eq("id", req.params.id).select().single();
      if (error) throw error;
      logAudit({ action: "SHIFT_ENDED", entityType: "SHIFT", entityId: req.params.id, details: { handoverNotes }, ip: req.ip, facility_id: facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/shifts/recent", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { data } = await db.from("shifts").select("*, staff:users(name)").eq("facility_id", req.facilityId).not("ended_at", "is", null).order("ended_at", { ascending: false }).limit(10);
    res.json((data || []).map((s: any) => ({ ...s, staff_name: s.staff?.name })));
  });

  // Manager Action Center — was a flat, capped-at-8 list covering only 5
  // item types with no urgency grouping and no explicit action per item.
  // Now sections everything into CRITICAL / TIME_CRITICAL / OPERATIONS /
  // UPCOMING (matching how a yard manager actually triages a shift) and
  // adds three real sources that existed elsewhere in the app but never
  // fed this feed: open Safety Center incidents, open Exception Center
  // entries, and unassigned/unclaimed move orders. Every item carries a
  // real action {label, link} instead of just a generic "view" link.
  app.get("/api/admin/needs-attention", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const facilityId = req.facilityId;
    try {
      const soon30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const in60 = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

      const [pendingApprovals, activeDetention, expiringVehicles, staleGatePasses, reeferTrailers, safetyIncidents, exceptions, unassignedMoves, upcomingAppts] = await Promise.all([
        db.from("walkin_registrations").select("id, truck_plate, carrier_name, created_at").eq("facility_id", facilityId).eq("status", "pending_approval"),
        db.from("detention_records").select("id, carrier_name, amount_owed, created_at").eq("facility_id", facilityId).eq("status", "ACTIVE"),
        db.from("vehicles").select("id, plate, inspection_expiry, carrier_id, carriers(name)").lte("inspection_expiry", soon30d).eq("active", true),
        db.from("gate_passes").select("id, plate, stage, updated_at").eq("facility_id", facilityId).not("stage", "in", "(OUT_PASS,EXITED)").lt("updated_at", staleCutoff),
        db.from("trailers").select("id, plate, checked_in_at, check_in_time").eq("facility_id", facilityId).eq("equipment_type", "reefer").eq("status", "IN_YARD"),
        db.from("safety_incidents").select("id, severity, category, plate, created_at").eq("facility_id", facilityId).neq("status", "resolved"),
        db.from("exceptions").select("id, exception_type, severity, title, description, created_at").eq("facility_id", facilityId).neq("status", "resolved"),
        db.from("move_orders").select("id, trailer_id, trailers(plate), created_at").eq("facility_id", facilityId).eq("status", "PENDING").is("assigned_to", null),
        db.from("appointments").select("id, plate, carrier, start_time").eq("facility_id", facilityId).eq("status", "SCHEDULED").is("checked_in_at", null).gte("start_time", now.toISOString()).lte("start_time", in60),
      ]);

      const reeferIds = (reeferTrailers.data || []).map((t: any) => t.id);
      const { data: recentReadings } = reeferIds.length
        ? await db.from("reefer_readings").select("trailer_id, status, reasons, recorded_at").in("trailer_id", reeferIds).order("recorded_at", { ascending: false })
        : { data: [] as any[] };
      const latestByTrailer = new Map<number, any>();
      for (const r of recentReadings || []) {
        if (!latestByTrailer.has(r.trailer_id)) latestByTrailer.set(r.trailer_id, r);
      }

      const critical: any[] = [];
      const timeCritical: any[] = [];
      const operations: any[] = [];
      const upcoming: any[] = [];

      for (const s of safetyIncidents.data || []) {
        const bucket = (s.severity === "critical" || s.severity === "high") ? critical : timeCritical;
        bucket.push({ type: "safety_incident", severity: s.severity, title: `Safety: ${String(s.category).replace(/_/g, " ")}`, description: s.plate || "No related asset", timestamp: s.created_at, action: { label: "Review", link: "/safety" } });
      }
      for (const e of exceptions.data || []) {
        const bucket = e.severity === "critical" ? critical : timeCritical;
        bucket.push({ type: "exception", severity: e.severity, title: e.title, description: e.description || String(e.exception_type).replace(/_/g, " "), timestamp: e.created_at, action: { label: "Resolve", link: "/exceptions" } });
      }
      for (const t of reeferTrailers.data || []) {
        const latest = latestByTrailer.get(t.id);
        const checkedInAt = t.checked_in_at || t.check_in_time || new Date().toISOString();
        if (!latest) {
          if (isReadingStale(checkedInAt)) timeCritical.push({ type: "reefer_unchecked", severity: "warning", title: "Reefer never checked", description: `${t.plate} — no reading since check-in`, timestamp: checkedInAt, action: { label: "Open trailer", link: "/tracking" } });
        } else if (latest.status === "critical") {
          critical.push({ type: "reefer_critical", severity: "critical", title: "Reefer out of range", description: `${t.plate} — ${(latest.reasons || []).join("; ") || "critical reading"}`, timestamp: latest.recorded_at, action: { label: "Open trailer", link: "/tracking" } });
        } else if (isReadingStale(latest.recorded_at)) {
          timeCritical.push({ type: "reefer_stale", severity: "warning", title: "Reefer reading overdue", description: `${t.plate} — last checked over ${STALE_READING_HOURS}h ago`, timestamp: latest.recorded_at, action: { label: "Open trailer", link: "/tracking" } });
        }
      }
      for (const d of activeDetention.data || []) {
        timeCritical.push({ type: "detention", severity: "warning", title: "Detention accruing", description: `${d.carrier_name || "Unknown carrier"} — ${d.amount_owed ? Number(d.amount_owed).toFixed(0) : "?"} owed so far`, timestamp: d.created_at, action: { label: "Open finance", link: "/finance" } });
      }
      for (const g of staleGatePasses.data || []) {
        timeCritical.push({ type: "stale_pass", severity: "warning", title: `Vehicle stuck at ${g.stage.replace(/_/g, " ")}`, description: `${g.plate} — no movement in over 2 hours`, timestamp: g.updated_at, action: { label: "Open pipeline", link: "/pipeline" } });
      }
      for (const w of pendingApprovals.data || []) {
        operations.push({ type: "approval", severity: "warning", title: "Gate entry awaiting approval", description: `${w.truck_plate} — ${w.carrier_name}`, timestamp: w.created_at, action: { label: "Approve", link: "/gate" } });
      }
      for (const m of unassignedMoves.data || []) {
        operations.push({ type: "unassigned_move", severity: "info", title: "Unassigned move", description: (m as any).trailers?.plate || `Move #${m.id}`, timestamp: m.created_at, action: { label: "Assign", link: "/dispatch" } });
      }
      for (const v of expiringVehicles.data || []) {
        const overdue = v.inspection_expiry < new Date().toISOString().split("T")[0];
        operations.push({ type: "inspection", severity: overdue ? "warning" : "info", title: overdue ? "Inspection overdue" : "Inspection expiring soon", description: `${v.plate} — ${(v as any).carriers?.name || "Unassigned"} — ${v.inspection_expiry}`, timestamp: v.inspection_expiry, action: { label: "Review", link: "/superadmin" } });
      }
      for (const a of upcomingAppts.data || []) {
        const withinMin = a.start_time <= in30 ? "30 min" : "60 min";
        upcoming.push({ type: "arrival", severity: "info", title: `Arriving within ${withinMin}`, description: `${a.plate} — ${a.carrier} — ${new Date(a.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, timestamp: a.start_time, action: { label: "Open gate", link: "/gate" } });
      }

      const byTime = (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      critical.sort((a, b) => -byTime(a, b));
      timeCritical.sort((a, b) => -byTime(a, b));
      operations.sort((a, b) => -byTime(a, b));
      upcoming.sort(byTime);

      res.json({ critical, timeCritical, operations, upcoming });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Exception Management Center — real queue for exceptions raiseException()
  // writes into (blacklist blocks, seal mismatches, reefer critical, SLA
  // critical, no-shows), with an actual open -> acknowledged -> resolved
  // lifecycle instead of just an audit-log entry nobody works as a queue.
  const SAFETY_CATEGORIES = ["near_miss", "ppe_violation", "speed_violation", "restricted_zone_entry", "pedestrian_conflict", "unauthorized_movement", "collision_risk", "unsafe_parking", "damaged_equipment", "other"];

  // No safety incident tracking existed anywhere in this app — any real
  // yard operation needs a way to log near-misses, PPE violations, unsafe
  // parking, damaged equipment, etc. with severity/witnesses/corrective
  // action, not just the general-purpose exceptions table (which has no
  // room for root cause, witnesses, or immediate vs. corrective action).
  // Also raises a linked exception so it surfaces in the existing
  // Exception Center without a supervisor needing to check a sixth module.
  app.get("/api/admin/safety-incidents", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status, severity } = req.query;
    try {
      let query = db.from("safety_incidents").select("*, reporter:users!safety_incidents_reported_by_fkey(name), resolver:users!safety_incidents_resolved_by_fkey(name), driver:drivers!safety_incidents_driver_id_fkey(name, phone)").eq("facility_id", req.facilityId).order("created_at", { ascending: false }).limit(200);
      if (status) query = query.eq("status", status);
      if (severity) query = query.eq("severity", severity);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/safety-incidents", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { severity, category, location, plate, driver_id, description, witnesses, immediate_action, photos, spot_id } = req.body;
    const userId = req.session?.user?.id || null;
    const facilityId = req.facilityId;
    if (!description || !description.trim()) return res.status(400).json({ error: "Description is required" });
    if (!["low", "medium", "high", "critical"].includes(severity)) return res.status(400).json({ error: "Invalid severity" });
    if (!SAFETY_CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category" });
    try {
      const { data, error } = await db.from("safety_incidents").insert({
        facility_id: facilityId, severity, category, location: location || null, plate: plate || null,
        driver_id: driver_id || null, description: description.trim(), witnesses: witnesses || null,
        immediate_action: immediate_action || null, photos: Array.isArray(photos) ? photos : [],
        reported_by: userId, spot_id: spot_id || null,
      }).select().single();
      if (error) throw error;
      logAudit({ action: "SAFETY_INCIDENT_REPORTED", entityType: "SAFETY_INCIDENT", entityId: String(data.id), details: { severity, category, plate }, ip: req.ip, facility_id: facilityId, severity: severity === "critical" || severity === "high" ? "warning" : "info" });
      emitUpdate("safety_incident_created", data);
      raiseException({ facility_id: facilityId, exception_type: "safety_incident", severity: severity === "critical" ? "critical" : severity === "high" ? "critical" : "warning", entity_type: plate ? "TRAILER" : "SAFETY", entity_id: plate || String(data.id), title: `Safety incident: ${category.replace(/_/g, " ")}`, description: description.trim(), source: "safety_center" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/safety-incidents/:id", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status, corrective_action, root_cause } = req.body;
    const userId = req.session?.user?.id || null;
    try {
      const patch: any = {};
      if (corrective_action !== undefined) patch.corrective_action = corrective_action;
      if (root_cause !== undefined) patch.root_cause = root_cause;
      if (status === "investigating") patch.status = "investigating";
      if (status === "resolved") { patch.status = "resolved"; patch.resolved_at = new Date().toISOString(); patch.resolved_by = userId; }
      if (status === "open") patch.status = "open";
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      const { data, error } = await db.from("safety_incidents").update(patch).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      logAudit({ action: "SAFETY_INCIDENT_UPDATED", entityType: "SAFETY_INCIDENT", entityId: String(req.params.id), details: { status }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("safety_incident_updated", data);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/exceptions", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status, severity } = req.query;
    try {
      let query = db.from("exceptions").select("*, owner:users!exceptions_owner_id_fkey(name), acknowledged_by_user:users!exceptions_acknowledged_by_fkey(name), resolved_by_user:users!exceptions_resolved_by_fkey(name)").eq("facility_id", req.facilityId).order("created_at", { ascending: false }).limit(200);
      if (status) query = query.eq("status", status);
      if (severity) query = query.eq("severity", severity);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/exceptions/:id", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status, owner_id, resolution_notes } = req.body;
    const userId = req.session?.user?.id || null;
    try {
      const patch: any = {};
      if (owner_id !== undefined) patch.owner_id = owner_id;
      if (resolution_notes !== undefined) patch.resolution_notes = resolution_notes;
      if (status === "acknowledged") { patch.status = "acknowledged"; patch.acknowledged_at = new Date().toISOString(); patch.acknowledged_by = userId; }
      if (status === "resolved") { patch.status = "resolved"; patch.resolved_at = new Date().toISOString(); patch.resolved_by = userId; }
      if (status === "open") patch.status = "open";
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      const { data, error } = await db.from("exceptions").update(patch).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      logAudit({ action: "EXCEPTION_UPDATED", entityType: "EXCEPTION", entityId: String(req.params.id), details: { status, resolution_notes: !!resolution_notes }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("exception_updated", data);
      if (status === "resolved") enqueueWebhook("EXCEPTION_RESOLVED", data, req.facilityId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Twilio inbound SMS webhook — lets an admin approve/reject by texting back
  // "YES <id>" / "NO <id>" instead of opening the app. Requires manually
  // pointing the Twilio phone number's "A MESSAGE COMES IN" webhook at this
  // URL in the Twilio Console — that step can't be done from here.
  // SECURITY FIX: this webhook approves/rejects real walk-in registrations
  // based on nothing but the request body's `From` field matching an admin's
  // phone number — with no verification that the request actually came from
  // Twilio. Anyone could POST directly to this URL with a forged `From` and
  // `Body`, impersonate any admin whose phone number they know, and push
  // through (or block) approvals that exist specifically to require a human
  // sign-off on unmanned-gate self-service walk-ins. Twilio signs every
  // webhook request with an X-Twilio-Signature header computed from the
  // auth token + exact URL + form params; validateRequest() is Twilio's own
  // verification of that signature. Requests that don't come from Twilio's
  // signing key are now rejected before any approval logic runs. If
  // TWILIO_AUTH_TOKEN isn't configured, Twilio integration isn't active and
  // this path can't be legitimately reached anyway, so it fails closed.
  app.post("/api/twilio/inbound-sms", async (req: any, res) => {
    res.set("Content-Type", "text/xml");
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.headers["x-twilio-signature"];
    const webhookUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    if (!authToken || !signature || !twilio.validateRequest(authToken, signature, webhookUrl, req.body || {})) {
      logAudit({ action: "TWILIO_WEBHOOK_SIGNATURE_INVALID", entityType: "SMS", details: { from: req.body?.From }, ip: req.ip, severity: "warning" });
      return res.status(403).send("<Response></Response>");
    }
    try {
      const from = String(req.body?.From || "").replace(/\D/g, "").slice(-9); // last 9 digits, loose match
      const body = String(req.body?.Body || "").trim();
      const match = body.match(/^(YES|NO)\s+(\d+)/i);
      if (!from || !match) return res.send("<Response></Response>");

      const { data: admin } = await db.from("users").select("id, phone, facility_id, role").in("role", ["ADMIN", "superadmin"]).not("phone", "is", null);
      const matched = (admin || []).find((a: any) => String(a.phone || "").replace(/\D/g, "").slice(-9) === from);
      if (!matched) {
        logAudit({ action: "SMS_APPROVAL_UNKNOWN_SENDER", entityType: "SMS", entityId: from, details: { body }, severity: "warning" });
        return res.send("<Response></Response>"); // unknown sender — silently ignore, don't leak info
      }

      const walkinId = Number(match[2]);
      const approve = match[1].toUpperCase() === "YES";
      const result = approve
        ? await approveWalkin(walkinId, matched.id, matched.facility_id || 1)
        : await rejectWalkin(walkinId, matched.id, matched.facility_id || 1, "Denied via SMS");

      const reply = result.ok
        ? (approve ? `Approved WK-${walkinId}${result.spotName ? `, spot ${result.spotName}` : " (queued, yard full)"}.` : `Rejected WK-${walkinId}.`)
        : `Could not process WK-${walkinId}: ${result.error}`;
      res.send(`<Response><Message>${reply}</Message></Response>`);
    } catch (e: any) {
      logger.error("SMS approval webhook failed", { error: e.message });
      res.send("<Response></Response>");
    }
  });

  // --- Gate pass pipeline management ---
  app.get("/api/gate-pass/active", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    try {
      const { data } = await db.from("gate_passes").select("*, spots(name)").eq("facility_id", req.facilityId).neq("stage", "EXITED").order("issued_at", { ascending: true });
      res.json((data || []).map((p: any) => ({ ...p, spot_name: p.spots?.name })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gate-pass/:id/verify", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { license_verified, vehicle_matched, documents_ok } = req.body;
    try {
      const { data, error } = await db.from("gate_passes").update({
        license_verified: !!license_verified, vehicle_matched: !!vehicle_matched, documents_ok: !!documents_ok,
        verified_by: req.session.user.id, verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      logAudit({ action: "GATE_PASS_VERIFIED", entityType: "GATE_PASS", entityId: req.params.id, details: { license_verified: !!license_verified, vehicle_matched: !!vehicle_matched, documents_ok: !!documents_ok, plate: data.plate }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("yard_update", { type: "GATE_PASS" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gate-pass/:id/advance", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { stage } = req.body;
    try {
      const { data: pass } = await db.from("gate_passes").select("*").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!pass) return res.status(404).json({ error: "Gate pass not found" });

      const transition = checkStageTransition(pass.stage, stage, { license_verified: pass.license_verified, vehicle_matched: pass.vehicle_matched });
      if (!transition.ok) return res.status(400).json({ error: transition.error });

      if (stage === "READY_FOR_EXIT" && pass.trailer_id) {
        const { data: trailer } = await db.from("trailers").select("cargo_status").eq("id", pass.trailer_id).maybeSingle();
        if (!isLoadReady(trailer?.cargo_status)) {
          return res.status(400).json({ error: `Cargo status "${trailer?.cargo_status}" is not ready for exit — finish the load operation first` });
        }
      }

      const { data, error } = await db.from("gate_passes").update({ stage, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
      if (error) throw error;
      logAudit({ action: "GATE_PASS_STAGE_ADVANCED", entityType: "GATE_PASS", entityId: String(pass.id), details: { from: pass.stage, to: stage }, ip: req.ip, facility_id: req.facilityId });

      if (stage === "READY_FOR_EXIT" && pass.driver_id) {
        const { data: driver } = await db.from("drivers").select("phone").eq("id", pass.driver_id).maybeSingle();
        if (driver?.phone) {
          notify({ type: "GATE_PASS_READY_FOR_EXIT", recipientType: "driver", recipientId: pass.driver_id, data: { phone: driver.phone, title: "Ready for exit", body: `SkyYard: ${pass.plate} is cleared for exit. An out-pass will be issued shortly. Ref: ${pass.pass_number}` } });
        }
      }

      emitUpdate("yard_update", { type: "GATE_PASS" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gate-pass/:id/out-pass", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    try {
      const { data: pass } = await db.from("gate_passes").select("*").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!pass) return res.status(404).json({ error: "Gate pass not found" });
      if (pass.stage !== "READY_FOR_EXIT") return res.status(400).json({ error: "Vehicle must be marked ready for exit before an out-pass can be issued" });

      const { data, error } = await db.from("gate_passes").update({
        stage: "OUT_PASS", out_pass_by: req.session.user.id, out_pass_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", req.params.id).select().single();
      if (error) throw error;
      logAudit({ action: "OUT_PASS_ISSUED", entityType: "GATE_PASS", entityId: String(pass.id), details: { plate: pass.plate }, ip: req.ip, facility_id: req.facilityId });

      if (pass.driver_id) {
        const { data: driver } = await db.from("drivers").select("phone").eq("id", pass.driver_id).maybeSingle();
        if (driver?.phone) {
          notify({ type: "OUT_PASS_ISSUED", recipientType: "driver", recipientId: pass.driver_id, data: { phone: driver.phone, title: "Out-pass issued", body: `SkyYard: Out-pass issued for ${pass.plate}. You're clear to exit. Ref: ${pass.pass_number}` } });
        }
      }

      emitUpdate("yard_update", { type: "GATE_PASS" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gate-pass/:id/exit", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    try {
      const { data: pass } = await db.from("gate_passes").select("*").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!pass) return res.status(404).json({ error: "Gate pass not found" });
      if (pass.stage !== "OUT_PASS") return res.status(400).json({ error: "Out-pass must be issued before exit can be confirmed" });

      const { data, error } = await db.from("gate_passes").update({ stage: "EXITED", exited_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
      if (error) throw error;
      await db.from("gate_logs").insert({ facility_id: req.facilityId, event_type: "exit", trailer_id: pass.trailer_id, truck_plate: pass.plate, guard_user_id: req.session.user.id, notes: `Gate pass ${pass.pass_number} exited` });
      if (pass.spot_id) await db.from("spots").update({ status: "EMPTY" }).eq("id", pass.spot_id);
      logAudit({ action: "GATE_PASS_EXITED", entityType: "GATE_PASS", entityId: String(pass.id), details: { plate: pass.plate }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("yard_update", { type: "GATE_PASS" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Driver ratings — driver_ratings had a full schema (punctuality/
  // cooperation/compliance scores) but nothing anywhere ever wrote or read
  // it. The natural moment to capture it is right after a gate pass exits,
  // while the interaction is still fresh for whoever was at the gate.
  app.post("/api/gate-pass/:id/rate", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { punctuality_score, cooperation_score, compliance_score, notes } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: pass } = await db.from("gate_passes").select("*").eq("id", req.params.id).eq("facility_id", facilityId).maybeSingle();
      if (!pass) return res.status(404).json({ error: "Gate pass not found" });
      if (pass.stage !== "EXITED") return res.status(400).json({ error: "Can only rate a gate pass after it has exited" });
      if (!pass.driver_id) return res.status(400).json({ error: "No driver on file for this gate pass" });

      const scores = [punctuality_score, cooperation_score, compliance_score].filter((s) => typeof s === "number");
      if (scores.length === 0) return res.status(400).json({ error: "At least one score is required" });
      const rating = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

      const { data: inserted, error } = await db.from("driver_ratings").insert({
        facility_id: facilityId, driver_id: pass.driver_id, rating,
        punctuality_score: punctuality_score ?? null, cooperation_score: cooperation_score ?? null, compliance_score: compliance_score ?? null,
        notes: notes || null, rated_by: req.session?.user?.id || null,
      }).select().single();
      if (error) throw error;

      logAudit({ action: "DRIVER_RATED", entityType: "GATE_PASS", entityId: String(pass.id), details: { driver_id: pass.driver_id, rating }, ip: req.ip, facility_id: facilityId });
      res.json(inserted);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/drivers/:id/ratings", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    try {
      const { data } = await db.from("driver_ratings").select("*").eq("driver_id", req.params.id).order("created_at", { ascending: false }).limit(20);
      const avg = (data || []).length ? Math.round((data as any[]).reduce((s, r) => s + (r.rating || 0), 0) / data!.length) : null;
      res.json({ average: avg, count: (data || []).length, ratings: data || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Gate badge scan — pre-registered driver (see /api/driver/profile) scans
  // their permanent QR at the gate instead of filling a form or waiting for
  // approval. Blacklist-checked, auto-assigns a spot via the same
  // walkin_autoassign_tx engine every other entry path already uses.
  // Physically reading the code still goes through GateConsole's existing
  // QRScanner (staff-operated camera) — a literal unattended kiosk/hardware
  // reader is a separate hardware integration, not something buildable here.
  app.get("/api/gate/badge/:token", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { token } = req.params;
    const facilityId = req.facilityId || 1;
    try {
      const { data: driver } = await db.from("drivers").select("*").eq("badge_token", token).maybeSingle();
      if (!driver || !driver.badge_issued_at) {
        return res.status(404).json({ error: "Badge not recognized or driver hasn't completed registration" });
      }

      const blacklistHit = await checkBlacklist(facilityId, driver.default_plate, driver.carrier_name);
      if (blacklistHit && blacklistHit.severity === "block") {
        logAudit({ action: "BLACKLIST_BLOCKED_BADGE_SCAN", entityType: "TRAILER", entityId: driver.default_plate, details: { reason: blacklistHit.reason, driverId: driver.id }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        raiseException({ facility_id: facilityId, exception_type: "blacklist_block", severity: "warning", entity_type: "TRAILER", entity_id: driver.default_plate, title: `Blacklisted entry blocked: ${driver.default_plate}`, description: blacklistHit.reason, source: "badge_scan" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason, driver: { name: driver.name, plate: driver.default_plate } });
      }

      // Phase F: deny entry on an expired inspection even when the plate
      // isn't blacklisted — a badge scan is unattended (no guard eyeballing
      // paperwork), so this is the only checkpoint left to catch it. Only
      // applies to plates actually registered in the fleet table (Phase D);
      // no registration means nothing to check against, same "opt-in, don't
      // block the unregistered" rule as the capacity check.
      const { data: vehicle } = await db.from("vehicles").select("inspection_expiry").eq("plate", driver.default_plate.toUpperCase()).maybeSingle();
      if (vehicle?.inspection_expiry && new Date(vehicle.inspection_expiry) < new Date()) {
        logAudit({ action: "EXPIRED_INSPECTION_BLOCKED_BADGE_SCAN", entityType: "VEHICLE", entityId: driver.default_plate, details: { inspection_expiry: vehicle.inspection_expiry, driverId: driver.id }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        return res.status(403).json({ error: "INSPECTION_EXPIRED", expiredOn: vehicle.inspection_expiry, driver: { name: driver.name, plate: driver.default_plate } });
      }

      const { data: walkin, error } = await db.from("walkin_registrations").insert({
        driver_name: driver.name, carrier_name: driver.carrier_name, phone: driver.phone,
        truck_plate: driver.default_plate, load_type: driver.default_load_type || "standard",
        status: "pending", facility_id: facilityId, driver_id: driver.id, source: "badge_scan",
      }).select().single();
      if (error) throw error;

      // Same rating-caution surfacing as guard-operated walk-in (Phase XX) —
      // a badge-scan re-entry is still the same driver with the same
      // history, and staff deserve the same heads-up regardless of which
      // entry path they came through.
      let driverCaution: { average: number; count: number } | null = null;
      const { data: ratings } = await db.from("driver_ratings").select("rating").eq("driver_id", driver.id).order("created_at", { ascending: false }).limit(20);
      if (ratings && ratings.length > 0) {
        const avg = ratings.reduce((s, r: any) => s + (r.rating || 0), 0) / ratings.length;
        if (avg <= 2) driverCaution = { average: Math.round(avg * 10) / 10, count: ratings.length };
      }

      const { data: assign } = await db.rpc("walkin_autoassign_tx", {
        p_walkin_id: walkin.id, p_truck_plate: driver.default_plate, p_carrier_name: driver.carrier_name, p_facility_id: facilityId,
      });

      logAudit({ action: "BADGE_SCAN_ENTRY", entityType: "DRIVER", entityId: String(driver.id), details: { plate: driver.default_plate, assigned: !!assign?.assigned }, ip: req.ip, facility_id: facilityId });

      if (assign?.assigned) {
        notify({ type: "BADGE_SCAN_CONFIRMED", recipientType: "driver", recipientId: driver.id, data: { phone: driver.phone, title: "Entry confirmed", body: `SkyYard: Badge scanned, welcome back. Proceed to spot ${assign.spotName}.` } });
        const pass = await issueGatePass({ facilityId, plate: driver.default_plate, carrierName: driver.carrier_name, driverId: driver.id, spotName: assign.spotName, issuedBy: req.session?.user?.id, entrySource: "badge_scan" });
        // Pre-registered badge already implies the driver's identity and vehicle were
        // verified at registration time — mark the checklist pre-satisfied so staff
        // aren't asked to re-verify what the badge itself already vouches for.
        if (pass) await db.from("gate_passes").update({ license_verified: true, vehicle_matched: true, verified_by: req.session?.user?.id, verified_at: new Date().toISOString() }).eq("id", pass.id);
        emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
        return res.json({ success: true, driver: { name: driver.name, plate: driver.default_plate, carrier_name: driver.carrier_name }, spotName: assign.spotName, passNumber: pass?.pass_number, driverCaution });
      }

      emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
      res.json({ success: true, driver: { name: driver.name, plate: driver.default_plate, carrier_name: driver.carrier_name }, queued: true, driverCaution });
    } catch (e: any) {
      logger.error("Badge scan failed", { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/visitors/register", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { name, company, host_name, purpose, expected_duration } = req.body;
    const facilityId = req.facilityId;
    const accessCode = Math.floor(1000 + Math.random() * 9000).toString();
    try {
      await db.from("visitors").insert({ facility_id: facilityId, name, company, host_name, purpose, access_code: accessCode, expected_duration_minutes: expected_duration || 60 });
      logAudit({ action: "VISITOR_REGISTERED", entityType: "VISITOR", entityId: accessCode, details: { name, company }, ip: req.ip, facility_id: facilityId });
      res.json({ success: true, accessCode });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/visitors/active", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { data } = await db.from("visitors").select("*").eq("facility_id", req.facilityId).is("checked_out_at", null);
    res.json(data || []);
  });

  app.post("/api/visitors/checkout", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { accessCode } = req.body;
    try {
      const { data, error } = await db.from("visitors").update({ checked_out_at: new Date().toISOString() })
        .eq("access_code", accessCode).eq("facility_id", req.facilityId).is("checked_out_at", null).select();
      if (error) throw error;
      if (!data || data.length === 0) return res.status(404).json({ error: "Active visitor not found with this code" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gate/checkin", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { appointmentId, plate, carrierName, sealNumber, overrideDiscrepancy, overrideNote, poNumber, skuSummary, reeferSetpoint } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: appt } = await db.from("appointments").select("*, drivers(phone, id)").eq("id", appointmentId).eq("facility_id", facilityId).maybeSingle();
      if (!appt) return res.status(404).json({ error: "Appointment not found" });

      const blacklistHit = await checkBlacklist(facilityId, plate, carrierName || appt.carrier);
      if (blacklistHit && blacklistHit.severity === "block") {
        await db.from("gate_logs").insert({ facility_id: facilityId, event_type: "denied", appointment_id: appointmentId, truck_plate: plate, guard_user_id: req.session?.user?.id || null, notes: `Blacklisted: ${blacklistHit.reason}` });
        logAudit({ action: "BLACKLIST_BLOCKED_ENTRY", entityType: "TRAILER", entityId: plate, details: { reason: blacklistHit.reason, appointmentId }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        raiseException({ facility_id: facilityId, exception_type: "blacklist_block", severity: "warning", entity_type: "TRAILER", entity_id: plate, title: `Blacklisted entry blocked: ${plate}`, description: blacklistHit.reason, source: "staff_checkin" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason });
      }

      const hasPlateMismatch = appt.plate && appt.plate !== plate;
      const hasCarrierMismatch = appt.carrier && appt.carrier !== carrierName && carrierName;
      if ((hasPlateMismatch || hasCarrierMismatch) && !overrideDiscrepancy) {
        return res.status(409).json({ error: "DISCREPANCY_DETECTED", expected: { plate: appt.plate, carrier: appt.carrier }, presented: { plate, carrier: carrierName } });
      }

      let result;
      try {
        const { data, error } = await db.rpc("gate_checkin_tx", {
          p_appointment_id: appointmentId, p_plate: plate, p_carrier: carrierName || appt.carrier,
          p_driver_license: appt.driver_license || null, p_seal_number: sealNumber || null, p_facility_id: facilityId,
          p_guard_user_id: req.session?.user?.id || null, p_override_discrepancy: !!overrideDiscrepancy, p_override_note: overrideNote || (blacklistHit ? `Warning: ${blacklistHit.reason}` : null),
        });
        if (error) throw error;
        result = data;
      } catch (e: any) {
        if (String(e.message).includes("YARD_FULL")) return res.status(400).json({ error: "Yard saturated. No empty parking nodes." });
        throw e;
      }

      logAudit({ action: "GATE_CHECKIN", entityType: "TRAILER", entityId: plate, details: { appointmentId, spot: result.spotName, overrideDiscrepancy }, ip: req.ip, facility_id: facilityId });

      if (poNumber || skuSummary) {
        await db.from("trailers").update({ po_number: poNumber || null, sku_summary: skuSummary || null }).eq("plate", plate).eq("facility_id", facilityId);
      }

      // temperature_requirement sat on appointments unused — a carrier could
      // book a reefer load and state the required temperature, but nothing
      // ever carried that through to the trailer's reefer_temp_setpoint,
      // which the reefer monitoring flow (Phase N) reads to judge whether a
      // logged reading is in range. Without it, every reefer trailer's
      // setpoint stayed null and readings only got checked against a generic
      // safe-range fallback instead of what was actually requested.
      // equipment_type also never gets set from load_type anywhere — without
      // it the reefer-reading endpoint rejects every reading for this
      // trailer with "not equipment_type reefer", making the whole feature
      // unreachable through a real check-in.
      if (appt.load_type === "reefer") {
        const parsedRequirement = appt.temperature_requirement != null ? parseFloat(appt.temperature_requirement) : null;
        const setpoint = reeferSetpoint != null && reeferSetpoint !== "" ? Number(reeferSetpoint) : (Number.isFinite(parsedRequirement) ? parsedRequirement : null);
        const patch: any = { equipment_type: "reefer" };
        if (setpoint != null && !isNaN(setpoint)) patch.reefer_temp_setpoint = setpoint;
        await db.from("trailers").update(patch).eq("plate", plate).eq("facility_id", facilityId);
      }

      // Staff already verified plate/carrier against the appointment (the
      // discrepancy check above) — record that as completed. documents_ok
      // stays false even when a seal number was captured: applying a seal
      // isn't the same as verifying it, and a real seal check now happens
      // in the pipeline board's verify modal (seal chain-of-custody).
      const pass = await issueGatePass({ facilityId, plate, carrierName: carrierName || appt.carrier, driverId: appt.driver_id, spotName: result.spotName, issuedBy: req.session?.user?.id, entrySource: "staff_checkin" });
      if (pass) {
        await db.from("gate_passes").update({
          license_verified: true, vehicle_matched: !hasPlateMismatch, documents_ok: false,
          verified_by: req.session?.user?.id, verified_at: new Date().toISOString(),
        }).eq("id", pass.id);
      }

      const driverPhone = appt.drivers?.phone;
      if (driverPhone) {
        notify({ type: "GATE_CHECKIN", recipientType: "driver", recipientId: appt.driver_id, data: { phone: driverPhone, title: "Checked In", body: `SkyYard: Welcome! You are assigned to parking spot: ${result.spotName}. Please wait for further instructions.` } });
      }

      emitUpdate("yard_update", { type: "CHECKIN", plate });
      res.json({ success: true, spotName: result.spotName, passNumber: pass?.pass_number });
    } catch (e: any) {
      logger.error("Gate checkin failed", { error: e });
      res.status(500).json({ error: "Sync failed" });
    }
  });

  const MOVE_PRIORITIES = ["low", "normal", "high", "urgent"];
  app.post("/api/create-move", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { trailerId, fromSpotId, toSpotId, assignedTo, priority } = req.body;
    const facilityId = req.facilityId;
    if (priority !== undefined && !MOVE_PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority" });
    try {
      const { data: move, error } = await db.from("move_orders").insert({
        trailer_id: trailerId, from_spot_id: fromSpotId, to_spot_id: toSpotId, facility_id: facilityId,
        assigned_to: assignedTo || null, status: assignedTo ? "IN_PROGRESS" : "PENDING",
        priority: priority || "normal",
      }).select().single();
      if (error) throw error;
      logAudit({ action: "MOVE_CREATED", entityType: "TRAILER", entityId: String(trailerId), details: { fromSpotId, toSpotId }, ip: req.ip, facility_id: facilityId });
      emitUpdate("move_update", { type: "NEW_MOVE" });
      res.json({ success: true, move });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to create move order" });
    }
  });

  // move_orders.assigned_to has existed in the schema (with a real FK to
  // users, and a status CHECK that already allows IN_PROGRESS) since before
  // this session, but nothing ever read or wrote it — every move sat in one
  // shared, unowned pool. Any hostler could complete any move and there was
  // no way to see "my" queue vs. everyone else's. This wires the column up
  // as a real claim workflow: PENDING (unassigned) -> claim -> IN_PROGRESS
  // (owned) -> complete-move (existing endpoint, unchanged) -> COMPLETED.
  app.post("/api/moves/:id/claim", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { id } = req.params;
    const facilityId = req.facilityId;
    const userId = req.session?.user?.id;
    try {
      const { data: move } = await db.from("move_orders").select("id, status, assigned_to").eq("id", id).eq("facility_id", facilityId).maybeSingle();
      if (!move) return res.status(404).json({ error: "Move order not found" });
      if (move.status !== "PENDING") return res.status(409).json({ error: `Move is ${move.status.toLowerCase()}, not available to claim` });
      if (move.assigned_to) return res.status(409).json({ error: "Already claimed by another operator" });

      const { data: updated, error } = await db.from("move_orders").update({ assigned_to: userId, status: "IN_PROGRESS" })
        .eq("id", id).eq("facility_id", facilityId).eq("status", "PENDING").is("assigned_to", null).select().single();
      if (error || !updated) return res.status(409).json({ error: "Already claimed by another operator" });

      logAudit({ action: "MOVE_CLAIMED", entityType: "MOVE_ORDER", entityId: String(id), ip: req.ip, facility_id: facilityId });
      emitUpdate("move_update", { type: "MOVE_CLAIMED", id: Number(id) });
      res.json({ success: true, move: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/moves/:id/release", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { id } = req.params;
    const facilityId = req.facilityId;
    const userId = req.session?.user?.id;
    const role = req.session?.user?.role;
    try {
      const { data: move } = await db.from("move_orders").select("id, status, assigned_to").eq("id", id).eq("facility_id", facilityId).maybeSingle();
      if (!move) return res.status(404).json({ error: "Move order not found" });
      if (move.assigned_to && move.assigned_to !== userId && role !== "superadmin" && role !== "ADMIN") {
        return res.status(403).json({ error: "This task is claimed by another operator" });
      }
      const { data: updated, error } = await db.from("move_orders").update({ assigned_to: null, status: "PENDING" }).eq("id", id).eq("facility_id", facilityId).select().single();
      if (error) throw error;

      logAudit({ action: "MOVE_RELEASED", entityType: "MOVE_ORDER", entityId: String(id), ip: req.ip, facility_id: facilityId });
      emitUpdate("move_update", { type: "MOVE_RELEASED", id: Number(id) });
      res.json({ success: true, move: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/complete-move", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { moveId } = req.body;
    try {
      const { data: result, error } = await db.rpc("complete_move_tx", { p_move_id: moveId });
      if (error) throw error;

      logAudit({ action: "MOVE_COMPLETED", entityType: "TRAILER", entityId: String(result.trailerId), details: { moveId }, ip: req.ip });

      if (result.toSpotType === "DOCK" && result.driverId) {
        const { data: driver } = await db.from("drivers").select("phone").eq("id", result.driverId).maybeSingle();
        if (driver?.phone) {
          notify({ type: "DOCK_ASSIGNMENT", recipientType: "driver", recipientId: result.driverId, data: { phone: driver.phone, title: "Dock Assigned", body: `SkyYard: Your trailer ${result.plate} has been assigned to Dock: ${result.toSpotName}. Please proceed for loading/unloading.` } });
        }
      }

      emitUpdate("yard_update", { type: "MOVE_COMPLETE" });
      enqueueWebhook("TRAILER_MOVED", { moveId, trailerId: result.trailerId, plate: result.plate, toSpotName: result.toSpotName, toSpotType: result.toSpotType }, req.facilityId || 1);
      res.json({ success: true });
    } catch (e: any) {
      if (String(e.message).includes("MOVE_ALREADY_COMPLETED")) {
        return res.status(409).json({ error: "This move was already completed — probably a double-click. No action taken." });
      }
      if (String(e.message).includes("MOVE_NOT_FOUND")) {
        return res.status(404).json({ error: "Move order not found" });
      }
      logger.error("Move completion failed", { error: e });
      res.status(500).json({ error: "Transaction failure" });
    }
  });

  app.post("/api/dispatch", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { trailerId, spotId } = req.body;
    try {
      const { data: trailer } = await db.from("trailers").select("*, drivers(phone)").eq("id", trailerId).maybeSingle();

      const { error } = await db.rpc("dispatch_trailer_tx", { p_trailer_id: trailerId, p_spot_id: spotId || null });
      if (error) throw error;

      // Close out any still-ACTIVE detention record for this trailer — dispatch
      // never touched detention_records before, so a resolved detention charge
      // stayed marked ACTIVE (still accruing) forever after the trailer left.
      const { data: activeDetention } = await db.from("detention_records").select("*").eq("trailer_id", trailerId).eq("status", "ACTIVE").maybeSingle();
      if (activeDetention) {
        const finalActualMinutes = Math.floor((Date.now() - new Date(activeDetention.start_time).getTime()) / 60000);
        const finalOvertimeMinutes = finalActualMinutes - (activeDetention.threshold_minutes || 0);
        const finalAmountOwed = Math.round((finalOvertimeMinutes / 60) * (activeDetention.rate_per_hour || 0) * 100) / 100;
        await db.from("detention_records").update({
          status: "RESOLVED", actual_minutes: finalActualMinutes, overtime_minutes: finalOvertimeMinutes,
          amount_owed: finalAmountOwed, updated_at: new Date().toISOString(),
        }).eq("id", activeDetention.id);
      }

      logAudit({ action: "TRAILER_DISPATCH", entityType: "TRAILER", entityId: String(trailerId), details: { spotId }, ip: req.ip });

      if (trailer?.drivers?.phone) {
        notify({ type: "TRAILER_DISPATCH", recipientType: "driver", recipientId: trailer.driver_id, data: { phone: trailer.drivers.phone, title: "Dispatched", body: `SkyYard: Your trailer ${trailer.plate} has been dispatched from Spot ${spotId || "Yard"}. Safe travels!` } });
      }

      emitUpdate("yard_update", { type: "DISPATCH" });
      enqueueWebhook("TRUCK_DEPARTED", { trailerId, plate: trailer?.plate, carrier: trailer?.carrier }, req.facilityId || 1);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Dispatch failed" });
    }
  });

  // Analytics Helper
  const getMetrics = async (start: string, end: string, facilityId: number) => {
    const { data: completed } = await db.from("walkin_registrations").select("checked_in_at, checked_out_at").eq("facility_id", facilityId).eq("status", "completed").gte("created_at", start).lte("created_at", end);
    let avgTat = 0;
    if (completed && completed.length > 0) {
      const total = completed.reduce((s: number, r: any) => s + (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) / 60000, 0);
      avgTat = Math.round(total / completed.length);
    }
    const countRes = await db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);

    // ExecutiveDashboard's KPI row (Total Movements/Avg Dwell/On-Time Rate/
    // SLA Breaches) was reading fields this endpoint never returned — it
    // silently rendered 0 for three of four cards. On-time uses the same
    // isOnTimeArrival logic the carrier-dashboard KPIs and no-show cron
    // already use, so the numbers agree with what staff see elsewhere.
    const { data: appts } = await db.from("appointments").select("start_time, checked_in_at, grace_period_minutes").eq("facility_id", facilityId).not("checked_in_at", "is", null).gte("start_time", start).lte("start_time", end);
    const onTimeCount = (appts || []).filter((a: any) => isOnTimeArrival(a.start_time, a.checked_in_at, a.grace_period_minutes)).length;
    const onTimeRate = appts && appts.length > 0 ? Math.round((onTimeCount / appts.length) * 1000) / 10 : null;

    const { count: detentionEvents } = await db.from("detention_records").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);

    return { totalTrucks: countRes.count || 0, avgTat, onTimeRate, detentionEvents: detentionEvents || 0 };
  };

  // Phase 41: Daily Yard Report — the manager-facing report every yard
  // still runs by hand (Excel, shift notes). Reuses getMetrics() for the
  // truck/dwell/on-time numbers instead of a second calculation, then
  // adds the categories getMetrics doesn't cover (safety, exceptions,
  // detention $ total) from tables that already exist.
  app.get("/api/admin/reports/daily", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId;
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    try {
      const metrics = await getMetrics(dayStart, dayEnd, facilityId);
      const [{ count: safetyIncidents }, { count: exceptions }, { data: detentionRows }] = await Promise.all([
        db.from("safety_incidents").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", dayStart).lt("created_at", dayEnd),
        db.from("exceptions").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", dayStart).lt("created_at", dayEnd),
        db.from("detention_records").select("amount_owed").eq("facility_id", facilityId).gte("created_at", dayStart).lt("created_at", dayEnd),
      ]);
      const detentionTotal = (detentionRows || []).reduce((sum, r: any) => sum + Number(r.amount_owed || 0), 0);
      res.json({
        date,
        totalTrucks: metrics.totalTrucks,
        avgDwellMinutes: metrics.avgTat,
        onTimeRate: metrics.onTimeRate,
        detentionEvents: metrics.detentionEvents,
        detentionTotal,
        safetyIncidents: safetyIncidents || 0,
        exceptions: exceptions || 0,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/analytics", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId;
    const start = (req.query.start as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = (req.query.end as string) || new Date().toISOString();

    const current = await getMetrics(start, end, facilityId);
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const prevStart = new Date(new Date(start).getTime() - duration).toISOString();
    const previous = await getMetrics(prevStart, start, facilityId);

    const { data: carrierRows } = await db.from("walkin_registrations").select("carrier_name, checked_in_at, checked_out_at").eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);
    const carrierMap: Record<string, { total_visits: number; dwellSum: number; dwellCount: number }> = {};
    for (const r of carrierRows || []) {
      const key = r.carrier_name || "Unknown";
      if (!carrierMap[key]) carrierMap[key] = { total_visits: 0, dwellSum: 0, dwellCount: 0 };
      carrierMap[key].total_visits++;
      if (r.checked_in_at) {
        const end2 = r.checked_out_at ? new Date(r.checked_out_at).getTime() : Date.now();
        carrierMap[key].dwellSum += (end2 - new Date(r.checked_in_at).getTime()) / 60000;
        carrierMap[key].dwellCount++;
      }
    }
    const carrierStats = Object.entries(carrierMap).map(([carrier, v]) => ({ carrier, total_visits: v.total_visits, avg_dwell_mins: v.dwellCount ? Math.round(v.dwellSum / v.dwellCount) : 0 }));

    const { data: hourlyRows } = await db.from("walkin_registrations").select("created_at").eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);
    const hourMap: Record<string, number> = {};
    for (const r of hourlyRows || []) {
      const hour = new Date(r.created_at).getHours().toString().padStart(2, "0");
      hourMap[hour] = (hourMap[hour] || 0) + 1;
    }
    const hourlyVolume = Object.entries(hourMap).map(([hour, count]) => ({ hour, count }));

    res.json({ current, previous, carrierStats, hourlyVolume });
  });

  // Dock/gate utilization heatmap: gate entries bucketed by day-of-week x
  // hour-of-day over the last 90 days. Monday-first week (ISO), matching the
  // Swedish work-week convention this app is built for. Used for staffing
  // and appointment-slot capacity planning, not just a live snapshot.
  app.get("/api/admin/analytics/heatmap", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId;
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data } = await db.from("gate_logs").select("timestamp").eq("facility_id", facilityId).eq("event_type", "entry").gte("timestamp", since);
      const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const row of data || []) {
        const d = new Date(row.timestamp);
        const isoDay = (d.getDay() + 6) % 7; // 0=Mon .. 6=Sun
        grid[isoDay][d.getHours()]++;
      }
      res.json({ grid, sampleDays: 90 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Smart Autofill for returning drivers
  // Was defined but never called from anywhere in the frontend — the manual
  // check-in form on GateConsole made staff retype carrier/license info for
  // every returning plate instead of prefilling it from history.
  app.get("/api/driver/lookup", requireRole("superadmin", "ADMIN", "GUARD"), async (req, res) => {
    const { plate } = req.query;
    try {
      const { data } = await db.from("trailers").select("driver_license, carrier").eq("plate", plate).order("check_in_time", { ascending: false }).limit(1).maybeSingle();
      res.json(data || { visit_count: 0 });
    } catch (e) {
      res.status(500).json({ error: "Lookup failed" });
    }
  });

  // Driver OTP Routes
  app.post("/api/driver/request-otp", otpRequestLimiter, async (req, res) => {
    const { phone } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.from("driver_otp").upsert({ phone, code, expires_at: expiresAt }, { onConflict: "phone" });
    await sendSms(phone, `SkyYard: Your verification code is ${code}. It expires in 10 minutes.`);
    res.json({ success: true, message: "Code sent" });
  });

  app.post("/api/driver/verify-otp", otpVerifyLimiter, async (req, res) => {
    const { phone, code } = req.body;
    const { data: otp } = await db.from("driver_otp").select("*").eq("phone", phone).eq("code", code).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!otp) {
      logAudit({ action: "DRIVER_OTP_FAILED", entityType: "DRIVER", entityId: phone, details: {}, ip: req.ip, facility_id: 1, severity: "warning" });
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    await db.from("driver_otp").delete().eq("phone", phone);
    await db.from("drivers").upsert({ phone }, { onConflict: "phone", ignoreDuplicates: true });
    const { data: driver } = await db.from("drivers").select("id").eq("phone", phone).maybeSingle();

    (req as any).session.driver_id = driver!.id;
    (req as any).session.driver_phone = phone;
    res.json({ success: true, redirect: "/driver/dashboard" });
  });

  app.get("/api/driver/me", async (req: any, res) => {
    if (!req.session?.driver_id) return res.status(401).json({ error: "Not authenticated" });
    const { data: driver } = await db.from("drivers").select("id, phone, name, default_carrier_id, default_plate, default_load_type, license_number, vehicle_type, carrier_name, badge_token, badge_issued_at").eq("id", req.session.driver_id).maybeSingle();
    res.json({ driver });
  });

  // Self-service driver profile — completing this is what turns a bare OTP
  // session into a reusable gate badge (badge_token already exists on every
  // driver row via a DB default, but it's meaningless without the profile
  // details a guard/scanner needs to actually verify someone at the gate).
  app.post("/api/driver/profile", async (req: any, res) => {
    if (!req.session?.driver_id) return res.status(401).json({ error: "Not authenticated" });
    const { name, truck_plate, carrier_name, license_number, vehicle_type } = req.body;
    if (!name || !truck_plate || !carrier_name) return res.status(400).json({ error: "Name, plate, and carrier are required" });
    try {
      const { data: driver, error } = await db.from("drivers").update({
        name, default_plate: truck_plate, carrier_name,
        license_number: license_number || null, vehicle_type: vehicle_type || null,
        badge_issued_at: new Date().toISOString(),
      }).eq("id", req.session.driver_id).select("id, phone, name, default_plate, carrier_name, license_number, vehicle_type, badge_token, badge_issued_at").single();
      if (error) throw error;
      logAudit({ action: "DRIVER_PROFILE_REGISTERED", entityType: "DRIVER", entityId: String(driver.id), details: { truck_plate, carrier_name }, ip: req.ip, facility_id: 1 });
      res.json({ success: true, driver });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/driver/logout", (req: any, res) => {
    delete req.session.driver_id;
    delete req.session.driver_phone;
    res.json({ success: true });
  });

  app.get("/api/driver/appointments", async (req: any, res) => {
    if (!req.session?.driver_id) return res.status(401).json({ error: "Driver session required" });
    try {
      const { data: appts } = await db.from("appointments").select("*, spots(name)").eq("driver_id", req.session.driver_id).order("start_time", { ascending: false }).limit(20);
      const { data: walkins } = await db.from("walkin_registrations").select("*").eq("phone", req.session.driver_phone).order("created_at", { ascending: false }).limit(20);
      res.json({ appointments: (appts || []).map((a: any) => ({ ...a, dock_name: a.spots?.name })), walkins: walkins || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // API v1: Platform Integration
  const WEBHOOK_EVENT_TYPES = ["APPOINTMENT_CREATED", "APPOINTMENT_CANCELLED", "EXCEPTION_CREATED", "EXCEPTION_RESOLVED", "TRAILER_MOVED", "TRUCK_DEPARTED"];

  app.get("/api/admin/webhooks", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data } = await db.from("webhook_subscriptions").select("id, url, events, active, created_at, last_triggered_at").eq("facility_id", req.facilityId).order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/webhooks", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { url, events } = req.body;
    const userId = req.session?.user?.id || null;
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "A valid http(s) URL is required" });
    const selectedEvents = (Array.isArray(events) ? events : []).filter((e: string) => WEBHOOK_EVENT_TYPES.includes(e));
    if (selectedEvents.length === 0) return res.status(400).json({ error: "Select at least one event" });
    try {
      const secret = crypto.randomBytes(32).toString("hex");
      const { data, error } = await db.from("webhook_subscriptions").insert({
        facility_id: req.facilityId, url, events: selectedEvents, secret, created_by: userId,
      }).select("id, url, events, active, created_at").single();
      if (error) throw error;
      logAudit({ action: "WEBHOOK_SUBSCRIPTION_CREATED", entityType: "WEBHOOK", entityId: String(data.id), details: { url, events: selectedEvents }, ip: req.ip, facility_id: req.facilityId });
      // Secret is only ever shown once, at creation — same pattern as API keys.
      res.json({ ...data, secret });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/webhooks/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { active } = req.body;
    if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false" });
    try {
      const { data, error } = await db.from("webhook_subscriptions").update({ active }).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/webhooks/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      await db.from("webhook_subscriptions").delete().eq("id", req.params.id).eq("facility_id", req.facilityId);
      logAudit({ action: "WEBHOOK_SUBSCRIPTION_DELETED", entityType: "WEBHOOK", entityId: req.params.id, ip: req.ip, facility_id: req.facilityId });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Management endpoints for api_keys — same gap as carriers earlier this
  // session: apiKeyAuth (verification) existed, but nothing anywhere could
  // ever create a row for it to verify. The whole /api/v1 external
  // integration surface was unusable. SHA-256 is the right hash here
  // (unlike passwords/OTP/TOTP secrets) because the raw key itself is
  // 256 bits of crypto.randomBytes, not a human-guessable secret — the
  // hash's job is just to avoid storing the live credential in plaintext,
  // not to resist brute force against low-entropy input.
  app.get("/api/admin/api-keys", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data } = await db.from("api_keys").select("id, name, key_prefix, tier, last_used_at, revoked_at, created_at").eq("facility_id", req.facilityId).order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/api-keys", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { name, tier } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    try {
      const rawKey = `sky_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);
      const { data, error } = await db.from("api_keys").insert({
        facility_id: req.facilityId, name, key_hash: keyHash, key_prefix: keyPrefix, tier: tier || "standard",
      }).select("id, name, key_prefix, tier, created_at").single();
      if (error) throw error;
      logAudit({ action: "API_KEY_CREATED", entityType: "API_KEY", entityId: String(data.id), details: { name, tier }, ip: req.ip, facility_id: req.facilityId });
      // Full key returned exactly once — only the hash is ever stored, so
      // this is the only moment it can be shown. Standard API-key UX.
      res.json({ ...data, key: rawKey });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/api-keys/:id/revoke", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      await db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", req.params.id).eq("facility_id", req.facilityId);
      logAudit({ action: "API_KEY_REVOKED", entityType: "API_KEY", entityId: req.params.id, details: {}, ip: req.ip, facility_id: req.facilityId, severity: "warning" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const apiKeyAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ success: false, error: "Bearer token required" });
    const rawKey = authHeader.split(" ")[1];
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const { data: keyRecord } = await db.from("api_keys").select("*").eq("key_hash", hash).is("revoked_at", null).maybeSingle();
    if (!keyRecord) return res.status(401).json({ success: false, error: "Invalid API key" });
    req.apiKeyId = keyRecord.id;
    req.facilityId = keyRecord.facility_id;
    req.apiTier = keyRecord.tier;
    db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id).then(() => {});
    next();
  };

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: (req: any) => (req.apiTier === "enterprise" ? 500 : 100),
    message: { success: false, error: "Rate limit exceeded. Protocol saturated." },
  });

  const v1 = express.Router();
  v1.use(apiKeyAuth, apiLimiter);

  v1.get("/appointments", async (req: any, res) => {
    const { date, status } = req.query;
    let query = db.from("appointments").select("*").eq("facility_id", req.facilityId);
    if (date) query = query.gte("start_time", `${date}T00:00:00`).lte("start_time", `${date}T23:59:59`);
    if (status) query = query.eq("status", status);
    const { data } = await query;
    res.json(data || []);
  });

  v1.get("/yard-status", async (req: any, res) => {
    const status = await getYardStatus(req.facilityId);
    res.json(status);
  });

  app.use("/api/v1", v1);

  // Webhook Delivery Worker
  cron.schedule("*/2 * * * *", async () => {
    const { data: jobs } = await db.from("webhook_queue").select("*").eq("status", "pending").lt("attempts", 3).lte("next_attempt_at", new Date().toISOString()).limit(5);
    for (const job of jobs || []) {
      try {
        const payload = JSON.stringify(job.payload_json);
        const sig = crypto.createHmac("sha256", job.webhook_secret || "").update(payload).digest("hex");
        const resp = await fetch(job.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-SkyYard-Signature": sig, "X-SkyYard-Event": job.event_type },
          body: payload,
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          await db.from("webhook_queue").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", job.id);
        } else {
          throw new Error(`HTTP ${resp.status}`);
        }
      } catch (e: any) {
        const nextAttempt = new Date(Date.now() + [60, 300, 900][job.attempts] * 1000).toISOString();
        await db.from("webhook_queue").update({ attempts: job.attempts + 1, next_attempt_at: nextAttempt, error: e.message }).eq("id", job.id);
      }
    }
  });

  // Carrier Auth & Portal
  app.post("/api/carrier/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    try {
      const { data: carrier } = await db.from("carriers").select("*").eq("email", email).maybeSingle();
      if (!carrier || !(await bcrypt.compare(password, carrier.password_hash))) {
        logAudit({ action: "CARRIER_LOGIN_FAILED", entityType: "CARRIER", entityId: email, details: {}, ip: req.ip, facility_id: 1, severity: "warning" });
        return res.status(401).json({ error: "Invalid credentials" });
      }
      (req as any).session.carrier_id = carrier.id;
      (req as any).session.carrier_name = carrier.name;
      res.json({ success: true, redirect: "/carrier/dashboard" });
    } catch (e) {
      res.status(500).json({ error: "Portal failure" });
    }
  });

  app.get("/api/carrier/me", requireCarrierAuth, async (req: any, res) => {
    const { data: carrier } = await db.from("carriers").select("id, name, email, contact_phone, flagged").eq("id", req.session.carrier_id).maybeSingle();
    res.json({ carrier });
  });

  app.post("/api/carrier/logout", (req: any, res) => {
    delete req.session.carrier_id;
    delete req.session.carrier_name;
    res.json({ success: true });
  });

  // Carrier dashboard only ever showed a live count of active trucks and
  // today's appointments — nothing about how the carrier actually performs
  // against their own scheduled slots, despite every field needed for real
  // KPIs (start_time, checked_in_at, grace_period_minutes, no_show_flag)
  // already existing on every appointment row. Computed over the trailing
  // 90 days, using the same isNoShow/isOnTimeArrival logic the SLA/no-show
  // cron workers already use, so the numbers agree with what staff see.
  app.get("/api/carrier/dashboard", requireCarrierAuth, async (req, res) => {
    const carrierId = (req as any).session.carrier_id;
    const { data: carrier } = await db.from("carriers").select("name").eq("id", carrierId).maybeSingle();
    const { count: activeTrucks } = await db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("carrier_name", carrier?.name || "__none__").not("status", "in", "(completed,cancelled)");
    const today = new Date().toISOString().split("T")[0];
    const { count: todayAppts } = await db.from("appointments").select("*", { count: "exact", head: true }).eq("carrier_id", carrierId).gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`);

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const { data: pastAppts } = await db.from("appointments")
      .select("start_time, checked_in_at, grace_period_minutes, no_show_flag, status")
      .eq("carrier_id", carrierId).lt("start_time", now).gte("start_time", ninetyDaysAgo).neq("status", "CANCELLED");

    const total = (pastAppts || []).length;
    const noShowCount = (pastAppts || []).filter((a: any) => a.no_show_flag).length;
    const checkedIn = (pastAppts || []).filter((a: any) => a.checked_in_at);
    const onTimeCount = checkedIn.filter((a: any) => isOnTimeArrival(a.start_time, a.checked_in_at, a.grace_period_minutes)).length;

    const kpis = {
      periodDays: 90, totalAppointments: total,
      noShowRate: total > 0 ? Math.round((noShowCount / total) * 1000) / 10 : 0,
      onTimeRate: checkedIn.length > 0 ? Math.round((onTimeCount / checkedIn.length) * 1000) / 10 : null,
      complianceRate: total > 0 ? Math.round((checkedIn.length / total) * 1000) / 10 : 0,
    };

    res.json({ activeTrucks: activeTrucks || 0, todayAppts: todayAppts || 0, kpis });
  });

  app.get("/api/carrier/appointments", requireCarrierAuth, async (req: any, res) => {
    try {
      const { data: appts } = await db.from("appointments").select("*, spots(name)").eq("carrier_id", req.session.carrier_id).order("start_time", { ascending: false }).limit(50);
      res.json((appts || []).map((a: any) => ({ ...a, dock_name: a.spots?.name })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Detention dispute workflow — carriers previously had no way to even
  // see their own detention charges, let alone dispute one. The most-cited
  // market complaint about detention billing is charges "that could not be
  // validated" with no dispute mechanism; the audit trail to fix that
  // already existed here (threshold/actual/overtime minutes, rate, real
  // timestamps) — it just wasn't surfaced or actionable.
  app.get("/api/carrier/detention", requireCarrierAuth, async (req: any, res) => {
    try {
      const { data } = await db.from("detention_records").select("*").eq("carrier_id", req.session.carrier_id).order("created_at", { ascending: false }).limit(50);
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carrier/detention/:id/dispute", requireCarrierAuth, async (req: any, res) => {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "A reason is required to dispute a charge" });
    try {
      const { data: record } = await db.from("detention_records").select("id, dispute_status").eq("id", req.params.id).eq("carrier_id", req.session.carrier_id).maybeSingle();
      if (!record) return res.status(404).json({ error: "Detention record not found" });
      if (record.dispute_status !== "none") return res.status(409).json({ error: `Already ${record.dispute_status}` });
      const { data, error } = await db.from("detention_records").update({ dispute_status: "disputed", dispute_reason: reason.trim().slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
      if (error) throw error;
      logAudit({ action: "DETENTION_DISPUTED", entityType: "DETENTION_RECORD", entityId: req.params.id, details: { reason: reason.trim() }, ip: req.ip, facility_id: data.facility_id });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/detention/disputes", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data } = await db.from("detention_records").select("*").eq("facility_id", req.facilityId).eq("dispute_status", "disputed").order("updated_at", { ascending: true });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/detention/:id/resolve", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { resolution, notes } = req.body;
    if (!["upheld", "waived"].includes(resolution)) return res.status(400).json({ error: "Resolution must be upheld or waived" });
    try {
      const { data: record } = await db.from("detention_records").select("*").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!record) return res.status(404).json({ error: "Detention record not found" });
      if (record.dispute_status !== "disputed") return res.status(409).json({ error: "Not currently disputed" });
      const patch: any = { dispute_status: resolution, dispute_resolution_notes: notes || null, updated_at: new Date().toISOString() };
      if (resolution === "waived") patch.amount_owed = 0;
      const { data, error } = await db.from("detention_records").update(patch).eq("id", req.params.id).select().single();
      if (error) throw error;
      logAudit({ action: "DETENTION_DISPUTE_RESOLVED", entityType: "DETENTION_RECORD", entityId: req.params.id, details: { resolution, notes }, ip: req.ip, facility_id: req.facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Detention & Maintenance Check
  // Was inserting a brand-new detention_records row every 15 minutes for the
  // same overdue trailer forever (same duplicate-insert class of bug fixed
  // earlier this session for notifications and escalations), never set
  // carrier_id (so POST /api/admin/invoices/generate's .eq("carrier_id", ...)
  // filter could never match an auto-detected record), and never set
  // invoice_status/amount_owed/overtime_minutes (so even a carrier_id fix
  // wouldn't help — the invoice query also filters on invoice_status=pending,
  // and the PDF renders amount_owed/overtime_minutes directly). Net effect:
  // automated detention billing has never actually produced an invoiceable
  // record. Now: one row per trailer while detention is active, updated in
  // place each cycle instead of duplicated, carrier looked up by name match,
  // amounts computed from the facility's configured rate (was hardcoded 50).
  cron.schedule("*/15 * * * *", async () => {
    const { data: facilities } = await db.from("facility_settings").select("facility_id, detention_threshold_hours, detention_rate_per_hour");
    for (const f of facilities || []) {
      const threshold = f.detention_threshold_hours || 24;
      const rate = f.detention_rate_per_hour || 50;
      const cutoff = new Date(Date.now() - threshold * 3600 * 1000).toISOString();
      const { data: overdue } = await db.from("trailers").select("*").eq("facility_id", f.facility_id).eq("status", "IN_YARD").lt("checked_in_at", cutoff);
      for (const t of overdue || []) {
        const actualMinutes = Math.floor((Date.now() - new Date(t.checked_in_at).getTime()) / 60000);
        const thresholdMinutes = threshold * 60;
        const overtimeMinutes = actualMinutes - thresholdMinutes;
        const amountOwed = Math.round((overtimeMinutes / 60) * rate * 100) / 100;

        const { data: existing } = await db.from("detention_records").select("id").eq("trailer_id", t.id).eq("status", "ACTIVE").maybeSingle();
        if (existing) {
          await db.from("detention_records").update({ actual_minutes: actualMinutes, overtime_minutes: overtimeMinutes, amount_owed: amountOwed, updated_at: new Date().toISOString() }).eq("id", existing.id);
          continue;
        }

        const { data: carrierMatch } = await db.from("carriers").select("id").eq("name", t.carrier).maybeSingle();
        await db.from("detention_records").insert({
          facility_id: f.facility_id, trailer_id: t.id, carrier_id: carrierMatch?.id || null, carrier_name: t.carrier,
          start_time: t.checked_in_at, threshold_minutes: thresholdMinutes, actual_minutes: actualMinutes,
          overtime_minutes: overtimeMinutes, rate_per_hour: rate, amount_owed: amountOwed,
          status: "ACTIVE", invoice_status: "pending",
        });
        notify({ type: "DETENTION_WARNING", recipientType: "CARRIER", recipientId: null, data: { title: "Detention Alert", body: `Trailer ${t.plate} has exceeded free dwell time. Detention charges applying.`, plate: t.plate } });
        // A trailer that just went into detention is the one dispatch most
        // needs to move next — bump any open move order for it so it
        // doesn't sit behind routine repositions in the FIFO-by-priority
        // queue (see Phase UU).
        await db.from("move_orders").update({ priority: "urgent" }).eq("trailer_id", t.id).neq("status", "COMPLETED").neq("priority", "urgent");
      }
    }
  });

  // Dock SLA — detention (above) only fires off total time since check-in,
  // so a trailer that sat PARKED for 20 hours then got stuck LOADING for 3
  // more never trips it separately. This watches time-in-stage instead, so
  // a stuck dock operation gets flagged even while the trailer is still
  // within its overall detention-free window.
  cron.schedule("*/5 * * * *", async () => {
    const { data: facilities } = await db.from("facility_settings").select("facility_id, dock_sla_minutes");
    for (const f of facilities || []) {
      const slaMinutes = f.dock_sla_minutes || 60;
      const { data: stuck } = await db.from("gate_passes").select("id, plate, stage, updated_at, trailer_id").eq("facility_id", f.facility_id).in("stage", ["LOADING", "UNLOADING"]);
      for (const p of stuck || []) {
        if (!isDockSlaBreached(p.stage, p.updated_at, slaMinutes)) continue;
        const { data: existing } = await db.from("exceptions").select("id").eq("entity_type", "GATE_PASS").eq("entity_id", String(p.id)).eq("exception_type", "dock_sla_breach").eq("status", "open").maybeSingle();
        if (existing) continue;
        raiseException({
          facility_id: f.facility_id, exception_type: "dock_sla_breach", severity: "warning",
          entity_type: "GATE_PASS", entity_id: String(p.id),
          title: `${p.plate} stuck ${p.stage.toLowerCase()} past SLA`,
          description: `Over ${slaMinutes} minutes in ${p.stage} — dock may be blocked or the load needs attention.`,
          source: "dock_sla_check",
        });
        if (p.trailer_id) await db.from("move_orders").update({ priority: "urgent" }).eq("trailer_id", p.trailer_id).neq("status", "COMPLETED").neq("priority", "urgent");
      }
    }
  });

  // Duration-aware availability — previously matched appointments by exact
  // start_time equality, so a 90-minute reefer load booked at 08:00 still
  // showed the dock as "available" at 09:00 even though the truck was still
  // there. Now estimates how long the requested load actually occupies the
  // dock (see appointmentDuration.ts) and checks real interval overlap
  // against every appointment that day, using each one's own estimated
  // duration too (end_time if a real one was recorded, otherwise its own
  // load-type estimate).
  app.get("/api/slots", async (req: any, res) => {
    const { date, load_type, load_weight_kg } = req.query;
    const facilityId = req.facilityId;
    // estimateDurationMinutes has always taken an optional weight argument
    // (heavier loads take longer to secure) but no caller ever passed one —
    // there was nowhere upstream to capture a weight, so the heavy-load
    // adjustment was tested but dead code. load_weight_kg is threaded
    // through from here down to both the requested slot's own estimate and
    // each existing appointment's fallback estimate, so overlap math and
    // the estimatedMinutes preview both reflect real load weight when known.
    const requestedWeight = load_weight_kg ? Number(load_weight_kg) : undefined;
    const requestedMinutes = estimateDurationMinutes(load_type as string, requestedWeight);
    const { data: docks } = await db.from("spots").select("id, name").eq("type", "DOCK").eq("facility_id", facilityId);
    const { data: dayAppointments } = await db
      .from("appointments")
      .select("dock_id, start_time, end_time, load_type, load_weight_kg")
      .eq("facility_id", facilityId)
      .neq("status", "CANCELLED")
      .gte("start_time", `${date}T00:00:00`)
      .lte("start_time", `${date}T23:59:59`);

    const times = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
    const slots = times.map((time) => {
      // Date-time strings without an offset are parsed as *local* time by
      // JS Date (unlike date-only strings, which default to UTC) — the
      // appointment timestamps coming back from Postgres are always UTC, so
      // without an explicit Z here the overlap math below would be skewed
      // by the server process's local timezone.
      const startTime = `${date}T${time}:00Z`;
      const endTime = estimateEndTime(startTime, load_type as string, requestedWeight);
      const occupiedIds = new Set(
        (dayAppointments || [])
          .filter((a: any) => intervalsOverlap(startTime, endTime, a.start_time, a.end_time || estimateEndTime(a.start_time, a.load_type, a.load_weight_kg)))
          .map((a: any) => a.dock_id)
      );
      const availableDocks = (docks || []).filter((d: any) => !occupiedIds.has(d.id));
      return { time, dateTime: startTime, estimatedMinutes: requestedMinutes, availableCount: availableDocks.length, docks: availableDocks };
    });

    res.json(slots);
  });

  // AI-scored dock recommendation — was previously scoring two hardcoded
  // fake slots (dock_id 1/2, never the real docks) and wasn't called from
  // anywhere in the frontend. Now scores every real dock x time-of-day
  // combination for the requested date, same source data as /api/slots.
  app.get("/api/slots/recommend", async (req: any, res) => {
    const { date, equipment_type, carrier_id, load_weight_kg } = req.query;
    const facilityId = req.facilityId;
    const requestedWeight = load_weight_kg ? Number(load_weight_kg) : undefined;
    const times = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
    const { data: docks } = await db.from("spots").select("id, name").eq("type", "DOCK").eq("facility_id", facilityId);
    const { data: dayAppointments } = await db
      .from("appointments")
      .select("dock_id, start_time, end_time, load_type, load_weight_kg")
      .eq("facility_id", facilityId)
      .neq("status", "CANCELLED")
      .gte("start_time", `${date}T00:00:00`)
      .lte("start_time", `${date}T23:59:59`);

    const availableSlots: { dock_id: number; dock_name: string; start_time: string }[] = [];
    for (const time of times) {
      // Date-time strings without an offset are parsed as *local* time by
      // JS Date (unlike date-only strings, which default to UTC) — the
      // appointment timestamps coming back from Postgres are always UTC, so
      // without an explicit Z here the overlap math below would be skewed
      // by the server process's local timezone.
      const startTime = `${date}T${time}:00Z`;
      const endTime = estimateEndTime(startTime, equipment_type as string, requestedWeight);
      const occupiedIds = new Set(
        (dayAppointments || [])
          .filter((a: any) => intervalsOverlap(startTime, endTime, a.start_time, a.end_time || estimateEndTime(a.start_time, a.load_type, a.load_weight_kg)))
          .map((a: any) => a.dock_id)
      );
      for (const dock of docks || []) {
        if (!occupiedIds.has(dock.id)) availableSlots.push({ dock_id: dock.id, dock_name: dock.name, start_time: time });
      }
    }

    const scored = await Promise.all(availableSlots.map(s => scoreSlot({ ...s, date }, {
      equipmentType: equipment_type as string, carrierId: carrier_id as string, facilityId, date: date as string,
    })));
    const valid = scored.map((s, i) => ({ ...availableSlots[i], ...s })).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    if (valid.length > 0) (valid[0] as any).recommended = true;
    res.json(valid);
  });

  // --- Phase W: Customer entity — the external stakeholder waiting on a
  // shipment, distinct from the carrier moving it. Same token-in-URL
  // pattern as carrier booking links (no password portal, generated at
  // creation instead of a separate step — one endpoint, not two).
  app.get("/api/admin/customers", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data } = await db.from("customers").select("*").eq("facility_id", req.facilityId).order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/customers", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { name, email, contact_phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    try {
      const { data, error } = await db.from("customers").insert({ facility_id: req.facilityId, name: name.trim(), email: email || null, contact_phone: contact_phone || null }).select().single();
      if (error) throw error;
      logAudit({ action: "CUSTOMER_ADDED", entityType: "CUSTOMER", entityId: String(data.id), details: { name }, ip: req.ip, facility_id: req.facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public, token-based — same trust model as carrier booking links:
  // the token in the URL is the auth. Read-only, so there's no state to
  // corrupt even if a link leaks.
  app.get("/api/customer/:token/shipments", async (req, res) => {
    try {
      const { data: customer } = await db.from("customers").select("id, name").eq("access_token", req.params.token).maybeSingle();
      if (!customer) return res.status(404).json({ error: "Invalid link" });
      const { data: shipments } = await db.from("appointments").select("id, plate, carrier, start_time, status, load_type, checked_in_at, checked_out_at").eq("customer_id", customer.id).order("start_time", { ascending: false }).limit(50);
      res.json({ customer_name: customer.name, shipments: shipments || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Carrier management: there was previously no way to create a carrier at
  // all — only /api/admin/carriers/:id/booking-link existed, which needs an
  // existing row. With zero carriers in the table, the whole self-service
  // pre-booking feature was a dead end.
  app.get("/api/admin/carriers", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      const { data } = await db.from("carriers").select("id, name, email, contact_phone, booking_token, booking_token_expires, flagged, created_at").order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/carriers", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { name, email, password, contact_phone } = req.body;
    if (!name) return res.status(400).json({ error: "Carrier name is required" });
    try {
      const password_hash = password ? await bcrypt.hash(password, 10) : null;
      const { data, error } = await db.from("carriers").insert({ name, email: email || null, password_hash, contact_phone: contact_phone || null }).select("id, name, email, contact_phone").single();
      if (error) throw error;
      logAudit({ action: "CARRIER_CREATED", entityType: "CARRIER", entityId: String(data.id), details: { name }, ip: req.ip, facility_id: req.session?.user?.facility_id || 1 });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/carriers/:id/booking-link", requireRole("superadmin", "ADMIN"), async (req, res) => {
    const { id } = req.params;
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.from("carriers").update({ booking_token: token, booking_token_expires: expiresAt }).eq("id", id);
    res.json({ booking_url: `/book/${token}` });
  });

  // Flagging (auto, on 3+ no-shows in 30 days) had no way back — a carrier
  // that improved its record stayed locked out of self-service booking
  // forever with no admin action to reverse it.
  app.post("/api/admin/carriers/:id/unflag", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { id } = req.params;
    try {
      const { data, error } = await db.from("carriers").update({ flagged: false }).eq("id", id).select("id, name").single();
      if (error) throw error;
      logAudit({ action: "CARRIER_UNFLAGGED", entityType: "CARRIER", entityId: String(id), details: { name: data.name }, ip: req.ip, facility_id: req.facilityId });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Phase L: Equipment & Maintenance — yard tractors, forklifts, dock/
  // gate equipment. New system, not a rename of anything: `vehicles` below
  // is carrier-owned rolling stock (trailers/trucks); this is the
  // facility's own operating equipment.
  const EQUIPMENT_TYPES = ["yard_tractor", "forklift", "dock_equipment", "gate_equipment", "other"];
  const EQUIPMENT_STATUSES = ["available", "in_use", "maintenance", "broken"];

  app.get("/api/admin/equipment", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    try {
      const { data } = await db.from("equipment").select("*").eq("facility_id", req.facilityId).order("name", { ascending: true });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/equipment", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { name, type } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    if (!EQUIPMENT_TYPES.includes(type)) return res.status(400).json({ error: "Invalid type" });
    try {
      const { data, error } = await db.from("equipment").insert({ facility_id: req.facilityId, name: name.trim(), type }).select().single();
      if (error) throw error;
      logAudit({ action: "EQUIPMENT_ADDED", entityType: "EQUIPMENT", entityId: String(data.id), details: { name, type }, ip: req.ip, facility_id: req.facilityId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/equipment/:id", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status, notes } = req.body;
    if (status !== undefined && !EQUIPMENT_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    try {
      const patch: any = { updated_at: new Date().toISOString() };
      if (status !== undefined) patch.status = status;
      if (notes !== undefined) patch.notes = typeof notes === "string" ? notes.slice(0, 500) : null;
      const { data, error } = await db.from("equipment").update(patch).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      logAudit({ action: "EQUIPMENT_STATUS_CHANGED", entityType: "EQUIPMENT", entityId: req.params.id, details: { status }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("yard_update", { type: "EQUIPMENT" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/equipment/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      await db.from("equipment").delete().eq("id", req.params.id).eq("facility_id", req.facilityId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Fleet registry: registered vehicles per carrier (Phase D) ---
  // Distinct from `trailers`, which is a per-visit occupancy record created
  // fresh at every gate checkin/walk-in. This is the persistent asset —
  // capacity, equipment type, inspection status — that visit-time checks
  // (load capacity validation, expired-inspection denial) will reference
  // against in later phases.
  app.get("/api/admin/vehicles", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      const { data } = await db.from("vehicles").select("*, carriers(name)").order("created_at", { ascending: false });
      res.json((data || []).map((v: any) => ({ ...v, carrier_name: v.carriers?.name })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/vehicles", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { carrier_id, plate, equipment_type, max_weight_kg, max_volume_m3, registration_country, inspection_expiry } = req.body;
    if (!plate) return res.status(400).json({ error: "Plate is required" });
    try {
      const { data, error } = await db.from("vehicles").insert({
        carrier_id: carrier_id || null, plate: String(plate).toUpperCase(), equipment_type: equipment_type || "standard",
        max_weight_kg: max_weight_kg || null, max_volume_m3: max_volume_m3 || null,
        registration_country: registration_country || "SE", inspection_expiry: inspection_expiry || null,
      }).select("*, carriers(name)").single();
      if (error) throw error;
      logAudit({ action: "VEHICLE_REGISTERED", entityType: "VEHICLE", entityId: String(data.id), details: { plate }, ip: req.ip, facility_id: req.facilityId || 1 });
      res.json({ ...data, carrier_name: data.carriers?.name });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/vehicles/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { id } = req.params;
    const allowedFields = ["carrier_id", "plate", "equipment_type", "max_weight_kg", "max_volume_m3", "registration_country", "inspection_expiry", "active"];
    const patch: any = {};
    for (const field of allowedFields) if (req.body[field] !== undefined) patch[field] = req.body[field];
    if (patch.plate) patch.plate = String(patch.plate).toUpperCase();
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });
    // Clear the expiry-notified flag whenever the expiry date itself changes
    // (e.g. after a renewal) so the new date gets its own notification cycle
    // instead of staying permanently suppressed by the old one.
    if (patch.inspection_expiry !== undefined) patch.expiry_notified_at = null;
    try {
      const { data, error } = await db.from("vehicles").update(patch).eq("id", id).select("*, carriers(name)").single();
      if (error) throw error;
      res.json({ ...data, carrier_name: data.carriers?.name });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/vehicles/:id", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      await db.from("vehicles").delete().eq("id", req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Phase G: read-only fleet health rollup — per-carrier counts, inspection
  // status, and recent capacity-warning frequency (from the audit trail
  // Phase E already writes to). Nothing here mutates state.
  app.get("/api/admin/fleet/summary", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      const { data: vehicles } = await db.from("vehicles").select("*, carriers(name)");
      const all = vehicles || [];
      const now = new Date();
      const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const byCarrierMap = new Map<string, number>();
      for (const v of all) {
        const name = (v as any).carriers?.name || "Unassigned";
        byCarrierMap.set(name, (byCarrierMap.get(name) || 0) + 1);
      }

      const expired = all.filter((v: any) => v.inspection_expiry && new Date(v.inspection_expiry) < now)
        .map((v: any) => ({ plate: v.plate, carrier_name: v.carriers?.name || "Unassigned", inspection_expiry: v.inspection_expiry }));
      const expiringSoon = all.filter((v: any) => v.inspection_expiry && new Date(v.inspection_expiry) >= now && new Date(v.inspection_expiry) <= soon)
        .map((v: any) => ({
          plate: v.plate, carrier_name: v.carriers?.name || "Unassigned", inspection_expiry: v.inspection_expiry,
          daysLeft: Math.ceil((new Date(v.inspection_expiry).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        }));

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: warnings } = await db.from("audit_logs").select("entityId, details, timestamp").eq("action", "LOAD_CAPACITY_WARNING").gte("timestamp", thirtyDaysAgo).order("timestamp", { ascending: false }).limit(10);

      res.json({
        totalVehicles: all.length,
        activeVehicles: all.filter((v: any) => v.active).length,
        byCarrier: Array.from(byCarrierMap, ([carrier_name, count]) => ({ carrier_name, count })).sort((a, b) => b.count - a.count),
        expired,
        expiringSoon,
        recentCapacityWarnings: warnings || [],
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/book/:token", async (req: any, res) => {
    const { token } = req.params;
    const { data: carrier } = await db.from("carriers").select("id, name, email, contact_phone").eq("booking_token", token).gt("booking_token_expires", new Date().toISOString()).maybeSingle();
    if (!carrier) return res.status(404).json({ error: "Invalid or expired booking link" });
    res.json({ carrier, facilityId: 1 });
  });

  app.post("/api/book/:token", bookingLimiter, async (req: any, res) => {
    const { token } = req.params;
    const { plate, driver_name, driver_phone, start_time, dock_id, load_type, temperature_requirement, load_weight_kg, special_instructions } = req.body;
    try {
      const { data: carrier } = await db.from("carriers").select("*").eq("booking_token", token).gt("booking_token_expires", new Date().toISOString()).maybeSingle();
      if (!carrier) return res.status(404).json({ error: "Invalid or expired booking link" });
      if (!plate || !start_time) return res.status(400).json({ error: "Plate and arrival time are required" });

      // The no-show worker has flagged carriers as "bookings now require
      // approval" for 30+ real days (3+ no-shows in 30 days) but nothing
      // ever actually enforced it — self-service booking stayed wide open
      // regardless. Block here with a clear message rather than silently
      // auto-creating a "pending approval" appointment with no admin UI to
      // ever approve it.
      if (carrier.flagged) {
        return res.status(403).json({ error: "CARRIER_FLAGGED", reason: "This account has excessive no-shows and self-service booking is paused. Contact the terminal directly to schedule." });
      }

      const blacklistHit = await checkBlacklist(1, plate, carrier.name);
      if (blacklistHit && blacklistHit.severity === "block") {
        logAudit({ action: "BLACKLIST_BLOCKED_BOOKING", entityType: "TRAILER", entityId: plate, details: { reason: blacklistHit.reason, carrier: carrier.name }, ip: req.ip, facility_id: 1, severity: "warning" });
        raiseException({ facility_id: 1, exception_type: "blacklist_block", severity: "warning", entity_type: "TRAILER", entity_id: plate, title: `Blacklisted entry blocked: ${plate}`, description: blacklistHit.reason, source: "carrier_booking" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason });
      }

      const weightKg = load_weight_kg != null && load_weight_kg !== "" && !isNaN(Number(load_weight_kg)) ? Number(load_weight_kg) : null;
      const bookedEndTime = estimateEndTime(start_time, load_type, weightKg);
      const capacity = await enforceAppointmentCapacity(1, start_time, bookedEndTime);
      if (!capacity.allowed) return res.status(409).json({ error: "CAPACITY_BLOCKED", reason: capacity.reason });

      let driverId: number | null = null;
      if (driver_phone) {
        await db.from("drivers").upsert({ phone: driver_phone, name: driver_name || null }, { onConflict: "phone", ignoreDuplicates: true });
        const { data: drv } = await db.from("drivers").select("id").eq("phone", driver_phone).maybeSingle();
        driverId = drv?.id || null;
      }

      // Capped — this is a public, unauthenticated field on a rate-limited
      // but still open endpoint; no reason to accept unbounded text.
      const instructions = typeof special_instructions === "string" && special_instructions.trim() ? special_instructions.trim().slice(0, 500) : null;

      const { data: newAppt, error } = await db.from("appointments").insert({
        plate, carrier: carrier.name, dock_id: dock_id || null, start_time, load_type: load_type || "standard",
        end_time: bookedEndTime, load_weight_kg: weightKg, special_instructions: instructions,
        temperature_requirement: load_type === "reefer" ? (temperature_requirement || null) : null,
        status: "SCHEDULED", source: "self_book", driver_id: driverId, carrier_id: carrier.id, facility_id: 1,
      }).select().single();
      if (error) throw error;

      logAudit({ action: "SELF_BOOKED", entityType: "APPOINTMENT", entityId: String(newAppt.id), details: { plate, carrier: carrier.name }, ip: req.ip, facility_id: 1 });
      emitUpdate("appointment_created", newAppt);
      enqueueWebhook("APPOINTMENT_CREATED", newAppt, 1);

      if (driver_phone) await sendSms(driver_phone, `SkyYard: Booking confirmed for ${plate} on ${start_time}. Reference: APT-${newAppt.id}.`);

      res.json({ success: true, appointment: newAppt });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk Import
  app.post("/api/admin/bulk-import", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { data } = req.body;
    const facilityId = req.facilityId;
    try {
      const rows = (data || []).map((row: any) => ({ plate: row.plate, carrier: row.carrier, start_time: `${row.date}T${row.time}`, facility_id: facilityId, source: "bulk_import" }));
      const { error } = await db.from("appointments").insert(rows);
      if (error) throw error;
      res.json({ success: true, count: rows.length });
    } catch (e) {
      res.status(500).json({ error: "Bulk import failed" });
    }
  });

  app.get("/api/superadmin/blacklist", requireRole("superadmin", "ADMIN"), async (req, res) => {
    const { data } = await db.from("blacklist").select("*").order("created_at", { ascending: false });
    res.json(data || []);
  });

  app.post("/api/superadmin/blacklist", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { entity_type, entity_value, reason, severity, expires_at } = req.body;
    const facilityId = req.session?.facility_id || req.facilityId || 1;
    if (!entity_type || !entity_value || !reason) return res.status(400).json({ error: "entity_type, entity_value and reason are required" });
    try {
      const { data, error } = await db.from("blacklist").insert({ facility_id: facilityId, entity_type, entity_value, reason, severity: severity || "warning", expires_at: expires_at || null }).select().single();
      if (error) throw error;
      logAudit({ action: "BLACKLIST_ADD", entityType: "BLACKLIST", entityId: data.id, details: { entity_type, entity_value, reason }, ip: req.ip, facility_id: facilityId });
      res.json({ success: true, id: data.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/superadmin/blacklist/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      await db.from("blacklist").delete().eq("id", req.params.id);
      logAudit({ action: "BLACKLIST_REMOVE", entityType: "BLACKLIST", entityId: req.params.id, ip: req.ip });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/superadmin/facilities", requireRole("superadmin"), async (req, res) => {
    const { data: facilities } = await db.from("facilities").select("*");
    const enriched = await Promise.all((facilities || []).map(async (f: any) => {
      const { count: active_trucks } = await db.from("trailers").select("*", { count: "exact", head: true }).eq("facility_id", f.id).neq("status", "DISPATCHED");
      const today = new Date().toISOString().split("T")[0];
      const { count: todays_appts } = await db.from("appointments").select("*", { count: "exact", head: true }).eq("facility_id", f.id).gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`);
      return { ...f, active_trucks: active_trucks || 0, todays_appts: todays_appts || 0 };
    }));
    res.json(enriched);
  });

  // Network overview for NetworkDashboard.tsx — this used to query Supabase
  // directly from the browser with the anon key. It couldn't have worked:
  // every table has RLS enabled with zero policies (anon/authenticated get
  // nothing by design, see README), and it called a get_facility_health()
  // RPC that doesn't exist in this database. Moved server-side onto the
  // same service_role-authorized pattern every other route already uses.
  app.get("/api/superadmin/network", requireRole("superadmin"), async (req, res) => {
    try {
      const { data: facilities } = await db.from("facilities").select("*");
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const enriched = await Promise.all((facilities || []).map(async (f: any) => {
        const [spotsRes, alertsRes] = await Promise.all([
          db.from("spots").select("status").eq("facility_id", f.id),
          db.from("audit_logs").select("id", { count: "exact", head: true }).eq("facility_id", f.id).in("severity", ["warning", "critical"]).gte("timestamp", since),
        ]);
        const totalSpots = (spotsRes.data || []).length;
        const activeTrucks = (spotsRes.data || []).filter((s: any) => s.status === "OCCUPIED" || s.status === "occupied").length;
        const openAlerts = alertsRes.count || 0;
        // No health-score model exists yet (the RPC this replaced was never
        // deployed) — simple heuristic until a real one is defined: fewer
        // recent warning/critical alerts = healthier.
        const healthScore = Math.max(0, 100 - openAlerts * 15);
        const utilization = totalSpots ? activeTrucks / totalSpots : 0;
        return { ...f, activeTrucks, totalSpots, openAlerts, healthScore, utilization };
      }));
      const totalSpotsAll = enriched.reduce((sum, f: any) => sum + f.totalSpots, 0);
      const totalActiveAll = enriched.reduce((sum, f: any) => sum + f.activeTrucks, 0);
      const globalLoadPct = totalSpotsAll ? Math.round((totalActiveAll / totalSpotsAll) * 100) : 0;
      res.json({ facilities: enriched, globalLoadPct });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/superadmin/facilities/switch", requireRole("superadmin"), (req, res) => {
    const { facilityId } = req.body;
    (req as any).session.facility_id = facilityId;
    res.json({ success: true });
  });

  app.post("/api/admin/trailers/:id/transfer", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { id } = req.params;
    const { destination_facility_id, eta, notes } = req.body;
    const originFacilityId = req.facilityId;
    try {
      const { data: trailer } = await db.from("trailers").select("*").eq("id", id).maybeSingle();
      if (!trailer) return res.status(404).json({ error: "Trailer not found" });

      await db.from("spots").update({ status: "EMPTY" }).eq("id", trailer.spot_id);
      await db.from("trailers").update({ status: "in_transit", facility_id: destination_facility_id, spot_id: null }).eq("id", id);
      await db.from("gate_logs").insert({ facility_id: originFacilityId, event_type: "exit", trailer_id: id, notes: `Transfer to facility ${destination_facility_id}. ${notes || ""}` });
      await db.from("gate_logs").insert({ facility_id: destination_facility_id, event_type: "entry", trailer_id: id, notes: `Expected transfer from facility ${originFacilityId}. ETA: ${eta}` });

      res.json({ success: true, message: "Transfer initiated" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin dock rules
  app.post("/api/admin/dock-rules", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { dockId, eType, isAdding } = req.body;
    try {
      const { data: existing } = await db.from("dock_rules").select("*").eq("dock_door_id", dockId).maybeSingle();
      const current: string[] = existing?.allowed_equipment_types || ["standard"];
      const updated = isAdding ? Array.from(new Set([...current, eType])) : current.filter((t) => t !== eType);
      if (existing) {
        await db.from("dock_rules").update({ allowed_equipment_types: updated }).eq("dock_door_id", dockId);
      } else {
        await db.from("dock_rules").insert({ facility_id: req.facilityId, dock_door_id: dockId, allowed_equipment_types: updated });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ReportBuilder's metric library (m1-m5) rendered a fake pulsing-bar
  // animation captioned "Real-time {chartType} preview simulation" for
  // ANY selection — Generate Preview had no click handler at all, Export
  // CSV had no handler either, and this endpoint ignored the `metric`/
  // `groupBy` it was given and just dumped raw appointment rows. This
  // computes each metric for real over a trailing window.
  const METRIC_LABELS: Record<string, string> = {
    m1: "Average TAT (Truck Turnaround Time)",
    m2: "Dock Utilization %",
    m3: "Detention Revenue",
    m4: "No-Show Rate",
    m5: "Peak Hour Volume",
  };

  app.post("/api/analytics/query", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { metrics, days } = req.body;
    const facilityId = req.facilityId;
    const periodDays = Number(days) > 0 ? Number(days) : 30;
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const wanted: string[] = Array.isArray(metrics) && metrics.length ? metrics : Object.keys(METRIC_LABELS);

    try {
      const results: any[] = [];

      if (wanted.includes("m1")) {
        const { data } = await db.from("gate_passes").select("issued_at, exited_at").eq("facility_id", facilityId).not("exited_at", "is", null).gte("issued_at", cutoff);
        const minutes = (data || []).map((p: any) => (new Date(p.exited_at).getTime() - new Date(p.issued_at).getTime()) / 60000).filter((m) => m >= 0);
        const avg = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0;
        results.push({ id: "m1", label: METRIC_LABELS.m1, value: Math.round(avg), unit: "min", sampleSize: minutes.length });
      }

      if (wanted.includes("m2")) {
        const [{ data: docks }, { data: appts }] = await Promise.all([
          db.from("spots").select("id").eq("facility_id", facilityId).eq("type", "DOCK"),
          db.from("appointments").select("actual_duration_minutes, dock_id").eq("facility_id", facilityId).not("dock_id", "is", null).gte("start_time", cutoff),
        ]);
        const busyMinutes = (appts || []).reduce((s: number, a: any) => s + (a.actual_duration_minutes || 0), 0);
        const capacityMinutes = (docks?.length || 0) * periodDays * 24 * 60;
        const pct = capacityMinutes > 0 ? Math.min(100, (busyMinutes / capacityMinutes) * 100) : 0;
        results.push({ id: "m2", label: METRIC_LABELS.m2, value: Math.round(pct * 10) / 10, unit: "%", sampleSize: appts?.length || 0 });
      }

      if (wanted.includes("m3")) {
        const { data } = await db.from("detention_records").select("amount_owed").eq("facility_id", facilityId).gte("created_at", cutoff);
        const total = (data || []).reduce((s: number, r: any) => s + Number(r.amount_owed || 0), 0);
        results.push({ id: "m3", label: METRIC_LABELS.m3, value: Math.round(total * 100) / 100, unit: "currency", sampleSize: data?.length || 0 });
      }

      if (wanted.includes("m4")) {
        const { data } = await db.from("appointments").select("status").eq("facility_id", facilityId).gte("start_time", cutoff);
        const total = data?.length || 0;
        const noShows = (data || []).filter((a: any) => a.status === "no_show").length;
        results.push({ id: "m4", label: METRIC_LABELS.m4, value: total ? Math.round((noShows / total) * 1000) / 10 : 0, unit: "%", sampleSize: total });
      }

      if (wanted.includes("m5")) {
        const { data } = await db.from("gate_logs").select("timestamp").eq("facility_id", facilityId).eq("event_type", "entry").gte("timestamp", cutoff);
        const byHour = new Array(24).fill(0);
        for (const row of data || []) byHour[new Date(row.timestamp).getHours()]++;
        const peakHour = byHour.indexOf(Math.max(...byHour));
        results.push({ id: "m5", label: METRIC_LABELS.m5, value: byHour[peakHour] || 0, unit: `entries at ${String(peakHour).padStart(2, "0")}:00`, series: byHour.map((count, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: count })), sampleSize: data?.length || 0 });
      }

      res.json({ periodDays, metrics: results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SLA Tracking Worker
  cron.schedule("*/5 * * * *", async () => {
    const { data: active } = await db.from("appointments").select("id, load_type, checked_in_at, facility_id, carrier").eq("status", "CHECKED_IN").is("checked_out_at", null);
    for (const appt of active || []) {
      if (!appt.checked_in_at) continue;
      const { data: sla } = await db.from("facility_sla_rules").select("*").eq("facility_id", appt.facility_id).eq("load_type", appt.load_type).maybeSingle();
      if (!sla) continue;

      const elapsedMin = (Date.now() - new Date(appt.checked_in_at).getTime()) / 60000;
      // Per-facility/load-type thresholds (facility_sla_rules.warning_pct/escalation_pct/
      // critical_pct) previously sat unused — every facility got the same hardcoded
      // 100%/120% cutoffs regardless of what was configured for it, and the warning_pct
      // tier was never checked at all.
      const level = evaluateSla(elapsedMin, sla.threshold_minutes, sla.warning_pct ?? 80, sla.escalation_pct ?? 100, sla.critical_pct ?? 120);

      const checkNotified = async (action: string) => {
        const { count } = await db.from("audit_logs").select("*", { count: "exact", head: true }).eq("entityId", String(appt.id)).eq("action", action).gt("timestamp", appt.checked_in_at);
        return count || 0;
      };

      if (level === "critical" && (await checkNotified("sla_critical")) === 0) {
        await db.from("audit_logs").insert({ facility_id: appt.facility_id, action: "sla_critical", entityType: "appointment", entityId: String(appt.id), details: { elapsed: Math.round(elapsedMin), threshold: sla.threshold_minutes }, severity: "critical" });
        raiseException({ facility_id: appt.facility_id, exception_type: "long_dwell", severity: "critical", entity_type: "APPOINTMENT", entity_id: String(appt.id), title: `SLA critical: ${appt.carrier} (${Math.round(elapsedMin)}min, threshold ${sla.threshold_minutes}min)`, source: "sla_worker" });
        notify({ type: "SLA_CRITICAL", recipientType: "ADMIN", recipientId: null, data: { title: "CRITICAL SLA BREACH", body: `${appt.carrier} has exceeded SLA at facility ${appt.facility_id}` } });
      } else if (level === "breach" && (await checkNotified("sla_breach")) === 0) {
        await db.from("audit_logs").insert({ facility_id: appt.facility_id, action: "sla_breach", entityType: "appointment", entityId: String(appt.id), details: { elapsed: Math.round(elapsedMin), threshold: sla.threshold_minutes }, severity: "warning" });
      } else if (level === "warning" && (await checkNotified("sla_warning")) === 0) {
        await db.from("audit_logs").insert({ facility_id: appt.facility_id, action: "sla_warning", entityType: "appointment", entityId: String(appt.id), details: { elapsed: Math.round(elapsedMin), threshold: sla.threshold_minutes }, severity: "info" });
      }
    }
  });

  // Financial Operations
  app.post("/api/admin/invoices/generate", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { carrierId, periodStart, periodEnd } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: carrier } = await db.from("carriers").select("*").eq("id", carrierId).maybeSingle();
      const { data: facility } = await db.from("facilities").select("*").eq("id", facilityId).maybeSingle();
      const { data: fSettings } = await db.from("facility_settings").select("currency").eq("facility_id", facilityId).maybeSingle();
      const currency = fSettings?.currency || "SEK";

      const { data: detentions } = await db.from("detention_records").select("*, appointments(start_time, plate)").eq("carrier_id", carrierId).eq("facility_id", facilityId)
        .gte("created_at", periodStart).lte("created_at", periodEnd).eq("invoice_status", "pending");

      if (!detentions || detentions.length === 0) return res.status(400).json({ error: "No uninvoiced detention records found" });

      const invoiceNum = `SKY-${(facility?.name || "GEN").substring(0, 3).toUpperCase()}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));

      doc.fontSize(20).font("Helvetica-Bold").text("INVOICE", 50, 50);
      doc.fontSize(10).font("Helvetica").text(`Invoice No: ${invoiceNum}`, 350, 50);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 350, 65);
      doc.text(facility?.name || "", 50, 100);
      doc.text("Bill To:", 300, 100).font("Helvetica-Bold").text(carrier?.name || "", 300, 115).font("Helvetica").text(carrier?.email || "", 300, 130);

      let y = 200;
      doc.font("Helvetica-Bold").text("Date", 50, y).text("Plate", 150, y).text("Mins Over", 300, y).text("Amount", 450, y);
      doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
      y += 25;

      let total = 0;
      doc.font("Helvetica");
      for (const d of detentions as any[]) {
        doc.text(new Date(d.appointments?.start_time || d.created_at).toLocaleDateString(), 50, y);
        doc.text(d.appointments?.plate || "", 150, y);
        doc.text(`${d.overtime_minutes}min`, 300, y);
        doc.text(`${Number(d.amount_owed).toFixed(2)} ${currency}`, 450, y);
        total += Number(d.amount_owed || 0);
        y += 20;
      }

      doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();
      doc.font("Helvetica-Bold").text(`Total: ${total.toFixed(2)} ${currency}`, 450, y + 15);
      doc.end();

      await new Promise((resolve) => doc.on("end", resolve));
      const pdfBuffer = Buffer.concat(chunks);

      await db.from("detention_records").update({ invoice_status: "invoiced", notes: invoiceNum }).in("id", detentions.map((d: any) => d.id));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${invoiceNum}.pdf`);
      res.send(pdfBuffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const PAYMENT_METHODS = ["bank_transfer", "card", "check", "other"];
  app.post("/api/admin/payments", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { carrier_id, amount, payment_method, invoice_numbers, detention_record_ids } = req.body;
    const facilityId = req.facilityId;
    const amountNum = Number(amount);
    if (!carrier_id) return res.status(400).json({ error: "carrier_id is required" });
    if (!Number.isFinite(amountNum) || amountNum <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ error: "Invalid payment_method" });
    try {
      const { data: carrier } = await db.from("carriers").select("id").eq("id", carrier_id).maybeSingle();
      if (!carrier) return res.status(404).json({ error: "Carrier not found" });

      // The amount recorded and what actually gets marked "paid" used to be
      // two unrelated things — nothing checked that the money received
      // covered the detention records being closed out, so a $1 payment
      // could zero out a $5,000 balance. Now the records only clear if the
      // amount at least covers what they owe (a small rounding tolerance
      // for currency math).
      if (detention_record_ids && detention_record_ids.length > 0) {
        const { data: records } = await db.from("detention_records").select("id, amount_owed").in("id", detention_record_ids).eq("facility_id", facilityId).eq("carrier_id", carrier_id);
        const owed = (records || []).reduce((sum, r: any) => sum + Number(r.amount_owed || 0), 0);
        if (amountNum < owed - 0.01) {
          return res.status(400).json({ error: `Payment amount (${amountNum}) is less than the total owed on selected records (${owed})` });
        }
      }

      await db.from("payments").insert({ facility_id: facilityId, carrier_id, amount: amountNum, payment_method, invoice_numbers: invoice_numbers || [] });
      if (invoice_numbers && invoice_numbers.length > 0) {
        await db.from("detention_records").update({ invoice_status: "paid" }).in("notes", invoice_numbers);
      }
      // Recording a payment could previously only clear a balance if it had
      // already been through /api/admin/invoices/generate (matched by
      // invoice number in `notes`) — a payment against a still-pending
      // (never-invoiced) balance silently cleared nothing. Accept direct
      // detention_record ids too so a payment always actually settles what
      // it claims to.
      if (detention_record_ids && detention_record_ids.length > 0) {
        await db.from("detention_records").update({ invoice_status: "paid" }).in("id", detention_record_ids).eq("facility_id", facilityId);
      }
      logAudit({ action: "PAYMENT_RECORDED", entityType: "CARRIER", entityId: String(carrier_id), details: { amount: amountNum, payment_method }, ip: req.ip, facility_id: facilityId });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/carrier-balances", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const facilityId = req.facilityId;
    try {
      const { data: records } = await db.from("detention_records").select("id, carrier_id, amount_owed, invoice_status, created_at, notes").eq("facility_id", facilityId).neq("invoice_status", "paid");
      const byCarrier: Record<number, { balance: number; oldest_invoice: string | null; invoice_numbers: string[]; detention_record_ids: number[] }> = {};
      for (const r of records || []) {
        if (!r.carrier_id) continue;
        if (!byCarrier[r.carrier_id]) byCarrier[r.carrier_id] = { balance: 0, oldest_invoice: null, invoice_numbers: [], detention_record_ids: [] };
        byCarrier[r.carrier_id].balance += Number(r.amount_owed || 0);
        byCarrier[r.carrier_id].detention_record_ids.push(r.id);
        if (r.invoice_status === "invoiced" && (!byCarrier[r.carrier_id].oldest_invoice || r.created_at < byCarrier[r.carrier_id].oldest_invoice!)) {
          byCarrier[r.carrier_id].oldest_invoice = r.created_at;
        }
        // notes holds the invoice number once /api/admin/invoices/generate has
        // run for this record — surfaced here so a payment can reference the
        // exact invoice(s) it's settling instead of staff having to reopen
        // the downloaded PDF to find the number.
        if (r.invoice_status === "invoiced" && r.notes && !byCarrier[r.carrier_id].invoice_numbers.includes(r.notes)) {
          byCarrier[r.carrier_id].invoice_numbers.push(r.notes);
        }
      }
      const ids = Object.keys(byCarrier).map(Number);
      if (ids.length === 0) return res.json([]);
      const { data: carriers } = await db.from("carriers").select("id, name").in("id", ids);
      const balances = (carriers || []).map((c: any) => ({ id: c.id, name: c.name, ...byCarrier[c.id] })).sort((a: any, b: any) => b.balance - a.balance);
      res.json(balances);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GDPR / Data Retention
  cron.schedule("0 3 * * *", async () => {
    logger.info("[Worker] Running Data Retention Enforcement...");
    const retentionDays = 90;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    await db.from("walkin_registrations").update({ driver_name: "[REDACTED]", phone: "[REDACTED]" }).lt("created_at", cutoff).neq("driver_name", "[REDACTED]");
    logAudit({ action: "DATA_RETENTION_ENFORCED", entityType: "system", details: { retentionDays } });
  });

  // Phase F: proactive warning before an inspection expiry becomes a hard
  // badge-scan denial (see /api/gate/badge/:token). Notify once per vehicle
  // via expiry_notified_at — same dedup lesson as the walk-in escalation
  // cron earlier this session (set-before-notify, filter on IS NULL), so
  // this doesn't fire daily for the same vehicle for its entire 30-day window.
  cron.schedule("0 7 * * *", async () => {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { data: expiring } = await db.from("vehicles").select("*, carriers(name)").lte("inspection_expiry", soon).is("expiry_notified_at", null).eq("active", true);
    for (const v of expiring || []) {
      await db.from("vehicles").update({ expiry_notified_at: new Date().toISOString() }).eq("id", v.id);
      const daysLeft = Math.ceil((new Date(v.inspection_expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const status = daysLeft < 0 ? `expired ${Math.abs(daysLeft)} days ago` : `expires in ${daysLeft} days`;
      logAudit({ action: "VEHICLE_INSPECTION_EXPIRING", entityType: "VEHICLE", entityId: v.plate, details: { inspection_expiry: v.inspection_expiry, daysLeft }, severity: daysLeft < 0 ? "critical" : "warning" });
      const { data: admins } = await db.from("users").select("id, phone").in("role", ["ADMIN", "superadmin"]);
      for (const admin of admins || []) {
        notify({
          type: "VEHICLE_INSPECTION_EXPIRING", recipientType: "ADMIN", recipientId: admin.id,
          data: { phone: admin.phone, title: "Vehicle inspection " + (daysLeft < 0 ? "expired" : "expiring"), body: `${v.plate} (${(v as any).carriers?.name || "unassigned"}) ${status}. Badge-scan entry will be blocked once expired.`, link: "/superadmin" },
        });
      }
    }
  });

  app.post("/api/privacy/request", async (req: any, res) => {
    const { request_type, phone_or_email } = req.body;
    try {
      const isEmail = String(phone_or_email).includes("@");
      // The Settings admin queue already displayed "Deadline
      // {deadline_at}" and promised a 72-hour IMY/GDPR response window in
      // its own copy, but this insert never actually set deadline_at —
      // every request showed "Invalid Date" to staff.
      const deadlineAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await db.from("data_subject_requests").insert({ facility_id: 1, request_type, requester_phone: isEmail ? null : phone_or_email, requester_email: isEmail ? phone_or_email : null, status: "pending", deadline_at: deadlineAt });
      res.json({ success: true, message: "Request received. We will process it within 72 hours." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // In-app notification bell
  app.get("/api/notifications/inapp", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const userType = (req.query.userType as string) || "ADMIN";
    try {
      const { data } = await db.from("in_app_notifications").select("*").eq("user_type", userType).is("read_at", null).order("created_at", { ascending: false }).limit(25);
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/inapp/:id/read", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    try {
      await db.from("in_app_notifications").update({ read_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/inapp/read-all", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const userType = req.body?.userType || "ADMIN";
    try {
      await db.from("in_app_notifications").update({ read_at: new Date().toISOString() }).eq("user_type", userType).is("read_at", null);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GDPR admin queue — GET/PATCH had no requireRole at all, unlike every
  // other staff endpoint in this file. Any unauthenticated caller could
  // list every data subject request (requester_phone/email is PII) or
  // mark them completed — an access-control gap inside the feature that
  // exists specifically to handle PII responsibly.
  app.get("/api/admin/data-requests", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data } = await db.from("data_subject_requests").select("*").order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/data-requests/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { status, notes } = req.body;
    try {
      const patch: any = {};
      if (status) patch.status = status;
      if (notes) patch.notes = notes;
      if (status === "completed") patch.completed_at = new Date().toISOString();
      await db.from("data_subject_requests").update(patch).eq("id", req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Real data export for an access request — download_url existed but
  // nothing ever produced anything to download. Gathers every real record
  // tied to the requester's phone/email across the tables that actually
  // hold personal data in this app and returns it as a JSON export;
  // records the export's own URL back onto the request.
  app.get("/api/admin/data-requests/:id/export", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data: request } = await db.from("data_subject_requests").select("*").eq("id", req.params.id).maybeSingle();
      if (!request) return res.status(404).json({ error: "Request not found" });
      const phone = request.requester_phone;
      const email = request.requester_email;
      if (!phone && !email) return res.status(400).json({ error: "Request has no phone or email to search for" });

      const [drivers, walkins] = await Promise.all([
        phone ? db.from("drivers").select("id, name, phone, default_plate, carrier_name, created_at").eq("phone", phone) : Promise.resolve({ data: [] as any[] }),
        phone ? db.from("walkin_registrations").select("id, driver_name, carrier_name, phone, truck_plate, status, created_at").eq("phone", phone) : Promise.resolve({ data: [] as any[] }),
      ]);
      const appointments = phone
        ? await db.from("appointments").select("id, plate, carrier, start_time, status").eq("driver_id", (drivers.data || [])[0]?.id ?? -1)
        : { data: [] as any[] };

      const exportPayload = {
        request: { id: request.id, request_type: request.request_type, requester_email: email, requester_phone: phone, created_at: request.created_at },
        drivers: drivers.data || [],
        walkin_registrations: walkins.data || [],
        appointments: appointments.data || [],
        generated_at: new Date().toISOString(),
      };

      const downloadUrl = `/api/admin/data-requests/${request.id}/export`;
      if (request.download_url !== downloadUrl) {
        await db.from("data_subject_requests").update({ download_url: downloadUrl }).eq("id", request.id);
      }
      logAudit({ action: "GDPR_EXPORT_GENERATED", entityType: "DATA_SUBJECT_REQUEST", entityId: String(request.id), details: { hasPhone: !!phone, hasEmail: !!email }, ip: req.ip, facility_id: request.facility_id, severity: "warning" });

      res.setHeader("Content-Disposition", `attachment; filename=data-export-${request.id}.json`);
      res.json(exportPayload);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Live activity feed
  app.get("/api/admin/gate-logs", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const facilityId = req.session?.facility_id || req.facilityId || 1;
    try {
      const { data } = await db.from("gate_logs").select("*, users(name)").eq("facility_id", facilityId).order("timestamp", { ascending: false }).limit(30);
      res.json((data || []).map((l: any) => ({ ...l, guard_name: l.users?.name })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Per-trailer movement timeline: merges gate events, moves, and the
  // hash-chained audit log into one chronological history for a plate —
  // used for detention disputes / incident review, not just a live snapshot.
  app.get("/api/trailer/:plate/timeline", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const facilityId = req.session?.facility_id || req.facilityId || 1;
    try {
      const [gateLogsRes, moveOrdersRes, auditRes, spotsRes] = await Promise.all([
        db.from("gate_logs").select("*, users(name)").eq("facility_id", facilityId).eq("truck_plate", plate).order("timestamp", { ascending: true }),
        db.from("move_orders").select("*, trailers!inner(plate)").eq("facility_id", facilityId).eq("trailers.plate", plate).order("created_at", { ascending: true }),
        db.from("audit_logs").select("*").eq("facility_id", facilityId).eq("entityType", "TRAILER").eq("entityId", plate).order("timestamp", { ascending: true }),
        db.from("spots").select("id, name").eq("facility_id", facilityId),
      ]);

      const spotName = new Map((spotsRes.data || []).map((s: any) => [s.id, s.name]));

      const events: any[] = [];
      for (const l of gateLogsRes.data || []) {
        events.push({ timestamp: l.timestamp, type: `gate_${l.event_type}`, label: `Gate: ${l.event_type}`, detail: l.notes, actor: l.users?.name });
      }
      for (const m of moveOrdersRes.data || []) {
        const from = spotName.get(m.from_spot_id) || "?";
        const to = spotName.get(m.to_spot_id) || "?";
        events.push({ timestamp: m.completed_at || m.created_at, type: m.status === "COMPLETED" ? "move_completed" : "move_created", label: `Move: ${from} → ${to}`, detail: m.status });
      }
      for (const a of auditRes.data || []) {
        events.push({ timestamp: a.timestamp, type: a.action?.toLowerCase(), label: a.action, detail: a.details });
      }

      events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      res.json({ plate, events });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reefer monitoring without hardware — trailers had a reefer_temp_setpoint
  // column and "reefer" as a selectable load type everywhere, but nothing
  // ever recorded a real reading or alerted on one. Staff key in a
  // temperature/fuel check (at the gate, or any walk-by); it's evaluated
  // against the trailer's setpoint immediately and flows into Needs
  // Attention if it's stale or out of range. Live telematics/IoT sensor
  // feeds are hardware-dependent and out of scope here.
  app.post("/api/trailers/:plate/reefer-reading", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const { temperature_c, fuel_level_pct, notes } = req.body;
    const facilityId = req.facilityId;
    if (temperature_c === undefined || temperature_c === null || isNaN(Number(temperature_c))) {
      return res.status(400).json({ error: "temperature_c is required" });
    }
    try {
      const { data: trailer } = await db.from("trailers").select("id, plate, equipment_type, reefer_temp_setpoint").eq("plate", plate).eq("facility_id", facilityId).maybeSingle();
      if (!trailer) return res.status(404).json({ error: "Trailer not found" });
      if (trailer.equipment_type !== "reefer") return res.status(400).json({ error: "Trailer is not equipment_type reefer" });

      const tempC = Number(temperature_c);
      const fuelPct = fuel_level_pct != null && fuel_level_pct !== "" ? Number(fuel_level_pct) : null;
      const evaluation = evaluateReading(tempC, fuelPct, trailer.reefer_temp_setpoint);

      const { data: reading, error } = await db.from("reefer_readings").insert({
        facility_id: facilityId, trailer_id: trailer.id, plate: trailer.plate,
        temperature_c: tempC, fuel_level_pct: fuelPct, status: evaluation.status, reasons: evaluation.reasons,
        recorded_by: req.session?.user?.id || null, notes: notes || null,
      }).select().single();
      if (error) throw error;

      logAudit({ action: "REEFER_READING_RECORDED", entityType: "TRAILER", entityId: plate, details: { temperature_c: tempC, fuel_level_pct: fuelPct, status: evaluation.status }, ip: req.ip, facility_id: facilityId, severity: evaluation.status === "critical" ? "warning" : "info" });

      if (evaluation.status === "critical") {
        const { data: admins } = await db.from("users").select("id, phone").eq("facility_id", facilityId).in("role", ["ADMIN", "superadmin"]);
        for (const admin of admins || []) {
          notify({ type: "REEFER_ALERT", recipientType: "ADMIN", recipientId: admin.id, data: { phone: admin.phone, title: "Reefer alert", body: `${plate}: ${evaluation.reasons.join("; ")}`, link: "/tracking" } });
        }
        raiseException({ facility_id: facilityId, exception_type: "temperature_violation", severity: "critical", entity_type: "TRAILER", entity_id: plate, title: `Reefer out of range: ${plate}`, description: evaluation.reasons.join("; "), source: "reefer_monitoring" });
      }

      emitUpdate("yard_update", { type: "REEFER_READING", plate });
      res.json(reading);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/trailers/:plate/reefer-readings", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const facilityId = req.facilityId;
    const { data } = await db.from("reefer_readings").select("*").eq("facility_id", facilityId).eq("plate", plate).order("recorded_at", { ascending: false }).limit(20);
    res.json(data || []);
  });

  // Seal chain-of-custody — gate_checkin_tx already writes an "applied" row
  // to seal_records the moment a seal number is captured at check-in, but
  // nothing ever verified or broke a seal after that: the pipeline's
  // "Documents (seal, permits) OK" checkbox was just a checkbox, not a real
  // comparison against what's on file.
  // Trailer inspection capture — hazmat_class and tare_weight_kg sat unused
  // on trailers with no form anywhere to set them, and damage_photos (jsonb)
  // had no write path at all. Real photo upload would need a Supabase
  // Storage bucket wired up, which doesn't exist in this app yet and is out
  // of scope here — damage_photos is used as a damage-report log instead
  // (note + reporter + timestamp, optional external photo URL if staff
  // already has one) rather than leaving the column dead.
  app.post("/api/trailers/:plate/inspection", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { plate } = req.params;
    const { hazmat_class, tare_weight_kg, damage_note, damage_photo_url } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: trailer } = await db.from("trailers").select("id, damage_photos").eq("plate", plate).eq("facility_id", facilityId).maybeSingle();
      if (!trailer) return res.status(404).json({ error: "Trailer not found" });

      const patch: any = {};
      if (hazmat_class !== undefined) patch.hazmat_class = hazmat_class || null;
      if (tare_weight_kg !== undefined && tare_weight_kg !== "") patch.tare_weight_kg = Number(tare_weight_kg);
      if (damage_note) {
        const existing = Array.isArray(trailer.damage_photos) ? trailer.damage_photos : [];
        patch.damage_photos = [...existing, { note: damage_note, photo_url: damage_photo_url || null, reported_by: req.session?.user?.id || null, reported_at: new Date().toISOString() }];
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to update" });

      const { data: updated, error } = await db.from("trailers").update(patch).eq("id", trailer.id).select().single();
      if (error) throw error;

      logAudit({ action: "TRAILER_INSPECTION_UPDATED", entityType: "TRAILER", entityId: plate, details: { hazmat_class, tare_weight_kg, damage_note: !!damage_note }, ip: req.ip, facility_id: facilityId, severity: damage_note ? "warning" : "info" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const CARGO_STATUSES = ["expected", "arrived", "checked", "loading", "loaded", "unloading", "unloaded", "short", "over", "damaged", "rejected", "completed"];

  app.patch("/api/trailers/:plate/cargo-status", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { status } = req.body;
    if (!CARGO_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    try {
      const { data, error } = await db.from("trailers").update({ cargo_status: status }).eq("plate", req.params.plate).eq("facility_id", req.facilityId).select("plate, cargo_status").single();
      if (error) throw error;
      logAudit({ action: "CARGO_STATUS_UPDATED", entityType: "TRAILER", entityId: req.params.plate, details: { status }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("yard_update", { type: "CARGO_STATUS" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/trailers/:plate/seal", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const facilityId = req.facilityId;
    try {
      const { data: trailer } = await db.from("trailers").select("id").eq("plate", plate).eq("facility_id", facilityId).maybeSingle();
      if (!trailer) return res.json(null);
      const { data } = await db.from("seal_records").select("*").eq("trailer_id", trailer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      res.json(data || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/trailers/:plate/seal/verify", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const { seal_number } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: trailer } = await db.from("trailers").select("id").eq("plate", plate).eq("facility_id", facilityId).maybeSingle();
      if (!trailer) return res.status(404).json({ error: "Trailer not found" });
      const { data: seal } = await db.from("seal_records").select("*").eq("trailer_id", trailer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!seal) return res.status(404).json({ error: "No seal on file for this trailer" });
      if (seal.status !== "intact") return res.status(400).json({ error: `Seal is already ${seal.status}` });

      const matched = String(seal_number || "").trim().toUpperCase() === String(seal.seal_number || "").trim().toUpperCase();
      if (!matched) {
        logAudit({ action: "SEAL_MISMATCH", entityType: "TRAILER", entityId: plate, details: { expected: seal.seal_number, presented: seal_number }, ip: req.ip, facility_id: facilityId, severity: "warning" });
        raiseException({ facility_id: facilityId, exception_type: "seal_mismatch", severity: "critical", entity_type: "TRAILER", entity_id: plate, title: `Seal mismatch: ${plate}`, description: `Expected ${seal.seal_number}, got ${seal_number || "(blank)"}`, source: "seal_verification" });
        return res.status(409).json({ error: "SEAL_MISMATCH", expected: seal.seal_number, presented: seal_number });
      }

      const { data: updated } = await db.from("seal_records").update({ verified_by: String(req.session?.user?.id ?? "guard"), verified_at: new Date().toISOString() }).eq("id", seal.id).select().single();
      logAudit({ action: "SEAL_VERIFIED", entityType: "TRAILER", entityId: plate, details: { seal_number: seal.seal_number }, ip: req.ip, facility_id: facilityId });
      res.json({ matched: true, record: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/trailers/:plate/seal/break", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { plate } = req.params;
    const { reason } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: trailer } = await db.from("trailers").select("id").eq("plate", plate).eq("facility_id", facilityId).maybeSingle();
      if (!trailer) return res.status(404).json({ error: "Trailer not found" });
      const { data: seal } = await db.from("seal_records").select("*").eq("trailer_id", trailer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!seal) return res.status(404).json({ error: "No seal on file for this trailer" });
      if (seal.status !== "intact") return res.status(400).json({ error: `Seal is already ${seal.status}` });

      const { data: updated } = await db.from("seal_records").update({ status: "broken", broken_at: new Date().toISOString(), broken_reason: reason || null }).eq("id", seal.id).select().single();
      logAudit({ action: "SEAL_BROKEN", entityType: "TRAILER", entityId: plate, details: { seal_number: seal.seal_number, reason }, ip: req.ip, facility_id: facilityId, severity: "warning" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Document Control Center — multer was an installed, unused dependency
  // (imported nowhere). No document storage of any kind existed: no bucket,
  // no table, no upload endpoint. This is the real thing, not a URL-only
  // stub: files go into a private Supabase Storage bucket via the same
  // service-role client already used for every other DB write, with real
  // mimetype/size validation (also closes off the "file upload attacks"
  // item from the requested security checklist) and short-lived signed
  // URLs for download rather than public links.
  const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      cb(null, allowed.includes(file.mimetype));
    },
  });
  const DOCUMENT_ENTITY_TYPES = ["appointment", "driver", "trailer", "carrier", "vehicle", "shipment"];

  // multer's own middleware throws synchronously on rejection (oversized
  // file, disallowed mimetype resolved to `false` by fileFilter) — that
  // error never reaches the route handler's try/catch, so with no global
  // Express error handler in this app it fell through to Express's default
  // handler, which returned a raw stack trace as unstyled HTML. Wrapping
  // the middleware call directly converts that into a clean 400 JSON
  // response instead of leaking internals.
  const uploadSingleDocument = (req: any, res: any, next: any) => {
    documentUpload.single("file")(req, res, (err: any) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large — max 10MB" });
      }
      if (err) return res.status(400).json({ error: "Upload failed — check file type (PDF/JPEG/PNG/WEBP)" });
      next();
    });
  };

  // Priority 4: document completeness — before/at gate check-in, tells the
  // guard whether required paperwork is on file for a plate, per the
  // facility's own configured required_document_types + document_policy
  // (not one hardcoded global rule).
  app.get("/api/documents/completeness", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { related_entity_type, related_entity_id } = req.query;
    if (!related_entity_type || !related_entity_id) return res.status(400).json({ error: "related_entity_type and related_entity_id are required" });
    try {
      const [{ data: settings }, { data: docs }] = await Promise.all([
        db.from("facility_settings").select("required_document_types, document_policy").eq("facility_id", req.facilityId).maybeSingle(),
        db.from("documents").select("doc_type").eq("facility_id", req.facilityId).eq("related_entity_type", related_entity_type).eq("related_entity_id", related_entity_id).not("verification_status", "in", "(rejected,expired)"),
      ]);
      const required = settings?.required_document_types || [];
      const missing = missingDocumentTypes(required, (docs || []).map((d: any) => d.doc_type));
      res.json({ ready: missing.length === 0, missing, policy: settings?.document_policy || "warn" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/documents", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { related_entity_type, related_entity_id, status } = req.query;
    try {
      let query = db.from("documents").select("*, uploader:users!documents_uploaded_by_fkey(name), verifier:users!documents_verified_by_fkey(name)").eq("facility_id", req.facilityId).order("created_at", { ascending: false }).limit(200);
      if (related_entity_type) query = query.eq("related_entity_type", related_entity_type);
      if (related_entity_id) query = query.eq("related_entity_id", related_entity_id);
      if (status) query = query.eq("verification_status", status);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/documents", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), uploadSingleDocument, async (req: any, res) => {
    const { doc_type, doc_number, related_entity_type, related_entity_id, expiry_date } = req.body;
    const facilityId = req.facilityId;
    const userId = req.session?.user?.id || null;
    if (!req.file) return res.status(400).json({ error: "No file uploaded, or file type/size rejected (PDF/JPEG/PNG/WEBP, max 10MB)" });
    if (!doc_type || !doc_type.trim()) return res.status(400).json({ error: "Document type is required" });
    if (!DOCUMENT_ENTITY_TYPES.includes(related_entity_type)) return res.status(400).json({ error: "Invalid related_entity_type" });
    if (!related_entity_id || !String(related_entity_id).trim()) return res.status(400).json({ error: "related_entity_id is required" });
    try {
      const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const storagePath = `${facilityId}/${related_entity_type}/${related_entity_id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      const { error: uploadError } = await db.storage.from("documents").upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
      if (uploadError) throw uploadError;

      const { data, error } = await db.from("documents").insert({
        facility_id: facilityId, doc_type: doc_type.trim(), doc_number: doc_number || null,
        related_entity_type, related_entity_id: String(related_entity_id).trim(),
        storage_path: storagePath, original_filename: req.file.originalname, mime_type: req.file.mimetype,
        file_size_bytes: req.file.size, expiry_date: expiry_date || null, uploaded_by: userId,
      }).select().single();
      if (error) throw error;
      logAudit({ action: "DOCUMENT_UPLOADED", entityType: "DOCUMENT", entityId: String(data.id), details: { doc_type, related_entity_type, related_entity_id }, ip: req.ip, facility_id: facilityId });
      emitUpdate("document_uploaded", data);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/documents/:id/download", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    try {
      const { data: doc } = await db.from("documents").select("storage_path, original_filename").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const { data, error } = await db.storage.from("documents").createSignedUrl(doc.storage_path, 300, { download: doc.original_filename });
      if (error) throw error;
      res.json({ url: data.signedUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/documents/:id", requireRole("superadmin", "ADMIN", "GUARD", "HOSTLER"), async (req: any, res) => {
    const { verification_status, notes } = req.body;
    const userId = req.session?.user?.id || null;
    try {
      const patch: any = {};
      if (notes !== undefined) patch.notes = notes;
      if (verification_status) {
        if (!["uploaded", "under_review", "verified", "rejected", "expired"].includes(verification_status)) return res.status(400).json({ error: "Invalid verification_status" });
        patch.verification_status = verification_status;
        if (verification_status === "verified" || verification_status === "rejected") { patch.verified_by = userId; patch.verified_at = new Date().toISOString(); }
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const { data, error } = await db.from("documents").update(patch).eq("id", req.params.id).eq("facility_id", req.facilityId).select().single();
      if (error) throw error;
      logAudit({ action: "DOCUMENT_UPDATED", entityType: "DOCUMENT", entityId: String(req.params.id), details: { verification_status }, ip: req.ip, facility_id: req.facilityId });
      emitUpdate("document_updated", data);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/documents/:id", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    try {
      const { data: doc } = await db.from("documents").select("storage_path").eq("id", req.params.id).eq("facility_id", req.facilityId).maybeSingle();
      if (!doc) return res.status(404).json({ error: "Document not found" });
      await db.storage.from("documents").remove([doc.storage_path]);
      await db.from("documents").delete().eq("id", req.params.id).eq("facility_id", req.facilityId);
      logAudit({ action: "DOCUMENT_DELETED", entityType: "DOCUMENT", entityId: req.params.id, ip: req.ip, facility_id: req.facilityId });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Live yard-adjacent weather from SMHI (Swedish met agency, public API, no key).
  // Air temp near/below freezing is a real safety signal for hostlers moving
  // trailers on icy pavement — surfaced on GateConsole and TVDisplay.
  app.get("/api/weather/current", async (req: any, res) => {
    try {
      const facilityId = req.session?.facility_id || req.facilityId || 1;
      const { data: facility } = await db.from("facilities").select("latitude, longitude").eq("id", facilityId).maybeSingle();
      const coords = facility?.latitude != null && facility?.longitude != null
        ? { lat: facility.latitude, lon: facility.longitude }
        : undefined;
      const reading = await getCurrentTemperature(coords);
      if (!reading) return res.status(502).json({ error: "SMHI data unavailable" });
      res.json(reading);
    } catch (e: any) {
      logger.error("SMHI weather fetch failed", { error: e.message });
      res.status(502).json({ error: "SMHI data unavailable" });
    }
  });

  // Set a facility's real-world coordinates so weather (and future
  // Trafikverket/geofence work) resolve to the nearest actual station
  // instead of the Stockholm-Bromma fallback.
  app.post("/api/admin/facility/coords", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { latitude, longitude } = req.body;
    const facilityId = req.session?.facility_id || 1;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ error: "latitude and longitude must be numbers" });
    }
    try {
      await db.from("facilities").update({ latitude, longitude }).eq("id", facilityId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vehicle Inspection Expiry Notifier — expiry_notified_at existed to
  // dedupe a recurring notification but nothing ever ran one. Needs
  // Attention (Phase H) surfaces expiring inspections to staff who happen
  // to check the dashboard; this proactively notifies the carrier (and
  // admins) once per expiry date instead of relying on someone noticing.
  const runVehicleExpiryCheck = async () => {
    const { data: vehicles } = await db.from("vehicles").select("id, plate, inspection_expiry, expiry_notified_at, carrier_id, carriers(name, email, contact_phone)").eq("active", true).not("inspection_expiry", "is", null);
    let notified = 0;
    for (const v of vehicles || []) {
      if (!shouldNotifyExpiry(v.inspection_expiry, v.expiry_notified_at)) continue;
      const carrier: any = v.carriers;
      const overdue = v.inspection_expiry < new Date().toISOString().split("T")[0];
      const body = `${v.plate} inspection ${overdue ? "expired" : "expires"} ${v.inspection_expiry}. Please renew and update the fleet record.`;

      if (v.carrier_id) {
        notify({ type: "VEHICLE_INSPECTION_EXPIRING", recipientType: "CARRIER", recipientId: v.carrier_id, data: { phone: carrier?.contact_phone, email: carrier?.email, title: "Vehicle inspection expiring", body, link: "/superadmin" } });
      }
      notify({ type: "VEHICLE_INSPECTION_EXPIRING", recipientType: "ADMIN", recipientId: null, data: { title: "Vehicle inspection expiring", body: `${carrier?.name || "Unassigned carrier"} — ${body}`, link: "/superadmin" } });

      await db.from("vehicles").update({ expiry_notified_at: new Date().toISOString() }).eq("id", v.id);
      logAudit({ action: "VEHICLE_EXPIRY_NOTIFIED", entityType: "VEHICLE", entityId: String(v.id), details: { plate: v.plate, inspection_expiry: v.inspection_expiry }, facility_id: 1, severity: overdue ? "warning" : "info" });
      notified++;
    }
    return notified;
  };

  cron.schedule("0 7 * * *", () => { runVehicleExpiryCheck(); });

  // Document Expiry Worker — Priority 3. Multi-level thresholds (30/14/7/3/
  // 1 days, then expired), deduplicated via expiry_alert_level so tightening
  // from "30 days out" to "7 days out" fires exactly once per crossing, not
  // once per cron tick. Raises a real exception (so it shows in the
  // Exception Center and Manager Action Center) and flips verification_
  // status to "expired" once the date has actually passed.
  const runDocumentExpiryCheck = async () => {
    const soon30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { data: docs } = await db.from("documents").select("id, facility_id, doc_type, doc_number, related_entity_type, related_entity_id, expiry_date, expiry_alert_level, verification_status")
      .not("expiry_date", "is", null).lte("expiry_date", soon30d).neq("verification_status", "rejected");
    let alerted = 0;
    for (const d of docs || []) {
      const level = nextExpiryAlertLevel(d.expiry_date, d.expiry_alert_level);
      if (level === null) continue;
      const expired = level === 0;
      const label = expired ? "expired" : `expires in ${level} day${level === 1 ? "" : "s"}`;
      const patch: any = { expiry_alert_level: level };
      if (expired) patch.verification_status = "expired";
      await db.from("documents").update(patch).eq("id", d.id);
      raiseException({
        facility_id: d.facility_id, exception_type: "document_expiring", severity: expired ? "critical" : level <= 7 ? "warning" : "info",
        entity_type: d.related_entity_type.toUpperCase(), entity_id: d.related_entity_id,
        title: `${d.doc_type}${d.doc_number ? ` (${d.doc_number})` : ""} ${label}`,
        description: `${d.related_entity_type} ${d.related_entity_id} — expiry ${d.expiry_date}`, source: "document_expiry_worker",
      });
      notify({ type: "DOCUMENT_EXPIRING", recipientType: "ADMIN", recipientId: null, data: { title: expired ? "Document expired" : "Document expiring soon", body: `${d.doc_type} for ${d.related_entity_type} ${d.related_entity_id} ${label}`, link: "/documents" } });
      logAudit({ action: "DOCUMENT_EXPIRY_ALERT", entityType: "DOCUMENT", entityId: String(d.id), details: { level, expired }, facility_id: d.facility_id, severity: expired ? "warning" : "info" });
      alerted++;
    }
    return alerted;
  };

  cron.schedule("0 8 * * *", () => { runDocumentExpiryCheck(); });

  // Manual trigger for the same worker the daily cron runs — lets staff
  // (or a live verification pass) run the check on demand instead of
  // waiting for the 07:00 schedule.
  app.post("/api/admin/vehicles/run-expiry-check", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      const notified = await runVehicleExpiryCheck();
      res.json({ success: true, notified });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/documents/run-expiry-check", requireRole("superadmin", "ADMIN"), async (req, res) => {
    try {
      const alerted = await runDocumentExpiryCheck();
      res.json({ success: true, alerted });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // No-Show Detection Worker — grace_period_minutes sat on every appointment
  // row unused; every appointment got the same flat 60-minute cutoff instead
  // of its own configured grace period. Query a wide-enough window (24h is
  // more than any grace period should ever be) and apply each row's own
  // grace period in JS.
  cron.schedule("*/30 * * * *", async () => {
    logger.info("[Worker] Running No-Show Detection...");
    const lookback = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates } = await db.from("appointments").select("id, carrier_id, carrier, start_time, grace_period_minutes, facility_id").eq("status", "SCHEDULED").gt("start_time", lookback).lt("start_time", new Date().toISOString()).is("checked_in_at", null);
    const noShows = (candidates || []).filter((appt: any) => isNoShow(appt.start_time, appt.grace_period_minutes));
    for (const appt of noShows) {
      await db.from("appointments").update({ status: "no_show", no_show_flag: true }).eq("id", appt.id);
      raiseException({ facility_id: appt.facility_id || 1, exception_type: "no_show", severity: "warning", entity_type: "APPOINTMENT", entity_id: String(appt.id), title: `No-show: ${appt.carrier || "Unknown carrier"}`, description: `Scheduled ${appt.start_time}, no check-in within grace period`, source: "no_show_worker" });
      if (!appt.carrier_id) continue;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await db.from("appointments").select("*", { count: "exact", head: true }).eq("carrier_id", appt.carrier_id).eq("no_show_flag", true).gt("start_time", thirtyDaysAgo);
      if ((count || 0) >= 3) {
        await db.from("carriers").update({ flagged: true }).eq("id", appt.carrier_id);
        notify({ type: "CARRIER_FLAGGED", recipientType: "ADMIN", recipientId: null, data: { title: "Carrier Flagged - Excessive No-Shows", body: `Carrier ID ${appt.carrier_id} has ${count} no-shows in 30 days. Bookings now require approval.` } });
      }
    }
  });

  // Self-service walk-in approval timeout/escalation: an unmanned gate has no
  // guard to fall back on, so a request stuck unanswered for too long needs a
  // second notification path — otherwise a driver can be stranded at the gate
  // indefinitely with nobody aware anything is pending.
  const WALKIN_APPROVAL_TIMEOUT_MIN = 10;
  cron.schedule("*/5 * * * *", async () => {
    const cutoff = new Date(Date.now() - WALKIN_APPROVAL_TIMEOUT_MIN * 60 * 1000).toISOString();
    const { data: stuck } = await db.from("walkin_registrations").select("id, truck_plate, carrier_name, facility_id, created_at").eq("status", "pending_approval").is("escalated_at", null).lt("created_at", cutoff);
    for (const w of stuck || []) {
      await db.from("walkin_registrations").update({ escalated_at: new Date().toISOString() }).eq("id", w.id); // set first — never re-escalate the same request
      logAudit({ action: "WALKIN_APPROVAL_ESCALATED", entityType: "WALKIN", entityId: String(w.id), details: { waitingSince: w.created_at }, facility_id: w.facility_id, severity: "warning" });
      const { data: allStaff } = await db.from("users").select("id, phone").eq("facility_id", w.facility_id).in("role", ["ADMIN", "superadmin"]);
      for (const staff of allStaff || []) {
        notify({
          type: "WALKIN_APPROVAL_ESCALATED", recipientType: "ADMIN", recipientId: staff.id,
          data: { phone: staff.phone, title: "Gate entry waiting over 10 minutes", body: `${w.carrier_name} (${w.truck_plate}) still awaiting approval. Reply YES ${w.id} or NO ${w.id}. Ref: WK-${w.id}`, link: "/gate" },
        });
      }
    }
  });

  // Notification Queue Processor
  cron.schedule("*/2 * * * *", async () => {
    const { data: pending } = await db.from("notifications_queue").select("*").eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).limit(20);
    for (const item of pending || []) {
      try {
        const payload = item.payload_json;
        logger.info(`[Notification Engine] Processing ${item.channel} to ${item.recipient_type} id ${item.recipient_id}`);
        if (item.channel === "sms") {
          const result = await sendSms(payload.phone, payload.message);
          if (result.success) {
            await db.from("notifications_queue").update({ status: "sent" }).eq("id", item.id);
          } else {
            throw new Error(result.error);
          }
        } else {
          await db.from("notifications_queue").update({ status: "sent" }).eq("id", item.id);
        }
      } catch (e: any) {
        const attempts = item.attempts + 1;
        const maxAttempts = 5;
        if (attempts >= maxAttempts) {
          await db.from("notifications_queue").update({ status: "failed", attempts, error_msg: e.message }).eq("id", item.id);
          logger.error(`[Notification Engine] Giving up on notification ${item.id} after ${attempts} attempts`, { error: e.message });
        } else {
          const backoffMin = Math.min(2 ** attempts, 30);
          await db.from("notifications_queue").update({ attempts, error_msg: e.message, next_attempt_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString() }).eq("id", item.id);
        }
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    logger.info(`SkyYard YMS v4.0 [Supabase + Real-time] running on http://localhost:${PORT}`);
  });
}

startServer();

