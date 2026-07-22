import { useCallback, useEffect, useRef, useState } from 'react';
import type { Confidence, Meal, Ordinal, PlateRatio } from '../../types';
import { analyzeIntake, clarifyIntake, conversationTurn, persuadeSnack, voiceRoute, checkChildNote, type AnalyzeIntakeResult, type ReplyIntent } from '../../api';
import { useStore } from '../../store';
import { useUI, type EatingConfirm } from '../../ui';
import type { SemanticLevel } from '../../types';
import CameraCapture from './CameraCapture';
import { speak, speakCancel, speakThen, vibrate } from '../../lib/feedback';
import { canPlayScience, canPersuade } from '../../report';
import { MEAL_LABEL, displayTime, slotFromTime, simEpoch, uid } from '../../utils';

// 从 ReactNode 提取纯文本(用于看板展示)。
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in (node as any)) {
    const { children } = (node as any).props || {};
    return extractText(children);
  }
  return '';
}

const ORDINAL_COLOR: Record<Ordinal, string> = { 偏少: '#e07a5f', 适中: '#6bbf8f', 偏多: '#e8a04f' };
const ORDINAL_BG: Record<Ordinal, string> = { 偏少: 'rgba(224,122,95,0.15)', 适中: 'rgba(107,191,143,0.16)', 偏多: 'rgba(232,160,79,0.18)' };

const RAISE_WAIT = 8000;   // 抬腕等待门
const REPLY_WAIT = 15000;  // 单轮倾听
const SHORT_WAIT = 8 * 60 * 1000; // going_to_eat 短等待:8 分钟(PRD)

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const PHRASES = {
  // 问句类全部由 LLM 生成，此处只保留非对话的系统提示文案
  startPhoto:          ['从上面拍一下食物会更清晰哦！'],
  retakePhoto:         ['往后一点点，重新拍一下'],
  photoFallback:       ['这张没拍清楚，直接告诉我吃了什么吧', '照片看不太清，你能直接告诉我吗？', '没拍清楚诶，你说说吃了啥吧'],
  voiceTimeout:        ['好嘞，那先不打扰你啦～', '行行，我走了'],
  recordDone:          ['好嘞，记下了！', '嗯嗯，记好了！', '记住了', '好，记下啦！'],
  recordVoiceLow:      ['记下了，等爸爸妈妈确认一下哦～'],
  recordPhotoLow:      ['照片没拍太清，先记着，让爸妈确认一下～', '先记下，爸妈帮确认一下哦～'],
  extraLow:            ['没拍太清，先记着，等爸妈确认～', '先记下，让爸爸妈妈确认一下哦～'],
  noDisturbPassive:    ['好嘞，先不打扰你啦～', '行，你先吃，我不管你了～'],
  noDisturbVoiceTimeout: ['好好，先不打扰啦～', '行，你忙，下次再说～'],
  voiceNoFood:         ['能跟我说说，吃了什么吗？'],
  activeCameraReady:   ['好呀，摄像头已打开，请说「开拍」进行拍照'],
  activeRetakeReady:   ['不太清晰，我们再拍一张，请说「开拍」'],
  activeFinalLow:      ['还是不太清，不过我先记下了，回家让爸爸妈妈确认一下'],
  activeVoiceLow:      ['好的，我记下来了，回家让爸爸妈妈确认一下'],
};

interface Msg {
  id: number;
  role: 'bot' | 'user';
  kind?: 'tip' | 'result' | 'loading';
  node: React.ReactNode;
}

let mid = 0;
const nextId = () => ++mid;

function ratioChips(ratio: PlateRatio) {
  return Object.entries(ratio).map(([cat, ord]) => (
    <span key={cat} className="ord" style={{ background: ORDINAL_BG[ord], color: ORDINAL_COLOR[ord] }}>
      {cat}·{ord}
    </span>
  ));
}

function confBadge(c: Confidence) {
  return c === 'high' ? <span className="badge high">置信度高</span> : <span className="badge low">置信度低·待家长确认</span>;
}

// 模糊主动记录(文字输入路径:「帮我记录一下」等,未明确拍/口述)→ AI 确认一次。
// 语音路径已由 voiceRoute LLM 统一处理，此函数仅用于文字输入的快速前置判断。
function wantsRecord(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /帮我记录|记录一下|记录今天|帮我记|也要记|我要记录|记一下/.test(t);
}

// 被动确认流程的阶段(模块一 §1.2/1.3)。
type ConfirmPhase = 'raise' | 'first' | 'secondYesNo' | 'shortwait' | 'secondNudge';
interface ConfirmCtx {
  snapshot: EatingConfirm;
  phase: ConfirmPhase;
  reminders: number;
  triggerId: string;
}

export interface SessionMsg {
  id: number;
  role: 'bot' | 'user';
  kind?: 'tip' | 'result' | 'loading';
  text: string; // 纯文本摘要,供看板展示
}

export interface RouteResult {
  transcript: string;
  entry: 'active' | 'passive' | 'none'; // 走哪条入口
  intent: string;   // photo / voice_log / record / eating / none
  level: string;    // strong / mid / weak / none
  phrase: string;
}

interface InfoPanelProps {
  enterCooldown: () => void;
  markTrigger: (id: string, status: string) => void;
  markMealSlotDone: (date: string, slot: string) => void;
  setSpeechLevel: (level: SemanticLevel) => void;
  lockArmed: () => void;
  unlockArmed: () => void;
  onMsgsChange?: (msgs: SessionMsg[]) => void;
  onRouteResult?: (r: RouteResult) => void;
}

