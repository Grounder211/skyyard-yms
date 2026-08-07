import React, { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Sweden first — this app's primary market — then the rest of the EU/common
// carrier-origin countries, then everything else alphabetically by name.
const COUNTRIES = [
  { code: "SE", dial: "+46", name: "Sweden" },
  { code: "NO", dial: "+47", name: "Norway" },
  { code: "DK", dial: "+45", name: "Denmark" },
  { code: "FI", dial: "+358", name: "Finland" },
  { code: "DE", dial: "+49", name: "Germany" },
  { code: "PL", dial: "+48", name: "Poland" },
  { code: "NL", dial: "+31", name: "Netherlands" },
  { code: "BE", dial: "+32", name: "Belgium" },
  { code: "LT", dial: "+370", name: "Lithuania" },
  { code: "LV", dial: "+371", name: "Latvia" },
  { code: "EE", dial: "+372", name: "Estonia" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
  { code: "FR", dial: "+33", name: "France" },
  { code: "ES", dial: "+34", name: "Spain" },
  { code: "IT", dial: "+39", name: "Italy" },
  { code: "AT", dial: "+43", name: "Austria" },
  { code: "CH", dial: "+41", name: "Switzerland" },
  { code: "IE", dial: "+353", name: "Ireland" },
  { code: "PT", dial: "+351", name: "Portugal" },
  { code: "CZ", dial: "+420", name: "Czechia" },
  { code: "SK", dial: "+421", name: "Slovakia" },
  { code: "RO", dial: "+40", name: "Romania" },
  { code: "BG", dial: "+359", name: "Bulgaria" },
  { code: "HU", dial: "+36", name: "Hungary" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "CA", dial: "+1", name: "Canada" },
].sort((a, b) => (a.code === "SE" ? -1 : b.code === "SE" ? 1 : a.name.localeCompare(b.name)));

interface PhoneInputProps {
  countryCode: string;
  number: string;
  onChange: (countryCode: string, number: string) => void;
  required?: boolean;
  placeholder?: string;
}

// Reusable phone field: country dial-code picker (scrollable list, Sweden
// pinned first) + national number. Emits E.164 via toE164().
export default function PhoneInput({ countryCode, number, onChange, required, placeholder }: PhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = COUNTRIES.find((c) => c.dial === countryCode) || COUNTRIES[0];
  const filtered = COUNTRIES.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.dial.includes(search)
  );

  return (
    <div className="relative flex gap-2" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm font-mono shrink-0 hover:border-indigo-300 transition-all"
      >
        {selected.dial}
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      <input
        type="tel"
        required={required}
        value={number}
        onChange={(e) => onChange(countryCode, e.target.value.replace(/[^\d\s-]/g, ""))}
        placeholder={placeholder || "70 123 45 67"}
        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
      />

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country..."
              className="w-full px-3 py-2.5 text-sm border-b border-slate-100 focus:outline-none"
            />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && <p className="text-xs text-slate-400 px-3 py-4 text-center">No matches</p>}
              {filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    onChange(c.dial, number);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-slate-50 transition-colors ${c.dial === countryCode ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-700"}`}
                >
                  <span>{c.name}</span>
                  <span className="font-mono text-xs text-slate-400">{c.dial}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function toE164(countryCode: string, number: string): string {
  return `${countryCode}${number.replace(/\D/g, "")}`;
}
