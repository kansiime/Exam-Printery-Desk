"use client";
// A short step-by-step guide for each role, shown the first time someone signs in.
// They can open it again from the account menu (Help guide).
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { Me } from "@/lib/session";

type Step = { en: [string, string]; lg: [string, string] };

const STEPS: Record<Me["role"], Step[]> = {
  owner: [
    { en: ["Post print orders", "On Overview, open “New print order” when a school's exams are done. The printers are told straight away."],
      lg: ["Sindika okulagira okukuba", "Ku Ebiriwo, ggulawo “New print order” essomero bwe limala ebigezo. Abakubi bategeezebwa mangu ddala."] },
    { en: ["Watch the bell", "Every step comes to you with a loud alert: meter readings and photos, counts, sales, cash. Red siren means a fraud warning."],
      lg: ["Tunuulira akade", "Buli kintu kikutuukako n'eddoboozi ery'amaanyi: omuwendo ku kyuma, ebifaananyi, okubala, okutunda, ssente. Siren emmyufu kitegeeza okulabula ku bubbi."] },
    { en: ["Check fraud", "Fraud checks compares the copier meter, store counts, serial numbers, mobile money and GPS. Call this week's schools from there."],
      lg: ["Kebera obubbi", "Okukebera obubbi kugeraageranya ekyuma ekikuba, okubala kwa sitoowa, ennamba, mobile money ne GPS. Kubira amasomero ag'omu wiiki eno okuva awo."] },
    { en: ["Add your team", "On Team, make a login for each worker and give them their job. Set sales commission there too."],
      lg: ["Yongeramu abakozi", "Ku Abakozi, kolera buli mukozi erinnya ly'okuyingira omuwe omulimu gwe. Teekayo ne commission y'abatunzi."] },
    { en: ["See the money", "Reports shows profit, each sales person's commission, top schools and slow payers. Download it to Excel."],
      lg: ["Laba ssente", "Lipoota eraga amagoba, commission ya buli mutunzi, amasomero agasinga n'abasasula empola. Gikuume mu Excel."] },
  ],
  printer: [
    { en: ["New orders ring", "When the owner posts a print order, your phone rings and the order appears on Printing."],
      lg: ["Okulagira okupya kukuba ekide", "Nannyini bizinensi bw'asindika okulagira okukuba, essimu yo ekuba era kulabika ku Okukuba ebigezo."] },
    { en: ["Step 1: Start printing", "Read the copier meter, type it, and take a photo of the meter. Then tap “Start printing”."],
      lg: ["Omutendera 1: Tandika okukuba", "Soma omuwendo ku kyuma ekikuba, guwandiike, okube ekifaananyi ky'omuwendo. Oluvannyuma nyiga “Tandika okukuba”."] },
    { en: ["Step 2: Post printed", "When printing is finished: good copies, spoilt sheets, the meter reading after, and a photo. Tap “Post printed and send to store”."],
      lg: ["Omutendera 2: Teeka omuwendo", "Ng'omaze okukuba: kopi ennungi, empapula ezoonoonese, omuwendo ku kyuma oluvannyuma, n'ekifaananyi. Nyiga “Teeka omuwendo ogukubiddwa, osindike mu sitoowa”."] },
    { en: ["Other printing too", "Record any other work on the copier under “Other printing”, or the owner sees pages with no record."],
      lg: ["N'okukuba okulala", "Wandiika buli mulimu omulala ku kyuma wansi wa “Other printing”, oba nannyini bizinensi alaba empapula ezitaliiko kiwandiiko."] },
  ],
  store: [
    { en: ["Fold and count", "Printed exams appear under “Fold and count”. Count the copies yourself and type the number and serial range."],
      lg: ["Zinga obale", "Ebigezo ebikubiddwa birabika wansi wa “Fold and count”. Bala kopi ggwe kennyini owandiike omuwendo n'ennamba."] },
    { en: ["Issue copies", "Give copies to a sales person and record how many and which serial numbers. They accept them on their phone."],
      lg: ["Gaba kopi", "Wa omutunzi kopi owandiike mmeka n'ennamba ki. Bazikkiriza ku ssimu yaabwe."] },
    { en: ["Returns and cash", "Record unsold copies brought back, and cash handed to you. Then hand cash to the owner on the Cash screen."],
      lg: ["Ebizzibwayo ne ssente", "Wandiika kopi ezitatundiddwa ezizzibwayo, ne ssente zikuweereddwa. Oluvannyuma wa nannyini bizinensi ssente ku Ssente."] },
    { en: ["Confirm day closes", "Each evening, check each sales person's day close and tap “It matches” or “Doesn't match”."],
      lg: ["Kakasa okuggalawo olunaku", "Buli kawungeezi, kebera okuggalawo olunaku kwa buli mutunzi onyige “It matches” oba “Doesn't match”."] },
  ],
  sales: [
    { en: ["Accept your copies", "When the store issues you copies, count them and tap “I received”. If the number is wrong, tell the store keeper first."],
      lg: ["Kkiriza kopi zo", "Sitoowa bw'ekuwa kopi, zibale onyige “I received”. Omuwendo bwe guba omukyamu, sooka otegeeze omukuumi wa sitoowa."] },
    { en: ["Record every school", "Choose the school, copies, money paid (the price is set by the owner), delivery note number, and a photo of the signed note. Your location is saved too."],
      lg: ["Wandiika buli ssomero", "Londa essomero, kopi, ssente ezisasuddwa (bbeeyi eteekebwawo nannyini bizinensi), ennamba ya delivery note, n'ekifaananyi kya note essiddwako omukono. N'ekifo kyo kiterekebwa."] },
    { en: ["No network? Keep going", "Visits save on your phone and send by themselves when the network returns."],
      lg: ["Tewali network? Genda mu maaso", "Okukyalira kuterekebwa ku ssimu yo era kusindikibwa kwokka network bw'edda."] },
    { en: ["Close your day", "Each evening tap “Close my day” and type the copies and cash you really have. Hand cash and unsold copies to the store."],
      lg: ["Ggalawo olunaku", "Buli kawungeezi nyiga “Ggalawo olunaku lwange” owandiike kopi ne ssente by'olina ddala. Wa sitoowa ssente ne kopi ezitatundiddwa."] },
  ],
};

