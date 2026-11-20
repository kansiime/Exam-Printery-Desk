"use client";
import { Shell } from "@/components/Shell";
import { ErrorNote, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { useData } from "@/lib/session";

type School = { id: number; name: string; district: string; contact: string; phone: string; candidates: number };

export default function SchoolsPage() {
  return <Shell allow={["owner"]}>{() => <Schools />}</Shell>;
}

function Schools() {
  const schools = useData<School[]>("schools");
  const { busy, run } = useAction();
  const list = schools.data ?? [];
  return (
    <>
      <ErrorNote error={schools.error} />
      <div><h2>Schools</h2><p className="sub">Sales people pick schools from this list. Keep candidate numbers up to date so the system can spot schools buying too few copies. The phone number receives the delivery confirmation SMS. If a school was added twice, merge it into the right one.</p></div>
      {list.length ? list.map((s) => (
        <div className="ticket" key={s.id}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const into = f.get("merge");
            if (into) {
              if (await run(() => api(`schools/${s.id}/merge`, { body: { into: Number(into) } }), "Schools merged")) schools.reload();
              return;
            }
            if (await run(() => api(`schools/${s.id}`, { method: "PATCH", body: { name: f.get("name"), district: f.get("district"), contact: f.get("contact"), phone: f.get("phone"), candidates: Number(f.get("candidates") || 0) } }), "School saved")) schools.reload();
          }}>
            <div className="grid3">
              <label>Name<input name="name" required defaultValue={s.name} /></label>
              <label>District<input name="district" defaultValue={s.district} /></label>
              <label>Candidates<input name="candidates" type="number" min={0} inputMode="numeric" defaultValue={s.candidates || ""} /></label>
              <label>Contact person<input name="contact" defaultValue={s.contact} /></label>
              <label>Phone<input name="phone" type="tel" defaultValue={s.phone} /></label>
              <label>Merge into (duplicates)<select name="merge" defaultValue=""><option value="">Don&apos;t merge</option>{list.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            </div>
            <div><button className="ghost" disabled={busy}>Save</button></div>
          </form>
        </div>
      )) : <div className="panel"><p className="empty">No schools yet. Sales people add them when they record their first visit.</p></div>}
    </>
  );
}
