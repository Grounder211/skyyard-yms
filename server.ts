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
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit";
import { db, unwrap } from "./server/supabaseClient.js";
import { logger } from "./server/logger.js";

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

  const PORT = 3000;

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
      .select("*, trailers!trailers_spot_id_fkey(id, plate, carrier, status, check_in_time, checked_in_at, equipment_type, seal_number, driver_license)")
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
      };
    });

    const { data: moveRows } = await db
      .from("move_orders")
      .select("*, trailers(plate), from_spot:spots!move_orders_from_spot_id_fkey(name), to_spot:spots!move_orders_to_spot_id_fkey(name)")
      .eq("facility_id", facilityId)
      .neq("status", "COMPLETED");

    const moves = (moveRows || []).map((m: any) => ({
      ...m,
      plate: m.trailers?.plate,
      from_name: m.from_spot?.name,
      to_name: m.to_spot?.name,
    }));

    const { data: fSettings } = await db.from("facility_settings").select("detention_threshold_hours").eq("facility_id", facilityId).maybeSingle();

    return { stats: statsData, spots: flatSpots, moves, detentionThresholdHours: fSettings?.detention_threshold_hours || 24 };
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
      await db.from("in_app_notifications").insert({
        user_id: recipientId,
        user_type: recipientType,
        title: data.title,
        body: data.body,
        link: data.link,
      });

      let prefs: any = { channel_sms: 1, channel_email: 0 };
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

  const checkBlacklist = async (facilityId: number, plate: string, carrierName?: string) => {
    const now = new Date().toISOString();
    const { data } = await db
      .from("blacklist")
      .select("*")
      .eq("facility_id", facilityId)
      .or(`and(entity_type.eq.plate,entity_value.eq.${plate}),and(entity_type.eq.carrier,entity_value.eq.${carrierName || "__none__"})`)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(1)
      .maybeSingle();
    return data;
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
  app.use(express.json());

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
    keyGenerator: (req: any) => `${req.ip}:${req.body?.phone || ""}`,
    message: { error: "Too many code requests. Try again in 10 minutes." },
  });

  // OTP verify: 6-digit code has 1e6 combinations — cap attempts per-IP+phone so it can't be brute-forced.
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => `${req.ip}:${req.body?.phone || ""}`,
    message: { error: "Too many attempts. Try again in 15 minutes." },
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
      req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role, facility_id: user.facility_id };
      if (user.facility_id) req.session.facility_id = user.facility_id;
      logAudit({ action: "STAFF_LOGIN", entityType: "USER", entityId: String(user.id), details: { email: user.email }, ip: req.ip, facility_id: user.facility_id || 1 });
      res.json({ success: true, user: req.session.user });
    } catch (e: any) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", (req: any, res) => {
    if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user: req.session.user });
  });

  app.post("/api/auth/logout", (req: any, res) => {
    req.session?.destroy(() => res.json({ success: true }));
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
  app.get("/api/search", async (req: any, res) => {
    const q = String(req.query.q || "");
    if (q.length < 2) return res.json([]);
    try {
      const facilityId = req.facilityId;
      const [{ data: trailers }, { data: appts }, { data: carriers }] = await Promise.all([
        db.from("trailers").select("id, plate, carrier").eq("facility_id", facilityId).ilike("plate", `%${q}%`).limit(5),
        db.from("appointments").select("id, plate, carrier").eq("facility_id", facilityId).ilike("plate", `%${q}%`).limit(5),
        db.from("carriers").select("id, name").ilike("name", `%${q}%`).limit(5),
      ]);
      const results = [
        ...(trailers || []).map((t: any) => ({ id: `trailer-${t.id}`, title: t.plate, subtitle: `Trailer · ${t.carrier || ""}`, url: `/status/${t.id}` })),
        ...(appts || []).map((a: any) => ({ id: `appt-${a.id}`, title: a.plate, subtitle: `Appointment · ${a.carrier || ""}`, url: `/status/${a.id}` })),
        ...(carriers || []).map((c: any) => ({ id: `carrier-${c.id}`, title: c.name, subtitle: "Carrier", url: `/network` })),
      ];
      res.json(results);
    } catch (e: any) {
      logger.error(`Search Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Custom Reports API
  app.get("/api/admin/reports", async (req: any, res) => {
    const { data } = await db.from("custom_reports").select("*").eq("facility_id", req.facilityId);
    res.json(data || []);
  });

  app.post("/api/admin/reports", async (req: any, res) => {
    const { name, description, config } = req.body;
    try {
      await db.from("custom_reports").insert({ facility_id: req.facilityId, name, description, config_json: config });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // General facility settings
  app.get("/api/settings/general", async (req: any, res) => {
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
    const { currency, locale, timezone, detention_rate_per_hour, detention_threshold_hours } = req.body;
    try {
      const patch: any = { updated_at: new Date().toISOString() };
      if (currency) patch.currency = currency;
      if (locale) patch.locale = locale;
      if (timezone) patch.timezone = timezone;
      if (detention_rate_per_hour !== undefined) patch.detention_rate_per_hour = detention_rate_per_hour;
      if (detention_threshold_hours !== undefined) patch.detention_threshold_hours = detention_threshold_hours;
      await db.from("facility_settings").update(patch).eq("facility_id", facilityId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Notification Preferences API
  app.get("/api/settings/notifications", async (req: any, res) => {
    const facilityId = req.facilityId;
    const userId = req.session?.user?.id || 1;
    const { data } = await db.from("notification_preferences").select("*").eq("user_id", userId);
    res.json(data || []);
  });

  app.post("/api/settings/notifications", async (req: any, res) => {
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
  app.get("/api/appointments", async (req: any, res) => {
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

  app.post("/api/appointments", async (req: any, res) => {
    const { plate, carrier, start_time, duration_minutes, dock_id, load_type, priority_level } = req.body;
    const facilityId = req.facilityId || 1;
    try {
      const { data: newAppt, error } = await db.from("appointments").insert({
        plate, carrier, start_time,
        actual_duration_minutes: duration_minutes || 60,
        dock_id: dock_id || null,
        load_type: load_type || "LOAD",
        priority_level: priority_level || 2,
        facility_id: facilityId,
        status: "SCHEDULED",
      }).select().single();
      if (error) throw error;

      emitUpdate("appointment_created", newAppt);
      evaluateWorkflows("appointment_created", newAppt, facilityId);
      res.json(newAppt);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/appointments/:id", async (req: any, res) => {
    const { id } = req.params;
    const updates = req.body;
    const facilityId = req.facilityId || 1;
    try {
      const allowedFields = ["plate", "carrier", "start_time", "actual_duration_minutes", "status", "priority_level", "dock_id"];
      const patch: any = {};
      for (const field of allowedFields) if (updates[field] !== undefined) patch[field] = updates[field];

      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      const { data: updated, error } = await db.from("appointments").update(patch).eq("id", id).eq("facility_id", facilityId).select().single();
      if (error) throw error;

      emitUpdate("appointment_updated", updated);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/appointments/:id", async (req: any, res) => {
    const { id } = req.params;
    const facilityId = req.facilityId || 1;
    try {
      await db.from("appointments").delete().eq("id", id).eq("facility_id", facilityId);
      emitUpdate("appointment_deleted", { id });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/yard-status", async (req: any, res) => {
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

  // Phase 5 Status Page Endpoint
  app.get("/api/status/:id", async (req, res) => {
    const { id } = req.params;
    const { data: trailer } = await db.from("trailers").select("*").eq("id", id).maybeSingle();
    if (trailer) return res.json({ type: "TRAILER", data: trailer });
    const { data: appt } = await db.from("appointments").select("*").eq("id", id).maybeSingle();
    if (appt) return res.json({ type: "APPOINTMENT", data: appt });
    res.status(404).json({ error: "Node not found" });
  });

  app.post("/api/walkin/register", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { driver_name, carrier_name, phone, truck_plate, trailer_number, load_type, direction } = req.body;
    const facilityId = req.facilityId || 1;

    if (!driver_name || !carrier_name || !truck_plate || !phone) {
      return res.status(400).json({ error: "Biometric and contact data incomplete" });
    }

    try {
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
        emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
        return res.json({ success: true, id: `WK-${walkin.id}`, spotName: assign.spotName });
      }

      logAudit({ action: "WALKIN_REGISTERED", entityType: "WALKIN", entityId: String(walkin.id), details: { truck_plate }, ip: req.ip, facility_id: facilityId });
      notify({ type: "WALKIN_QUEUED", recipientType: "driver", recipientId: walkin.id, data: { phone, title: "Registration Queued", body: `SkyYard: You are in queue. Reference: WK-${walkin.id}. Please wait for spot assignment.` } });
      notify({ type: "WALKIN_NEEDS_ATTENTION", recipientType: "ADMIN", recipientId: null, data: { title: "Walk-in waiting for a spot", body: `${driver_name} (${carrier_name}, ${truck_plate}) is queued at the gate — yard is at capacity. Ref: WK-${walkin.id}`, link: "/gate" } });

      emitUpdate("yard_update", { type: "WALKIN", id: walkin.id });
      res.json({ success: true, id: `WK-${walkin.id}`, status: "QUEUED" });
    } catch (e: any) {
      logger.error("Walk-in registration failed", { error: e });
      res.status(500).json({ error: "System Neural Failure: " + e.message });
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

  app.get("/api/visitors/active", async (req: any, res) => {
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
    const { appointmentId, plate, carrierName, sealNumber, overrideDiscrepancy, overrideNote } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: appt } = await db.from("appointments").select("*, drivers(phone, id)").eq("id", appointmentId).eq("facility_id", facilityId).maybeSingle();
      if (!appt) return res.status(404).json({ error: "Appointment not found" });

      const blacklistHit = await checkBlacklist(facilityId, plate, carrierName || appt.carrier);
      if (blacklistHit && blacklistHit.severity === "block") {
        await db.from("gate_logs").insert({ facility_id: facilityId, event_type: "denied", appointment_id: appointmentId, truck_plate: plate, guard_user_id: req.session?.user?.id || null, notes: `Blacklisted: ${blacklistHit.reason}` });
        logAudit({ action: "BLACKLIST_BLOCKED_ENTRY", entityType: "TRAILER", entityId: plate, details: { reason: blacklistHit.reason, appointmentId }, ip: req.ip, facility_id: facilityId, severity: "warning" });
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

      const driverPhone = appt.drivers?.phone;
      if (driverPhone) {
        notify({ type: "GATE_CHECKIN", recipientType: "driver", recipientId: appt.driver_id, data: { phone: driverPhone, title: "Checked In", body: `SkyYard: Welcome! You are assigned to parking spot: ${result.spotName}. Please wait for further instructions.` } });
      }

      emitUpdate("yard_update", { type: "CHECKIN", plate });
      res.json({ success: true, spotName: result.spotName });
    } catch (e: any) {
      logger.error("Gate checkin failed", { error: e });
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/create-move", requireRole("superadmin", "ADMIN", "HOSTLER"), async (req: any, res) => {
    const { trailerId, fromSpotId, toSpotId } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data: move, error } = await db.from("move_orders").insert({ trailer_id: trailerId, from_spot_id: fromSpotId, to_spot_id: toSpotId, status: "PENDING", facility_id: facilityId }).select().single();
      if (error) throw error;
      logAudit({ action: "MOVE_CREATED", entityType: "TRAILER", entityId: String(trailerId), details: { fromSpotId, toSpotId }, ip: req.ip, facility_id: facilityId });
      emitUpdate("move_update", { type: "NEW_MOVE" });
      res.json({ success: true, move });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to create move order" });
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
      res.json({ success: true });
    } catch (e: any) {
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

      logAudit({ action: "TRAILER_DISPATCH", entityType: "TRAILER", entityId: String(trailerId), details: { spotId }, ip: req.ip });

      if (trailer?.drivers?.phone) {
        notify({ type: "TRAILER_DISPATCH", recipientType: "driver", recipientId: trailer.driver_id, data: { phone: trailer.drivers.phone, title: "Dispatched", body: `SkyYard: Your trailer ${trailer.plate} has been dispatched from Spot ${spotId || "Yard"}. Safe travels!` } });
      }

      emitUpdate("yard_update", { type: "DISPATCH" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Dispatch failed" });
    }
  });

  // Analytics Helper
  const getMetrics = async (start: string, end: string, facilityId: number) => {
    const { data: totalTrucks } = await db.from("walkin_registrations").select("id", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);
    const { data: completed } = await db.from("walkin_registrations").select("checked_in_at, checked_out_at").eq("facility_id", facilityId).eq("status", "completed").gte("created_at", start).lte("created_at", end);
    let avgTat = 0;
    if (completed && completed.length > 0) {
      const total = completed.reduce((s: number, r: any) => s + (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) / 60000, 0);
      avgTat = Math.round(total / completed.length);
    }
    const countRes = await db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", start).lte("created_at", end);
    return { totalTrucks: countRes.count || 0, avgTat };
  };

  app.get("/api/admin/analytics", async (req: any, res) => {
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

  // Smart Autofill for returning drivers
  app.get("/api/driver/lookup", async (req, res) => {
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
    const { data: driver } = await db.from("drivers").select("id, phone, name, default_carrier_id, default_plate, default_load_type").eq("id", req.session.driver_id).maybeSingle();
    res.json({ driver });
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

  app.get("/api/carrier/dashboard", requireCarrierAuth, async (req, res) => {
    const carrierId = (req as any).session.carrier_id;
    const { data: carrier } = await db.from("carriers").select("name").eq("id", carrierId).maybeSingle();
    const { count: activeTrucks } = await db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("carrier_name", carrier?.name || "__none__").not("status", "in", "(completed,cancelled)");
    const today = new Date().toISOString().split("T")[0];
    const { count: todayAppts } = await db.from("appointments").select("*", { count: "exact", head: true }).eq("carrier_id", carrierId).gte("start_time", `${today}T00:00:00`).lte("start_time", `${today}T23:59:59`);
    res.json({ activeTrucks: activeTrucks || 0, todayAppts: todayAppts || 0 });
  });

  app.get("/api/carrier/appointments", requireCarrierAuth, async (req: any, res) => {
    try {
      const { data: appts } = await db.from("appointments").select("*, spots(name)").eq("carrier_id", req.session.carrier_id).order("start_time", { ascending: false }).limit(50);
      res.json((appts || []).map((a: any) => ({ ...a, dock_name: a.spots?.name })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Detention & Maintenance Check
  cron.schedule("*/15 * * * *", async () => {
    const { data: facilities } = await db.from("facility_settings").select("facility_id, detention_threshold_hours");
    for (const f of facilities || []) {
      const threshold = f.detention_threshold_hours || 24;
      const cutoff = new Date(Date.now() - threshold * 3600 * 1000).toISOString();
      const { data: overdue } = await db.from("trailers").select("*").eq("facility_id", f.facility_id).eq("status", "IN_YARD").lt("checked_in_at", cutoff);
      for (const t of overdue || []) {
        await db.from("detention_records").insert({ facility_id: f.facility_id, trailer_id: t.id, carrier_name: t.carrier, start_time: t.checked_in_at, rate_per_hour: 50, status: "ACTIVE" });
        notify({ type: "DETENTION_WARNING", recipientType: "CARRIER", recipientId: null, data: { title: "Detention Alert", body: `Trailer ${t.plate} has exceeded free dwell time. Detention charges applying.`, plate: t.plate } });
      }
    }
  });

  app.get("/api/slots", async (req: any, res) => {
    const { date } = req.query;
    const facilityId = req.facilityId;
    const { data: docks } = await db.from("spots").select("id, name").eq("type", "DOCK").eq("facility_id", facilityId);
    const times = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];

    const slots = await Promise.all(times.map(async (time) => {
      const startTime = `${date}T${time}:00`;
      const { data: occupied } = await db.from("appointments").select("dock_id").eq("facility_id", facilityId).neq("status", "CANCELLED").eq("start_time", startTime);
      const occupiedIds = (occupied || []).map((d: any) => d.dock_id);
      const availableDocks = (docks || []).filter((d: any) => !occupiedIds.includes(d.id));
      return { time, dateTime: startTime, availableCount: availableDocks.length, docks: availableDocks };
    }));

    res.json(slots);
  });

  // AI-scored dock recommendation
  app.get("/api/slots/recommend", async (req: any, res) => {
    const { date, equipment_type, carrier_id } = req.query;
    const facilityId = req.facilityId;
    const availableSlots = [
      { dock_id: 1, start_time: "08:00" },
      { dock_id: 2, start_time: "10:00" },
    ];
    const scored = await Promise.all(availableSlots.map(s => scoreSlot({ ...s, date }, {
      equipmentType: equipment_type as string, carrierId: carrier_id as string, facilityId, date: date as string,
    })));
    const valid = scored.map((s, i) => ({ ...availableSlots[i], ...s })).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    if (valid.length > 0) (valid[0] as any).recommended = true;
    res.json(valid);
  });

  app.patch("/api/appointments/:id/reschedule", async (req: any, res) => {
    const { id } = req.params;
    const { slot_start, dock_door_id } = req.body;
    try {
      await db.from("appointments").update({ start_time: slot_start, dock_id: dock_door_id }).eq("id", id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Reschedule failed" });
    }
  });

  app.post("/api/admin/carriers/:id/booking-link", requireRole("superadmin", "ADMIN"), async (req, res) => {
    const { id } = req.params;
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.from("carriers").update({ booking_token: token, booking_token_expires: expiresAt }).eq("id", id);
    res.json({ booking_url: `/book/${token}` });
  });

  app.get("/book/:token", async (req, res) => {
    const { token } = req.params;
    const { data: carrier } = await db.from("carriers").select("*").eq("booking_token", token).gt("booking_token_expires", new Date().toISOString()).maybeSingle();
    if (!carrier) return res.status(404).send("Invalid or expired booking link");
    res.json(carrier);
  });

  app.get("/api/book/:token", async (req: any, res) => {
    const { token } = req.params;
    const { data: carrier } = await db.from("carriers").select("id, name, email, contact_phone").eq("booking_token", token).gt("booking_token_expires", new Date().toISOString()).maybeSingle();
    if (!carrier) return res.status(404).json({ error: "Invalid or expired booking link" });
    res.json({ carrier, facilityId: 1 });
  });

  app.post("/api/book/:token", async (req: any, res) => {
    const { token } = req.params;
    const { plate, driver_name, driver_phone, start_time, dock_id, load_type } = req.body;
    try {
      const { data: carrier } = await db.from("carriers").select("*").eq("booking_token", token).gt("booking_token_expires", new Date().toISOString()).maybeSingle();
      if (!carrier) return res.status(404).json({ error: "Invalid or expired booking link" });
      if (!plate || !start_time) return res.status(400).json({ error: "Plate and arrival time are required" });

      const blacklistHit = await checkBlacklist(1, plate, carrier.name);
      if (blacklistHit && blacklistHit.severity === "block") {
        logAudit({ action: "BLACKLIST_BLOCKED_BOOKING", entityType: "TRAILER", entityId: plate, details: { reason: blacklistHit.reason, carrier: carrier.name }, ip: req.ip, facility_id: 1, severity: "warning" });
        return res.status(403).json({ error: "BLACKLIST_BLOCK", reason: blacklistHit.reason });
      }

      let driverId: number | null = null;
      if (driver_phone) {
        await db.from("drivers").upsert({ phone: driver_phone, name: driver_name || null }, { onConflict: "phone", ignoreDuplicates: true });
        const { data: drv } = await db.from("drivers").select("id").eq("phone", driver_phone).maybeSingle();
        driverId = drv?.id || null;
      }

      const { data: newAppt, error } = await db.from("appointments").insert({
        plate, carrier: carrier.name, dock_id: dock_id || null, start_time, load_type: load_type || "standard",
        status: "SCHEDULED", source: "self_book", driver_id: driverId, carrier_id: carrier.id, facility_id: 1,
      }).select().single();
      if (error) throw error;

      logAudit({ action: "SELF_BOOKED", entityType: "APPOINTMENT", entityId: String(newAppt.id), details: { plate, carrier: carrier.name }, ip: req.ip, facility_id: 1 });
      emitUpdate("appointment_created", newAppt);

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

  app.get("/api/period-stats", async (req: any, res) => {
    const facilityId = req.facilityId;
    const days = Number(req.query.days) || 7;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await db.from("walkin_registrations").select("*", { count: "exact", head: true }).eq("facility_id", facilityId).gte("created_at", start);
    res.json({ days, totalTrucks: count || 0 });
  });

  app.post("/api/analytics/query", async (req: any, res) => {
    const { metric, groupBy } = req.body;
    const facilityId = req.facilityId;
    try {
      const { data } = await db.from("appointments").select("*").eq("facility_id", facilityId);
      res.json({ metric, groupBy, rows: data || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SVG Map Data Feed
  app.get("/api/admin/yard-map", async (req: any, res) => {
    const { data: spots } = await db.from("spots").select("*, trailers!trailers_spot_id_fkey(plate, carrier, check_in_time, status)").eq("facility_id", req.facilityId);
    const rows = (spots || []).map((s: any) => {
      const trailer = Array.isArray(s.trailers) ? s.trailers.find((t: any) => t.status !== "DISPATCHED") : null;
      const dwellMins = trailer ? Math.round((Date.now() - new Date(trailer.check_in_time).getTime()) / 60000) : null;
      const { trailers, ...rest } = s;
      return { ...rest, plate: trailer?.plate, carrier: trailer?.carrier, dwell_mins: dwellMins };
    });
    res.json(rows);
  });

  // SLA Tracking Worker
  cron.schedule("*/5 * * * *", async () => {
    const { data: active } = await db.from("appointments").select("id, load_type, checked_in_at, facility_id, carrier").eq("status", "CHECKED_IN").is("checked_out_at", null);
    for (const appt of active || []) {
      if (!appt.checked_in_at) continue;
      const { data: sla } = await db.from("facility_sla_rules").select("*").eq("facility_id", appt.facility_id).eq("load_type", appt.load_type).maybeSingle();
      if (!sla) continue;

      const elapsedMin = (Date.now() - new Date(appt.checked_in_at).getTime()) / 60000;
      const pct = (elapsedMin / sla.threshold_minutes) * 100;

      const checkNotified = async (level: string) => {
        const { count } = await db.from("audit_logs").select("*", { count: "exact", head: true }).eq("entityId", String(appt.id)).eq("action", `sla_${level}`).gt("timestamp", appt.checked_in_at);
        return count || 0;
      };

      if (pct >= 120 && (await checkNotified("critical")) === 0) {
        await db.from("audit_logs").insert({ facility_id: appt.facility_id, action: "sla_critical", entityType: "appointment", entityId: String(appt.id), details: { elapsed: Math.round(elapsedMin), threshold: sla.threshold_minutes }, severity: "critical" });
        notify({ type: "SLA_CRITICAL", recipientType: "ADMIN", recipientId: null, data: { title: "CRITICAL SLA BREACH", body: `${appt.carrier} has exceeded SLA by 20%+ at facility ${appt.facility_id}` } });
      } else if (pct >= 100 && (await checkNotified("breach")) === 0) {
        await db.from("audit_logs").insert({ facility_id: appt.facility_id, action: "sla_breach", entityType: "appointment", entityId: String(appt.id), details: { elapsed: Math.round(elapsedMin), threshold: sla.threshold_minutes }, severity: "warning" });
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

  app.post("/api/admin/payments", requireRole("superadmin", "ADMIN"), async (req: any, res) => {
    const { carrier_id, amount, payment_method, invoice_numbers } = req.body;
    const facilityId = req.facilityId;
    try {
      await db.from("payments").insert({ facility_id: facilityId, carrier_id, amount, payment_method, invoice_numbers: invoice_numbers || [] });
      if (invoice_numbers && invoice_numbers.length > 0) {
        await db.from("detention_records").update({ invoice_status: "paid" }).in("notes", invoice_numbers);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/carrier-balances", async (req: any, res) => {
    const facilityId = req.facilityId;
    try {
      const { data: records } = await db.from("detention_records").select("carrier_id, amount_owed, invoice_status, created_at").eq("facility_id", facilityId).neq("invoice_status", "paid");
      const byCarrier: Record<number, { balance: number; oldest_invoice: string | null }> = {};
      for (const r of records || []) {
        if (!r.carrier_id) continue;
        if (!byCarrier[r.carrier_id]) byCarrier[r.carrier_id] = { balance: 0, oldest_invoice: null };
        byCarrier[r.carrier_id].balance += Number(r.amount_owed || 0);
        if (r.invoice_status === "invoiced" && (!byCarrier[r.carrier_id].oldest_invoice || r.created_at < byCarrier[r.carrier_id].oldest_invoice!)) {
          byCarrier[r.carrier_id].oldest_invoice = r.created_at;
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

  app.post("/api/privacy/request", async (req: any, res) => {
    const { request_type, phone_or_email } = req.body;
    try {
      const isEmail = String(phone_or_email).includes("@");
      await db.from("data_subject_requests").insert({ facility_id: 1, request_type, requester_phone: isEmail ? null : phone_or_email, requester_email: isEmail ? phone_or_email : null });
      res.json({ success: true, message: "Request received. We will process it within 72 hours." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // In-app notification bell
  app.get("/api/notifications/inapp", async (req: any, res) => {
    const userType = (req.query.userType as string) || "ADMIN";
    try {
      const { data } = await db.from("in_app_notifications").select("*").eq("user_type", userType).is("read_at", null).order("created_at", { ascending: false }).limit(25);
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/inapp/:id/read", async (req: any, res) => {
    try {
      await db.from("in_app_notifications").update({ read_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/notifications/inapp/read-all", async (req: any, res) => {
    const userType = req.body?.userType || "ADMIN";
    try {
      await db.from("in_app_notifications").update({ read_at: new Date().toISOString() }).eq("user_type", userType).is("read_at", null);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GDPR admin queue
  app.get("/api/admin/data-requests", async (req: any, res) => {
    try {
      const { data } = await db.from("data_subject_requests").select("*").order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/admin/data-requests/:id", async (req: any, res) => {
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

  // Live activity feed
  app.get("/api/admin/gate-logs", async (req: any, res) => {
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
  app.get("/api/trailer/:plate/timeline", async (req: any, res) => {
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

  // No-Show Detection Worker
  cron.schedule("*/30 * * * *", async () => {
    logger.info("[Worker] Running No-Show Detection...");
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: noShows } = await db.from("appointments").select("id, carrier_id, carrier").eq("status", "SCHEDULED").lt("start_time", cutoff).is("checked_in_at", null);
    for (const appt of noShows || []) {
      await db.from("appointments").update({ status: "no_show", no_show_flag: true }).eq("id", appt.id);
      if (!appt.carrier_id) continue;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await db.from("appointments").select("*", { count: "exact", head: true }).eq("carrier_id", appt.carrier_id).eq("no_show_flag", true).gt("start_time", thirtyDaysAgo);
      if ((count || 0) >= 3) {
        await db.from("carriers").update({ flagged: true }).eq("id", appt.carrier_id);
        notify({ type: "CARRIER_FLAGGED", recipientType: "ADMIN", recipientId: null, data: { title: "Carrier Flagged - Excessive No-Shows", body: `Carrier ID ${appt.carrier_id} has ${count} no-shows in 30 days. Bookings now require approval.` } });
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
        await db.from("notifications_queue").update({ attempts: item.attempts + 1, error_msg: e.message }).eq("id", item.id);
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

