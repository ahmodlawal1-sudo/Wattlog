import React, { useState, useEffect, useMemo } from "react";
import { Zap, Fuel, Battery, Plus, X, TrendingUp, Clock, Wallet, Heart } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

// ---------- Helpers ----------
const todayKey = () => new Date().toISOString().slice(0, 10);
const fmtNaira = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const fmtHrs = (h) => `${Number(h || 0).toFixed(1)}h`;
const dayLabel = (key) => {
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric" });
};

const initialState = {
  gridEvents: [], // {id, date, type: 'on'|'off', time: 'HH:MM'}
  genLogs: [],     // {id, date, hours, fuelLiters, fuelCost}
  meterLogs: [],   // {id, date, units, cost}
};

export default function EnergyTracker() {
  const [data, setData] = useState(initialState);
  const [gridOn, setGridOn] = useState(null); // null = unknown, true/false
  const [activeModal, setActiveModal] = useState(null); // 'gen' | 'meter' | 'support' | null
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [piUser, setPiUser] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState("idle"); // idle | authenticating | paying | success | error

  // Initialize Pi SDK if running inside Pi Browser (script tag loaded in index.html)
  useEffect(() => {
    if (typeof window !== "undefined" && window.Pi) {
      try {
        window.Pi.init({ version: "2.0", sandbox: true }); // set sandbox: false for production/mainnet
      } catch (e) {
        console.warn("Pi SDK init skipped (not running in Pi Browser)", e);
      }
    }
  }, []);

  // Pi authentication — required before a payment can be created
  const authenticateWithPi = async () => {
    if (!window.Pi) {
      showToast("Open this app inside Pi Browser to use Pi payments");
      return null;
    }
    setPaymentStatus("authenticating");
    try {
      const scopes = ["payments"];
      const onIncompletePaymentFound = (payment) => {
        console.log("Incomplete payment found:", payment);
      };
      const authResult = await window.Pi.authenticate(scopes, onIncompletePaymentFound);
      setPiUser(authResult.user);
      setPaymentStatus("idle");
      return authResult.user;
    } catch (e) {
      console.error("Pi auth failed", e);
      setPaymentStatus("error");
      showToast("Pi sign-in failed");
      return null;
    }
  };

  // Triggers a small Pi payment ("tip") — exercises the full approve/complete flow
  const sendSupportPayment = async (amount = 0.01) => {
    let user = piUser;
    if (!user) {
      user = await authenticateWithPi();
      if (!user) return;
    }

    if (!window.Pi) {
      showToast("Pi SDK not available — open inside Pi Browser");
      return;
    }

    setPaymentStatus("paying");

    const paymentData = {
      amount,
      memo: "Support Wattlog",
      metadata: { reason: "tip", app: "wattlog" },
    };

    const callbacks = {
      onReadyForServerApproval: async (paymentId) => {
        try {
          await fetch("/api/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId }),
          });
        } catch (e) {
          console.error("Approve call failed", e);
          setPaymentStatus("error");
          showToast("Payment approval failed");
        }
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        try {
          await fetch("/api/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId, txid }),
          });
          setPaymentStatus("success");
          showToast("Thank you for supporting Wattlog!");
          setActiveModal(null);
        } catch (e) {
          console.error("Complete call failed", e);
          setPaymentStatus("error");
          showToast("Payment completion failed");
        }
      },
      onCancel: (paymentId) => {
        console.log("Payment cancelled", paymentId);
        setPaymentStatus("idle");
      },
      onError: (error, payment) => {
        console.error("Payment error", error, payment);
        setPaymentStatus("error");
        showToast("Payment error — please try again");
      },
    };

    try {
      window.Pi.createPayment(paymentData, callbacks);
    } catch (e) {
      console.error("createPayment failed", e);
      setPaymentStatus("error");
      showToast("Could not start payment");
    }
  };


  // Load (browser localStorage — persists per-device in the standalone app)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("energy-tracker-data");
      if (raw) {
        const parsed = JSON.parse(raw);
        setData({ ...initialState, ...parsed });
        const events = parsed.gridEvents || [];
        if (events.length) {
          setGridOn(events[events.length - 1].type === "on");
        }
      }
    } catch (e) {
      // no existing data yet
    }
    setLoaded(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("energy-tracker-data", JSON.stringify(data));
    } catch (e) {
      console.error("Save failed", e);
    }
  }, [data, loaded]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const toggleGrid = () => {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const newState = !(gridOn === true);
    setGridOn(newState);
    setData((d) => ({
      ...d,
      gridEvents: [
        ...d.gridEvents,
        { id: crypto.randomUUID(), date: todayKey(), type: newState ? "on" : "off", time },
      ],
    }));
    showToast(newState ? "Grid power logged ON" : "Grid power logged OFF");
  };

  const addGenLog = (entry) => {
    setData((d) => ({
      ...d,
      genLogs: [...d.genLogs, { id: crypto.randomUUID(), date: todayKey(), ...entry }],
    }));
    setActiveModal(null);
    showToast("Generator log saved");
  };

  const addMeterLog = (entry) => {
    setData((d) => ({
      ...d,
      meterLogs: [...d.meterLogs, { id: crypto.randomUUID(), date: todayKey(), ...entry }],
    }));
    setActiveModal(null);
    showToast("Meter purchase saved");
  };

  // ---------- Derived stats ----------
  const stats = useMemo(() => {
    const now = new Date();
    const last7 = [...Array(7)].map((_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });

    // Uptime calc: pair consecutive on/off events per day window (approximate, last 7 days)
    const sortedEvents = [...data.gridEvents].sort((a, b) =>
      (a.date + a.time).localeCompare(b.date + b.time)
    );
    let totalOnMs = 0;
    let totalWindowMs = 0;
    const weekStart = new Date(last7[0] + "T00:00:00");
    const weekEnd = new Date();
    totalWindowMs = weekEnd - weekStart;

    for (let i = 0; i < sortedEvents.length; i++) {
      const ev = sortedEvents[i];
      const evTime = new Date(ev.date + "T" + ev.time + ":00");
      if (evTime < weekStart) continue;
      if (ev.type === "on") {
        const nextOff = sortedEvents.slice(i + 1).find((e) => e.type === "off");
        const offTime = nextOff
          ? new Date(nextOff.date + "T" + nextOff.time + ":00")
          : weekEnd;
        const start = evTime < weekStart ? weekStart : evTime;
        const end = offTime > weekEnd ? weekEnd : offTime;
        if (end > start) totalOnMs += end - start;
      }
    }
    // If currently on and no closing off event captured above due to ordering, approximate is fine for v1.
    const uptimePct = totalWindowMs > 0 ? Math.min(100, (totalOnMs / totalWindowMs) * 100) : 0;
    const uptimeHrsTotal = totalOnMs / (1000 * 60 * 60);

    // Daily cost breakdown (last 7 days) combining gen fuel cost + meter cost spread
    const dailyCost = last7.map((dateKey) => {
      const genCost = data.genLogs
        .filter((g) => g.date === dateKey)
        .reduce((sum, g) => sum + Number(g.fuelCost || 0), 0);
      const meterCost = data.meterLogs
        .filter((m) => m.date === dateKey)
        .reduce((sum, m) => sum + Number(m.cost || 0), 0);
      return { date: dateKey, label: dayLabel(dateKey), cost: genCost + meterCost };
    });

    const monthKey = now.toISOString().slice(0, 7);
    const monthlyGenCost = data.genLogs
      .filter((g) => g.date.startsWith(monthKey))
      .reduce((s, g) => s + Number(g.fuelCost || 0), 0);
    const monthlyMeterCost = data.meterLogs
      .filter((m) => m.date.startsWith(monthKey))
      .reduce((s, m) => s + Number(m.cost || 0), 0);
    const monthlyGenHours = data.genLogs
      .filter((g) => g.date.startsWith(monthKey))
      .reduce((s, g) => s + Number(g.hours || 0), 0);

    const totalMonthlySpend = monthlyGenCost + monthlyMeterCost;
    const avgCostPerDay = totalMonthlySpend / now.getDate();

    const genHoursToday = data.genLogs
      .filter((g) => g.date === todayKey())
      .reduce((s, g) => s + Number(g.hours || 0), 0);

    return {
      uptimePct,
      uptimeHrsTotal,
      dailyCost,
      monthlyGenCost,
      monthlyMeterCost,
      monthlyGenHours,
      totalMonthlySpend,
      avgCostPerDay,
      genHoursToday,
    };
  }, [data]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
        <div className="text-[#8B95A1] font-mono text-sm tracking-wider animate-pulse">
          LOADING POWER LOG…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#E6E9ED] font-sans pb-16">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Space Grotesk', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .font-sans { font-family: 'Inter', sans-serif; }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 12px 2px var(--glow-color), 0 0 0 0 var(--glow-color); }
          50% { box-shadow: 0 0 24px 6px var(--glow-color), 0 0 0 0 var(--glow-color); }
        }
        .lamp-on { --glow-color: rgba(242, 201, 76, 0.55); animation: pulse-glow 2.4s ease-in-out infinite; }
        .lamp-off { --glow-color: rgba(224, 83, 61, 0.35); }
        @media (prefers-reduced-motion: reduce) {
          .lamp-on { animation: none; }
        }
      `}</style>

      {/* Header */}
      <header className="px-5 pt-8 pb-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] tracking-[0.2em] text-[#8B95A1] uppercase mb-1">
              Home Power Log
            </p>
            <h1 className="font-display text-2xl font-bold text-[#F2C94C]">Wattlog</h1>
          </div>
          <Zap className="text-[#F2C94C]" size={28} strokeWidth={2} />
        </div>
      </header>

      <main className="px-5 max-w-3xl mx-auto space-y-5">
        {/* Grid status — signature element */}
        <button
          onClick={toggleGrid}
          className={`w-full rounded-2xl p-6 flex items-center justify-between bg-[#1C2530] border transition-colors ${
            gridOn ? "border-[#F2C94C]/30" : "border-[#E0533D]/20"
          }`}
        >
          <div className="flex items-center gap-4">
            <div
              className={`w-4 h-4 rounded-full ${
                gridOn ? "bg-[#F2C94C] lamp-on" : "bg-[#E0533D] lamp-off"
              }`}
            />
            <div className="text-left">
              <p className="font-mono text-[10px] tracking-[0.15em] text-[#8B95A1] uppercase">
                Grid Status
              </p>
              <p className="font-display text-xl font-semibold mt-0.5">
                {gridOn === null ? "Tap to log" : gridOn ? "Power is ON" : "Power is OFF"}
              </p>
            </div>
          </div>
          <span className="font-mono text-[11px] text-[#8B95A1] border border-[#2A3441] rounded-full px-3 py-1.5">
            Tap to flip
          </span>
        </button>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<Clock size={16} />}
            label="7-day uptime"
            value={`${stats.uptimePct.toFixed(0)}%`}
            sub={fmtHrs(stats.uptimeHrsTotal)}
          />
          <StatCard
            icon={<Wallet size={16} />}
            label="Avg cost / day"
            value={fmtNaira(stats.avgCostPerDay)}
            sub="this month"
          />
          <StatCard
            icon={<TrendingUp size={16} />}
            label="Month spend"
            value={fmtNaira(stats.totalMonthlySpend)}
            sub={`${stats.monthlyGenHours.toFixed(0)}h gen`}
          />
        </div>

        {/* Chart */}
        <div className="bg-[#1C2530] rounded-2xl p-5 border border-[#2A3441]">
          <p className="font-mono text-[10px] tracking-[0.15em] text-[#8B95A1] uppercase mb-3">
            Daily cost — last 7 days
          </p>
          <div style={{ width: "100%", height: 160 }}>
            <ResponsiveContainer>
              <BarChart data={stats.dailyCost} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#2A3441" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#8B95A1", fontSize: 11, fontFamily: "IBM Plex Mono" }}
                  axisLine={{ stroke: "#2A3441" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#8B95A1", fontSize: 10, fontFamily: "IBM Plex Mono" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => `₦${v}`}
                />
                <Tooltip
                  formatter={(v) => fmtNaira(v)}
                  contentStyle={{
                    background: "#0D1117",
                    border: "1px solid #2A3441",
                    borderRadius: 8,
                    fontFamily: "IBM Plex Mono",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#8B95A1" }}
                />
                <Bar dataKey="cost" fill="#F2C94C" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quick log cards */}
        <div className="grid grid-cols-2 gap-3">
          <LogCard
            icon={<Fuel size={18} />}
            title="Generator"
            sub={stats.genHoursToday > 0 ? `${fmtHrs(stats.genHoursToday)} today` : "Log fuel & hours"}
            onClick={() => setActiveModal("gen")}
            accent="#3FB68B"
          />
          <LogCard
            icon={<Battery size={18} />}
            title="Prepaid Meter"
            sub="Log token purchase"
            onClick={() => setActiveModal("meter")}
            accent="#5B8DEF"
          />
        </div>

        {/* Support card — Pi payment */}
        <button
          onClick={() => setActiveModal("support")}
          className="w-full bg-[#1C2530] rounded-xl p-4 border border-[#2A3441] text-left hover:border-[#3A4555] transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Heart size={18} className="text-[#F2C94C]" />
            <div>
              <p className="font-display text-sm font-semibold">Support Wattlog</p>
              <p className="font-mono text-[10px] text-[#8B95A1] mt-0.5">Send a small tip in Pi</p>
            </div>
          </div>
          <span className="font-mono text-[10px] text-[#8B95A1] border border-[#2A3441] rounded-full px-2.5 py-1">
            π 0.01
          </span>
        </button>

        {/* Recent activity */}
        <RecentActivity data={data} />
      </main>

      {activeModal === "gen" && (
        <GenModal onSave={addGenLog} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "meter" && (
        <MeterModal onSave={addMeterLog} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "support" && (
        <SupportModal
          status={paymentStatus}
          onPay={() => sendSupportPayment(0.01)}
          onClose={() => setActiveModal(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1C2530] border border-[#2A3441] rounded-full px-4 py-2.5 font-mono text-xs text-[#E6E9ED] shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="bg-[#1C2530] rounded-xl p-3.5 border border-[#2A3441]">
      <div className="text-[#8B95A1] mb-2">{icon}</div>
      <p className="font-mono text-[9px] tracking-[0.1em] text-[#8B95A1] uppercase leading-tight">
        {label}
      </p>
      <p className="font-display text-lg font-semibold mt-1 truncate">{value}</p>
      <p className="font-mono text-[10px] text-[#8B95A1] mt-0.5">{sub}</p>
    </div>
  );
}

function LogCard({ icon, title, sub, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className="bg-[#1C2530] rounded-xl p-4 border border-[#2A3441] text-left hover:border-[#3A4555] transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div style={{ color: accent }}>{icon}</div>
        <Plus size={14} className="text-[#8B95A1]" />
      </div>
      <p className="font-display text-sm font-semibold">{title}</p>
      <p className="font-mono text-[10px] text-[#8B95A1] mt-0.5">{sub}</p>
    </button>
  );
}

function RecentActivity({ data }) {
  const items = useMemo(() => {
    const all = [
      ...data.gridEvents.map((e) => ({
        ts: e.date + " " + e.time,
        text: e.type === "on" ? "Grid power came ON" : "Grid power went OFF",
        color: e.type === "on" ? "#F2C94C" : "#E0533D",
      })),
      ...data.genLogs.map((g) => ({
        ts: g.date + " 12:00",
        text: `Generator: ${fmtHrs(g.hours)}, ${g.fuelLiters || 0}L for ${fmtNaira(g.fuelCost)}`,
        color: "#3FB68B",
      })),
      ...data.meterLogs.map((m) => ({
        ts: m.date + " 12:00",
        text: `Meter token: ${m.units || 0} kWh for ${fmtNaira(m.cost)}`,
        color: "#5B8DEF",
      })),
    ];
    return all.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  }, [data]);

  if (items.length === 0) {
    return (
      <div className="bg-[#1C2530] rounded-2xl p-6 border border-[#2A3441] text-center">
        <p className="font-mono text-xs text-[#8B95A1]">
          No entries yet. Tap the grid status above to log your first power event.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#1C2530] rounded-2xl p-5 border border-[#2A3441]">
      <p className="font-mono text-[10px] tracking-[0.15em] text-[#8B95A1] uppercase mb-3">
        Recent activity
      </p>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <p className="font-sans text-sm text-[#C5CBD3] flex-1">{item.text}</p>
            <p className="font-mono text-[10px] text-[#8B95A1] flex-shrink-0">
              {item.ts.slice(5, 16).replace(" ", " · ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-[#1C2530] rounded-t-2xl sm:rounded-2xl border border-[#2A3441] w-full sm:max-w-sm p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-[#8B95A1] hover:text-white">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <label className="block font-mono text-[10px] tracking-[0.1em] text-[#8B95A1] uppercase mb-1.5">
      {children}
    </label>
  );
}

const inputClass =
  "w-full bg-[#0D1117] border border-[#2A3441] rounded-lg px-3 py-2.5 text-[#E6E9ED] font-mono text-sm focus:outline-none focus:border-[#F2C94C]/60";

function GenModal({ onSave, onClose }) {
  const [hours, setHours] = useState("");
  const [fuelLiters, setFuelLiters] = useState("");
  const [fuelCost, setFuelCost] = useState("");

  const submit = () => {
    if (!hours && !fuelCost) return;
    onSave({
      hours: parseFloat(hours) || 0,
      fuelLiters: parseFloat(fuelLiters) || 0,
      fuelCost: parseFloat(fuelCost) || 0,
    });
  };

  return (
    <ModalShell title="Log generator use" onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <FieldLabel>Hours run today</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 4"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Fuel added (litres)</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 10"
            value={fuelLiters}
            onChange={(e) => setFuelLiters(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Fuel cost (₦)</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 8500"
            value={fuelCost}
            onChange={(e) => setFuelCost(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          onClick={submit}
          className="w-full bg-[#3FB68B] text-[#0D1117] font-display font-semibold rounded-lg py-3 mt-2"
        >
          Save log
        </button>
      </div>
    </ModalShell>
  );
}

function SupportModal({ status, onPay, onClose }) {
  const isBusy = status === "authenticating" || status === "paying";

  return (
    <ModalShell title="Support Wattlog" onClose={onClose}>
      <div className="space-y-4">
        <p className="font-sans text-sm text-[#C5CBD3]">
          Wattlog is free to use. If it's been useful, you can send a small tip in
          Pi to support development.
        </p>
        <div className="bg-[#0D1117] border border-[#2A3441] rounded-lg p-4 flex items-center justify-between">
          <span className="font-mono text-xs text-[#8B95A1] uppercase tracking-wide">
            Tip amount
          </span>
          <span className="font-display text-lg font-semibold text-[#F2C94C]">π 0.01</span>
        </div>
        <button
          onClick={onPay}
          disabled={isBusy}
          className="w-full bg-[#F2C94C] text-[#0D1117] font-display font-semibold rounded-lg py-3 disabled:opacity-60"
        >
          {status === "authenticating"
            ? "Signing in with Pi…"
            : status === "paying"
            ? "Processing payment…"
            : "Send π 0.01"}
        </button>
        {status === "error" && (
          <p className="font-mono text-[11px] text-[#E0533D] text-center">
            Something went wrong. Please try again.
          </p>
        )}
        <p className="font-mono text-[10px] text-[#8B95A1] text-center">
          Requires Pi Browser to complete payment
        </p>
      </div>
    </ModalShell>
  );
}

function MeterModal({ onSave, onClose }) {
  const [units, setUnits] = useState("");
  const [cost, setCost] = useState("");

  const submit = () => {
    if (!units && !cost) return;
    onSave({ units: parseFloat(units) || 0, cost: parseFloat(cost) || 0 });
  };

  return (
    <ModalShell title="Log meter purchase" onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <FieldLabel>Units bought (kWh)</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 50"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Amount paid (₦)</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 15000"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          onClick={submit}
          className="w-full bg-[#5B8DEF] text-[#0D1117] font-display font-semibold rounded-lg py-3 mt-2"
        >
          Save log
        </button>
      </div>
    </ModalShell>
  );
}
