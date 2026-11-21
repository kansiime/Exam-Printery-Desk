"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { EmptyCard, ErrorNote, PageHead, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useData } from "@/lib/session";

type School = { id: number; name: string; district: string; contact: string; phone: string; candidates: number };

export default function SchoolsPage() {
  return <Shell allow={["owner"]}>{() => <Schools />}</Shell>;
}

function Schools() {
  const schools = useData<School[]>("schools");
  const [q, setQ] = useState("");
  const list = schools.data ?? [];
  const shown = list.filter((s) => (s.name + " " + s.district).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <ErrorNote error={schools.error} />
      <PageHead title="Schools" sub="Sales people pick schools from this list. Keep candidate numbers and phone numbers up to date: the phone receives the delivery confirmation SMS." />
      {list.length > 6 && <label>Find a school<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or district" /></label>}
      {shown.length ? shown.map((s) => <SchoolRow key={s.id} school={s} all={list} onSaved={schools.reload} />)
        : <EmptyCard icon="school">{list.length ? "No school matches that search." : "No schools yet. Sales people add them when they record their first visit."}</EmptyCard>}
    </>
  );
}

function SchoolRow({ school: s, all, onSaved }: { school: School; all: School[]; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const { busy, run } = useAction();
  return (
    <div className="ticket">
      <div className="head" style={{ alignItems: "center" }}>
        <div className="t"><h3>{s.name}</h3><p className="sub">{[s.district, s.contact, s.phone, s.candidates ? `${fmt(s.candidates)} candidates` : "candidates not set"].filter(Boolean).join(" · ")}</p></div>
        <button type="button" className="ghost" onClick={() => setEdit((x) => !x)}>{edit ? "Close" : "Edit"}</button>
      </div>
      {edit && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const into = f.get("merge");
          const ok = into
            ? await run(() => api(`schools/${s.id}/merge`, { body: { into: Number(into) } }), "Schools merged")
            : await run(() => api(`schools/${s.id}`, { method: "PATCH", body: { name: f.get("name"), district: f.get("district"), contact: f.get("contact"), phone: f.get("phone"), candidates: Number(f.get("candidates") || 0) } }), "School saved");
          if (ok) { setEdit(false); onSaved(); }
        }}>
          <div className="grid2">
            <label>Name<input name="name" required defaultValue={s.name} /></label>
            <label>District<input name="district" defaultValue={s.district} /></label>
            <label>Contact person<input name="contact" defaultValue={s.contact} /></label>
            <label>Phone<input name="phone" type="tel" defaultValue={s.phone} /></label>
            <label>Number of candidates<input name="candidates" type="number" min={0} inputMode="numeric" defaultValue={s.candidates || ""} /></label>
            <label>Added twice? Merge into<select name="merge" defaultValue=""><option value="">Don&apos;t merge</option>{all.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </div>
          <div><button disabled={busy}>Save</button></div>
        </form>
      )}
    </div>
  );
}
