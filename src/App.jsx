import { useState, useReducer, useEffect } from "react";

// ============================================================
// 🗄️  DATA LAYER
// Swap Storage.get / Storage.set for Firebase/Supabase calls
// to turn this into a multi-device app later.
// ============================================================
const Storage = {
  get: (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("Storage write failed:", e);
    }
  },
};

// ============================================================
// 🧮  BUSINESS LOGIC
// ============================================================
const getDaysLeftInMonth = () => {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
};

const getDaysUntilPayday = (paydayStr) => {
  if (!paydayStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const payday = new Date(paydayStr);
  payday.setHours(0, 0, 0, 0);
  const diff = Math.ceil((payday - now) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : null;
};

const calcBudget = (profile, expenses) => {
  const totalFixed = profile.fixedExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const freeMoney = Number(profile.income) - totalFixed;

  // Only count expenses from this calendar month
  const now = new Date();
  const monthExpenses = expenses.filter((e) => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const remaining = freeMoney - totalSpent;
  const daysLeft = getDaysLeftInMonth();
  const safeDaily = daysLeft > 0 ? Math.floor(Math.max(remaining, 0) / daysLeft) : 0;

  // Daily avg over last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentSpend = expenses
    .filter((e) => new Date(e.date) >= weekAgo)
    .reduce((s, e) => s + Number(e.amount), 0);
  const dailyAvg = Math.floor(recentSpend / 7);

  const overspending = dailyAvg > safeDaily && safeDaily > 0;
  const runOutDays =
    overspending && dailyAvg > 0 ? Math.max(Math.floor(remaining / dailyAvg), 0) : null;

  return {
    totalFixed,
    freeMoney,
    totalSpent,
    remaining,
    daysLeft,
    safeDaily,
    dailyAvg,
    overspending,
    runOutDays,
    monthExpenses,
  };
};

const getWeeklySummary = (expenses) => {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recent = expenses.filter((e) => new Date(e.date) >= weekAgo);
  const total = recent.reduce((s, e) => s + Number(e.amount), 0);
  const catTotals = {};
  recent.forEach((e) => {
    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
  });
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  return { total, topCategory: topCat ? topCat[0] : null };
};

const calcStreak = (expenses, safeDaily) => {
  if (safeDaily <= 0) return 0;
  const byDay = {};
  expenses.forEach((e) => {
    const d = e.date.split("T")[0];
    byDay[d] = (byDay[d] || 0) + Number(e.amount);
  });
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    if ((byDay[key] || 0) <= safeDaily) streak++;
    else break;
  }
  return streak;
};

// ============================================================
// 🏷️  CONSTANTS
// ============================================================
export const CATEGORIES = [
  { id: "food",      label: "食事",   emoji: "🍜" },
  { id: "transport", label: "交通",   emoji: "🚃" },
  { id: "shopping",  label: "買い物", emoji: "🛍️" },
  { id: "fun",       label: "娯楽",   emoji: "🎮" },
  { id: "other",     label: "その他", emoji: "📦" },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const INITIAL_PROFILE = {
  income: 150000,
  fixedExpenses: [
    { id: "phone",     label: "携帯",  amount: 8000 },
    { id: "transport", label: "定期代", amount: 12000 },
  ],
  payday: "",
  goals: [],
};

// ============================================================
// 🗃️  STATE MANAGEMENT
// ============================================================
const initialState = {
  profile:   Storage.get("bp_profile",  INITIAL_PROFILE),
  expenses:  Storage.get("bp_expenses", []),
  activeTab: "home",
  modal:     null,
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, activeTab: action.tab, modal: null };

    case "SET_MODAL":
      return { ...state, modal: action.modal };

    case "ADD_EXPENSE": {
      const expenses = [action.expense, ...state.expenses];
      Storage.set("bp_expenses", expenses);
      return { ...state, expenses, modal: null };
    }

    case "DELETE_EXPENSE": {
      const expenses = state.expenses.filter((e) => e.id !== action.id);
      Storage.set("bp_expenses", expenses);
      return { ...state, expenses };
    }

    case "UPDATE_PROFILE": {
      const profile = { ...state.profile, ...action.profile };
      Storage.set("bp_profile", profile);
      return { ...state, profile, modal: null };
    }

    case "ADD_GOAL": {
      const goals = [...state.profile.goals, action.goal];
      const profile = { ...state.profile, goals };
      Storage.set("bp_profile", profile);
      return { ...state, profile };
    }

    case "UPDATE_GOAL_SAVED": {
      const goals = state.profile.goals.map((g) =>
        g.id === action.id ? { ...g, saved: action.saved } : g
      );
      const profile = { ...state.profile, goals };
      Storage.set("bp_profile", profile);
      return { ...state, profile };
    }

    case "DELETE_GOAL": {
      const goals = state.profile.goals.filter((g) => g.id !== action.id);
      const profile = { ...state.profile, goals };
      Storage.set("bp_profile", profile);
      return { ...state, profile };
    }

    default:
      return state;
  }
}

// ============================================================
// 🧩  SHARED UI PRIMITIVES
// ============================================================
const fmt = (n) => `¥${Number(n).toLocaleString("ja-JP")}`;

function Card({ children, className = "", onClick, style }) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={`bg-white rounded-2xl shadow-sm border border-stone-100 ${className} ${
        onClick ? "cursor-pointer active:scale-[0.98] transition-transform" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Badge({ children, color = "stone" }) {
  const colors = {
    stone: "bg-stone-100 text-stone-600",
    green: "bg-emerald-50 text-emerald-700",
    red:   "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-700",
    blue:  "bg-sky-50 text-sky-700",
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors[color]}`}>
      {children}
    </span>
  );
}

