import { create } from 'zustand';
import { uid, dateStr, nowHHMM } from './utils';

export type ParentTab = 'daily' | 'photos' | 'weekly' | 'settings';

export interface Toast {
  id: string;
  ico: string;
  title: string;
  body?: string;
}

// 进食触发事件:useEatingMonitor 触发时写入,InfoPanel 消费后清空。
// 作为 EatingMonitor 与 InfoPanel 之间的跨组件事件通道(同 Toaster/simTime 模式)。
export interface EatingConfirm {
  id: string;
  p: number; // 触发时的 P(Eating)
  time: string; // HH:MM
  mealTime: 'none' | 'near' | 'in';
}

interface UIState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
  parentTab: ParentTab;
  setParentTab: (t: ParentTab) => void;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  // 测试用模拟时间:null = 跟随真实值,否则用设定值。
  simTime: string | null; // HH:MM
  setSimTime: (t: string | null) => void;
  simDate: string | null; // YYYY-MM-DD
  setSimDate: (d: string | null) => void;
  // 进食触发确认事件:EatingMonitor 触发 → startEatingConfirm;InfoPanel 确认完成 → endEatingConfirm。
  eatingConfirm: EatingConfirm | null;
  startEatingConfirm: (snap: EatingConfirm) => void;
  endEatingConfirm: () => void;
  // 手环视觉状态(模拟震动/抬腕/说话/倾听/短等待),驱动 Band 动画。
  bandState: 'idle' | 'vibrating' | 'raising' | 'speaking' | 'listening' | 'waiting';
  setBandState: (s: 'idle' | 'vibrating' | 'raising' | 'speaking' | 'listening' | 'waiting') => void;
  // 抬腕门(PRD 模块一:短震后等抬腕 8-10s)。InfoPanel 进门时 setAwaitingRaise(true);
  // Band 的「抬腕」按钮在门控期间点击 → signalRaise() → InfoPanel 监听 resolve 进第一问。
  awaitingRaise: boolean;
  setAwaitingRaise: (b: boolean) => void;
  raiseSignal: number;
  signalRaise: () => void;
  // 调试用:跳过 going_to_eat 短等待,立刻触发二次轻提醒。
  skipWaitSignal: number;
  signalSkipWait: () => void;
  // 短等待开始时间戳(ms),0 = 不在短等待中;供倒计时面板读取。
  shortWaitStartedAt: number;
  shortWaitDurationMs: number;
  setShortWait: (startedAt: number, durationMs: number) => void;
  clearShortWait: () => void;
  // 统一语音:ASR 开关 + 实时转写(由 InfoPanel 管理 ASR 实例,EatingMonitor 读取展示)。
  voiceActive: boolean;
  setVoiceActive: (b: boolean) => void;
  voiceInterim: string;
  setVoiceInterim: (s: string) => void;
  voiceLastTranscript: string;
  setVoiceLastTranscript: (s: string) => void;
}

export const useUI = create<UIState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  parentTab: 'daily',
  setParentTab: (t) => set({ parentTab: t }),
  selectedDate: dateStr(0),
  setSelectedDate: (d) => set({ selectedDate: d }),
  simTime: null,
  setSimTime: (t) => set({ simTime: t }),
  simDate: null,
  setSimDate: (d) => set({ simDate: d }),
  eatingConfirm: null,
  startEatingConfirm: (snap) => set({ eatingConfirm: snap }),
  endEatingConfirm: () => set({ eatingConfirm: null }),
  bandState: 'idle',
  setBandState: (s) => set({ bandState: s }),
  awaitingRaise: false,
  setAwaitingRaise: (b) => set({ awaitingRaise: b }),
  raiseSignal: 0,
  signalRaise: () => set((s) => ({ raiseSignal: s.raiseSignal + 1 })),
  skipWaitSignal: 0,
  signalSkipWait: () => set((s) => ({ skipWaitSignal: s.skipWaitSignal + 1 })),
  shortWaitStartedAt: 0,
  shortWaitDurationMs: 0,
  setShortWait: (startedAt, durationMs) => set({ shortWaitStartedAt: startedAt, shortWaitDurationMs: durationMs }),
  clearShortWait: () => set({ shortWaitStartedAt: 0, shortWaitDurationMs: 0 }),
  voiceActive: false,
  setVoiceActive: (b) => set({ voiceActive: b }),
  voiceInterim: '',
  setVoiceInterim: (s) => set({ voiceInterim: s }),
  voiceLastTranscript: '',
  setVoiceLastTranscript: (s) => set({ voiceLastTranscript: s }),
}));

// 给 <input type="time"> 用:模拟时间为空时回退到真实时间。
export function simOrNow(sim: string | null): string {
  return sim ?? nowHHMM();
}
