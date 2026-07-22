import { useCallback, useEffect, useRef, useState } from 'react';
import { useUI } from '../ui';
import { useStore } from '../store';
import { deriveMealTime, deriveHistory, displayTime, slotFromTime, uid, type MealTimeLevel } from '../utils';
import type { SemanticLevel } from '../types';

// 模块一·进食识别引擎(纯 P 引擎)。
//
// 三因素加法 P(Eating) = min(100, 饭点 + 历史习惯 + AI 进食语义)。
// AI 进食语义 4 级(无0/弱20/中40/强75)。70% 触发、<67% 重新武装。
// 历史习惯由过去已确认正餐自动推导(同 slot ±20min)。
// 冷却在确认流程结束时设(enterCooldown),而非触发时 —— PRD「本轮流程结束→进/刷新冷却」。
//
// ASR 已移出:由 InfoPanel 管理单一 ASR 实例,调 setSpeechLevel 喂进食语义。
// 触发 → onTrigger(snapshot)(由 EatingMonitor 转成 useUI.eatingConfirm)。
// eatingConfirm 活跃时 P-loop 不再 fire(guard !eatingConfirmRef.current)。

export type MonitorApi = ReturnType<typeof useEatingMonitor>;

export interface FactorItem {
  k: string;
  w: number;
}

export interface TriggerLogItem {
  id: string;
  time: string;
  p: number;
  raw: number;
  factors: FactorItem[];
  status: string;
}

export interface MonitorView {
  p: number;
  raw: number;
  factors: FactorItem[];
  mealTime: MealTimeLevel;
  history: boolean;
  semantic: SemanticLevel;
  armed: boolean;
  cooldownRemaining: number;
}

// PRD 模型：饭点 near=40/in=70 + GPS(demo 用历史习惯 10 替代) + 语音语义(demo 扩展，GPS 不可用时补充信号)。
const WEIGHTS = {
  mealTime: { none: 0, near: 40, in: 70 },
  history: 10,
  semantic: { none: 0, weak: 20, mid: 40, strong: 75 } as Record<SemanticLevel, number>,
};
const THRESHOLD = 70;
const REARM = 67;
const COOLDOWN_DEFAULT = 30 * 60 * 1000;
const SPEECH_DECAY_MS = 90 * 1000;
const TICK_MS = 500;

interface Input {
  mealTime: MealTimeLevel;
  history: boolean;
  semantic: SemanticLevel;
}

const SEM_LABEL: Record<SemanticLevel, string> = { none: '无', weak: '弱', mid: '中', strong: '强' };

function compute(s: Input) {
  const items: FactorItem[] = [];
  const mt = WEIGHTS.mealTime[s.mealTime];
  if (mt) items.push({ k: '饭点时段', w: mt });
  if (s.history) items.push({ k: '符合历史习惯', w: WEIGHTS.history });
  const sem = WEIGHTS.semantic[s.semantic];
  if (sem) items.push({ k: `进食语义(${SEM_LABEL[s.semantic]})`, w: sem });
  const raw = items.reduce((a, b) => a + b.w, 0);
  const p = Math.min(100, raw);
  return { items, raw, p };
}

