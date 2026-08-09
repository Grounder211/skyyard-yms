import React, { useEffect, useState } from "react";
import { Globe2, ShieldBan, UploadCloud, Building2, Trash2, Loader2, CheckCircle2, AlertTriangle, Truck, Link2, Copy, Package, Pencil, X } from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import PhoneInput, { toE164 } from "../components/PhoneInput";

type Tab = "facilities" | "blacklist" | "import" | "carriers" | "fleet";

export default function SuperadminConsole() {
  const [tab, setTab] = useState<Tab>("facilities");

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-20">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Superadmin Console</h1>
        <p className="text-slate-500 font-medium">Manage facilities network-wide, enforce blacklists, and bulk import schedules.</p>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit">
        <TabButton active={tab === "facilities"} onClick={() => setTab("facilities")} icon={<Building2 size={14} />} label="Facilities" />
        <TabButton active={tab === "carriers"} onClick={() => setTab("carriers")} icon={<Truck size={14} />} label="Carriers" />
        <TabButton active={tab === "fleet"} onClick={() => setTab("fleet")} icon={<Package size={14} />} label="Fleet" />
        <TabButton active={tab === "blacklist"} onClick={() => setTab("blacklist")} icon={<ShieldBan size={14} />} label="Blacklist" />
        <TabButton active={tab === "import"} onClick={() => setTab("import")} icon={<UploadCloud size={14} />} label="Bulk import" />
      </div>

      {tab === "facilities" && <FacilitiesTab />}
      {tab === "carriers" && <CarriersTab />}
      {tab === "fleet" && <FleetTab />}
      {tab === "blacklist" && <BlacklistTab />}
      {tab === "import" && <BulkImportTab />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${active ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
    >
      {icon} {label}
    </button>
  );
}

function FacilitiesTab() {
  const { toast } = useToast();
  const [facilities, setFacilities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<number | null>(null);

  const load = () => {
    fetch("/api/superadmin/facilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFacilities(Array.isArray(data) ? data : []))
      .catch(() => setFacilities([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const switchTo = async (id: number) => {
    setSwitching(id);
    const res = await fetch("/api/superadmin/facilities/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId: id }),
    });
    setSwitching(null);
    if (res.ok) {
      toast("Active facility switched — dashboards now reflect this site.", "success");
    } else {
      toast("Only superadmins can switch facilities.", "error");
    }
  };

  if (loading) return <p className="text-sm text-slate-400 py-8">Loading facilities...</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {facilities.length === 0 && <p className="text-sm text-slate-400">No facilities found.</p>}
      {facilities.map((f) => (
        <div key={f.id} className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Globe2 size={18} />
            </div>
            <p className="font-bold text-slate-900">{f.name}</p>
          </div>
          <div className="flex gap-4 text-sm">
            <div>
              <p className="text-xl font-bold text-slate-900">{f.active_trucks ?? 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Active trucks</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{f.todays_appts ?? 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Today's appts</p>
            </div>
          </div>
          <button
            onClick={() => switchTo(f.id)}
            disabled={switching === f.id}
            className="w-full bg-slate-900 text-white text-xs font-bold py-2.5 rounded-xl hover:bg-indigo-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {switching === f.id && <Loader2 size={12} className="animate-spin" />} Switch to this facility
          </button>
        </div>
      ))}
    </div>
  );
}

function CarriersTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "", contact_phone: "" });
  const [phoneCountry, setPhoneCountry] = useState("+46");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState<number | null>(null);

  const load = () => {
    fetch("/api/admin/carriers")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/admin/carriers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) {
      toast("Carrier added", "success");
      setForm({ name: "", email: "", password: "", contact_phone: "" });
      setPhoneNumber("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to add carrier", "error");
    }
  };

  const generateLink = async (id: number) => {
    setLinkBusy(id);
    const res = await fetch(`/api/admin/carriers/${id}/booking-link`, { method: "POST" });
    setLinkBusy(null);
    if (res.ok) {
      const { booking_url } = await res.json();
      const fullUrl = `${window.location.origin}${booking_url}`;
      navigator.clipboard?.writeText(fullUrl).catch(() => {});
      toast(`Booking link copied: ${fullUrl}`, "success");
      load();
    } else {
      toast("Failed to generate link", "error");
    }
  };

  const unflag = async (id: number) => {
    setLinkBusy(id);
    const res = await fetch(`/api/admin/carriers/${id}/unflag`, { method: "POST" });
    setLinkBusy(null);
    if (res.ok) {
      toast("Carrier unflagged — self-service booking restored", "success");
      load();
    } else {
      toast("Failed to unflag carrier", "error");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 h-fit">
        <p className="text-sm font-bold text-slate-900">Add carrier</p>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Name</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Email (portal login)</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Password (portal login)</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Contact phone</label>
          <PhoneInput
            countryCode={phoneCountry}
            number={phoneNumber}
            onChange={(cc, n) => {
              setPhoneCountry(cc);
              setPhoneNumber(n);
              setForm({ ...form, contact_phone: toE164(cc, n) });
            }}
          />
        </div>
        <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />} Add carrier
        </button>
      </form>

      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-8 text-center">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-8 text-center">No carriers yet — add one to enable self-service pre-booking links.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Email</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Booking link</th>
                <th className="px-5 py-3" />
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => {
                const active = r.booking_token && r.booking_token_expires && new Date(r.booking_token_expires) > new Date();
                return (
                  <tr key={r.id}>
                    <td className="px-5 py-3 text-sm font-bold text-slate-800 flex items-center gap-2">
                      {r.name}
                      {r.flagged && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700">Flagged</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{r.email || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${active ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                        {active ? "Active" : "None"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => generateLink(r.id)} disabled={linkBusy === r.id} className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-xs font-bold ml-auto disabled:opacity-50">
                        {linkBusy === r.id ? <Loader2 size={12} className="animate-spin" /> : active ? <Copy size={12} /> : <Link2 size={12} />}
                        {active ? "Copy link" : "Generate link"}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.flagged && (
                        <button onClick={() => unflag(r.id)} disabled={linkBusy === r.id} className="text-teal-600 hover:text-teal-800 text-xs font-bold disabled:opacity-50">
                          Unflag
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const EQUIPMENT_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];

function FleetTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [carriers, setCarriers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const emptyForm = { carrier_id: "", plate: "", equipment_type: "standard", max_weight_kg: "", max_volume_m3: "", registration_country: "SE", inspection_expiry: "" };
  const [form, setForm] = useState<any>(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = () => {
    Promise.all([
      fetch("/api/admin/vehicles").then((r) => r.json()),
      fetch("/api/admin/carriers").then((r) => r.json()),
    ])
      .then(([vehicles, carrierList]) => {
        setRows(Array.isArray(vehicles) ? vehicles : []);
        setCarriers(Array.isArray(carrierList) ? carrierList : []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const url = editingId ? `/api/admin/vehicles/${editingId}` : "/api/admin/vehicles";
    const method = editingId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        carrier_id: form.carrier_id || null,
        max_weight_kg: form.max_weight_kg ? Number(form.max_weight_kg) : null,
        max_volume_m3: form.max_volume_m3 ? Number(form.max_volume_m3) : null,
        inspection_expiry: form.inspection_expiry || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast(editingId ? "Vehicle updated" : "Vehicle registered", "success");
      setForm(emptyForm);
      setEditingId(null);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to save vehicle", "error");
    }
  };

  const startEdit = (v: any) => {
    setEditingId(v.id);
    setForm({
      carrier_id: v.carrier_id || "", plate: v.plate, equipment_type: v.equipment_type || "standard",
      max_weight_kg: v.max_weight_kg || "", max_volume_m3: v.max_volume_m3 || "",
      registration_country: v.registration_country || "SE", inspection_expiry: v.inspection_expiry ? v.inspection_expiry.split("T")[0] : "",
    });
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this vehicle from the fleet registry?")) return;
    const res = await fetch(`/api/admin/vehicles/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Vehicle removed", "success");
      load();
    }
  };

  const expiringSoon = (dateStr: string | null) => {
    if (!dateStr) return false;
    const days = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days < 30;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 h-fit">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900">{editingId ? "Edit vehicle" : "Register vehicle"}</p>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Carrier</label>
          <select value={form.carrier_id} onChange={(e) => setForm({ ...form, carrier_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <option value="">Unassigned</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Plate</label>
          <input required value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Equipment type</label>
          <select value={form.equipment_type} onChange={(e) => setForm({ ...form, equipment_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
            {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Max weight (kg)</label>
            <input type="number" value={form.max_weight_kg} onChange={(e) => setForm({ ...form, max_weight_kg: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Max volume (m³)</label>
            <input type="number" value={form.max_volume_m3} onChange={(e) => setForm({ ...form, max_volume_m3: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Inspection expiry</label>
          <input type="date" value={form.inspection_expiry} onChange={(e) => setForm({ ...form, inspection_expiry: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />} {editingId ? "Save changes" : "Register vehicle"}
        </button>
      </form>

      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-8 text-center">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-8 text-center">No vehicles registered yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Plate</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Carrier</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Equipment</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Capacity</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Inspection</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="px-5 py-3 text-sm font-bold text-slate-800">{v.plate}</td>
                  <td className="px-5 py-3 text-sm text-slate-500">{v.carrier_name || "—"}</td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{v.equipment_type}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {v.max_weight_kg ? `${v.max_weight_kg}kg` : "—"}{v.max_volume_m3 ? ` / ${v.max_volume_m3}m³` : ""}
                  </td>
                  <td className="px-5 py-3">
                    {v.inspection_expiry ? (
                      <span className={`text-xs font-bold flex items-center gap-1 ${expiringSoon(v.inspection_expiry) ? "text-amber-600" : "text-slate-500"}`}>
                        {expiringSoon(v.inspection_expiry) && <AlertTriangle size={11} />} {new Date(v.inspection_expiry).toLocaleDateString()}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => startEdit(v)} className="text-slate-400 hover:text-indigo-600">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => remove(v.id)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BlacklistTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ entity_type: "plate", entity_value: "", reason: "", severity: "warning", expires_at: "" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/superadmin/blacklist")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/superadmin/blacklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, expires_at: form.expires_at || null }),
    });
    setBusy(false);
    if (res.ok) {
      toast("Blacklist entry added", "success");
      setForm({ entity_type: "plate", entity_value: "", reason: "", severity: "warning", expires_at: "" });
      load();
    } else {
      toast("Failed to add entry", "error");
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/superadmin/blacklist/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Entry removed", "success");
      load();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 h-fit">
        <p className="text-sm font-bold text-slate-900">Add entry</p>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Type</label>
          <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <option value="plate">Plate</option>
            <option value="carrier">Carrier</option>
            <option value="driver_name">Driver name</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Value</label>
          <input required value={form.entity_value} onChange={(e) => setForm({ ...form, entity_value: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Reason</label>
          <input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Severity</label>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <option value="warning">Warning (flag at gate)</option>
            <option value="block">Block (deny entry)</option>
          </select>
        </div>
        <button type="submit" disabled={busy} className="w-full bg-red-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-red-700 transition-all disabled:opacity-50">
          Add to blacklist
        </button>
      </form>

      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-8 text-center">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-8 text-center">No blacklist entries.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Value</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Reason</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Severity</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 text-sm text-slate-600">{r.entity_type}</td>
                  <td className="px-5 py-3 text-sm font-bold text-slate-800">{r.entity_value}</td>
                  <td className="px-5 py-3 text-sm text-slate-500">{r.reason}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 w-fit ${r.severity === "block" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      <AlertTriangle size={10} /> {r.severity}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BulkImportTab() {
  const { toast } = useToast();
  const [csv, setCsv] = useState("plate,carrier,date,time\nABC123,Nordic Freight,2026-08-10,09:00\nXYZ789,Baltic Lines,2026-08-10,11:00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const parsed = React.useMemo(() => {
    const lines = csv.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const row: any = {};
      headers.forEach((h, i) => (row[h] = cells[i]));
      return row;
    });
  }, [csv]);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsed }),
      });
      const data = await res.json();
      setResult(data);
      if (res.ok) toast(`Imported ${data.count} appointments`, "success");
      else toast(data.error || "Import failed", "error");
    } catch {
      toast("Network error", "error");
    }
    setBusy(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4">
        <p className="text-sm font-bold text-slate-900">Paste CSV (columns: plate, carrier, date, time)</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
        <button onClick={submit} disabled={busy || parsed.length === 0} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />} Import {parsed.length} appointments
        </button>
        {result?.success && (
          <p className="text-sm text-teal-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {result.count} rows imported.
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview ({parsed.length} rows)</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {parsed.map((row, i) => (
            <div key={i} className="px-5 py-2.5 border-b border-slate-50 text-xs text-slate-600 flex justify-between">
              <span className="font-bold text-slate-800">{row.plate}</span>
              <span>{row.carrier}</span>
              <span>{row.date} {row.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