// Runyankore guides (draft: please have a fluent speaker check).
const NYN: Record<Me["role"], [string, string][]> = {
  owner: [
    ["Ohereze ebiragiro by'okucapa", "Aha Okureeba byona, iguraho “New print order” eishomero ku ryamara ebigyezo. Abacapa nibamanyisibwa ahonaaho."],
    ["Reeba akagambo k'obutumwa", "Buri kintu nikikuhikaho n'eiraka rihango: omubaro gw'ekyuma, ebishushani, okubara, okuguza, sente. Siren etukura neemanyisa obwiibi."],
    ["Shwijuma obwiibi", "Okushwijuma obwiibi nikugyeragyeranisa ekyuma ky'okucapa, okubara kwa sitoo, enamba, mobile money na GPS. Teera esimu amashomero ga wiiki egi kuruga aho."],
    ["Teeramu abakozi", "Aha Abakozi, kora buri mukozi eiziina ry'okutaaha, omuhe omurimo gwe. Teeraho na commission y'abaguzi."],
    ["Reeba sente", "Lipooti neeyoreka amagoba, commission ya buri muguzi, amashomero agakira n'abashashura mpora. Gyeihe omuri Excel."],
  ],
  printer: [
    ["Ebiragiro ebisya nibiteera", "Nyin'omurimo yaaherereza ekiragiro ky'okucapa, esimu yaawe neeteera kandi kikareebeka aha Okucapa ebigyezo."],
    ["Entambwe 1: Tandika okucapa", "Shoma omubaro aha kyuma ky'okucapa, ogwandiike, okwate ekishushani ky'omubaro. Reero kanda “Tandika okucapa”."],
    ["Entambwe 2: Teeraho omubaro", "Waamara okucapa: kopi nungi, empapura ezaashiisikire, omubaro gw'ekyuma bwanyima, n'ekishushani. Kanda “Teeraho omubaro gw'ebicapirwe, obyohereze omu sitoo”."],
    ["N'okucapa okundi", "Handiika buri murimo ogundi aha kyuma ahansi ya “Other printing”, nikwo nyin'omurimo atareeba empapura ezitarikuhandiikwa."],
  ],
  store: [
    ["Kunja obare", "Ebigyezo ebicapirwe nibireebeka ahansi ya “Fold and count”. Bara kopi wenka, ohandiike omubaro n'enamba."],
    ["Ha kopi", "Ha omuguzi kopi, ohandiike zingahi n'enamba ki. Nibazakira aha simu yaabo."],
    ["Ebigarukire na sente", "Handiika kopi ezitaguzirwe ezigarukire, na sente ezakuhairwe. Reero ha nyin'omurimo sente aha Sente."],
    ["Hamya okukinga eizooba", "Buri kyeggyezi, shwijuma okukinga eizooba kwa buri muguzi, okande “It matches” nari “Doesn't match”."],
  ],
  sales: [
    ["Yakira kopi zaawe", "Sitoo yaakuha kopi, zibare, okande “I received”. Omubaro gwaaba gutari gwo, banza ogambire omurinzi wa sitoo."],
    ["Handiika buri ishomero", "Toorana eishomero, kopi, sente ezishashuirwe (bbeeyi eteekwaho nyin'omurimo), enamba ya delivery note, n'ekishushani kya note eteiretwaho omukono. N'ahu oriho nihabikwa."],
    ["Tihariho network? Komeza", "Engyendo nizibikwa aha simu yaawe, zikeyohereza zonka network yagaruka."],
    ["Kinga eizooba ryawe", "Buri kyeggyezi kanda “Kinga eizooba ryangye” ohandiike kopi na sente ebi oine butoosha. Ha sitoo sente na kopi ezitaguzirwe."],
  ],
};

export function Guide({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const { lang, t } = useT();
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);
  if (!open) return null;
  const steps = STEPS[me.role];
  const [title, text] = lang === "nyn" ? (NYN[me.role][i] ?? steps[i].en) : steps[i][lang];
  const last = i === steps.length - 1;
  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label={t("Help guide")}>
      <div className="guide">
        <div className="mini">{t("Help guide")} · {i + 1} / {steps.length}</div>
        <h2>{title}</h2>
        <p style={{ margin: 0 }}>{text}</p>
        <div className="dots">{steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="row">
          {i > 0 && <button type="button" className="ghost" onClick={() => setI(i - 1)}>{t("Back")}</button>}
          <span className="grow" />
          <button type="button" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? t("Got it") : t("Next")}</button>
        </div>
      </div>
    </div>
  );
}

/** Opens the guide automatically the first time this person signs in on this phone. */
export function useFirstTimeGuide(me: Me | null) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!me) return;
    try { if (!localStorage.getItem(`guide-seen-${me.id}`)) setOpen(true); } catch {}
  }, [me]);
  const close = () => { setOpen(false); try { if (me) localStorage.setItem(`guide-seen-${me.id}`, "1"); } catch {} };
  return { open, show: () => setOpen(true), close };
}
