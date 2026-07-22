import type { MealType, Ordinal, DayRecord } from './types';

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  afternoon: '午后',
  dinner: '晚餐',
};

// 按时间自动归餐次:<10 早,10-14 午,14-17 午后过渡(不强行算晚餐),≥17 晚。
export function slotFromTime(hhmm: string): MealType {
  const h = Number((hhmm || '').split(':')[0]);
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'afternoon';
  return 'dinner';
}

// 饭点时段判断(模块一·进食识别):早 7-9 / 午 11-13 / 晚 17-19 为"饭点中",
// 前后 ±1h 为"接近饭点",其余"非饭点"。入参用 displayTime(simTime),让模拟时间驱动触发。
// 移植自 A段 eating-detector-demo.html 的 deriveMealTime。
export type MealTimeLevel = 'none' | 'near' | 'in';
export function deriveMealTime(hhmm: string): MealTimeLevel {
  const [hStr, mStr] = (hhmm || '').split(':');
  const h = Number(hStr) + Number(mStr || 0) / 60;
  const in_ = (a: number, b: number) => h >= a && h <= b;
  if (in_(7, 9) || in_(11, 13) || in_(17, 19)) return 'in';
  if (in_(6, 7) || in_(10, 11) || in_(16, 17)) return 'near';
  return 'none';
}

export function dateStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateLabel(s: string): string {
  if (s === dateStr(0)) return '今天';
  if (s === dateStr(-1)) return '昨天';
  const [, m, d] = s.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function weekdayLabel(s: string): string {
  const d = new Date(s + 'T00:00:00');
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 设备端显示/打戳用的时间:sim 为 null 时走真实时间,否则走模拟时间。
export function displayTime(sim: string | null): string {
  return sim ?? nowHHMM();
}

// 模拟时钟 → epoch ms(simDate + simTime)。无 simDate 时回退真实时间。
// 用于记录 createdAt 与 48h 自动归档判定。
export function simEpoch(simDate: string | null, simTime: string | null): number {
  if (!simDate) return Date.now();
  const [h, m] = (simTime || nowHHMM()).split(':').map(Number);
  const d = new Date(simDate + 'T00:00:00');
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

// 历史习惯(PRD 模块一·辅助信号):从过去已确认正餐推导。
// 当前 simTime 落在某 slot,若任一已确认同 slot 餐时间在 ±20min 内,即"符合历史"。
export function deriveHistory(days: DayRecord[], simTime: string | null, simDate: string | null): boolean {
  const cur = displayTime(simTime);
  const [ch, cm] = cur.split(':').map(Number);
  const curMin = (ch || 0) * 60 + (cm || 0);
  const slot = slotFromTime(cur);
  for (const d of days) {
    for (const m of d.meals) {
      if (!m.confirmed || m.type !== slot) continue;
      const [mh, mm] = (m.time || '').split(':').map(Number);
      if (Math.abs(((mh || 0) * 60 + (mm || 0)) - curMin) <= 20) return true;
    }
  }
  return false;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// 用 canvas 生成示例餐食缩略图(emoji + 渐变底),让照片墙有真实图片可看。
export function emojiPhoto(emoji: string, bg: string, label?: string): string {
  try {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 360;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 480, 360);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(250, 150, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '150px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 240, 165);
    if (label) {
      ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(label, 240, 320);
    }
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return '';
  }
}

export const ORDINAL_RANK: Record<Ordinal, number> = { 偏少: 1, 适中: 2, 偏多: 3 };
export const ORDINAL_COLOR: Record<Ordinal, string> = { 偏少: '#e07a5f', 适中: '#6bbf8f', 偏多: '#e8a04f' };