export function useEatingMonitor(onTrigger: (snap: { id: string; p: number; time: string; mealTime: MealTimeLevel }) => void) {
  const simTime = useUI((s) => s.simTime);
  const simDate = useUI((s) => s.simDate);
  const eatingConfirm = useUI((s) => s.eatingConfirm);
  const days = useStore((s) => s.days);

  const active = useUI((s) => s.voiceActive);
  const [triggers, setTriggers] = useState<TriggerLogItem[]>([]);
  const [view, setView] = useState<MonitorView>(() => {
    const s: Input = { mealTime: 'none', history: false, semantic: 'none' };
    const r = compute(s);
    return { factors: r.items, raw: r.raw, p: r.p, mealTime: 'none', history: false, semantic: 'none', armed: true, cooldownRemaining: 0 };
  });

  const simTimeRef = useRef(simTime);
  const simDateRef = useRef(simDate);
  const daysRef = useRef(days);
  const eatingConfirmRef = useRef(eatingConfirm);
  const onTriggerRef = useRef(onTrigger);

  const armedRef = useRef(true);
  const cooldownUntilRef = useRef(0);
  const cooldownMsRef = useRef(COOLDOWN_DEFAULT);
  const speechLevelRef = useRef<SemanticLevel>('none');
  const lastResultTsRef = useRef(0);
  // 已主动完成正餐记录的饭点集合，key = "YYYY-MM-DD:slot"，同一饭点内不再被动触发。
  const doneMealSlotsRef = useRef<Set<string>>(new Set());

  useEffect(() => { simTimeRef.current = simTime; }, [simTime]);
  useEffect(() => { simDateRef.current = simDate; }, [simDate]);
  useEffect(() => { daysRef.current = days; }, [days]);
  useEffect(() => { eatingConfirmRef.current = eatingConfirm; }, [eatingConfirm]);
  useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

  const readState = useCallback((): Input => {
    const history = deriveHistory(daysRef.current, simTimeRef.current, simDateRef.current);
    return {
      mealTime: deriveMealTime(displayTime(simTimeRef.current)),
      history,
      semantic: speechLevelRef.current,
    };
  }, []);

  const fire = useCallback((p: number, raw: number, items: FactorItem[], s: Input) => {
    const id = uid();
    const time = displayTime(simTimeRef.current);
    const rec: TriggerLogItem = { id, time, p: Math.round(p), raw, factors: items, status: 'pending' };
    setTriggers((t) => [rec, ...t].slice(0, 20));
    armedRef.current = false;
    onTriggerRef.current({ id, p: Math.round(p), time, mealTime: s.mealTime });
  }, []);

  const enterCooldown = useCallback(() => {
    cooldownUntilRef.current = Date.now() + cooldownMsRef.current;
  }, []);

  const setCooldownMs = useCallback((ms: number) => {
    cooldownMsRef.current = ms;
  }, []);

  const markTrigger = useCallback((id: string, status: string) => {
    setTriggers((t) => t.map((x) => (x.id === id ? { ...x, status } : x)));
  }, []);

  // 主动完成正餐记录后调用，标记该饭点已记录，本饭点内不再被动触发。
  const markMealSlotDone = useCallback((date: string, slot: string) => {
    doneMealSlotsRef.current = new Set(doneMealSlotsRef.current).add(`${date}:${slot}`);
  }, []);

  // InfoPanel 收到 voiceRoute LLM 结果后调此方法喂进食语义,驱动 P(Eating)。
  const setSpeechLevel = useCallback((level: SemanticLevel) => {
    speechLevelRef.current = level;
    lastResultTsRef.current = Date.now();
  }, []);

  // 主 loop:衰减语音 + 计算 P + 触发/重新武装 + 刷新 view。
  useEffect(() => {
    const iv = setInterval(() => {
      if (speechLevelRef.current !== 'none' && Date.now() - lastResultTsRef.current > SPEECH_DECAY_MS) {
        speechLevelRef.current = 'none';
      }
      const s = readState();
      const { items, raw, p } = compute(s);
      const now = Date.now();
      const cdRem = cooldownUntilRef.current > now ? cooldownUntilRef.current - now : 0;

      const slotKey = `${simDateRef.current}:${slotFromTime(displayTime(simTimeRef.current))}`;
      const slotDone = doneMealSlotsRef.current.has(slotKey);
      if (p >= THRESHOLD && armedRef.current && cdRem === 0 && !eatingConfirmRef.current && !slotDone) {
        fire(p, raw, items, s);
      }
      if (p < REARM && !routePendingRef.current) armedRef.current = true;

      setView({
        p, raw, factors: items,
        mealTime: s.mealTime, history: s.history, semantic: s.semantic,
        armed: armedRef.current, cooldownRemaining: cdRem,
      });
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [readState, fire]);

  const start = useCallback(() => useUI.getState().setVoiceActive(true), []);
  const stop = useCallback(() => useUI.getState().setVoiceActive(false), []);

  const supported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const reset = useCallback(() => {
    armedRef.current = true;
    cooldownUntilRef.current = 0;
  }, []);

  // voiceRoute LLM 请求期间锁住 P-engine，防止被动流程在结果返回前抢先触发。
  // 主 loop 检查此标记，锁定期间跳过重新武装，确保锁不被 tick 静默解除。
  const routePendingRef = useRef(false);
  const lockArmed = useCallback(() => { routePendingRef.current = true; armedRef.current = false; }, []);
  const unlockArmed = useCallback(() => { routePendingRef.current = false; armedRef.current = true; }, []);

  return {
    active, start, stop, supported,
    view,
    enterCooldown, markTrigger, markMealSlotDone, setSpeechLevel, setCooldownMs,
    reset, lockArmed, unlockArmed,
    triggers,
  };
}
