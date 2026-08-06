import React, { useState, useEffect } from "react";
import { DollarSign, FileText, CheckCircle2, Clock, ShieldCheck, Wallet, ChevronRight, ArrowUpDown } from "lucide-react";

export default function AccountsReceivable() {
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
                      <p className="text-[11px] font-medium text-slate-400 mt-0.5">Carrier Site ID: {b.id.substring(0,8)}</p>
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
                   <button 
                    onClick={() => handleGenerateInvoice(b.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                   >
                     <FileText size={16} /> 
                     Invoice
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
