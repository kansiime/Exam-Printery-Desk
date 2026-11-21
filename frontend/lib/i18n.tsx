"use client";
// Language switch. English is the default; Luganda and Runyankore cover menus, buttons, page
// titles and the role guides. Anything not in a list stays in English.
// PLEASE have fluent speakers check both lists: edit the right-hand side only.
import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "lg" | "nyn";

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

const NYN: Record<string, string> = {
  // menus and pages
  "Overview": "Okureeba byona",
  "Fraud checks": "Okushwijuma obwiibi",
  "Printing": "Okucapa ebigyezo",
  "Store": "Sitoo",
  "Debts": "Amabanja",
  "Cash": "Sente",
  "Schools": "Amashomero",
  "Team": "Abakozi",
  "Reports": "Lipooti",
  "Pilot week": "Wiiki y'okugyezaho",
  "QR stickers": "Obupapura bwa QR",
  "My field work": "Omurimo gwangye aheeru",
  "My account": "Akawunti yangye",
  "My schools that owe": "Amashomero gangye agarimu ebanja",
  "Home": "Ahaka", "Checks": "Okushwijuma", "Print": "Capa", "Field": "Aheeru",
  // account menu
  "My account and password": "Akawunti n'ekigambo eky'ekyama",
  "Help guide": "Obuhwezi",
  "Report a problem or idea": "Gamba ekizibu nari ekiteekateeko",
  "Sign out": "Shohoka",
  "Language": "Orurimi",
  // sign in
  "Welcome back": "Twakwakiira kandi",
  "Sign in": "Taaha",
  "Username": "Eiziina ry'okutaaha",
  "Password": "Ekigambo eky'ekyama",
  "Forgot your password?": "Wayebwa ekigambo eky'ekyama?",
  "Sign in with the username and password the owner gave you.": "Taaha n'eiziina hamwe n'ekigambo eky'ekyama ebi nyin'omurimo yakuhaire.",
  // main buttons
  "Start printing": "Tandika okucapa",
  "Post printed and send to store": "Teeraho omubaro gw'ebicapirwe, obyohereze omu sitoo",
  "Confirm count": "Hamya omubaro",
  "Issue copies": "Ha kopi",
  "Receive returns": "Yakira kopi ezigarukire",
  "Save visit": "Bika orugyendo rw'eishomero",
  "Close my day": "Kinga eizooba ryangye",
  "Record payment": "Handiika okushashura",
  "Record cash received": "Handiika sente ezaakirwe",
  "Record handover": "Handiika sente ezahairwe",
  "Send to printer": "Ohereza ow'okucapa",
  "Save details": "Bika ebikukwataho",
  "Change password": "Hindura ekigambo eky'ekyama",
  "Send": "Ohereza",
  "Notifications": "Obutumwa",
  "OK, got it": "Ego, naayetegyereza",
  "Next": "Ekirikukurataho",
  "Back": "Garuka",
  "Got it": "Naayetegyereza",
};

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }>({ lang: "en", setLang: () => {}, t: (s) => s });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { try { const l = localStorage.getItem("lang"); if (l === "lg" || l === "nyn") setLangState(l); } catch {} }, []);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("lang", l); } catch {} document.documentElement.lang = l; };
  const t = (s: string) => (lang === "lg" ? LG[s] ?? s : lang === "nyn" ? NYN[s] ?? s : s);
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
        <option value="nyn">Runyankore</option>
      </select>
    </label>
  );
}
