import { useState, useReducer, useRef } from "react";

// ============================================================
// 🔊  SOUND + MEME ENGINE
// ============================================================

// Meme reactions based on how bad the spending is
const MEME_MESSAGES = {
  // Spent nothing today
  none: [
    "今日は天才か？👏",
    "節約マスター現る🧘",
    "お財布が喜んでる💚",
  ],
  // Under budget — good job
  good: [
    "頑張れ頑張れ！💪",
    "その調子や！🔥",
    "えらい！偉すぎる！👑",
    "神ってる〜！✨",
    "お前天才じゃん😤",
  ],
  // A little over
  warning: [
    "ちょっと使いすぎちゃった…😅",
    "まあ、人間だもんね🙃",
    "次は気をつけて！⚠️",
    "あぶな〜い！😬",
  ],
  // Way over budget
  danger: [
    "ふざけんなお前💀",
    "は？何してんの？😡",
    "財布を今すぐ閉めろ🚨",
    "もうダメだ終わった🫠",
    "お金どこ行った？！🤯",
    "やばすぎて笑えない😭",
  ],
};

const getMemeMessage = (todaySpent, safeDaily) => {
  if (todaySpent === 0) return rand(MEME_MESSAGES.none);
  const ratio = safeDaily > 0 ? todaySpent / safeDaily : 0;
  if (ratio <= 0.7) return rand(MEME_MESSAGES.good);
  if (ratio <= 1.0) return rand(MEME_MESSAGES.warning);
  return rand(MEME_MESSAGES.danger);
};

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Play the faaah sound
const playFaaah = () => {
  try {
    const audio = new Audio(process.env.PUBLIC_URL + "/faaah.mp3");
    audio.volume = 0.7;
    audio.play().catch(() => {}); // ignore autoplay block
  } catch {}
};

// ============================================================
// 🗄️  DATA LAYER
// ============================================================
const Storage = {
  get: (key, fallback) => {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn("Storage write failed:", e); }
  },
};

// ============================================================
// 🧮  BUSINESS LOGIC
// ============================================================

// Returns integer days from today (midnight) to target date
// 0 = today, 1 = tomorrow, -1 = yesterday
const getDaysUntil = (dateStr) => {
  if (!dateStr) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parts = dateStr.split("-").map(Number); // YYYY-MM-DD safe parse
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
};

const isPaydayPast = (dateStr) => {
  if (!dateStr) return false;
  const d = getDaysUntil(dateStr);
  return d !== null && d < 0;
};

// Local date string YYYY-MM-DD for a Date object (avoids UTC shift)
const toLocalDateStr = (date) => {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const getTodayStr = () => toLocalDateStr(new Date());

const calcBudget = (profile, expenses) => {
  const totalFixed = profile.fixedExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const income = Number(profile.currentIncome) || 0;
  const freeMoney = income - totalFixed;

  // Period start = lastPayday itself (the day you received money)
  // NOT the day after — otherwise expenses logged on payday get excluded
  let periodStartStr;
  if (profile.lastPayday) {
    periodStartStr = profile.lastPayday; // YYYY-MM-DD, inclusive
  } else {
    const now = new Date();
    periodStartStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  }

  const todayStr = getTodayStr();

  // All expense dates are stored as plain YYYY-MM-DD — compare as strings directly
  const getDateStr = (e) => e.date.length === 10 ? e.date : e.date.substring(0, 10);

  const periodExpenses = expenses.filter((e) => getDateStr(e) >= periodStartStr);
  const totalSpent = periodExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const remaining = freeMoney - totalSpent;

  const daysUntilPay = profile.nextPayday
    ? Math.max(getDaysUntil(profile.nextPayday), 1)
    : 30;

  const safeDaily = remaining > 0 ? Math.floor(remaining / daysUntilPay) : 0;

  // Today's spending — plain string equality
  const todaySpent = periodExpenses
    .filter((e) => getDateStr(e) === todayStr)
    .reduce((s, e) => s + Number(e.amount), 0);

  const todayDiff = safeDaily - todaySpent;

  // Today's breakdown by category
  const todayCats = {};
  periodExpenses
    .filter((e) => getDateStr(e) === todayStr)
    .forEach((e) => { todayCats[e.category] = (todayCats[e.category] || 0) + Number(e.amount); });

  // 7-day rolling average
  const weekAgoStr = toLocalDateStr(new Date(Date.now() - 7 * 86400000));
  const recentSpend = expenses
    .filter((e) => getDateStr(e) >= weekAgoStr)
    .reduce((s, e) => s + Number(e.amount), 0);
  const dailyAvg = Math.floor(recentSpend / 7);

  const overspending = dailyAvg > safeDaily && safeDaily > 0;
  const runOutDays = overspending && dailyAvg > 0
    ? Math.max(Math.floor(remaining / dailyAvg), 0) : null;

  return {
    totalFixed, freeMoney, totalSpent, remaining,
    daysUntilPay, safeDaily, dailyAvg,
    overspending, runOutDays,
    periodExpenses, todaySpent, todayDiff, todayCats,
  };
};

const getWeeklySummary = (expenses) => {
  const weekAgoStr = toLocalDateStr(new Date(Date.now() - 7 * 86400000));
  const recent = expenses.filter((e) => e.date.split("T")[0] >= weekAgoStr);
  const total = recent.reduce((s, e) => s + Number(e.amount), 0);
  const catTotals = {};
  recent.forEach((e) => { catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount); });
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  return { total, topCategory: topCat ? topCat[0] : null };
};