// 信息栏:从无屏手环剥离出来的拍照 / 语音 / 文字输入 + LLM 识别对话。
export default function InfoPanel({ enterCooldown, markTrigger, markMealSlotDone, setSpeechLevel, lockArmed, unlockArmed, onMsgsChange, onRouteResult }: InfoPanelProps) {
  const today = useStore((s) => s.today());
  const addMeal = useStore((s) => s.addMeal);
  const addExtra = useStore((s) => s.addExtra);
  const incInteraction = useStore((s) => s.incInteraction);
  const config = useStore((s) => s.config);
  const simTime = useUI((s) => s.simTime);
  const simDate = useUI((s) => s.simDate);
  const eatingConfirm = useUI((s) => s.eatingConfirm);
  const endEatingConfirm = useUI((s) => s.endEatingConfirm);
  const setBandState = useUI((s) => s.setBandState);
  const setAwaitingRaise = useUI((s) => s.setAwaitingRaise);
  const raiseSignal = useUI((s) => s.raiseSignal);
  const skipWaitSignal = useUI((s) => s.skipWaitSignal);
  const voiceActive = useUI((s) => s.voiceActive);
  const setVoiceInterim = useUI((s) => s.setVoiceInterim);
  const setVoiceLastTranscript = useUI((s) => s.setVoiceLastTranscript);
  const setShortWait = useUI((s) => s.setShortWait);
  const clearShortWait = useUI((s) => s.clearShortWait);
  const curTime = () => displayTime(simTime);

  const [, setMsgs] = useState<Msg[]>([]);
  const [staging, setStaging] = useState<{ photo: string | null; text: string }>({ photo: null, text: '' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<{ photo: string | null; text: string; question: string; isVoice?: boolean } | null>(null);
  const [confirmCtx, setConfirmCtx] = useState<ConfirmCtx | null>(null);
  const [voiceCtx, setVoiceCtx] = useState<{ source: 'passive' | 'active'; retakePhoto?: string } | null>(null);
  const [activeDisambig, setActiveDisambig] = useState(false);
  const [photoCtx, setPhotoCtx] = useState<{ retakeUsed: boolean } | null>(null);
  // 主动入口：摄像头已开，等孩子说「开拍」
  const kaipaiModeRef = useRef(false);
  const triggerShootRef = useRef<(() => void) | null>(null);

  const confirmCtxRef = useRef<ConfirmCtx | null>(null);
  useEffect(() => { confirmCtxRef.current = confirmCtx; }, [confirmCtx]);
  const voiceCtxRef = useRef(voiceCtx);
  useEffect(() => { voiceCtxRef.current = voiceCtx; }, [voiceCtx]);
  const clarifyRef = useRef(clarify);
  useEffect(() => { clarifyRef.current = clarify; }, [clarify]);
  const activeDisambigRef = useRef(activeDisambig);
  useEffect(() => { activeDisambigRef.current = activeDisambig; }, [activeDisambig]);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const raiseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shortWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const childNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 30s 补充窗口：记录刚落库的食物名+id+source，窗口到期后清空
  const lastRecordRef = useRef<{ foodName: string; id: string; source: 'meal' | 'extra' } | null>(null);
  const routeFinalRef = useRef<(text: string) => Promise<void>>(async () => {});
  const onReplyRef = useRef<(text: string) => void>(() => {});
  const onRouteResultRef = useRef(onRouteResult);
  useEffect(() => { onRouteResultRef.current = onRouteResult; }, [onRouteResult]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- 统一 ASR:InfoPanel 持有唯一 SpeechRecognition 实例 ----
  const supported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const asrActiveRef = useRef(false);
  const asrRecRef = useRef<any>(null);

  const voiceBufferRef = useRef<string>('');
  const voiceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 上下文滑动窗口：保存最近 5 句 idle 期 final 转写（含时间戳），供 voiceRoute 判断时参考
  const recentTranscriptsRef = useRef<{ text: string; ts: number }[]>([]);

  const sessionLogRef = useRef<SessionMsg[]>([]);
  const onMsgsChangeRef = useRef(onMsgsChange);
  useEffect(() => { onMsgsChangeRef.current = onMsgsChange; }, [onMsgsChange]);

  const push = useCallback((role: Msg['role'], node: React.ReactNode, kind?: Msg['kind']) => {
    const id = nextId();
    setMsgs((m) => [...m, { id, role, node, kind }]);
    if (kind !== 'loading') {
      // 从 ReactNode 提取可读文本:支持 string / JSX div 的 textContent 近似
      let text = '';
      try { text = extractText(node); } catch { text = role === 'bot' ? '…' : ''; }
      const entry: SessionMsg = { id, role, kind, text };
      sessionLogRef.current = [...sessionLogRef.current, entry];
      onMsgsChangeRef.current?.(sessionLogRef.current);
    }
  }, []);
  const removeLoading = useCallback(() => setMsgs((m) => m.filter((x) => x.kind !== 'loading')), []);

  const clearTimers = () => {
    if (raiseTimerRef.current) { clearTimeout(raiseTimerRef.current); raiseTimerRef.current = null; }
    if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
    if (shortWaitTimerRef.current) { clearTimeout(shortWaitTimerRef.current); shortWaitTimerRef.current = null; }
  };
  const startReplyTimer = (onTimeout: () => void) => {
    if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
    replyTimerRef.current = setTimeout(onTimeout, REPLY_WAIT);
  };

  // 本轮流程结束:进/刷新冷却 + 收尾(PRD「本轮流程结束→进/刷新冷却」「主动完成后刷新冷却」)。
  const endRound = useCallback(() => {
    clearTimers();
    speakCancel();
    recentTranscriptsRef.current = [];
    enterCooldown();
    setBandState('idle');
    setAwaitingRaise(false);
    endEatingConfirm();
    setConfirmCtx(null);
    setVoiceCtx(null);
    setActiveDisambig(false);
    setPhotoCtx(null);
    setCameraOpen(false);
    kaipaiModeRef.current = false;
    triggerShootRef.current = null;
    clearShortWait();
  }, [enterCooldown, setBandState, setAwaitingRaise, endEatingConfirm, clearShortWait]);

  // ---- 抬腕门(被动触发后)----
  useEffect(() => {
    if (!eatingConfirm) return;
    // 新的被动触发:进 raise 门,震动等抬腕。
    setConfirmCtx({ snapshot: eatingConfirm, phase: 'raise', reminders: 0, triggerId: eatingConfirm.id });
    setAwaitingRaise(true);
    setBandState('vibrating');
    vibrate();
    raiseTimerRef.current = setTimeout(() => {
      if (confirmCtxRef.current?.phase === 'raise') noWakeup();
    }, RAISE_WAIT);
    return () => { if (raiseTimerRef.current) { clearTimeout(raiseTimerRef.current); raiseTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eatingConfirm]);

  // 抬腕点击(Band.signalRaise)→ resolve 进第一问。
  const lastRaiseRef = useRef(0);
  useEffect(() => {
    if (raiseSignal <= lastRaiseRef.current) return;
    lastRaiseRef.current = raiseSignal;
    if (confirmCtxRef.current?.phase !== 'raise') return;
    if (raiseTimerRef.current) { clearTimeout(raiseTimerRef.current); raiseTimerRef.current = null; }
    setAwaitingRaise(false);
    firstQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiseSignal]);

  // 调试按钮「跳过等待」→ 立即触发短等待回调。
  const lastSkipRef = useRef(0);
  useEffect(() => {
    if (skipWaitSignal <= lastSkipRef.current) return;
    lastSkipRef.current = skipWaitSignal;
    const ctx = confirmCtxRef.current;
    if (ctx?.phase !== 'shortwait' || !shortWaitTimerRef.current) return;
    clearTimeout(shortWaitTimerRef.current);
    shortWaitTimerRef.current = null;
    clearShortWait();
    if (ctx.reminders >= 2) { endRound(); return; }
    fireSecondNudge(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipWaitSignal]);

  const noWakeup = useCallback(() => {
    const ctx = confirmCtxRef.current;
    if (ctx) markTrigger(ctx.triggerId, '未唤醒');
    push('bot', <div className="tiny muted">(未抬腕,不打扰)</div>);
    endRound();
  }, [markTrigger, push, endRound]);

  const firstQuestion = useCallback(async () => {
    const ctx = confirmCtxRef.current;
    if (!ctx) return;
    setConfirmCtx({ ...ctx, phase: 'first', reminders: 1 });
    setBandState('speaking');
    try {
      const r = await conversationTurn({ reply: '', turnType: 'first', mealTime: ctx.snapshot.mealTime });
      const fq = r.reply || '你在吃东西吗？';
      push('bot', <div>{fq} 🎤</div>);
      speak(fq);
    } catch {
      const fq = '你在吃东西吗？';
      push('bot', <div>{fq} 🎤</div>);
      speak(fq);
    }
    setBandState('listening');
    startReplyTimer(() => onReplyRef.current(''));
    // eslint-disable-next-line react-deps-exhaustive
  }, [push, setBandState]);

  // 孩子的回复路由(按当前阶段)。
  const onReply = useCallback(async (text: string) => {
    const ctx = confirmCtxRef.current;
    if (!ctx) return;
    if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
    push('user', <div>{text || '（无回复）'}</div>);
    if (!text.trim()) {
      if (ctx.phase === 'secondYesNo') {
        markTrigger(ctx.triggerId, '语音补录'); startVoice('passive', true);
      } else {
        startVoice('passive');
      }
      return;
    }

    // 第二问 yes/no(eating 分支) — LLM 判断孩子是否同意拍照
    if (ctx.phase === 'secondYesNo') {
      push('bot', <><span className="dots"><span /><span /><span /></span> 嗯嗯…</>, 'loading');
      setBusy(true);
      try {
        const r = await conversationTurn({ reply: text, turnType: 'second_yes_no', mealTime: ctx.snapshot.mealTime });
        removeLoading();
        const fullText = r.question ? `${r.reply} ${r.question}` : r.reply;
        setBandState('speaking'); push('bot', <div>{fullText}</div>); speak(fullText);
        if (r.intent === 'wants_photo') { startPhoto('passive'); }
        else { markTrigger(ctx.triggerId, '语音补录'); startVoice('passive', true); }
      } catch { removeLoading(); endRound(); } finally { setBusy(false); }
      return;
    }
    // 轻提醒后(going_to_eat 短等待)
    if (ctx.phase === 'secondNudge') {
      push('bot', <><span className="dots"><span /><span /><span /></span> 嗯嗯…</>, 'loading');
      setBusy(true);
      try {
        const r = await conversationTurn({ reply: text, turnType: 'second_nudge', mealTime: ctx.snapshot.mealTime });
        removeLoading();
        const fullText = r.question ? `${r.reply} ${r.question}` : r.reply;
        setBandState('speaking'); push('bot', <div>{fullText}</div>); speak(fullText);
        // PRD: second_nudge 确认 eating → 直接拍照，不再问第二问
        if (r.intent === 'wants_photo' || r.intent === 'eating') startPhoto('passive');
        else if (r.intent === 'finished' || r.intent === 'wants_voice_log') startVoice('passive', true);
        else if (r.intent === 'wants_record') { clearTimers(); endEatingConfirm(); setConfirmCtx(null); setActiveDisambig(true); }
        else { markTrigger(ctx.triggerId, statusFor(r.intent)); endRound(); }
      } catch { removeLoading(); endRound(); } finally { setBusy(false); }
      return;
    }
    // 第一问的回复
    push('bot', <><span className="dots"><span /><span /><span /></span> 嗯嗯…</>, 'loading');
    setBusy(true);
    try {
      const r = await conversationTurn({ reply: text, turnType: 'first', mealTime: ctx.snapshot.mealTime });
      removeLoading();
      // 主动覆盖意图：孩子在第一问时直接说要拍/口述/记录，绕过被动流程
      if (r.intent === 'wants_photo') {
        if (r.reply) { setBandState('speaking'); push('bot', <div>{r.reply}</div>); speak(r.reply); }
        clearTimers(); endEatingConfirm(); setConfirmCtx(null);
        markTrigger(ctx.triggerId, '拍照记录'); startPhoto('active');
      } else if (r.intent === 'wants_voice_log') {
        if (r.reply) { setBandState('speaking'); push('bot', <div>{r.reply}</div>); speak(r.reply); }
        clearTimers(); endEatingConfirm(); setConfirmCtx(null);
        markTrigger(ctx.triggerId, '语音补录'); setVoiceCtx({ source: 'active' }); voiceDone(text);
      } else if (r.intent === 'wants_record') {
        if (r.reply) { setBandState('speaking'); push('bot', <div>{r.reply}</div>); speak(r.reply); }
        clearTimers(); endEatingConfirm(); setConfirmCtx(null); setActiveDisambig(true);
      } else {
        branchIntent(r.intent, r.reply, r.question);
      }
    } catch { removeLoading(); endRound(); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, removeLoading, setBandState, endRound]);
  // 每次渲染同步 ref，让 fireSecondNudge 能拿到最新版本
  onReplyRef.current = onReply;

  const statusFor = (intent: ReplyIntent): string => (
    intent === 'not_eating' ? '没在吃' : intent === 'finished' ? '语音补录' : intent === 'going_to_eat' ? '短等待' : '模糊/无回复'
  );

  const branchIntent = useCallback((intent: ReplyIntent, reply: string, question?: string) => {
    const ctx = confirmCtxRef.current;
    if (!ctx) return;
    setBandState('speaking');
    // 合并 reply + question 成一条气泡播报
    const fullText = question ? `${reply} ${question}` : reply;
    push('bot', <div>{fullText}</div>);
    speak(fullText);
    if (intent === 'eating') {
      setConfirmCtx({ ...ctx, phase: 'secondYesNo' });
      setTimeout(() => {
        setBandState('listening');
        startReplyTimer(() => onReplyRef.current(''));
      }, 800);
    } else if (intent === 'finished') {
      startVoice('passive', true);
    } else if (intent === 'going_to_eat') {
      startShortWait();
    } else {
      markTrigger(ctx.triggerId, statusFor(intent));
      endRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, setBandState, endRound]);

  // 二次轻提醒：问句由 LLM 生成（second_nudge 轮，reply 为空表示主动发起）。
  const fireSecondNudge = useCallback(async (c: ConfirmCtx) => {
    setConfirmCtx({ ...c, phase: 'secondNudge', reminders: c.reminders + 1 });
    setBandState('speaking');
    try {
      const r = await conversationTurn({ reply: '', turnType: 'second_nudge', mealTime: c.snapshot.mealTime });
      const sn = r.reply || '吃上了吗？';
      push('bot', <div>{sn}</div>);
      speak(sn);
    } catch {
      const sn = '吃上了吗？';
      push('bot', <div>{sn}</div>);
      speak(sn);
    }
    setBandState('listening');
    startReplyTimer(() => onReplyRef.current(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBandState, push]);

  const startShortWait = useCallback(() => {
    const ctx = confirmCtxRef.current;
    if (!ctx) return;
    if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
    markTrigger(ctx.triggerId, '短等待');
    setBandState('waiting');
    setConfirmCtx({ ...ctx, phase: 'shortwait' });
    const shortWait = SHORT_WAIT;
    setShortWait(Date.now(), shortWait);
    shortWaitTimerRef.current = setTimeout(() => {
      const c = confirmCtxRef.current;
      if (!c || c.phase !== 'shortwait') return;
      clearShortWait();
      if (c.reminders >= 2) { endRound(); return; }
      fireSecondNudge(c);
    }, shortWait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBandState, push, endRound, fireSecondNudge]);

  // 语音补录(PRD:finished/主动口述 → AI 问吃了啥一轮 → 记语音补录,待确认不计趋势)。
  const startVoice = useCallback((source: 'passive' | 'active', _silent?: boolean, retakePhoto?: string) => {
    voiceBufferRef.current = '';
    if (voiceDebounceRef.current) { clearTimeout(voiceDebounceRef.current); voiceDebounceRef.current = null; }
    setVoiceCtx({ source, retakePhoto });
    if (source === 'passive') { const ctx = confirmCtxRef.current; if (ctx) markTrigger(ctx.triggerId, '语音补录'); }
    setBandState('listening');
    startReplyTimer(() => {
      const nd = pick(PHRASES.noDisturbVoiceTimeout);
      push('bot', <div>{nd}</div>);
      speak(nd.replace('～', ''));
      speakThen(endRound);
    });
    // 问句由 LLM 在上游生成并已播报，这里不再硬编码问句
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBandState, push, endRound]);

  const voiceDone = useCallback(async (text: string) => {
    if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
    const retakePhoto = voiceCtxRef.current?.retakePhoto;
    const isActiveVoice = voiceCtxRef.current?.source === 'active';
    setVoiceCtx(null);
    push('user', <div>{text}</div>);
    push('bot', <><span className="dots"><span /><span /><span /></span> 记一下…</>, 'loading');
    setBusy(true);
    try {
      const r = await analyzeIntake({ text });
      removeLoading();
      if (r.clarify?.question) {
        setClarify({ photo: retakePhoto ?? null, text, question: r.clarify.question, isVoice: true });
        push('bot', <div>{r.clarify.question}</div>); speak(r.clarify.question);
        return;
      }
      // 语音没识别出吃的是什么 → 不记录，直接问
      if (r.confidence === 'low' && !r.foodsDetected && !r.name) {
        const q = pick(PHRASES.voiceNoFood);
        setClarify({ photo: retakePhoto ?? null, text, question: q, isVoice: true });
        push('bot', <div>{q}</div>); speak(q.replace(' 🎤', ''));
        return;
      }
      await applyResult(r, retakePhoto, text, { isVoice: true, isActiveVoice, onDone: endRound });
    } catch (e: any) {
      removeLoading();
      push('bot', <>记失败:{e?.message || '未知错误'}</>);
      endRound();
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, removeLoading, endRound]);

  // ---- 拍照执行链路(引导 + 倒数 + 自动拍 + 判质量 + 补拍 + 降级)----

  // 被动入口：说完引导语后自动倒数拍摄。
  const startPhoto = useCallback((source: 'passive' | 'active') => {
    if (source === 'passive') { const ctx = confirmCtxRef.current; if (ctx) markTrigger(ctx.triggerId, '拍照记录'); }
    setPhotoCtx({ retakeUsed: false });
    setBandState('speaking');
    const sp = pick(PHRASES.startPhoto);
    push('bot', <div>{sp}</div>);
    speak(sp.replace(' 📷', ''));
    setCameraOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, setBandState]);

  // 主动入口：调起摄像头 + 说提示语，停住等孩子说「开拍」。
  const startPhotoActive = useCallback(() => {
    setPhotoCtx({ retakeUsed: false });
    kaipaiModeRef.current = true;
    setBandState('listening');
    const msg = pick(PHRASES.activeCameraReady);
    push('bot', <div>{msg}</div>);
    speak(msg);
    setCameraOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, setBandState]);

  const handlePhoto = useCallback(async (d: string) => {
    setCameraOpen(false);
    const isActive = kaipaiModeRef.current;
    kaipaiModeRef.current = false;
    triggerShootRef.current = null;
    push('bot', <><span className="dots"><span /><span /><span /></span> 正在看看你吃了什么…</>, 'loading');
    setBusy(true);
    try {
      const r = await analyzeIntake({ image: d });
      removeLoading();
      // 低置信度且补拍可救且未补拍 → 引导调整 + 再拍 1 次。
      // 主动入口：等「开拍」；被动入口：自动倒数。
      if (r.confidence === 'low' && r.needRetake && photoCtx && !photoCtx.retakeUsed) {
        setPhotoCtx({ retakeUsed: true });
        setBusy(false);
        if (isActive) {
          // 主动入口补拍：重新进入等「开拍」状态
          kaipaiModeRef.current = true;
          const msg = pick(PHRASES.activeRetakeReady);
          push('bot', <div>{msg}</div>);
          speak(msg);
          setBandState('listening');
          setCameraOpen(true);
        } else {
          const rp = pick(PHRASES.retakePhoto);
          push('bot', <div>{rp}</div>);
          speak(rp.replace(' 📷', ''));
          setCameraOpen(true);
        }
        return;
      }
      // 低置信度且无法再补拍。
      if (r.confidence === 'low' && (!r.needRetake || (photoCtx && photoCtx.retakeUsed))) {
        setPhotoCtx(null);
        setBusy(false);
        if (isActive) {
          // 主动入口：直接结束，说「还是不太清」，记「照片，置信度低」，不降级语音
          const msg = pick(PHRASES.activeFinalLow);
          push('bot', <div>{msg}</div>);
          speak(msg);
          speakThen(endRound);
        } else {
          // 被动入口：降级语音补录，携带照片
          const pf = pick(PHRASES.photoFallback);
          push('bot', <div>{pf}</div>);
          speak(pf.replace('？🎤', '？').replace(' 🎤', ''));
          startVoice('active', false, d);
        }
        return;
      }
      // 追问(馅料等)
      if (r.clarify?.question) {
        setClarify({ photo: d, text: '', question: r.clarify.question });
        push('bot', <div className="row gap4"><b>🤔</b><b>{r.clarify.question}</b></div>);
        speak(r.clarify.question);
        setBusy(false);
        return;
      }
      await applyResult(r, d, undefined, { onDone: endRound });
    } catch (e: any) {
      removeLoading();
      push('bot', <>识别失败:{e?.message || '未知错误'}</>);
      speak('识别失败，再试一次吧。');
      endRound();
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, removeLoading, photoCtx, endRound]);

  // 把识别结果落库 + 推 UI 气泡 + 频次护栏(科普/劝导)。手环无屏,结果同时语音播报。返回 { id, kind } 供补拍 patch 用。
  const applyResult = useCallback(async (r: AnalyzeIntakeResult, p: string | undefined, t: string | undefined, opts?: { isVoice?: boolean; isActiveVoice?: boolean; onDone?: () => void }): Promise<{ id: string; kind: 'meal' | 'extra' }> => {
    const isVoice = !!opts?.isVoice;
    const isActiveVoice = !!opts?.isActiveVoice;
    const ts = simEpoch(simDate, simTime);
    if (r.kind === 'meal') {
      const slot = slotFromTime(curTime());
      const mealName = r.foodsDetected || r.name || '食物';
      const canSci = canPlayScience(r, isVoice, today);
      const meal: Meal = {
        id: uid(), type: slot, time: curTime(), photoUrl: p || undefined, textDesc: t,
        foodsDetected: r.foodsDetected, foodItems: r.foodItems, categories: r.categories as any, plateRatio: r.plateRatio as PlateRatio,
        confidence: r.confidence, confirmed: r.confidence === 'high' && !isVoice,
        scienceTip: canSci ? r.scienceTip : null, sciencePlayed: canSci && !!r.scienceTip && config.sceneToggles.science,
        original: { foodsDetected: r.foodsDetected, foodItems: r.foodItems, categories: r.categories as any, plateRatio: r.plateRatio as PlateRatio, name: r.name, confidence: r.confidence, uploadedAt: curTime() },
        createdAt: ts, isVoice,
      };
      addMeal(meal);
      markMealSlotDone(todayDate, slot);
      openChildNoteWindow(mealName, meal.id, 'meal');
      push('bot',
        <div>
          <div className="row gap4 wrap"><b>🍽️ {MEAL_LABEL[slot]}:</b><span>{r.foodsDetected || r.name || '(未识别)'}</span></div>
          {Object.keys(r.plateRatio).length > 0 && <div className="ratio-row mt8">{ratioChips(r.plateRatio as PlateRatio)}</div>}
          <div className="row gap4 mt8">{confBadge(r.confidence)}{isVoice && <span className="badge low">语音补录</span>}</div>
        </div>, 'result'
      );
      if (r.confidence === 'high' && !isVoice) {
        const rd = pick(PHRASES.recordDone);
        push('bot', <div>{rd}</div>);
        speak(rd);
        if (canSci && r.scienceTip && config.sceneToggles.science) {
          incInteraction(today.date, 'science', mealName);
          push('bot', <>{r.scienceTip} 🌱</>, 'tip');
          speak(r.scienceTip);
        }
      } else {
        const lowMsg = isActiveVoice
          ? pick(PHRASES.activeVoiceLow)
          : isVoice ? pick(PHRASES.recordVoiceLow) : pick(PHRASES.recordPhotoLow);
        push('bot', <>{lowMsg}</>);
        speak(lowMsg.replace('～', ''));
      }
      if (opts?.onDone) speakThen(opts.onDone);
      return { id: meal.id, kind: 'meal' as const };
    } else {
      const kind = r.kind === 'snack' ? 'snack' : r.kind === 'fruit' ? 'fruit' : 'drink';
      const extraName = r.name || (kind === 'snack' ? '零食' : kind === 'fruit' ? '水果' : '饮料');
      const extraId = addExtra({
        time: curTime(), name: extraName, kind, snackType: r.snackType ?? null,
        photoUrl: p || undefined, confidence: r.confidence, confirmed: r.confidence === 'high' && !isVoice,
        original: { name: r.name, confidence: r.confidence, uploadedAt: curTime() }, createdAt: ts, isVoice,
      });
      openChildNoteWindow(extraName, extraId, 'extra');
      const ico = kind === 'snack' ? '🍬' : kind === 'fruit' ? '🍎' : '🥤';
      const kindLabel = kind === 'snack' ? '识别到零食:' : kind === 'fruit' ? '记下水果:' : '记下饮料:';
      push('bot',
        <div>
          <div className="row gap4 wrap"><b>{ico} {kindLabel}</b><span>{extraName}</span></div>
          <div className="row gap4 mt8">{confBadge(r.confidence)}{isVoice && <span className="badge low">语音补录</span>}</div>
        </div>, 'result'
      );
      if (r.confidence === 'low') {
        const el = isActiveVoice ? pick(PHRASES.activeVoiceLow) : pick(PHRASES.extraLow);
        push('bot', <>{el}</>);
        speak(el.replace('～', ''));
      } else {
        const rd = pick(PHRASES.recordDone);
        push('bot', <div>{rd}</div>);
        speak(rd);
        // 水果科普(高置信+当天<3+同食物未播)。
        if (kind === 'fruit' && canPlayScience({ kind: 'fruit', confidence: r.confidence, foodsDetected: extraName }, isVoice, today) && r.scienceTip && config.sceneToggles.science) {
          incInteraction(today.date, 'science', extraName);
          push('bot', <>{r.scienceTip} 🌱</>, 'tip');
          speak(r.scienceTip);
        }
      }
      // 零食劝导(糖果/膨化食品/含糖饮料,每天 ≤1)。
      if (canPersuade(r, isVoice, today)) {
        try {
          const { tip } = await persuadeSnack({ snackType: r.snackType!, name: r.name || '' });
          if (tip) { incInteraction(today.date, 'persuade'); push('bot', <>{tip} 💛</>, 'tip'); speak(tip); }
        } catch { /* 劝导失败不影响记录 */ }
      }
      if (opts?.onDone) speakThen(opts.onDone);
      return { id: extraId, kind: 'extra' as const };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, config, addMeal, addExtra, incInteraction, push, simDate, simTime, markMealSlotDone]);

  // 记录落库后开 30s 补充窗口，期间孩子说的话优先走 childNote 判断。
  const openChildNoteWindow = useCallback((foodName: string, id: string, source: 'meal' | 'extra') => {
    if (childNoteTimerRef.current) clearTimeout(childNoteTimerRef.current);
    lastRecordRef.current = { foodName, id, source };
    childNoteTimerRef.current = setTimeout(() => {
      lastRecordRef.current = null;
      childNoteTimerRef.current = null;
    }, 30000);
  }, []);

  const patchMeal = useStore((s) => s.patchMeal);
  const patchExtra = useStore((s) => s.patchExtra);
  const todayDate = useStore((s) => s.today().date);

  // 语音路由已移入 routeFinal(统一 ASR + LLM 意图判断),见上方 ASR effect。

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => handlePhoto(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async (photo?: string, text?: string) => {
    const p = photo ?? staging.photo;
    const t = text ?? staging.text;
    // 读 ref 版本，避免闭包捕获 stale state
    const curVoiceCtx = voiceCtxRef.current;
    const curConfirmCtx = confirmCtxRef.current;
    const curClarify = clarifyRef.current;
    const curBusy = busyRef.current;

    // 主动覆盖意图由 conversationTurn(LLM) 在 in-phase 时识别，idle 时由 voiceRoute(LLM) 识别。
    // 正则快速路径已移除，避免否定句/非标准表达的误判。

    // 语音补录回合(finished / 主动口述)
    if (curVoiceCtx && !photo) {
      if (!t || curBusy) return;
      setStaging({ photo: null, text: '' });
      return voiceDone(t);
    }
    // 被动确认回合回复
    if (curConfirmCtx && !photo) {
      if (!t || curBusy) return;
      // 短等待阶段用户主动开口：打断等待，立即进入二次提醒回复
      if (curConfirmCtx.phase === 'shortwait') {
        if (shortWaitTimerRef.current) { clearTimeout(shortWaitTimerRef.current); shortWaitTimerRef.current = null; }
        clearShortWait();
        const nudgeCtx = { ...curConfirmCtx, phase: 'secondNudge' as const, reminders: curConfirmCtx.reminders + 1 };
        confirmCtxRef.current = nudgeCtx; // 同步更新 ref，让 onReply 读到正确 phase
        setConfirmCtx(nudgeCtx);
        setStaging({ photo: null, text: '' });
        return onReply(t);
      }
      setStaging({ photo: null, text: '' });
      return onReply(t);
    }
    // 追问回合
    if (curClarify) {
      if (!t || curBusy) return;
      setStaging({ photo: null, text: '' });
      push('user', <div>{t}</div>);
      push('bot', <><span className="dots"><span /><span /><span /></span> 嗯嗯,看看…</>, 'loading');
      setBusy(true);
      try {
        const r = await clarifyIntake({ image: curClarify.photo || undefined, text: curClarify.text || undefined, question: curClarify.question, answer: t });
        removeLoading();
        setClarify(null);
        await applyResult(r, curClarify.photo || undefined, curClarify.text || undefined, { isVoice: curClarify.isVoice, onDone: endRound });
      } catch (e: any) {
        removeLoading(); push('bot', <>识别失败:{e?.message || '未知错误'}</>); speak('识别失败，再试一次吧。'); endRound();
      } finally { setBusy(false); }
      return;
    }
    // 主动意图确认回合(模糊「帮我记录」→ 拍照 or 口述) — LLM 判断
    if (activeDisambigRef.current && !photo) {
      if (!t || curBusy) return;
      setActiveDisambig(false);
      setStaging({ photo: null, text: '' });
      push('user', <div>{t}</div>);
      push('bot', <><span className="dots"><span /><span /><span /></span> 嗯嗯…</>, 'loading');
      setBusy(true);
      try {
        const r = await conversationTurn({ reply: t, turnType: 'active_disambig' });
        removeLoading();
        if (r.reply) { setBandState('speaking'); push('bot', <div>{r.reply}</div>); speak(r.reply); }
        if (r.intent === 'wants_photo') startPhoto('active');
        else if (r.intent === 'wants_voice_log') { setVoiceCtx({ source: 'active' }); voiceDone(t); }
        else startVoice('active');
      } catch { removeLoading(); startVoice('active'); } finally { setBusy(false); }
      return;
    }

    if ((!p && !t) || busy) return;

    // 模糊主动记录 → AI 确认一次
    if (!p && wantsRecord(t)) {
      setStaging({ photo: null, text: '' });
      push('user', <div>{t}</div>);
      push('bot', <div>想拍照还是说给我听？ 🤔</div>);
      speak('想拍照还是说给我听？');
      setActiveDisambig(true);
      return;
    }

    // 普通:有图或食物文字描述 → 直接识别(主动完成后刷新冷却)。
    setStaging({ photo: null, text: '' });
    push('user', <>{p && <img className="watch-photo" src={p} alt="餐食" />}{t && <div>{t}</div>}</>);
    if (p) { return handlePhoto(p); }
    push('bot', <><span className="dots"><span /><span /><span /></span> 正在看看你吃了什么…</>, 'loading');
    setBusy(true);
    try {
      const r = await analyzeIntake({ image: p || undefined, text: t || undefined });
      removeLoading();
      if (r.clarify?.question) {
        setClarify({ photo: null, text: t || '', question: r.clarify.question });
        push('bot', <div>{r.clarify.question}</div>); speak(r.clarify.question);
        return;
      }
      await applyResult(r, undefined, t, { onDone: endRound });
    } catch (e: any) {
      removeLoading(); push('bot', <>识别失败:{e?.message || '未知错误'}</>); speak('识别失败，再试一次吧。'); endRound();
    } finally { setBusy(false); }
  };

  useEffect(() => () => clearTimers(), []);

  // ---- ASR 生命周期:live+voiceActive 时启动,否则停止 ----
  useEffect(() => {
    const stop = () => {
      asrActiveRef.current = false;
      try { asrRecRef.current?.stop(); } catch {}
      asrRecRef.current = null;
      setVoiceInterim('');
    };
    if (!voiceActive || !supported) { stop(); return; }
    asrActiveRef.current = true;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = '', finalT = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalT += t; else interim += t;
      }
      setVoiceInterim(interim);
      if (finalT.trim()) { setVoiceInterim(''); routeFinal(finalT.trim()); }
    };
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') asrActiveRef.current = false;
    };
    rec.onend = () => { if (asrActiveRef.current) { try { rec.start(); } catch {} } };
    asrRecRef.current = rec;
    try { rec.start(); } catch { asrActiveRef.current = false; }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive, supported]);

  // ---- 统一语音路由:idle 时每句 final 过一次 LLM,按结果分流 ----
  const routeFinal = async (text: string) => {
    if (!text.trim() || busyRef.current) return;
    const bs = useUI.getState().bandState;
    // speaking/vibrating 时：若孩子明确说"要拍照"，打断当前播报立即进主动拍照
    if (bs === 'speaking' || bs === 'vibrating') {
      const wantsPhotoNow = /我要拍照|帮我拍|想拍一下|我要拍|拍一下|来拍|拍个照/.test(text.trim());
      if (!wantsPhotoNow || kaipaiModeRef.current) return;
      speakCancel();
      const trigId = confirmCtxRef.current?.triggerId ?? null;
      if (trigId) markTrigger(trigId, '拍照记录');
      clearTimers(); endEatingConfirm(); setConfirmCtx(null);
      push('user', <div>{text}</div>);
      startPhotoActive();
      return;
    }
    // waiting = shortwait 阶段：用户主动开口应打断等待，直接走 submit
    if (bs === 'waiting' && !confirmCtxRef.current) return;

    // 主动入口等「开拍」状态：分流「开拍」/ 「不想拍 / 口述食物」
    if (kaipaiModeRef.current) {
      const t = text.trim();
      const isKaipai = /^开拍$|^开始拍$|^拍$/.test(t);
      const isCancel = /不想拍|不拍了|不要拍|算了/.test(t);
      if (isKaipai) {
        // 触发倒数+拍照
        if (triggerShootRef.current) { triggerShootRef.current(); }
        return;
      }
      if (isCancel) {
        // 孩子不想拍了 → 关摄像头，走语音补录
        kaipaiModeRef.current = false;
        triggerShootRef.current = null;
        setCameraOpen(false);
        push('user', <div>{t}</div>);
        setBandState('speaking');
        push('bot', <div>吃了啥？说给我听 🎤</div>);
        speak('吃了啥？说给我听。');
        startVoice('active');
        return;
      }
      // 孩子直接口述食物内容（如「我吃了苹果」）→ 关摄像头，直接走语音补录并落库
      kaipaiModeRef.current = false;
      triggerShootRef.current = null;
      setCameraOpen(false);
      setVoiceCtx({ source: 'active' });
      voiceDone(t);
      return;
    }

    const inPhase = !!(confirmCtxRef.current || voiceCtxRef.current || clarifyRef.current || activeDisambigRef.current);
    if (inPhase) {
      // 语音补录阶段：积累 final 片段，1.5s 无新内容再一次性提交，避免 ASR 分句过早打断
      if (voiceCtxRef.current) {
        voiceBufferRef.current = voiceBufferRef.current ? voiceBufferRef.current + text : text;
        if (voiceDebounceRef.current) clearTimeout(voiceDebounceRef.current);
        voiceDebounceRef.current = setTimeout(() => {
          const full = voiceBufferRef.current.trim();
          voiceBufferRef.current = '';
          voiceDebounceRef.current = null;
          if (full) submit(undefined, full);
        }, 1500);
        return;
      }
      submit(undefined, text);
      return;
    }
    // 补充窗口期：30s 内孩子说的话优先判断是否是对刚才记录的补充
    const lastRec = lastRecordRef.current;
    if (lastRec) {
      try {
        const nr = await checkChildNote({ foodName: lastRec.foodName, transcript: text });
        if (nr.isNote && nr.note) {
          // 关闭窗口，写备注
          if (childNoteTimerRef.current) { clearTimeout(childNoteTimerRef.current); childNoteTimerRef.current = null; }
          lastRecordRef.current = null;
          const date = todayDate;
          if (lastRec.source === 'meal') patchMeal(date, lastRec.id, { childNote: nr.note });
          else patchExtra(date, lastRec.id, { childNote: nr.note });
          push('user', <div>{text}</div>);
          push('bot', <div>{nr.reply}</div>);
          speak(nr.reply);
          return;
        }
        // 不是补充，关闭窗口，继续走正常路由
        if (childNoteTimerRef.current) { clearTimeout(childNoteTimerRef.current); childNoteTimerRef.current = null; }
        lastRecordRef.current = null;
      } catch { /* 失败静默，继续走正常路由 */ }
    }
    // idle → unified LLM 路由
    // 发请求前锁住 P-engine，防止 LLM 返回前被动流程抢先触发。
    lockArmed();
    try {
      // 维护上下文窗口：仅保留 60s 内最近 4 句，传给 LLM 作为上文
      const now = Date.now();
      const recent = recentTranscriptsRef.current.filter((t) => now - t.ts < 60000).slice(-4);
      const recentContext = recent.map((t) => t.text);
      recentTranscriptsRef.current = [...recent, { text, ts: now }].slice(-5);
      const r = await voiceRoute({ transcript: text, recentContext: recentContext.length > 0 ? recentContext : undefined });
      setVoiceLastTranscript(text);
      // 把 idle 期间转写到的文字也推入对话看板
      const sid = nextId();
      const idleEntry: SessionMsg = { id: sid, role: 'user', text };
      sessionLogRef.current = [...sessionLogRef.current, idleEntry];
      onMsgsChangeRef.current?.(sessionLogRef.current);
      // 上报路由判定结果(供调试面板展示)
      const isActiveIntent = r.intent !== 'none';
      onRouteResultRef.current?.({
        transcript: text,
        entry: isActiveIntent ? 'active' : (r.level !== 'none' ? 'passive' : 'none'),
        intent: r.intent,
        level: r.level,
        phrase: r.phrase,
      });
      // 无论哪个分支，请求已完成，解除 routePending 锁。
      // intent=none：还原 armed 并喂 level；intent≠none：主动入口接管，armed 由冷却/流程结束后自然恢复。
      unlockArmed();
      if (r.intent === 'none') {
        setSpeechLevel(r.level);
      }
      if (r.intent === 'photo' || r.intent === 'record') {
        // 主动入口：不管是拍照类还是模糊记录类，统一先开摄像头等「开拍」
        const trigId = confirmCtxRef.current?.triggerId ?? null;
        if (trigId) markTrigger(trigId, '拍照记录');
        push('user', <div>{text}</div>);
        startPhotoActive();
      } else if (r.intent === 'voice_log') {
        // voice_log：孩子明确说「帮我记一下刚才吃的 xxx」，直接走语音补录（记「语音补录，置信度低」）
        const trigId = confirmCtxRef.current?.triggerId ?? null;
        if (trigId) markTrigger(trigId, '语音补录');
        push('user', <div>{text}</div>);
        if (r.hasFood) {
          setVoiceCtx({ source: 'active' });
          voiceDone(text);
        } else {
          setBandState('speaking');
          push('bot', <div>吃了啥？说给我听 🎤</div>);
          speak('吃了啥？说给我听。');
          startVoice('active');
        }
      }
    } catch { unlockArmed(); /* 路由失败静默忽略,不影响其他流程 */ }
  };
  // 每次渲染更新 ref，确保 window 入口始终持有最新版本
  routeFinalRef.current = routeFinal;

  // E2E 测试专用：通过 ref 包装器暴露，避免 stale closure
  useEffect(() => {
    (window as any).__dietDebug = {
      ...((window as any).__dietDebug || {}),
      routeFinal: (text: string) => routeFinalRef.current(text),
      triggerFilePick: () => fileRef.current?.click(),
    };
  }, []);

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickPhoto} />
      {cameraOpen && (
        <CameraCapture
          auto={!kaipaiModeRef.current}
          waitForKaipai={kaipaiModeRef.current}
          triggerShootRef={triggerShootRef}
          onCapture={(d) => handlePhoto(d)}
          onClose={() => { setCameraOpen(false); setPhotoCtx(null); kaipaiModeRef.current = false; triggerShootRef.current = null; }}
          onPickFile={() => { setCameraOpen(false); kaipaiModeRef.current = false; setTimeout(() => fileRef.current?.click(), 60); }}
        />
      )}
    </>
  );
}
