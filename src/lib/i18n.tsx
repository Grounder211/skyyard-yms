import React, { createContext, useContext, useState } from "react";

export type Lang = "en" | "sv";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    // Nav
    "nav.dashboard": "Dashboard",
    "nav.network": "Network",
    "nav.calendar": "Calendar",
    "nav.gate": "Gate & Check-in",
    "nav.dispatch": "Dispatch",
    "nav.finance": "Financials",
    "nav.analytics": "Analytics",
    "nav.superadmin": "Superadmin",
    "nav.settings": "Settings",
    "nav.design": "Design System",
    "nav.logout": "Log out",
    // Login
    "login.title": "Terminal Sign-in",
    "login.subtitle": "Sign in with your SkyYard staff account.",
    "login.email": "Work email",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.demo": "Demo accounts",
    // Common
    "common.loading": "Loading...",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.submit": "Submit",
    "common.search": "Search",
    "common.close": "Close",
    "common.available": "Available",
    "common.occupied": "Occupied",
    "common.checkin": "Check in",
    "common.checkout": "Check out",
    "common.register": "Register",
    "common.plate": "Plate",
    "common.carrier": "Carrier",
    "common.driver": "Driver",
    "common.phone": "Phone",
    "common.status": "Status",
    "common.language": "Language",
    // Gate
    "gate.title": "Gate & Check-in",
    "gate.subtitle": "Verify scheduled arrivals, register walk-ins, and manage visitors on-site.",
    "gate.scheduled": "Scheduled arrivals",
    "gate.walkin": "Walk-in registration",
    "gate.visitors": "Active visitors",
    "gate.scan": "Scan or enter code",
    "gate.noSlots": "Yard full — driver will be queued and the manager notified.",
  },
  sv: {
    "nav.dashboard": "Översikt",
    "nav.network": "Nätverk",
    "nav.calendar": "Kalender",
    "nav.gate": "Grind & Incheckning",
    "nav.dispatch": "Utkörning",
    "nav.finance": "Ekonomi",
    "nav.analytics": "Analys",
    "nav.superadmin": "Superadmin",
    "nav.settings": "Inställningar",
    "nav.design": "Designsystem",
    "nav.logout": "Logga ut",
    "login.title": "Terminalinloggning",
    "login.subtitle": "Logga in med ditt SkyYard-personalkonto.",
    "login.email": "Jobb-e-post",
    "login.password": "Lösenord",
    "login.submit": "Logga in",
    "login.demo": "Demokonton",
    "common.loading": "Laddar...",
    "common.save": "Spara",
    "common.cancel": "Avbryt",
    "common.submit": "Skicka",
    "common.search": "Sök",
    "common.close": "Stäng",
    "common.available": "Ledig",
    "common.occupied": "Upptagen",
    "common.checkin": "Checka in",
    "common.checkout": "Checka ut",
    "common.register": "Registrera",
    "common.plate": "Reg.nr",
    "common.carrier": "Transportör",
    "common.driver": "Förare",
    "common.phone": "Telefon",
    "common.status": "Status",
    "common.language": "Språk",
    "gate.title": "Grind & Incheckning",
    "gate.subtitle": "Verifiera bokade ankomster, registrera drop-in och hantera besökare på plats.",
    "gate.scheduled": "Bokade ankomster",
    "gate.walkin": "Drop-in-registrering",
    "gate.visitors": "Aktiva besökare",
    "gate.scan": "Skanna eller ange kod",
    "gate.noSlots": "Gården är full — föraren köas och ansvarig chef meddelas.",
  },
};

interface I18nCtxShape {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nCtxShape>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("skyyard_lang") as Lang | null) : null;
    return saved === "sv" || saved === "en" ? saved : "en";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("skyyard_lang", l);
    } catch {}
  };

  const t = (key: string) => dict[lang][key] ?? dict.en[key] ?? key;

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
