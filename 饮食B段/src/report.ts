import type { DayRecord, Meal, MealType, Ordinal, DayInteractions } from './types';
import { ORDINAL_RANK, simEpoch } from './utils';
import { useUI } from './ui';

const MEAL_NAME: Record<MealType, string> = { breakfast: '早餐', lunch: '午餐', afternoon: '午后', dinner: '晚餐' };
const SLOT_ORDER: MealType[] = ['breakfast', 'lunch', 'afternoon', 'dinner' ];
const ARCHIVE_MS = 48 * 60 * 60 * 1000;

// 当日互动统计(缺省补零)。
export function dayInteractions(day: DayRecord): DayInteractions {
  return day.interactions || { scienceCount: 0, scienceFoods: [], persuadeCount: 0 };
}

// 48h 未确认归档(PRD §五):未确认且 createdAt 超 48h(sim 时钟)。
export function isArchived(m: { confirmed: boolean; createdAt?: number }): boolean {
  if (m.confirmed || m.createdAt == null) return false;
  return simEpoch(useUI.getState().simDate, useUI.getState().simTime) - m.createdAt > ARCHIVE_MS;
}

// 营养小科普可否播放(PRD 模块二·三):正餐+有照片+高置信+已识别具体食物+本餐未播
// +当天同食物未播+当天<3+非糖果/膨化/含糖饮料。本餐未播由"新记录"自然满足。
export function canPlayScience(r: { kind: string; confidence: 'high' | 'low'; foodsDetected?: string }, isVoice: boolean, day: DayRecord): boolean {
  if (isVoice) return false;
  if ((r.kind !== 'meal' && r.kind !== 'fruit') || r.confidence !== 'high') return false;
  const food = (r.foodsDetected || (r as any).name || '').trim();
  if (!food) return false;
  const it = dayInteractions(day);
  if (it.scienceCount >= 3) return false;
  if (it.scienceFoods.includes(food)) return false;
  return true;
}

// 零食劝导可否播放(PRD 模块二·四):零食+识别出糖果/膨化/含糖饮料+当天≤1。
// 语音补录也触发：孩子说了零食名就够，行为引导不依赖照片置信度。
export function canPersuade(r: { kind: string; snackType?: string | null; confidence: 'high' | 'low' }, _isVoice: boolean, day: DayRecord): boolean {
  if (!r.snackType) return false;
  return dayInteractions(day).persuadeCount < 1;
}

// 数据完整度(PRD §五):每 slot 状态 未记录/待确认/已记录 + 已记录数。
export type SlotStatus = 'unrecorded' | 'pending' | 'confirmed';
export function completeness(day: DayRecord): { recorded: number; total: number; slots: Record<MealType, SlotStatus> } {
  const slots = { breakfast: 'unrecorded', lunch: 'unrecorded', afternoon: 'unrecorded', dinner: 'unrecorded' } as Record<MealType, SlotStatus>;
  let recorded = 0;
  for (const slot of SLOT_ORDER) {
    const ms = day.meals.filter((m) => m.type === slot && !isArchived(m));
    if (ms.length === 0) continue;
    const anyConfirmed = ms.some((m) => m.confirmed);
    slots[slot] = anyConfirmed ? 'confirmed' : 'pending';
    if (anyConfirmed) recorded++;
  }
  return { recorded, total: SLOT_ORDER.length, slots };
}

// 近 7 天有效记录中蔬菜偏低天数(≥3 天家长端特别标注)。
export function vegLowDays(valid: DayRecord[]): number {
  let n = 0;
  for (const d of valid) { if (vegOrdinalForDay(d) === '偏少') n++; }
  return n;
}

// 近 7 天有效日(排除异常日)。
export function weekValidDays(days: DayRecord[], endDate: string): DayRecord[] {
  const idx = days.findIndex((d) => d.date === endDate);
  const window = idx >= 0 ? days.slice(Math.max(0, idx - 6), idx + 1) : days.slice(-7);
  return window.filter((d) => !d.isAbnormal);
}

export function mealList(day: DayRecord): Meal[] {
  return day.meals;
}

export function snackCount(day: DayRecord): number {
  return day.extras.filter((e) => e.kind === 'snack').length;
}

