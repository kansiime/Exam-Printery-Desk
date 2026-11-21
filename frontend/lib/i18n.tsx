"use client";
// Language switch. English is the default; Luganda covers menus, buttons, page titles and the
// role guides. Anything not in the list stays in English.
// PLEASE have a fluent Luganda speaker check these: edit the right-hand side only.
import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "lg";

const LG: Record<string, string> = {
  // menus and pages
  "Overview": "Ebiriwo",
  "Fraud checks": "Okukebera obubbi",
  "Printing": "Okukuba ebigezo",
  "Store": "Sitoowa",
  "Debts": "Amabanja",
  "Cash": "Ssente",
  "Schools": "Amasomero",
  "Team": "Abakozi",
  "Reports": "Lipoota",
  "Pilot week": "Wiiki ey'okugezesa",
  "QR stickers": "Obupapula bwa QR",
  "My field work": "Omulimu gwange ebweru",
  "My account": "Akawunti yange",
  "Home": "Awaka", "Checks": "Okukebera", "Print": "Kuba", "Field": "Ebweru",
  // account menu
  "My account and password": "Akawunti n'ekigambo ky'ekyama",
  "Help guide": "Obuyambi",
  "Report a problem or idea": "Tegeeza ekizibu oba ekirowoozo",
  "Sign out": "Fuluma",
  "Language": "Olulimi",
  // sign in
  "Welcome back": "Tukwanirizza nate",
  "Sign in": "Yingira",
  "Username": "Erinnya ly'okuyingira",
  "Password": "Ekigambo ky'ekyama",
  "Forgot your password?": "Weerabidde ekigambo ky'ekyama?",
  "Sign in with the username and password the owner gave you.": "Yingira n'erinnya n'ekigambo ky'ekyama nannyini bizinensi bye yakuwa.",
  // main buttons
  "Start printing": "Tandika okukuba",
  "Post printed and send to store": "Teeka omuwendo ogukubiddwa, osindike mu sitoowa",
  "Confirm count": "Kakasa omuwendo",
  "Issue copies": "Gaba kopi",
  "Receive returns": "Funa kopi ezizzibwayo",
  "Save visit": "Tereka okukyalira essomero",
  "Close my day": "Ggalawo olunaku lwange",
  "Record payment": "Wandiika okusasula",
  "Record cash received": "Wandiika ssente ezifuniddwa",
  "Record handover": "Wandiika ssente eziweereddwa",
  "Send to printer": "Sindika eri omukubi",
  "Save details": "Tereka ebikukwatako",
  "Change password": "Kyusa ekigambo ky'ekyama",
  "Send": "Sindika",
  "Notifications": "Obubaka",
  "OK, got it": "Kale, ntegedde",
  "Next": "Ekiddako",
  "Back": "Emabega",
  "Got it": "Ntegedde",
};

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }>({ lang: "en", setLang: () => {}, t: (s) => s });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { try { if (localStorage.getItem("lang") === "lg") setLangState("lg"); } catch {} }, []);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("lang", l); } catch {} document.documentElement.lang = l === "lg" ? "lg" : "en"; };
  const t = (s: string) => (lang === "lg" ? LG[s] ?? s : s);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);

export function LanguagePicker() {
  const { lang, setLang, t } = useT();
  return (
    <label>{t("Language")}
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        <option value="en">English</option>
        <option value="lg">Luganda</option>
      </select>
    </label>
  );
}