// Streak = consecutive days at or under safeDaily, within pay period
const calcStreak = (expenses, safeDaily, lastPayday) => {
  if (safeDaily <= 0) return 0;
  const getDateStr = (e) => e.date.length === 10 ? e.date : e.date.substring(0, 10);
  const byDay = {};
  expenses.forEach((e) => {
    const d = getDateStr(e);
    byDay[d] = (byDay[d] || 0) + Number(e.amount);
  });
  const periodStartStr = lastPayday
    ? lastPayday
    : (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`; })();
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const key = toLocalDateStr(new Date(Date.now() - i * 86400000));
    if (key < periodStartStr) break;
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
  currentIncome: "",
  lastPayday: "",
  nextPayday: "",
  fixedExpenses: [],
  goals: [],
  periodHistory: [],
};

// ============================================================
// 🗃️  STATE
// ============================================================
const initialState = {
  profile:   Storage.get("bp_profile",  INITIAL_PROFILE),
  expenses:  Storage.get("bp_expenses", []),
  activeTab: "home",
  modal:     null,
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_TAB":   return { ...state, activeTab: action.tab, modal: null };
    case "SET_MODAL": return { ...state, modal: action.modal };

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

    case "NEW_PAY_PERIOD": {
      // Archive current period
      const { profile, expenses } = state;
      let historyEntry = null;
      if (profile.lastPayday && profile.nextPayday) {
        const periodStartStr = profile.lastPayday; // inclusive from payday itself
        const periodExp = expenses.filter((e) => {
          const d = e.date.length === 10 ? e.date : e.date.substring(0, 10);
          return d >= periodStartStr;
        });
        const spent = periodExp.reduce((s, e) => s + Number(e.amount), 0);
        const inc = Number(profile.currentIncome) || 0;
        const fixed = profile.fixedExpenses.reduce((s, e) => s + Number(e.amount), 0);
        const free = inc - fixed;
        historyEntry = {
          period: profile.lastPayday + " 〜 " + profile.nextPayday,
          income: inc,
          fixed,
          spent,
          saved: Math.max(free - spent, 0),
        };
      }

      const periodHistory = historyEntry
        ? [historyEntry, ...(profile.periodHistory || [])].slice(0, 24)
        : (profile.periodHistory || []);

      const newProfile = {
        ...profile,
        lastPayday: profile.nextPayday || getTodayStr(),
        nextPayday: action.nextPayday,
        currentIncome: action.income,
        periodHistory,
      };
      Storage.set("bp_profile", newProfile);
      return { ...state, profile: newProfile, modal: null };
    }

    case "ADD_GOAL": {
      const goals = [...state.profile.goals, action.goal];
      const profile = { ...state.profile, goals };
      Storage.set("bp_profile", profile);
      return { ...state, profile };
    }
    case "UPDATE_GOAL_SAVED": {
      const goals = state.profile.goals.map((g) =>
        g.id === action.id ? { ...g, saved: Math.max(0, Number(action.saved)) } : g);
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
    default: return state;
  }
}

// ============================================================
// 🧩  UI PRIMITIVES
// ============================================================
const fmt = (n) => "¥" + Math.abs(Math.round(Number(n))).toLocaleString("ja-JP");

function Card({ children, className = "", onClick, style }) {
  return (
    <div onClick={onClick} style={style}
      className={"bg-white rounded-2xl shadow-sm border border-stone-100 " + className +
        (onClick ? " cursor-pointer active:scale-[0.98] transition-transform" : "")}>
      {children}
    </div>
  );
}

function Badge({ children, color = "stone" }) {
  const c = { stone: "bg-stone-100 text-stone-600", green: "bg-emerald-50 text-emerald-700", red: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-700" };
  return <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + c[color]}>{children}</span>;
}

function ProgressBar({ pct, color }) {
  return (
    <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: Math.min(Math.max(Number(pct) || 0, 0), 100) + "%", background: color || "#10b981" }} />
    </div>
  );
}

// ============================================================
// 🆕  NEW PAY PERIOD MODAL
// ============================================================
function NewPayPeriodModal({ profile, dispatch, canDismiss }) {
  const isPastDue = isPaydayPast(profile.nextPayday);
  const [income, setIncome] = useState("");
  const [nextPayday, setNextPayday] = useState("");

  const handleConfirm = () => {
    const n = parseInt(income, 10);
    if (!n || n <= 0 || !nextPayday) return;
    // Validate nextPayday is in the future
    if (getDaysUntil(nextPayday) <= 0) {
      alert("次の給料日は明日以降に設定してください");
      return;
    }
    dispatch({ type: "NEW_PAY_PERIOD", income: n, nextPayday });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-10 relative">
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />

        {canDismiss && (
          <button onClick={() => dispatch({ type: "SET_MODAL", modal: null })}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 text-lg font-bold">
            ×
          </button>
        )}

        {isPastDue ? (
          <>
            <p className="text-3xl mb-1">💰</p>
            <p className="font-black text-stone-900 text-xl mb-1">給料日お疲れ様！</p>
            <p className="text-stone-500 text-sm mb-5">今月のシフト収入と次の給料日を入力してください。</p>
          </>
        ) : (
          <>
            <p className="text-3xl mb-1">👋</p>
            <p className="font-black text-stone-900 text-xl mb-1">はじめよう</p>
            <p className="text-stone-500 text-sm mb-5">今月の収入と次の給料日を入力してください。</p>
          </>
        )}

        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">今月の収入（バイト代）</p>
        <div className="bg-stone-50 rounded-2xl p-4 mb-3 flex items-center gap-2">
          <span className="text-stone-400 text-2xl font-light">¥</span>
          <input type="number" value={income} onChange={(e) => setIncome(e.target.value)}
            className="text-3xl font-black text-stone-900 bg-transparent border-none outline-none flex-1 min-w-0"
            placeholder="0" autoFocus inputMode="numeric" />
        </div>
        <div className="grid grid-cols-4 gap-2 mb-5">
          {[50000, 80000, 100000, 120000].map((n) => (
            <button key={n} onClick={() => setIncome(String(n))}
              className={"py-2 rounded-xl text-xs font-bold transition-all " +
                (income === String(n) ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 active:bg-stone-200")}>
              {(n / 10000).toFixed(0)}万
            </button>
          ))}
        </div>

        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">次の給料日</p>
        <input type="date" value={nextPayday} onChange={(e) => setNextPayday(e.target.value)}
          min={getTodayStr()}
          className="w-full bg-stone-50 rounded-xl p-3.5 text-stone-800 font-semibold outline-none border-none text-base mb-6" />

        <button onClick={handleConfirm}
          disabled={!income || !nextPayday}
          className="w-full bg-stone-900 text-white font-black text-lg py-4 rounded-2xl disabled:opacity-30 active:bg-stone-700 transition-colors">
          スタート 🚀
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 🏠  HOME TAB
// ============================================================
function HomeTab({ state, dispatch }) {
  const { profile, expenses } = state;
  const budget = calcBudget(profile, expenses);
  const streak = calcStreak(expenses, budget.safeDaily, profile.lastPayday);
  const daysUntilPay = profile.nextPayday ? getDaysUntil(profile.nextPayday) : null;
  const spentPct = budget.freeMoney > 0 ? (budget.totalSpent / budget.freeMoney) * 100 : 0;

  const safeColor = budget.remaining <= 0 ? "#f43f5e"
    : budget.safeDaily > 5000 ? "#10b981"
    : budget.safeDaily > 2000 ? "#f59e0b"
    : "#f43f5e";

  // Today card state
  const hasSpentToday = budget.todaySpent > 0;
  const todaySaved  = budget.todayDiff > 0;
  const todayOver   = budget.todayDiff < 0;
  const todayExact  = budget.todayDiff === 0 && hasSpentToday;
  const todayNone   = !hasSpentToday;

  return (
    <div className="space-y-3">

      {/* ── HERO ── */}
      <Card className="p-6 text-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1c1917 0%, #292524 100%)" }}>
        <p className="text-stone-400 text-xs font-semibold tracking-widest uppercase mb-2">今日使える金額</p>
        <p className="font-black tracking-tight" style={{ fontSize: "3.2rem", lineHeight: 1, color: safeColor }}>
          {budget.remaining <= 0 ? "¥0" : fmt(budget.safeDaily)}
        </p>
        <p className="text-stone-500 text-xs mt-2">
          {daysUntilPay !== null ? `給料日まで ${daysUntilPay}日` : "給料日未設定"}
          {" · "}
          {fmt(Math.max(budget.remaining, 0))} 残高
        </p>
        {streak > 1 && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full">
            🔥 {streak}日連続予算内
          </div>
        )}
      </Card>

      {/* ── TODAY STATUS ── */}
      {budget.safeDaily > 0 && (
        <Card className={"p-4 " + (todaySaved ? "bg-emerald-50 border-emerald-100" : todayOver ? "bg-rose-50 border-rose-200" : "")}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">
              {todayNone ? "☀️" : todaySaved ? "✨" : todayOver ? "😬" : "🎯"}
            </span>
            <div className="flex-1">
              {todayNone && <p className="font-bold text-stone-700 text-sm">今日はまだ支出なし</p>}
              {todaySaved && <p className="font-bold text-emerald-700 text-sm">今日は {fmt(budget.todayDiff)} 節約中！</p>}
              {todayOver  && <p className="font-bold text-rose-700 text-sm">今日は {fmt(Math.abs(budget.todayDiff))} オーバー</p>}
              {todayExact && <p className="font-bold text-stone-800 text-sm">ぴったり！完璧です 🎯</p>}
              <p className="text-xs mt-0.5" style={{ color: todayOver ? "#f87171" : "#9ca3af" }}>
                今日の支出 {fmt(budget.todaySpent)} ／ 目標 {fmt(budget.safeDaily)}
              </p>
            </div>
          </div>
          <ProgressBar
            pct={budget.safeDaily > 0 ? (budget.todaySpent / budget.safeDaily) * 100 : 0}
            color={todayOver ? "#f43f5e" : "#10b981"}
          />
        </Card>
      )}

      {/* ── OVERSPENDING WARNING ── */}
      {budget.overspending && (
        <Card className="p-4 bg-rose-50 border-rose-200">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-rose-700 font-bold text-sm">ペースが速すぎます</p>
              <p className="text-rose-500 text-xs mt-0.5">
                このペースだとあと <strong className="text-rose-700">{budget.runOutDays}日</strong> でなくなります
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── PERIOD BUDGET BAR ── */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="font-bold text-stone-800 text-sm">今期の予算</p>
          <Badge color={spentPct > 85 ? "red" : spentPct > 60 ? "amber" : "green"}>
            {Math.min(Math.round(spentPct), 100)}% 使用
          </Badge>
        </div>
        <ProgressBar pct={spentPct} color={safeColor} />
        <div className="flex justify-between mt-2.5 text-xs text-stone-400">
          <span>支出 {fmt(budget.totalSpent)}</span>
          <span>自由資金 {fmt(Math.max(budget.freeMoney, 0))}</span>
        </div>
      </Card>

      {/* ── QUICK STATS ── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "今月収入",   value: fmt(profile.currentIncome || 0) },
          { label: "固定費",     value: fmt(budget.totalFixed) },
          { label: "日平均支出", value: fmt(budget.dailyAvg) },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="text-stone-400 text-xs mb-1">{s.label}</p>
            <p className="font-bold text-stone-800 text-sm">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* ── PAYDAY COUNTDOWN ── */}
      {daysUntilPay !== null && (
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-xl">💰</div>
          <div className="flex-1">
            {daysUntilPay > 0 && <p className="font-bold text-stone-800 text-sm">給料日まであと {daysUntilPay}日</p>}
            {daysUntilPay === 0 && <p className="font-bold text-emerald-700 text-sm">🎉 今日は給料日！</p>}
            {daysUntilPay < 0 && <p className="font-bold text-rose-600 text-sm">給料日を更新してください</p>}
            <p className="text-stone-400 text-xs">{profile.nextPayday}</p>
          </div>
          {daysUntilPay <= 0 && (
            <button onClick={() => dispatch({ type: "SET_MODAL", modal: "newPeriod" })}
              className="bg-stone-900 text-white text-xs font-bold px-3 py-2 rounded-xl active:bg-stone-700">
              {daysUntilPay === 0 ? "受け取った！" : "更新する"}
            </button>
          )}
        </Card>
      )}

      {/* ── TODAY SUMMARY ── */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold text-stone-800 text-sm">今日のまとめ</p>
          <Badge color={budget.todaySpent === 0 ? "stone" : budget.todayDiff >= 0 ? "green" : "red"}>
            {budget.todaySpent === 0 ? "支出なし" : budget.todayDiff >= 0 ? `${fmt(budget.todayDiff)} 節約` : `${fmt(Math.abs(budget.todayDiff))} オーバー`}
          </Badge>
        </div>

        {/* Today progress bar */}
        <div className="mb-3">
          <ProgressBar
            pct={budget.safeDaily > 0 ? (budget.todaySpent / budget.safeDaily) * 100 : 0}
            color={budget.todayDiff < 0 ? "#f43f5e" : "#10b981"}
          />
          <div className="flex justify-between text-xs text-stone-400 mt-1.5">
            <span>使用 {fmt(budget.todaySpent)}</span>
            <span>目標 {fmt(budget.safeDaily)}</span>
          </div>
        </div>

        {/* Category breakdown for today */}
        {Object.keys(budget.todayCats).length > 0 ? (
          <div className="space-y-1.5 pt-2 border-t border-stone-50">
            {Object.entries(budget.todayCats)
              .sort((a, b) => b[1] - a[1])
              .map(([catId, amount]) => (
                <div key={catId} className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">
                    {CAT_MAP[catId]?.emoji} {CAT_MAP[catId]?.label}
                  </span>
                  <span className="font-bold text-stone-800 text-sm">{fmt(amount)}</span>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-center text-stone-400 text-xs pt-1">今日はまだ何も記録していません ☀️</p>
        )}
      </Card>

      {/* ── GOALS ── */}
      {profile.goals.length > 0 && (
        <div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 px-1">🎯 目標</p>
          {profile.goals.map((goal) => {
            const pct = goal.target > 0 ? (Number(goal.saved) / Number(goal.target)) * 100 : 0;
            return (
              <Card key={goal.id} className="p-4 mb-2">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-bold text-stone-800 text-sm">{goal.name}</p>
                  <p className="text-xs text-stone-400">{fmt(goal.saved)} / {fmt(goal.target)}</p>
                </div>
                <ProgressBar pct={pct} color="#6366f1" />
                <p className="text-xs text-stone-400 mt-1">{Math.round(pct)}% 達成 {pct >= 100 ? "🎉" : ""}</p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 🍞  MEME TOAST
// ============================================================
function MemeToast({ message, onDone }) {
  return (
    <div
      className="fixed top-6 left-1/2 z-[100] animate-bounce-in"
      style={{
        transform: "translateX(-50%)",
        animation: "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}
    >
      <div className="bg-stone-900 text-white font-black text-base px-5 py-3 rounded-2xl shadow-2xl whitespace-nowrap">
        {message}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(-50%) scale(0.7) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) scale(1)   translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// ➕  ADD EXPENSE MODAL
// ============================================================
function AddExpenseModal({ dispatch, onAdded }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");

  const handleSubmit = () => {
    const n = parseInt(amount, 10);
    if (!n || n <= 0) return;
    dispatch({
      type: "ADD_EXPENSE",
      expense: { id: Date.now().toString(), amount: n, category, note: note.trim(), date: getTodayStr() },
    });
    onAdded(n); // trigger sound + meme
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && dispatch({ type: "SET_MODAL", modal: null })}>
      <div className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-10">
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />
        <p className="font-black text-stone-900 text-xl mb-4">支出を追加</p>

        {/* Amount input */}
        <div className="bg-stone-50 rounded-2xl p-4 mb-4 text-center">
          <p className="text-stone-400 text-xs mb-1">金額</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-3xl font-light text-stone-400">¥</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="text-4xl font-black text-stone-900 bg-transparent border-none outline-none w-44 text-center"
              placeholder="0" autoFocus inputMode="numeric" />
          </div>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mb-4">
          {[500, 1000, 2000, 5000].map((n) => (
            <button key={n} onClick={() => setAmount(String(n))}
              className={"flex-1 rounded-xl py-2 text-sm font-bold transition-all " +
                (amount === String(n) ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 active:bg-stone-200")}>
              ¥{n.toLocaleString()}
            </button>
          ))}
        </div>

        {/* Categories */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {CATEGORIES.map((cat) => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={"flex flex-col items-center py-2.5 rounded-xl text-xs font-medium transition-all " +
                (category === cat.id ? "bg-stone-900 text-white scale-105 shadow-md" : "bg-stone-100 text-stone-600")}>
              <span className="text-lg mb-0.5">{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Note */}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full bg-stone-50 rounded-xl p-3 text-sm text-stone-700 border-none outline-none mb-5 placeholder-stone-400"
          placeholder="メモ（任意）" />

        <button onClick={handleSubmit} disabled={!amount || Number(amount) <= 0}
          className="w-full bg-stone-900 text-white font-black text-lg py-4 rounded-2xl disabled:opacity-30 active:bg-stone-700 transition-colors">
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

  const grouped = [...expenses]
    .sort((a, b) => b.date.localeCompare(a.date))
    .reduce((acc, e) => {
      const dateObj = new Date(e.date);
      const d = dateObj.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
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
            <p className="text-xs font-semibold text-stone-400">{fmt(items.reduce((s, e) => s + Number(e.amount), 0))}</p>
          </div>
          <Card>
            {items.map((expense, i) => (
              <div key={expense.id}
                className={"flex items-center justify-between p-4 " + (i < items.length - 1 ? "border-b border-stone-50" : "")}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center text-xl flex-shrink-0">
                    {CAT_MAP[expense.category]?.emoji || "📦"}
                  </div>
                  <div>
                    <p className="font-semibold text-stone-800 text-sm">{expense.note || CAT_MAP[expense.category]?.label}</p>
                    <p className="text-xs text-stone-400">{CAT_MAP[expense.category]?.label}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold text-stone-900">{fmt(expense.amount)}</p>
                  <button onClick={() => dispatch({ type: "DELETE_EXPENSE", id: expense.id })}
                    className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition-colors text-sm font-bold flex-shrink-0">
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
  const [tab, setTab] = useState("current");
  const history = profile.periodHistory || [];

  const catTotals = {};
  budget.periodExpenses.forEach((e) => {
    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
  });
  const catList = CATEGORIES
    .map((c) => ({ ...c, total: catTotals[c.id] || 0 }))
    .sort((a, b) => b.total - a.total);
  const maxCat = Math.max(...catList.map((c) => c.total), 1);

  return (
    <div className="space-y-3">
      <div className="flex bg-stone-100 rounded-2xl p-1 gap-1">
        {[{ id: "current", label: "今期" }, { id: "history", label: "過去の記録" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={"flex-1 py-2 rounded-xl text-sm font-bold transition-all " +
              (tab === t.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-400")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "current" && (
        <>
          {/* Category breakdown */}
          <Card className="p-4">
            <p className="font-bold text-stone-800 text-sm mb-4">💸 カテゴリ別支出（今期）</p>
            {budget.periodExpenses.length === 0
              ? <p className="text-stone-400 text-sm text-center py-4">今期の支出はまだありません</p>
              : (
                <div className="space-y-3">
                  {catList.map((cat) => (
                    <div key={cat.id}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-medium text-stone-700">{cat.emoji} {cat.label}</span>
                        <span className="text-stone-500 font-semibold">{fmt(cat.total)}</span>
                      </div>
                      <ProgressBar pct={(cat.total / maxCat) * 100} color="#6366f1" />
                    </div>
                  ))}
                </div>
              )
            }
          </Card>

          {/* Pace analysis */}
          <Card className="p-4">
            <p className="font-bold text-stone-800 text-sm mb-3">📈 日次ペース分析</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-stone-50 rounded-xl p-3 text-center">
                <p className="text-xs text-stone-400 mb-1">目標日額</p>
                <p className="font-black text-stone-900 text-2xl">{fmt(budget.safeDaily)}</p>
              </div>
              <div className={"rounded-xl p-3 text-center " + (budget.overspending ? "bg-rose-50" : "bg-emerald-50")}>
                <p className="text-xs text-stone-400 mb-1">7日間の日平均</p>
                <p className={"font-black text-2xl " + (budget.overspending ? "text-rose-600" : "text-emerald-600")}>
                  {fmt(budget.dailyAvg)}
                </p>
              </div>
            </div>
            <p className={"text-xs text-center font-semibold " + (budget.overspending ? "text-rose-500" : "text-emerald-600")}>
              {budget.overspending
                ? `⚠️ 日平均が目標を ${fmt(budget.dailyAvg - budget.safeDaily)} 超過`
                : "✅ ペースは良好です"}
            </p>
          </Card>

          {/* Period overview */}
          <Card className="p-4">
            <p className="font-bold text-stone-800 text-sm mb-3">🗓️ 今期の概要</p>
            {[
              { label: "バイト収入",   val: fmt(profile.currentIncome || 0), color: "text-emerald-600" },
              { label: "固定費",       val: "−" + fmt(budget.totalFixed),    color: "text-stone-500" },
              { label: "今期の支出",   val: "−" + fmt(budget.totalSpent),    color: "text-rose-500" },
              { label: "残高",         val: fmt(Math.max(budget.remaining, 0)), color: "text-stone-900 font-black" },
              { label: "節約できた額", val: fmt(Math.max(budget.remaining, 0)), color: "text-emerald-600 font-black" },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center py-2.5 border-b border-stone-50 last:border-0">
                <p className="text-sm text-stone-500">{row.label}</p>
                <p className={"text-sm font-bold " + row.color}>{row.val}</p>
              </div>
            ))}
          </Card>
        </>
      )}

      {tab === "history" && (
        <>
          {history.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="text-4xl mb-3">📂</p>
              <p className="text-stone-500 font-semibold text-sm">まだ履歴がありません</p>
              <p className="text-stone-400 text-xs mt-1">給料期間が終わると自動で記録されます</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((h, i) => {
                const savePct = h.income > 0 ? Math.round((h.saved / h.income) * 100) : 0;
                return (
                  <Card key={i} className="p-4">
                    <p className="text-xs text-stone-400 font-medium mb-3">{h.period}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
                      <div>
                        <p className="text-xs text-stone-400">収入</p>
                        <p className="font-black text-stone-900">{fmt(h.income)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-400">節約</p>
                        <p className={"font-black " + (h.saved > 0 ? "text-emerald-600" : "text-stone-400")}>{fmt(h.saved)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-400">固定費</p>
                        <p className="font-bold text-stone-600 text-sm">{fmt(h.fixed)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-400">変動支出</p>
                        <p className="font-bold text-stone-600 text-sm">{fmt(h.spent)}</p>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-stone-400">節約率</span>
                      <span className="font-bold text-stone-700">{savePct}%</span>
                    </div>
                    <ProgressBar pct={savePct} color={savePct > 20 ? "#10b981" : savePct > 5 ? "#f59e0b" : "#f43f5e"} />
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// ⚙️  SETTINGS TAB
// ============================================================
function ProfileTab({ state, dispatch }) {
  const { profile } = state;
  const [fixedExpenses, setFixedExpenses] = useState(profile.fixedExpenses);
  const [newFixed, setNewFixed] = useState({ label: "", amount: "" });
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [saved, setSaved] = useState(false);
  const [goalInputs, setGoalInputs] = useState({});

  const handleSave = () => {
    dispatch({ type: "UPDATE_PROFILE", profile: { fixedExpenses } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addFixed = () => {
    if (!newFixed.label.trim() || !newFixed.amount) return;
    setFixedExpenses((prev) => [
      ...prev,
      { id: Date.now().toString(), label: newFixed.label.trim(), amount: parseInt(newFixed.amount) || 0 },
    ]);
    setNewFixed({ label: "", amount: "" });
  };

  const addGoal = () => {
    if (!goalName.trim() || !goalTarget) return;
    dispatch({
      type: "ADD_GOAL",
      goal: { id: Date.now().toString(), name: goalName.trim(), target: parseInt(goalTarget) || 0, saved: 0 },
    });
    setGoalName(""); setGoalTarget("");
  };

  const applyGoalDelta = (g, sign) => {
    const delta = parseInt(goalInputs[g.id] || "0", 10);
    if (!delta || delta <= 0) return;
    const newSaved = Math.max(0, Number(g.saved) + sign * delta);
    dispatch({ type: "UPDATE_GOAL_SAVED", id: g.id, saved: newSaved });
    setGoalInputs((p) => ({ ...p, [g.id]: "" }));
  };

  return (
    <div className="space-y-3">
      {/* Current period card */}
      <Card className="p-4" style={{ background: "linear-gradient(135deg, #1c1917, #292524)" }}>
        <p className="text-stone-400 text-xs font-semibold mb-3 uppercase tracking-widest">今期の状況</p>
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-stone-400 text-xs">今月収入</p>
            <p className="text-white font-black text-2xl">{fmt(profile.currentIncome || 0)}</p>
          </div>
          <div className="text-right">
            <p className="text-stone-400 text-xs">次の給料日</p>
            <p className="text-white font-bold">{profile.nextPayday || "未設定"}</p>
            {profile.nextPayday && (
              <p className="text-stone-400 text-xs mt-0.5">
                {getDaysUntil(profile.nextPayday) > 0
                  ? `あと ${getDaysUntil(profile.nextPayday)}日`
                  : getDaysUntil(profile.nextPayday) === 0 ? "今日！"
                  : "期限切れ"}
              </p>
            )}
          </div>
        </div>
        <button onClick={() => dispatch({ type: "SET_MODAL", modal: "newPeriod" })}
          className="w-full bg-white/10 hover:bg-white/15 text-white text-sm font-bold py-2.5 rounded-xl active:bg-white/20 transition-colors">
          新しい給料期間を設定 →
        </button>
      </Card>

      {/* Fixed expenses */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-3">📌 固定費</p>
        {fixedExpenses.length === 0 && (
          <p className="text-stone-400 text-xs mb-3 text-center py-2">固定費はまだありません</p>
        )}
        {fixedExpenses.map((fe) => (
          <div key={fe.id} className="flex items-center justify-between py-2.5 border-b border-stone-50 last:border-0">
            <p className="text-sm text-stone-700">{fe.label}</p>
            <div className="flex items-center gap-3">
              <p className="font-bold text-stone-800">{fmt(fe.amount)}</p>
              <button onClick={() => setFixedExpenses((prev) => prev.filter((f) => f.id !== fe.id))}
                className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 text-sm font-bold transition-colors">
                ×
              </button>
            </div>
          </div>
        ))}
        <div className="flex gap-2 mt-3">
          <input type="text" value={newFixed.label}
            onChange={(e) => setNewFixed((p) => ({ ...p, label: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addFixed()}
            className="flex-1 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="名前（例：携帯）" />
          <input type="number" value={newFixed.amount}
            onChange={(e) => setNewFixed((p) => ({ ...p, amount: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addFixed()}
            className="w-24 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
            placeholder="金額" inputMode="numeric" />
          <button onClick={addFixed}
            className="bg-stone-900 text-white rounded-xl px-3 text-sm font-bold active:bg-stone-700">
            追加
          </button>
        </div>
      </Card>

      {/* Goals */}
      <Card className="p-4">
        <p className="font-bold text-stone-800 text-sm mb-4">🎯 貯蓄目標</p>
        {profile.goals.length === 0 && (
          <p className="text-stone-400 text-xs text-center py-2 mb-3">目標はまだありません</p>
        )}
        {profile.goals.map((g) => {
          const pct = Number(g.target) > 0 ? (Number(g.saved) / Number(g.target)) * 100 : 0;
          return (
            <div key={g.id} className="mb-5 pb-5 border-b border-stone-100 last:border-0 last:mb-0 last:pb-0">
              <div className="flex justify-between items-start mb-1">
                <p className="font-bold text-stone-800 text-sm">{g.name}</p>
                <button onClick={() => dispatch({ type: "DELETE_GOAL", id: g.id })}
                  className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-rose-100 hover:text-rose-500 text-xs font-bold transition-colors ml-2 flex-shrink-0">
                  ×
                </button>
              </div>
              <div className="flex justify-between text-xs text-stone-400 mb-2">
                <span>貯蓄済み <strong className="text-stone-700">{fmt(g.saved)}</strong></span>
                <span>目標 {fmt(g.target)}</span>
              </div>
              <ProgressBar pct={pct} color="#6366f1" />
              <p className="text-xs text-stone-400 mt-1 mb-3">
                {Math.round(pct)}% 達成
                {pct >= 100 ? " 🎉 達成！" : ` · あと ${fmt(Number(g.target) - Number(g.saved))}`}
              </p>

              {/* +/− controls */}
              <div className="flex items-center gap-2">
                <button onClick={() => applyGoalDelta(g, -1)}
                  className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 font-black text-xl flex items-center justify-center active:bg-rose-100 flex-shrink-0">
                  −
                </button>
                <div className="flex-1 bg-stone-50 rounded-xl flex items-center px-3 h-10">
                  <span className="text-stone-400 text-sm mr-1">¥</span>
                  <input type="number" value={goalInputs[g.id] || ""}
                    onChange={(e) => setGoalInputs((p) => ({ ...p, [g.id]: e.target.value }))}
                    className="flex-1 bg-transparent text-sm font-bold text-stone-800 outline-none border-none placeholder-stone-400 min-w-0"
                    placeholder="金額を入力" inputMode="numeric" />
                </div>
                <button onClick={() => applyGoalDelta(g, 1)}
                  className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 font-black text-xl flex items-center justify-center active:bg-emerald-100 flex-shrink-0">
                  ＋
                </button>
              </div>
              <p className="text-center text-xs text-stone-400 mt-1.5">
                ＋ で貯金を追加 ／ − で引き出し
              </p>
            </div>
          );
        })}

        {/* Add new goal */}
        <div className="pt-3 border-t border-stone-50 mt-1">
          <p className="text-xs font-bold text-stone-400 mb-2 uppercase tracking-wide">新しい目標</p>
          <div className="flex gap-2">
            <input type="text" value={goalName} onChange={(e) => setGoalName(e.target.value)}
              className="flex-1 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400 min-w-0"
              placeholder="目標名（例：MacBook）" />
            <input type="number" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)}
              className="w-28 bg-stone-50 rounded-xl p-2.5 text-sm text-stone-700 outline-none border-none placeholder-stone-400"
              placeholder="目標額" inputMode="numeric" />
            <button onClick={addGoal}
              className="bg-indigo-600 text-white rounded-xl px-3 text-sm font-bold active:bg-indigo-700">
              追加
            </button>
          </div>
        </div>
      </Card>

      <button onClick={handleSave}
        className={"w-full font-black text-lg py-4 rounded-2xl transition-all duration-300 " +
          (saved ? "bg-emerald-500 text-white" : "bg-stone-900 text-white active:bg-stone-700")}>
        {saved ? "✅ 保存しました" : "固定費を保存"}
      </button>

      <p className="text-center text-xs text-stone-400 pb-2">
        データはこのデバイスのみに保存されています
      </p>
    </div>
  );
}

// ============================================================
// 📱  BOTTOM NAV
// ============================================================
function BottomNav({ activeTab, dispatch }) {
  const tabs = [
    { id: "home",     icon: "🏠", label: "ホーム" },
    { id: "history",  icon: "📋", label: "履歴" },
    { id: "insights", icon: "📊", label: "分析" },
    { id: "profile",  icon: "⚙️",  label: "設定" },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-stone-100 z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="max-w-md mx-auto flex items-center justify-around px-2 pt-1 pb-3">
        {tabs.slice(0, 2).map((t) => (
          <button key={t.id} onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
            className="flex flex-col items-center gap-0.5 py-1 px-4">
            <span className="text-xl">{t.icon}</span>
            <span className={"text-xs font-semibold " + (activeTab === t.id ? "text-stone-900" : "text-stone-400")}>
              {t.label}
            </span>
            {activeTab === t.id && <div className="w-1 h-1 rounded-full bg-stone-900 mt-0.5" />}
          </button>
        ))}
        <button onClick={() => dispatch({ type: "SET_MODAL", modal: "add" })}
          className="w-14 h-14 rounded-full bg-stone-900 flex items-center justify-center shadow-xl -mt-7 active:scale-95 transition-transform">
          <span className="text-white text-3xl font-thin" style={{ marginTop: "-2px" }}>＋</span>
        </button>
        {tabs.slice(2).map((t) => (
          <button key={t.id} onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
            className="flex flex-col items-center gap-0.5 py-1 px-4">
            <span className="text-xl">{t.icon}</span>
            <span className={"text-xs font-semibold " + (activeTab === t.id ? "text-stone-900" : "text-stone-400")}>
              {t.label}
            </span>
            {activeTab === t.id && <div className="w-1 h-1 rounded-full bg-stone-900 mt-0.5" />}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ============================================================
// 🎬  ROOT
// ============================================================
const TAB_TITLES = { home: "学生バジェット", history: "支出履歴", insights: "分析", profile: "設定" };

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { profile } = state;
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const needsSetup = !profile.currentIncome || !profile.nextPayday || isPaydayPast(profile.nextPayday);
  const canDismiss = !needsSetup && state.modal === "newPeriod";
  const showPeriodModal = (needsSetup || state.modal === "newPeriod") && state.modal !== "add";

  // Called right after an expense is added
  const handleExpenseAdded = (amount) => {
    playFaaah();
    // Recalculate budget with the new expense already in state would be ideal,
    // but we can estimate: use current todaySpent + new amount for meme pick
    const budget = calcBudget(profile, state.expenses);
    const newTodaySpent = budget.todaySpent + amount;
    const msg = getMemeMessage(newTodaySpent, budget.safeDaily);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  return (
    <div className="min-h-screen"
      style={{ fontFamily: "'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', sans-serif", background: "#fafaf9" }}>

      {/* Meme toast */}
      {toast && <MemeToast message={toast} onDone={() => setToast(null)} />}

      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-stone-100">
        <div className="max-w-md mx-auto px-4 flex items-center justify-between"
          style={{ paddingTop: "max(env(safe-area-inset-top), 12px)", paddingBottom: "12px" }}>
          <h1 className="font-black text-stone-900 text-lg tracking-tight">{TAB_TITLES[state.activeTab]}</h1>
          {state.activeTab === "home" && (
            <span className="text-xs text-stone-400 font-medium">
              {new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 pb-36">
        {state.activeTab === "home"     && <HomeTab state={state} dispatch={dispatch} />}
        {state.activeTab === "history"  && <HistoryTab state={state} dispatch={dispatch} />}
        {state.activeTab === "insights" && <InsightsTab state={state} />}
        {state.activeTab === "profile"  && <ProfileTab state={state} dispatch={dispatch} />}
      </main>

      <BottomNav activeTab={state.activeTab} dispatch={dispatch} />

      {showPeriodModal && <NewPayPeriodModal profile={profile} dispatch={dispatch} canDismiss={canDismiss} />}
      {state.modal === "add" && <AddExpenseModal dispatch={dispatch} onAdded={handleExpenseAdded} />}
    </div>
  );
}
