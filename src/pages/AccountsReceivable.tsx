import React, { useState, useEffect } from "react";
import { DollarSign, FileText, CheckCircle2, Clock, ShieldCheck, Wallet, ChevronRight, ArrowUpDown, Loader2, X } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const PAYMENT_METHODS = ["bank_transfer", "card", "check", "other"];

export default function AccountsReceivable() {
  const { toast } = useToast();
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBalances = async () => {
    const res = await fetch("/api/admin/carrier-balances");
    const data = await res.json();
    setBalances(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchBalances();
  }, []);

  const [payTarget, setPayTarget] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [payBusy, setPayBusy] = useState(false);

  const openPayment = (b: any) => {
    setPayTarget(b);
    setPayAmount(b.balance.toFixed(2));
    setPayMethod("bank_transfer");
    setSelectedInvoices([]);
  };

  const toggleInvoice = (num: string) => {
    setSelectedInvoices((prev) => (prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]));
  };

  const submitPayment = async () => {
    if (!payTarget || !payAmount || Number(payAmount) <= 0) {
      toast("Enter a valid payment amount", "error");
      return;
    }
    setPayBusy(true);
    // A full payment against the outstanding balance clears every detention
    // record behind it (invoiced or not) — a partial payment only settles
    // the specific invoices staff checked, since partial-allocating across
    // unspecified pending records would be ambiguous.
    const isFullPayment = Math.abs(Number(payAmount) - payTarget.balance) < 0.01;
    const res = await fetch("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier_id: payTarget.id,
        amount: Number(payAmount),
        payment_method: payMethod,
        invoice_numbers: isFullPayment ? payTarget.invoice_numbers : selectedInvoices,
        detention_record_ids: isFullPayment ? payTarget.detention_record_ids : [],
      }),
    });
    setPayBusy(false);
    if (res.ok) {
      toast(`Payment of $${Number(payAmount).toLocaleString()} recorded for ${payTarget.name}`, "success");
      setPayTarget(null);
      fetchBalances();
    } else {
      toast("Failed to record payment", "error");
    }
  };

  const handleGenerateInvoice = async (carrierId: number) => {
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date().toISOString();

    const res = await fetch("/api/admin/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrierId, periodStart, periodEnd })
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_${carrierId}.pdf`;
      a.click();
      fetchBalances();
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      <span className="text-xs font-bold uppercase tracking-widest">Loading Ledgers...</span>
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Accounts Receivable</h1>
          <p className="text-slate-500 font-medium">Manage carrier detention billing and outstanding balances.</p>
        </div>
        
        <div className="bg-indigo-600 text-white px-6 py-4 rounded-2xl flex items-center gap-6 shadow-lg shadow-indigo-100">
           <div className="flex flex-col mr-4">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Outstanding Total</span>
              <span className="text-2xl font-bold">
                ${balances.reduce((acc, curr) => acc + curr.balance, 0).toLocaleString()}
              </span>
           </div>
           <Wallet className="opacity-80" />
        </div>
      </div>

      <DisputesPanel />

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Carrier Identity</th>
              <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Balance</th>
              <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Status</th>
              <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-widest text-slate-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {balances.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50/50 transition-colors group">
                <td className="px-8 py-5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 font-bold flex items-center justify-center transition-all group-hover:bg-indigo-100 group-hover:text-indigo-600">
                      {b.name.substring(0,2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 leading-tight">{b.name}</p>
                      <p className="text-[11px] font-medium text-slate-400 mt-0.5">Carrier Site ID: {b.id}</p>
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <span className="text-lg font-bold text-slate-900">
                    ${b.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </td>
                <td className="px-8 py-5">
                  {b.oldest_invoice ? (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-100">
                      <Clock size={14} />
                      {Math.floor((Date.now() - new Date(b.oldest_invoice).getTime()) / 86400000)} Days Overdue
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold border border-teal-100">
                       <CheckCircle2 size={14} /> Current
                    </div>
                  ) }
                </td>
                <td className="px-8 py-5 text-right">
                   <div className="flex justify-end gap-2">
                     <button
                      onClick={() => openPayment(b)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-700 rounded-lg text-xs font-bold hover:bg-teal-600 hover:text-white transition-all shadow-sm"
                     >
                       <DollarSign size={16} />
                       Record payment
                     </button>
                     <button
                      onClick={() => handleGenerateInvoice(b.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                     >
                       <FileText size={16} />
                       Invoice
                     </button>
                   </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payTarget && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setPayTarget(null)}>
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg text-slate-900">Record payment</h3>
                <p className="text-sm text-slate-500">{payTarget.name}</p>
              </div>
              <button onClick={() => setPayTarget(null)} className="text-slate-400 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Amount</label>
                <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                <p className="text-[11px] text-slate-400">Outstanding balance: ${payTarget.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Payment method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{m.replace("_", " ")}</option>
                  ))}
                </select>
              </div>

              {payTarget.invoice_numbers?.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Settling invoice(s)</label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {payTarget.invoice_numbers.map((num: string) => (
                      <label key={num} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                        <input type="checkbox" checked={selectedInvoices.includes(num)} onChange={() => toggleInvoice(num)} />
                        <span className="font-mono">{num}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400">Checked invoices will be marked paid.</p>
                </div>
              )}

              <button onClick={submitPayment} disabled={payBusy} className="w-full bg-teal-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-teal-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {payBusy && <Loader2 size={14} className="animate-spin" />} Confirm payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DisputesPanel() {
  const { toast } = useToast();
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = () => {
    fetch("/api/admin/detention/disputes").then((r) => r.json()).then(setDisputes).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resolve = async (id: number, resolution: "upheld" | "waived") => {
    setBusyId(id);
    const res = await fetch(`/api/admin/detention/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution, notes: notes[id] || "" }),
    });
    setBusyId(null);
    if (res.ok) {
      toast(resolution === "waived" ? "Charge waived" : "Charge upheld", "success");
      load();
    } else {
      toast("Failed to resolve dispute", "error");
    }
  };

  if (loading || disputes.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
        <ShieldCheck size={14} /> Disputed detention charges ({disputes.length})
      </h3>
      {disputes.map((d) => (
        <div key={d.id} className="bg-white border border-amber-100 rounded-2xl p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-bold text-slate-900">{d.carrier_name} — {d.amount_owed} owed</p>
              <p className="text-xs text-slate-500 mt-1">{d.overtime_minutes} min over threshold · {new Date(d.start_time).toLocaleString()}</p>
              <p className="text-sm text-slate-600 mt-2 italic">"{d.dispute_reason}"</p>
            </div>
          </div>
          <textarea
            value={notes[d.id] || ""}
            onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
            placeholder="Resolution notes (optional) — shown to the carrier"
            rows={2}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
          />
          <div className="flex gap-2">
            <button onClick={() => resolve(d.id, "waived")} disabled={busyId === d.id} className="text-xs font-bold bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-50">
              Waive charge
            </button>
            <button onClick={() => resolve(d.id, "upheld")} disabled={busyId === d.id} className="text-xs font-bold bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-50">
              Uphold charge
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