function ProgressBar({ pct, color = "#10b981" }) {
  return (
    <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }}
      />
    </div>
  );
}

// ============================================================
// 🏠  HOME TAB
// ============================================================
function HomeTab({ state, dispatch }) {
  const { profile, expenses } = state;
  const budget = calcBudget(profile, expenses);
  const streak = calcStreak(expenses, budget.safeDaily);
  const daysUntilPay = getDaysUntilPayday(profile.payday);
  const weekly = getWeeklySummary(expenses);
  const spentPct =
    budget.freeMoney > 0 ? (budget.totalSpent / budget.freeMoney) * 100 : 0;

  const safeColor =
    budget.safeDaily > 5000
      ? "#10b981"
      : budget.safeDaily > 2000
      ? "#f59e0b"
      : "#f43f5e";

  return (
    <div className="space-y-3">
      {/* ── HERO ── */}
      <Card
        className="p-6 text-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1c1917 0%, #292524 100%)" }}
      >
        <p className="text-stone-400 text-xs font-semibold tracking-widest uppercase mb-2">
          今日使える金額
        </p>
        <p
          className="font-black text-5xl tracking-tight"
          style={{ color: safeColor }}
        >
          {fmt(Math.max(budget.safeDaily, 0))}
        </p>
        <p className="text-stone-500 text-xs mt-1.5">
          残り {budget.daysLeft} 日 &nbsp;·&nbsp; {fmt(Math.max(budget.remaining, 0))} 残高
        </p>
        {streak > 0 && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full">
            🔥 {streak}日連続予算内
          </div>
        )}
      </Card>

      {/* ── OVERSPENDING WARNING ── */}
      {budget.overspending && (
        <Card className="p-4 !border-rose-200 !bg-rose-50">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-rose-700 font-bold text-sm">ペースが速すぎます</p>
              <p className="text-rose-500 text-xs mt-0.5">
                このペースだとあと{" "}
                <strong className="text-rose-700">{budget.runOutDays} 日</strong>{" "}
                でなくなります
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── BUDGET BAR ── */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="font-bold text-stone-800 text-sm">今月の予算</p>
          <Badge color={spentPct > 85 ? "red" : spentPct > 60 ? "amber" : "green"}>
            {Math.round(spentPct)}% 使用
          </Badge>
        </div>
        <ProgressBar pct={spentPct} color={safeColor} />
        <div className="flex justify-between mt-2.5 text-xs text-stone-400">
          <span>支出 {fmt(budget.totalSpent)}</span>
          <span>自由資金 {fmt(budget.freeMoney)}</span>
        </div>
      </Card>

      {/* ── QUICK STATS ── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "収入",   value: fmt(profile.income) },
          { label: "固定費", value: fmt(budget.totalFixed) },
          { label: "日平均", value: fmt(budget.dailyAvg) },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-stone-400 text-xs mb-1">{s.label}</p>
            <p className="font-bold text-stone-800 text-sm">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* ── PAYDAY ── */}
      {daysUntilPay !== null && (
        <Card className="p-4 flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div>
            <p className="font-bold text-stone-800 text-sm">
              給料日まであと {daysUntilPay} 日
            </p>
            <p className="text-stone-400 text-xs">{profile.payday}</p>
          </div>
        </Card>
      )}

      {/* ── WEEKLY SUMMARY ── */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📊 今週のまとめ</p>
        <div className="flex justify-between items-center">
          <div>
            <p className="text-stone-400 text-xs">合計支出</p>
            <p className="font-bold text-stone-800 text-lg">{fmt(weekly.total)}</p>
          </div>
          {weekly.topCategory && (
            <div className="text-right">
              <p className="text-stone-400 text-xs">最多カテゴリ</p>
              <p className="font-bold text-stone-800">
                {CAT_MAP[weekly.topCategory]?.emoji}{" "}
                {CAT_MAP[weekly.topCategory]?.label}
              </p>
            </div>
          )}
          <Badge
            color={
              weekly.total < budget.safeDaily * 7 ? "green" : "amber"
            }
          >
            {weekly.total < budget.safeDaily * 7 ? "順調👍" : "注意⚠️"}
          </Badge>
        </div>
      </Card>

      {/* ── GOALS ── */}
      {profile.goals.length > 0 && (
        <div>
          <p className="font-bold text-stone-600 text-xs uppercase tracking-widest mb-2 px-1">
            目標
          </p>
          {profile.goals.map((goal) => {
            const pct =
              goal.target > 0 ? (goal.saved / goal.target) * 100 : 0;
            return (
              <Card key={goal.id} className="p-4 mb-2">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-bold text-stone-800 text-sm">{goal.name}</p>
                  <p className="text-xs text-stone-400">
                    {fmt(goal.saved)} / {fmt(goal.target)}
                  </p>
                </div>
                <ProgressBar pct={pct} color="#6366f1" />
                <p className="text-xs text-stone-400 mt-1">
                  {Math.round(pct)}% 達成
                  {pct >= 100 && " 🎉"}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ➕  ADD EXPENSE MODAL
// ============================================================
function AddExpenseModal({ dispatch }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");

  const handleSubmit = () => {
    const n = parseInt(amount, 10);
    if (!n || n <= 0) return;
    dispatch({
      type: "ADD_EXPENSE",
      expense: {
        id: Date.now().toString(),
        amount: n,
        category,
        note: note.trim(),
        date: new Date().toISOString(),
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) =>
        e.target === e.currentTarget &&
        dispatch({ type: "SET_MODAL", modal: null })
      }
    >
      <div className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-10 animate-slide-up">
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />
        <p className="font-black text-stone-900 text-xl mb-5">支出を追加</p>

        {/* Amount */}
        <div className="bg-stone-50 rounded-2xl p-4 mb-4 text-center">
          <p className="text-stone-400 text-xs mb-1">金額</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-3xl font-light text-stone-400">¥</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-4xl font-black text-stone-900 bg-transparent border-none outline-none w-44 text-center"
              placeholder="0"
              autoFocus
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mb-4">
          {[500, 1000, 2000, 5000].map((n) => (
            <button
              key={n}
              onClick={() => setAmount(String(n))}
              className="flex-1 bg-stone-100 rounded-xl py-2 text-sm font-bold text-stone-600 active:bg-stone-200 transition-colors"
            >
              ¥{n.toLocaleString()}
            </button>
          ))}
        </div>

        {/* Category */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex flex-col items-center py-2.5 px-1 rounded-xl text-xs font-medium transition-all ${
                category === cat.id
                  ? "bg-stone-900 text-white scale-105 shadow-md"
                  : "bg-stone-100 text-stone-600"
              }`}
            >
              <span className="text-lg mb-0.5">{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Note */}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full bg-stone-50 rounded-xl p-3 text-sm text-stone-700 border-none outline-none mb-5 placeholder-stone-400"
          placeholder="メモ（任意）"
        />

        <button
          onClick={handleSubmit}
          className="w-full bg-stone-900 text-white font-black text-lg py-4 rounded-2xl active:bg-stone-700 transition-colors"
        >
          追加する
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 📋  HISTORY TAB
// ============================================================
function HistoryTab({ state, dispatch }) {
  const { expenses } = state;

  // Group by date label
  const grouped = expenses.reduce((acc, e) => {
    const d = new Date(e.date).toLocaleDateString("ja-JP", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    if (!acc[d]) acc[d] = [];
    acc[d].push(e);
    return acc;
  }, {});

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-5xl mb-4">📭</p>
        <p className="text-stone-500 font-semibold">まだ支出がありません</p>
        <p className="text-stone-400 text-sm mt-1">「＋」ボタンから追加しましょう</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          <div className="flex justify-between items-center mb-2 px-1">
            <p className="text-xs font-bold text-stone-500">{date}</p>
            <p className="text-xs text-stone-400">
              {fmt(items.reduce((s, e) => s + Number(e.amount), 0))}
            </p>
          </div>
          <Card>
            {items.map((expense, i) => (
              <div
                key={expense.id}
                className={`flex items-center justify-between p-4 ${
                  i < items.length - 1 ? "border-b border-stone-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center text-xl">
                    {CAT_MAP[expense.category]?.emoji}
                  </div>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">
                      {expense.note || CAT_MAP[expense.category]?.label}
                    </p>
                    <p className="text-xs text-stone-400">
                      {CAT_MAP[expense.category]?.label}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold text-stone-900">{fmt(expense.amount)}</p>
                  <button
                    onClick={() =>
                      dispatch({ type: "DELETE_EXPENSE", id: expense.id })
                    }
                    className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition-colors text-sm font-bold"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 📊  INSIGHTS TAB
// ============================================================
function InsightsTab({ state }) {
  const { profile, expenses } = state;
  const budget = calcBudget(profile, expenses);

  const catTotals = {};
  budget.monthExpenses.forEach(
    (e) => (catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount))
  );
  const catList = CATEGORIES.map((c) => ({
    ...c,
    total: catTotals[c.id] || 0,
  })).sort((a, b) => b.total - a.total);

  const maxCat = Math.max(...catList.map((c) => c.total), 1);

  return (
    <div className="space-y-3">
      {/* Category breakdown */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-4">💸 カテゴリ別支出（今月）</p>
        <div className="space-y-3">
          {catList.map((cat) => (
            <div key={cat.id}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-stone-700">
                  {cat.emoji} {cat.label}
                </span>
                <span className="text-stone-500">{fmt(cat.total)}</span>
              </div>
              <ProgressBar
                pct={(cat.total / maxCat) * 100}
                color="#6366f1"
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Daily pace */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📈 日次ペース分析</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-stone-50 rounded-xl p-3 text-center">
            <p className="text-xs text-stone-400 mb-1">目標日額</p>
            <p className="font-black text-stone-900 text-xl">
              {fmt(budget.safeDaily)}
            </p>
          </div>
          <div
            className={`rounded-xl p-3 text-center ${
              budget.overspending ? "bg-rose-50" : "bg-emerald-50"
            }`}
          >
            <p className="text-xs text-stone-400 mb-1">実際の日平均</p>
            <p
              className={`font-black text-xl ${
                budget.overspending ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {fmt(budget.dailyAvg)}
            </p>
          </div>
        </div>
        <p
          className={`text-xs mt-3 text-center font-medium ${
            budget.overspending ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {budget.overspending
            ? `⚠️ 日平均が目標を ${fmt(budget.dailyAvg - budget.safeDaily)} 超過しています`
            : "✅ ペースは良好です"}
        </p>
      </Card>

      {/* Fixed expenses */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📌 固定費の内訳</p>
        {profile.fixedExpenses.map((fe) => (
          <div
            key={fe.id}
            className="flex justify-between items-center py-2.5 border-b border-stone-50 last:border-0"
          >
            <p className="text-sm text-stone-700">{fe.label}</p>
            <p className="font-bold text-stone-800">{fmt(fe.amount)}</p>
          </div>
        ))}
        <div className="flex justify-between items-center pt-2 mt-1">
          <p className="text-sm font-bold text-stone-400">合計</p>
          <p className="font-black text-stone-900">{fmt(budget.totalFixed)}</p>
        </div>
      </Card>

      {/* Month overview */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">🗓️ 今月の概要</p>
        {[
          { label: "収入",     value: fmt(profile.income),       color: "text-emerald-600" },
          { label: "固定費",   value: `-${fmt(budget.totalFixed)}`, color: "text-rose-500" },
          { label: "変動支出", value: `-${fmt(budget.totalSpent)}`, color: "text-rose-500" },
          { label: "残高",     value: fmt(Math.max(budget.remaining, 0)), color: "text-stone-900" },
        ].map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-center py-2 border-b border-stone-50 last:border-0"
          >
            <p className="text-sm text-stone-500">{row.label}</p>
            <p className={`font-bold text-sm ${row.color}`}>{row.value}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ============================================================
// ⚙️  PROFILE TAB
// ============================================================
function ProfileTab({ state, dispatch }) {
  const { profile } = state;
  const [income, setIncome] = useState(String(profile.income));
  const [payday, setPayday] = useState(profile.payday);
  const [fixedExpenses, setFixedExpenses] = useState(profile.fixedExpenses);
  const [newFixed, setNewFixed] = useState({ label: "", amount: "" });
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    dispatch({
      type: "UPDATE_PROFILE",
      profile: { income: parseInt(income) || 0, payday, fixedExpenses },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addFixed = () => {
    if (!newFixed.label || !newFixed.amount) return;
    setFixedExpenses((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        label: newFixed.label,
        amount: parseInt(newFixed.amount) || 0,
      },
    ]);
    setNewFixed({ label: "", amount: "" });
  };

  const addGoal = () => {
    if (!goalName || !goalTarget) return;
    dispatch({
      type: "ADD_GOAL",
      goal: {
        id: Date.now().toString(),
        name: goalName,
        target: parseInt(goalTarget) || 0,
        saved: 0,
      },
    });
    setGoalName("");
    setGoalTarget("");
  };

  return (
    <div className="space-y-3">
      {/* Income */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">💴 月収入</p>
        <div className="bg-stone-50 rounded-xl p-3 flex items-center gap-2">
          <span className="text-stone-400 text-lg font-light">¥</span>
          <input
            type="number"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            className="bg-transparent flex-1 font-bold text-stone-900 text-xl outline-none border-none"
            placeholder="150000"
            inputMode="numeric"
          />
        </div>
      </Card>

      {/* Payday */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📅 次の給料日</p>
        <input
          type="date"
          value={payday}
          onChange={(e) => setPayday(e.target.value)}
          className="w-full bg-stone-50 rounded-xl p-3 text-stone-700 outline-none border-none text-sm"
        />
      </Card>

      {/* Fixed expenses */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📌 固定費</p>
        {fixedExpenses.length === 0 && (
          <p className="text-stone-400 text-xs mb-2">固定費はまだありません</p>
        )}
        {fixedExpenses.map((fe) => (
          <div
            key={fe.id}
            className="flex items-center justify-between py-2.5 border-b border-stone-50 last:border-0"
          >
            <p className="text-sm text-stone-700">{fe.label}</p>
            <div className="flex items-center gap-2">
              <p className="font-bold text-stone-800 text-sm">{fmt(fe.amount)}</p>
              <button
                onClick={() =>
                  setFixedExpenses((prev) => prev.filter((f) => f.id !== fe.id))
                }
                className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition-colors text-sm font-bold"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newFixed.label}
            onChange={(e) => setNewFixed((p) => ({ ...p, label: e.target.value }))}
            className="flex-1 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="名前"
          />
          <input
            type="number"
            value={newFixed.amount}
            onChange={(e) => setNewFixed((p) => ({ ...p, amount: e.target.value }))}
            className="w-24 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="金額"
            inputMode="numeric"
          />
          <button
            onClick={addFixed}
            className="bg-stone-900 text-white rounded-xl px-3 text-sm font-bold active:bg-stone-700"
          >
            追加
          </button>
        </div>
      </Card>

      {/* Goals */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">🎯 貯蓄目標</p>
        {profile.goals.map((g) => {
          const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
          return (
            <div key={g.id} className="mb-4 last:mb-2">
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-sm font-semibold text-stone-800">{g.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">
                    {fmt(g.saved)} / {fmt(g.target)}
                  </span>
                  <button
                    onClick={() => dispatch({ type: "DELETE_GOAL", id: g.id })}
                    className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition-colors text-xs font-bold"
                  >
                    ×
                  </button>
                </div>
              </div>
              <ProgressBar pct={pct} color="#6366f1" />
              <div className="flex gap-2 mt-2">
                <input
                  type="number"
                  className="flex-1 bg-stone-50 rounded-lg p-2 text-xs outline-none border-none placeholder-stone-400"
                  placeholder="貯蓄額を更新..."
                  inputMode="numeric"
                  onBlur={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 0) {
                      dispatch({ type: "UPDATE_GOAL_SAVED", id: g.id, saved: v });
                    }
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={goalName}
            onChange={(e) => setGoalName(e.target.value)}
            className="flex-1 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="目標名（例：MacBook）"
          />
          <input
            type="number"
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value)}
            className="w-28 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="目標額"
            inputMode="numeric"
          />
          <button
            onClick={addGoal}
            className="bg-indigo-600 text-white rounded-xl px-3 text-sm font-bold active:bg-indigo-700"
          >
            追加
          </button>
        </div>
      </Card>

      {/* Save button */}
      <button
        onClick={handleSave}
        className={`w-full font-black text-lg py-4 rounded-2xl transition-all duration-300 ${
          saved
            ? "bg-emerald-500 text-white"
            : "bg-stone-900 text-white active:bg-stone-700"
        }`}
      >
        {saved ? "✅ 保存しました" : "設定を保存"}
      </button>

      {/* Data info */}
      <p className="text-center text-xs text-stone-400 pb-2">
        データはこのデバイスに保存されています
      </p>
    </div>
  );
}

// ============================================================
// 📱  BOTTOM NAVIGATION
// ============================================================
function BottomNav({ activeTab, dispatch }) {
  const tabs = [
    { id: "home",     icon: "🏠", label: "ホーム" },
    { id: "history",  icon: "📋", label: "履歴" },
    { id: "insights", icon: "📊", label: "分析" },
    { id: "profile",  icon: "⚙️",  label: "設定" },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-stone-100 z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around px-2 pt-1 pb-3">
        {tabs.slice(0, 2).map((tab) => (
          <NavItem key={tab.id} tab={tab} active={activeTab === tab.id} dispatch={dispatch} />
        ))}

        {/* Center FAB */}
        <button
          onClick={() => dispatch({ type: "SET_MODAL", modal: "add" })}
          className="w-14 h-14 rounded-full bg-stone-900 flex items-center justify-center shadow-xl -mt-7 active:scale-95 transition-transform"
        >
          <span className="text-white text-3xl font-thin leading-none mt-[-2px]">＋</span>
        </button>

        {tabs.slice(2).map((tab) => (
          <NavItem key={tab.id} tab={tab} active={activeTab === tab.id} dispatch={dispatch} />
        ))}
      </div>
    </nav>
  );
}

function NavItem({ tab, active, dispatch }) {
  return (
    <button
      onClick={() => dispatch({ type: "SET_TAB", tab: tab.id })}
      className="flex flex-col items-center gap-0.5 py-1 px-4 transition-all"
    >
      <span className="text-xl">{tab.icon}</span>
      <span
        className={`text-xs font-semibold transition-colors ${
          active ? "text-stone-900" : "text-stone-400"
        }`}
      >
        {tab.label}
      </span>
      {active && (
        <div className="w-1 h-1 rounded-full bg-stone-900 mt-0.5" />
      )}
    </button>
  );
}

// ============================================================
// 🎬  ROOT APP
// ============================================================
const TAB_TITLES = {
  home:     "学生バジェット",
  history:  "支出履歴",
  insights: "分析",
  profile:  "設定",
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <div
      className="min-h-screen"
      style={{
        fontFamily:
          "'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
        background: "#fafaf9",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-stone-100">
        <div
          className="max-w-md mx-auto px-4 flex items-center justify-between"
          style={{ paddingTop: "env(safe-area-inset-top, 12px)", paddingBottom: "12px" }}
        >
          <h1 className="font-black text-stone-900 text-lg tracking-tight">
            {TAB_TITLES[state.activeTab]}
          </h1>
          {state.activeTab === "home" && (
            <span className="text-xs text-stone-400">
              {new Date().toLocaleDateString("ja-JP", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </span>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-md mx-auto px-4 pt-4 pb-36">
        {state.activeTab === "home"     && <HomeTab state={state} dispatch={dispatch} />}
        {state.activeTab === "history"  && <HistoryTab state={state} dispatch={dispatch} />}
        {state.activeTab === "insights" && <InsightsTab state={state} />}
        {state.activeTab === "profile"  && <ProfileTab state={state} dispatch={dispatch} />}
      </main>

      <BottomNav activeTab={state.activeTab} dispatch={dispatch} />

      {state.modal === "add" && <AddExpenseModal dispatch={dispatch} />}
    </div>
  );
}