// 蔬菜占比数值(序数 rank 均值,仅计已确认餐次——含家长确认的低置信度),用于趋势折线
export function vegRankForDay(day: DayRecord): number | null {
  const ms = day.meals.filter((m) => m.plateRatio['蔬菜'] && m.confirmed && !isArchived(m));
  if (!ms.length) return null;
  const sum = ms.reduce((a, m) => a + ORDINAL_RANK[m.plateRatio['蔬菜'] as Ordinal], 0);
  return sum / ms.length;
}

export function vegOrdinalForDay(day: DayRecord): Ordinal | null {
  const r = vegRankForDay(day);
  if (r === null) return null;
  if (r < 1.5) return '偏少';
  if (r < 2.5) return '适中';
  return '偏多';
}

export function todaySummary(day: DayRecord): string {
  const parts: string[] = [];
  for (const slot of SLOT_ORDER) {
    const ms = day.meals.filter((m) => m.type === slot && !isArchived(m));
    if (!ms.length) { parts.push(`${MEAL_NAME[slot]}:未记录`); continue; }
    const seg = ms.map((m) => {
      const veg = m.plateRatio['蔬菜'] || '未涉及';
      const confTag = m.confirmed ? (m.confidence === 'high' ? '高' : '已确认') : '低·待确认';
      return `${m.foodsDetected || '未知食物'}(蔬菜${veg},置信度${confTag})`;
    }).join('|');
    parts.push(`${MEAL_NAME[slot]}:${seg}`);
  }
  const liveExtras = day.extras.filter((e) => !isArchived(e));
  const snackDrinkNames = liveExtras.filter((e) => e.kind === 'snack' || e.kind === 'drink').map((e) => e.name).filter(Boolean);
  const fruitNames = liveExtras.filter((e) => e.kind === 'fruit').map((e) => e.name).filter(Boolean);
  if (snackDrinkNames.length) parts.push(`零食/饮料:${snackDrinkNames.join('、')}`);
  if (fruitNames.length) parts.push(`水果:${fruitNames.join('、')}`);
  return parts.join('; ');
}

export function trend7d(days: DayRecord[], endDate: string): string {
  const idx = days.findIndex((d) => d.date === endDate);
  const window = idx >= 0 ? days.slice(Math.max(0, idx - 6), idx + 1) : days.slice(-7);
  const valid = window.filter((d) => !d.isAbnormal);
  let vegLow = 0, vegCounted = 0;
  for (const d of valid) {
    const o = vegOrdinalForDay(d);
    if (o) { vegCounted++; if (o === '偏少') vegLow++; }
  }
  const snackTotal = valid.reduce((a, d) => a + snackCount(d), 0);
  return `近 ${valid.length} 天(已排除异常日):蔬菜偏低 ${vegLow}/${vegCounted} 天,零食累计 ${snackTotal} 次。`;
}

// 周报解读 LLM 输入:近 7 天逐日明细(蔬菜等级/异常日 + 零食次数)+ 汇总(排除异常日)。
export function weeklySummary(days: DayRecord[], endDate: string): string {
  const idx = days.findIndex((d) => d.date === endDate);
  const window = idx >= 0 ? days.slice(Math.max(0, idx - 6), idx + 1) : days.slice(-7);
  const lines = window.map((d) => {
    if (d.isAbnormal) return `${d.date} 异常日(不计入趋势)`;
    const veg = vegOrdinalForDay(d) ?? '无数据';
    return `${d.date} 蔬菜${veg} 零食${snackCount(d)}次`;
  });
  const valid = window.filter((d) => !d.isAbnormal);
  let vegLow = 0, vegCounted = 0;
  for (const d of valid) {
    const o = vegOrdinalForDay(d);
    if (o) { vegCounted++; if (o === '偏少') vegLow++; }
  }
  const snackTotal = valid.reduce((a, d) => a + snackCount(d), 0);
  const abnormal = window.length - valid.length;
  return `近 ${window.length} 天逐日明细:\n${lines.join('\n')}\n汇总(已排除异常日 ${abnormal} 天):蔬菜偏低 ${vegLow}/${vegCounted} 天,零食累计 ${snackTotal} 次。`;
}
