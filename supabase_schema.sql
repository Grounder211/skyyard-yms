-- SkyYard YMS Supabase Schema
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)
--
-- STALE PARTIAL REFERENCE: this file only covers 15 of the live project's
-- ~44 tables and predates several columns in active use — it does not
-- reflect the current database and should not be used to provision a new
-- one as-is. It also has no RLS statements; the live project has
-- ENABLE ROW LEVEL SECURITY set on every table with zero policies defined,
-- which is correct default-deny for the anon/authenticated roles (only the
-- app's own service_role key, used exclusively server-side, can read or
-- write). Any table added here should get the same treatment:
--   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

-- 1. Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Facilities
CREATE TABLE IF NOT EXISTS facilities (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Facility Settings
CREATE TABLE IF NOT EXISTS facility_settings (
  facility_id INTEGER PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  timezone TEXT DEFAULT 'UTC',
  enable_auto_allocation BOOLEAN DEFAULT TRUE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  sms_provider TEXT DEFAULT 'TWILIO',
  sms_api_key TEXT,
  sms_sender_name TEXT DEFAULT 'SkyYard',
  digest_emails TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  role TEXT CHECK(role IN ('superadmin', 'ADMIN', 'GUARD', 'DRIVER', 'HOSTLER')),
  facility_id INTEGER REFERENCES facilities(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  default_carrier_id INTEGER,
  default_plate TEXT,
  default_load_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Driver OTP
CREATE TABLE IF NOT EXISTS driver_otp (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 7. Carriers
CREATE TABLE IF NOT EXISTS carriers (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT,
  contact_phone TEXT,
  api_key_hash TEXT,
  api_key_prefix TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Spots
CREATE TABLE IF NOT EXISTS spots (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('PARKING', 'DOCK')),
  status TEXT DEFAULT 'EMPTY',
  facility_id INTEGER REFERENCES facilities(id) DEFAULT 1,
  UNIQUE(name, facility_id)
);

-- 9. Trailers
CREATE TABLE IF NOT EXISTS trailers (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL,
  carrier TEXT,
  driver_license TEXT,
  status TEXT, -- 'IN_YARD', 'DOCKED', 'DISPATCHED'
  spot_id INTEGER REFERENCES spots(id),
  facility_id INTEGER REFERENCES facilities(id) DEFAULT 1,
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plate, facility_id)
);

-- 10. Walkin Registrations
CREATE TABLE IF NOT EXISTS walkin_registrations (
  id SERIAL PRIMARY KEY,
  driver_name TEXT,
  carrier_name TEXT,
  truck_plate TEXT,
  phone TEXT,
  trailer_number TEXT,
  po_number TEXT,
  load_type TEXT,
  direction TEXT,
  status TEXT DEFAULT 'pending', 
  assigned_dock_id INTEGER REFERENCES spots(id),
  driver_id INTEGER REFERENCES drivers(id),
  facility_id INTEGER REFERENCES facilities(id) DEFAULT 1,
  source TEXT DEFAULT 'walkin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  detention_flag BOOLEAN DEFAULT FALSE
);

-- 11. Appointments
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  plate TEXT,
  carrier TEXT,
  driver_license TEXT,
  dock_id INTEGER REFERENCES spots(id),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'SCHEDULED',
  checked_in_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  driver_id INTEGER REFERENCES drivers(id),
  carrier_id INTEGER REFERENCES carriers(id),
  facility_id INTEGER REFERENCES facilities(id) DEFAULT 1,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Move Orders
CREATE TABLE IF NOT EXISTS move_orders (
  id SERIAL PRIMARY KEY,
  trailer_id INTEGER REFERENCES trailers(id),
  from_spot_id INTEGER REFERENCES spots(id),
  to_spot_id INTEGER REFERENCES spots(id),
  assigned_to INTEGER REFERENCES users(id),
  status TEXT CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  facility_id INTEGER REFERENCES facilities(id) DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 13. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  facility_id INTEGER REFERENCES facilities(id),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Notifications Queue
CREATE TABLE IF NOT EXISTS notifications_queue (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_id INTEGER,
  channel TEXT NOT NULL, 
  payload_json JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. In-App Notifications
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_type TEXT,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Notification Preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER,
  user_type TEXT,
  event_type TEXT,
  channel_sms BOOLEAN DEFAULT FALSE,
  channel_email BOOLEAN DEFAULT FALSE,
  channel_inapp BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (user_id, user_type, event_type)
);

-- Initial Data
INSERT INTO facilities (id, name) VALUES (1, 'North Terminal') ON CONFLICT DO NOTHING;
INSERT INTO facility_settings (facility_id) VALUES (1) ON CONFLICT DO NOTHING;

-- RPC for Yard Stats
CREATE OR REPLACE FUNCTION get_yard_stats(f_id INTEGER)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'empty_parking', (SELECT COUNT(*) FROM spots WHERE facility_id = f_id AND type = 'PARKING' AND status = 'EMPTY'),
    'empty_docks', (SELECT COUNT(*) FROM spots WHERE facility_id = f_id AND type = 'DOCK' AND status = 'EMPTY'),
    'active_trailers', (SELECT COUNT(*) FROM trailers WHERE facility_id = f_id AND status != 'DISPATCHED')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
