import { useStore } from './store';
import { useUI } from './ui';

// 跨设备状态同步(通过 dev server 内存中转):
// - 启动时拉取后端快照覆盖本地种子
// - 本地 store 变更 → debounce POST 完整状态到后端
// - 轮询版本号,版本前进则拉取完整状态覆盖本地
// 同步内容:数据(days/config)+ 测试用模拟时间(sim)。手机↔Mac 实时同步。

let lastVersion = 0;
let applying = true; // 初始化或回放远端时,抑制本地广播
let postTimer: ReturnType<typeof setTimeout> | null = null;

const STATE_URL = '/api/state';

async function fetchVersion(): Promise<number> {
  try {
    const r = await fetch(STATE_URL);
    const d = await r.json();
    return d.version ?? 0;
  } catch {
    return 0;
  }
}

async function fetchFull(): Promise<{ state: any; version: number } | null> {
  try {
    const r = await fetch(STATE_URL + '?full=1');
    const d = await r.json();
    return { state: d.state, version: d.version ?? 0 };
  } catch {
    return null;
  }
}

// 防御:后端快照可能是旧数据结构(meals 单槽对象 / 无 extras),直接套用会崩。
// 只接受 meals 与 extras 都是数组的形状,否则忽略、走本地种子。
function looksValid(state: any): boolean {
  return !!(state && Array.isArray(state.days) && state.days.length && Array.isArray(state.days[0].meals) && Array.isArray(state.days[0].extras));
}

async function broadcast() {
  const { days, config } = useStore.getState();
  const { simDate, simTime } = useUI.getState();
  try {
    const r = await fetch(STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { days, config, sim: { date: simDate, time: simTime } } }),
    });
    const d = await r.json();
    if (d.version != null) lastVersion = d.version;
  } catch {
    /* ignore */
  }
}

function scheduleBroadcast() {
  if (applying) return;
  if (postTimer) clearTimeout(postTimer);
  postTimer = setTimeout(broadcast, 400);
}

function applyRemote(full: { state: any; version: number }) {
  applying = true;
  useStore.setState({ days: full.state.days, config: full.state.config });
  const sim = full.state.sim;
  if (sim) useUI.setState({ simDate: sim.date ?? null, simTime: sim.time ?? null });
  lastVersion = full.version;
  setTimeout(() => {
    applying = false;
  }, 300);
}

async function poll() {
  const v = await fetchVersion();
  if (v <= lastVersion) return;
  const full = await fetchFull();
  if (!full || !looksValid(full.state)) return;
  applyRemote(full);
}

export function initSync() {
  (async () => {
    const full = await fetchFull();
    if (looksValid(full?.state)) {
      applyRemote(full!);
    } else {
      lastVersion = await fetchVersion();
    }
    applying = false;
    useStore.subscribe((s, prev) => {
      if (s.days !== prev.days || s.config !== prev.config) scheduleBroadcast();
    });
    useUI.subscribe((s, prev) => {
      if (s.simDate !== prev.simDate || s.simTime !== prev.simTime) scheduleBroadcast();
    });
    setInterval(poll, 1500);
  })();
}
