import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { DayRecord, Meal, MealType, ParentConfig, ExtraRecord, NutritionReport, WeeklySuggestion } from './types';
import { buildSeedDays, DEFAULT_CONFIG } from './data/seed';
import { dateStr, uid } from './utils';
import { useUI } from './ui';

// 测试历史:每天一条只读快照(去图片),持久化到 localStorage,跨会话保留。
export interface HistoryEntry {
  date: string;
  mealCount: number;
  extraCount: number;
  stars?: number;
  summary?: string;
  snapshot: {
    meals: { type: MealType; time: string; name: string; ratio: Record<string, string> }[];
    extras: { time: string; name: string; kind: 'snack' | 'drink' | 'fruit' }[];
  };
  report?: NutritionReport;
  sig: string;
  updatedAt: number;
}

// 测试用"当前日期":若 UI 设了模拟日期就用它,否则真实今天。设备记录会落到这一天。
function currentDate(): string {
  return useUI.getState().simDate || dateStr(0);
}

interface AppState {
  days: DayRecord[];
  config: ParentConfig;
  // 正餐
  addMeal: (meal: Meal) => void;
  removeMeal: (date: string, id: string) => void;
  patchMeal: (date: string, id: string, patch: Partial<Meal>) => void;
  mealToExtra: (date: string, mealId: string, extra: { name: string; kind: 'snack' | 'drink' | 'fruit' }) => void;
  extraToMeal: (date: string, extraId: string, meal: { slot: MealType; foodsDetected: string; plateRatio: Record<string, any> }) => void;
  // 零食/饮料
  addExtra: (e: Omit<ExtraRecord, 'id'>) => string;
  removeExtra: (date: string, id: string) => void;
  patchExtra: (date: string, id: string, patch: Partial<ExtraRecord>) => void;
  // 其他
  setReportSuggestion: (date: string, suggestion: NutritionReport) => void;
  setWeeklySuggestion: (date: string, suggestion: WeeklySuggestion) => void;
  setConfig: (partial: Partial<ParentConfig>) => void;
  toggleAbnormal: (date: string) => void;
  incInteraction: (date: string, kind: 'science' | 'persuade', food?: string) => void;
  ensureDay: (date: string) => void;
  getDay: (date: string) => DayRecord | undefined;
  today: () => DayRecord;
  history: HistoryEntry[];
  recordHistory: (dates: Set<string>) => void;
}

function patchDay(days: DayRecord[], date: string, fn: (d: DayRecord) => DayRecord): DayRecord[] {
  return days.map((d) => (d.date === date ? fn(d) : d));
}

