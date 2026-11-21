"use client";
import { Shell } from "@/components/Shell";
import { CancelOrReport, DataTable, ErrorNote, Feed, Kpi, PageHead, Pill, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { fmt, ugx } from "@/lib/format";
import { Me, useData } from "@/lib/session";

type Summary = { store: { received: number; handed: number; held: number; unconfirmed: number; confirmed: number }; sales: { id: number; name: string; cash_collected: number; handed: number; cash_held: number }[] };
type Cash = { id: number; sales_name: string; amount: number; created_at: string; by: string };
type Handover = { id: number; amount: number; method: string; ref: string; confirmed_at: string | null; created_at: string; by: string };

export default function CashPage() {
  return <Shell allow={["store", "owner"]}>{(me) => <CashScreen me={me} />}</Shell>;
}

function CashScreen({ me }: { me: Me }) {
  const sum = useData<Summary>("summary/cash");
  const cash = useData<Cash[]>("cash");
  const handovers = useData<Handover[]>("handovers");
  const reload = () => { sum.reload(); cash.reload(); handovers.reload(); };
  const { busy, run } = useAction();
  const s = sum.data;
  const isStore = me.role === "store";
  return (
    <>
      <ErrorNote error={sum.error} />
      <PageHead title="Cash" sub={<>Sales people hand cash to the store keeper. The store keeper hands it to the owner, and the owner confirms. Mobile money goes straight to the business number.</>} />
      <div className="kpis">
        <Kpi label="With sales people" value={fmt(s?.sales.reduce((a, x) => a + x.cash_held, 0))} />
        <Kpi label="With store keeper" value={fmt(s?.store.held)} bad={(s?.store.held ?? 0) > 0} />
        <Kpi label="Waiting for owner" value={fmt(s?.store.unconfirmed)} />
        <Kpi label="Confirmed by owner" value={fmt(s?.store.confirmed)} />
      </div>
      <section className="block"><h3>Cash each sales person should hand in</h3>
        <DataTable<Summary["sales"][number]> rows={s?.sales ?? []} rowKey={(x) => x.id} empty="No sales people yet."
          columns={[
            { label: "Sales person", cell: (x) => <b>{x.name}</b> },
            { label: "Collected", cell: (x) => fmt(x.cash_collected) },
            { label: "Handed in", cell: (x) => fmt(x.handed) },
            { label: "Still to hand in", cell: (x) => <b>{fmt(x.cash_held)}</b>, bad: (x) => x.cash_held > 0 },
          ]} />
      </section>
      {isStore && (
        <div className="split">
          <section className="panel"><h3>Receive cash from a sales person</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget, f = new FormData(form);
              if (await run(() => api("cash", { body: { sales: Number(f.get("sales")), amount: Number(f.get("amount")) } }), "Cash received recorded")) { form.reset(); reload(); }
            }}>
              <label>Sales person<select name="sales" required>{(s?.sales ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} (owes {fmt(x.cash_held)})</option>)}</select></label>
              <label>Amount received (UGX)<input name="amount" type="number" min={1} inputMode="numeric" required /></label>
              <div><button disabled={busy}>Record cash received</button></div>
            </form>
          </section>
          <section className="panel"><h3>Hand cash to the owner</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget, f = new FormData(form);
              if (await run(() => api("handovers", { body: { amount: Number(f.get("amount")), method: f.get("method"), ref: f.get("ref") || "" } }), "Handover recorded. The owner will confirm.")) { form.reset(); reload(); }
            }}>
              <div className="grid2">
                <label>Amount (UGX)<input name="amount" type="number" min={1} inputMode="numeric" required placeholder={fmt(s?.store.held)} /></label>
                <label>How<select name="method"><option>Cash in hand</option><option>Mobile money</option><option>Bank deposit</option></select></label>
              </div>
              <label>Reference (optional)<input name="ref" placeholder="e.g. MoMo transaction ID or bank slip number" /></label>
              <div><button disabled={busy}>Record handover</button></div>
            </form>
          </section>
        </div>
      )}
      <section className="panel"><h3>Handovers to the owner</h3>
        <Feed empty="No handovers yet." items={(handovers.data ?? []).map((h) => ({
          key: h.id, at: h.created_at,
          text: <><b>{ugx(h.amount)}</b> · {h.method}{h.ref ? " · " + h.ref : ""} {h.confirmed_at ? <Pill cls="p-ready">Confirmed</Pill> : <Pill cls="p-fold">Not confirmed</Pill>}</>,
          act: <>{me.role === "owner" && !h.confirmed_at && <button type="button" className="ghost" onClick={() => run(() => api(`handovers/${h.id}/confirm`, { body: {} }), "Cash confirmed").then(reload)}>Confirm received</button>}<CancelOrReport type="handover" id={h.id} onDone={reload} /></>,
        }))} />
      </section>
      <section className="panel"><h3>Cash received from sales people</h3>
        <Feed empty="No cash received yet." items={(cash.data ?? []).map((c) => ({ key: c.id, at: c.created_at, text: <><b>{ugx(c.amount)}</b> from {c.sales_name} · received by {c.by}</>, act: <CancelOrReport type="cash" id={c.id} onDone={reload} /> }))} />
      </section>
    </>
  );
}
