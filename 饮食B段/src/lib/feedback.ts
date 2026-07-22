// 设备端轻量反馈:TTS 语音播报 + 震动。移植自 A段 eating-detector-demo.html。
// 关键:多数 speak() 发生在 await/setTimeout 之后(非用户手势上下文),
// Safari/iOS 及部分 Chrome 会静默拦截。因此在「首次用户手势」时用一句音量 0 的话
// 解锁引擎,之后程序化 speak 才能发声。voice 异步加载,无中文音时回退首个可用音。

let zhVoice: SpeechSynthesisVoice | null = null;
let unlocked = false;

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  // 优先选亲切女声:Ting-Ting(macOS)、Mei-Jia(台湾)、普通话女声
  return vs.find((v) => /Ting-Ting|TingTing/i.test(v.name))
    || vs.find((v) => /Mei-Jia|MeiJia/i.test(v.name))
    || vs.find((v) => /zh-CN|zh_CN/i.test(v.lang) && /female|woman|girl/i.test(v.name))
    || vs.find((v) => /zh|cmn/i.test(v.lang))
    || vs.find((v) => /Chinese|中文|普通话|Sin-ji/i.test(v.name))
    || null;
}

// 首次用户手势时解锁语音引擎(音量 0,不可闻)。
function ensureUnlocked() {
  if (unlocked || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance('嗯');
    u.volume = 0;
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  zhVoice = pickZhVoice();
  speechSynthesis.onvoiceschanged = () => { zhVoice = pickZhVoice(); };
  window.addEventListener('pointerdown', ensureUnlocked, { once: true });
  window.addEventListener('keydown', ensureUnlocked, { once: true });
}

function makeUtterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  else {
    const vs = speechSynthesis.getVoices();
    if (vs.length) u.voice = vs[0];
  }
  u.rate = 1.05;
  u.pitch = 1.2;
  u.volume = 1;
  return u;
}

// 排队播放:当前句说完后自动接下一句,避免 cancel() 打断。
const speakQueue: string[] = [];
let speakBusy = false;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

// Chrome bug: onend/onerror 在页面失焦或连续 speak 时有时不触发,
// 导致 speakBusy 永远卡住。watchdog 在估算时长 + 缓冲后强制解锁。
function scheduleWatchdog(text: string) {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  // 估算：中文约 4 字/秒（rate=1.05），最少给 2 秒，最多 15 秒
  const estMs = Math.min(15000, Math.max(2000, (text.length / 4) * 1000 + 800));
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (!speakBusy) return;
    speakBusy = false;
    drainQueue();
  }, estMs);
}

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

function drainQueue() {
  if (speakBusy || speakQueue.length === 0) {
    if (!speakBusy && speakQueue.length === 0 && pendingCallbacks.length > 0) {
      const cbs = pendingCallbacks.splice(0);
      cbs.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
    }
    return;
  }
  const text = speakQueue.shift()!;
  speakBusy = true;
  const u = makeUtterance(text);
  const done = () => { clearWatchdog(); speakBusy = false; drainQueue(); };
  u.onend = done;
  u.onerror = done;
  try {
    speechSynthesis.resume();
    speechSynthesis.speak(u);
    scheduleWatchdog(text);
  } catch { clearWatchdog(); speakBusy = false; drainQueue(); }
}

// Chrome 会在约 15s 后自动暂停语音合成引擎；每 10s resume 一次保活。
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  setInterval(() => {
    if (speakBusy) { speechSynthesis.pause(); speechSynthesis.resume(); }
  }, 10000);
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const t = (text || '').trim();
  if (!t) return;
  ensureUnlocked();
  speakQueue.push(t);
  drainQueue();
}

export function speakCancel() {
  clearWatchdog();
  speakQueue.length = 0;
  speakBusy = false;
  pendingCallbacks.length = 0;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
}

// 在当前队列全部播完后执行 cb（队列为空则立即执行）。
// 用于在最后一句 speak() 之后、speakCancel() 之前挂 endRound，避免提前 cancel 截断语音。
const pendingCallbacks: Array<() => void> = [];

export function speakThen(cb: () => void) {
  if (!speakBusy && speakQueue.length === 0) { cb(); return; }
  pendingCallbacks.push(cb);
}

export function vibrate() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([180, 120, 180, 120, 180]);
}