function upsertDay(days: DayRecord[], date: string, fn: (d: DayRecord) => DayRecord): DayRecord[] {
  const exists = days.find((d) => d.date === date);
  if (exists) return days.map((d) => (d.date === date ? fn(d) : d));
  const blank: DayRecord = { date, meals: [], extras: [] };
  return [...days, fn(blank)].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const byTime = (a: { time: string }, b: { time: string }) => (a.time < b.time ? -1 : 1);

export const useStore = create<AppState>()(persist((set, get) => ({
  days: buildSeedDays(),
  config: DEFAULT_CONFIG,
  history: [],

  addMeal: (meal) =>
    set((s) => ({ days: upsertDay(s.days, currentDate(), (d) => ({ ...d, meals: [...d.meals, meal].sort(byTime) })) })),

  removeMeal: (date, id) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, meals: d.meals.filter((m) => m.id !== id) })) })),

  patchMeal: (date, id, patch) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, meals: d.meals.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort(byTime) })) })),

  mealToExtra: (date, mealId, extra) =>
    set((s) => ({
      days: patchDay(s.days, date, (d) => {
        const m = d.meals.find((x) => x.id === mealId);
        if (!m) return d;
        const newExtra: ExtraRecord = {
          id: uid(), time: m.time, name: extra.name, kind: extra.kind,
          photoUrl: m.photoUrl, confidence: m.confidence, confirmed: true,
        };
        return { ...d, meals: d.meals.filter((x) => x.id !== mealId), extras: [...d.extras, newExtra] };
      }),
    })),

  extraToMeal: (date, extraId, meal) =>
    set((s) => ({
      days: patchDay(s.days, date, (d) => {
        const e = d.extras.find((x) => x.id === extraId);
        if (!e) return d;
        const newMeal: Meal = {
          id: uid(), type: meal.slot, time: e.time, photoUrl: e.photoUrl,
          foodsDetected: meal.foodsDetected, categories: Object.keys(meal.plateRatio) as any,
          plateRatio: meal.plateRatio, confidence: e.confidence, confirmed: true,
        };
        return {
          ...d,
          extras: d.extras.filter((x) => x.id !== extraId),
          meals: [...d.meals, newMeal].sort(byTime),
        };
      }),
    })),

  addExtra: (e) => {
    const id = uid();
    set((s) => ({ days: upsertDay(s.days, currentDate(), (d) => ({ ...d, extras: [...d.extras, { ...e, id }] })) }));
    return id;
  },

  removeExtra: (date, id) =>
    set((s) => ({
      days: patchDay(s.days, date, (d) => ({ ...d, extras: d.extras.filter((x) => x.id !== id) })),
    })),

  patchExtra: (date, id, patch) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, extras: d.extras.map((x) => (x.id === id ? { ...x, ...patch } : x)) })) })),

  setReportSuggestion: (date, suggestion) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, reportSuggestion: suggestion })) })),

  setWeeklySuggestion: (date, suggestion) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, weeklySuggestion: suggestion })) })),

  setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),

  toggleAbnormal: (date) =>
    set((s) => ({ days: patchDay(s.days, date, (d) => ({ ...d, isAbnormal: !d.isAbnormal })) })),

  // 当日儿童端互动计数(科普/劝导频次护栏 + 家长端播放次数)。
  incInteraction: (date, kind, food) =>
    set((s) => ({
      days: upsertDay(s.days, date, (d) => {
        const it = d.interactions || { scienceCount: 0, scienceFoods: [], persuadeCount: 0 };
        if (kind === 'science') {
          return { ...d, interactions: { ...it, scienceCount: it.scienceCount + 1, scienceFoods: food ? [...it.scienceFoods, food] : it.scienceFoods } };
        }
        return { ...d, interactions: { ...it, persuadeCount: it.persuadeCount + 1 } };
      }),
    })),

  ensureDay: (date) =>
    set((s) => (s.days.find((d) => d.date === date) ? {} : { days: upsertDay(s.days, date, (d) => d) })),

  getDay: (date) => get().days.find((d) => d.date === date),
  today: () => {
    const cur = currentDate();
    return get().days.find((d) => d.date === cur) || get().days.find((d) => d.date === dateStr(0)) || get().days[get().days.length - 1];
  },

  // 把指定日期(去图片的只读快照)写进历史;空白天跳过。已有且内容未变则保留旧时间戳。
  recordHistory: (dates) =>
    set((s) => {
      const map = new Map(s.history.map((h) => [h.date, h]));
      for (const date of dates) {
        const d = s.days.find((x) => x.date === date);
        if (!d) continue;
        if (d.meals.length === 0 && d.extras.length === 0) continue;
        const snapshot = {
          meals: d.meals.map((m) => ({ type: m.type, time: m.time, name: m.foodsDetected || m.textDesc || '(未识别)', ratio: { ...(m.plateRatio || {}) } })),
          extras: d.extras.map((e) => ({ time: e.time, name: e.name, kind: e.kind })),
        };
        const sig = JSON.stringify(snapshot) + '|' + (d.reportSuggestion?.stars ?? '');
        const existing = map.get(d.date);
        const updatedAt = !existing || existing.sig !== sig ? Date.now() : existing.updatedAt;
        map.set(d.date, {
          date: d.date, mealCount: d.meals.length, extraCount: d.extras.length,
          stars: d.reportSuggestion?.stars, summary: d.reportSuggestion?.summary,
          snapshot, report: d.reportSuggestion, sig, updatedAt,
        });
      }
      const history = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt || (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
      return { history };
    }),
}), {
  name: 'diet-agent-history',
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ history: s.history }),
}));

// days 变化时,只把"引用变化过的天"写进历史(种子数据不动,避免污染)。
useStore.subscribe((s, prev) => {
  if (s.days === prev.days) return;
  const prevMap = new Map(prev.days.map((d) => [d.date, d]));
  const changed = new Set<string>();
  for (const d of s.days) if (prevMap.get(d.date) !== d) changed.add(d.date);
  if (changed.size > 0) useStore.getState().recordHistory(changed);
});
