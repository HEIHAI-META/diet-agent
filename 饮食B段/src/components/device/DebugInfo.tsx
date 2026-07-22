import { useEffect, useRef, useState } from 'react';
import EatingMonitor from './EatingMonitor';
import InfoPanel, { type SessionMsg, type RouteResult } from './InfoPanel';
import RouteStatusPanel from './RouteStatusPanel';
import ShortWaitCountdown from './ShortWaitCountdown';
import { useEatingMonitor } from '../../hooks/useEatingMonitor';
import { useUI } from '../../ui';

const COOLDOWN_OPTIONS = [
  { label: '15 秒(测试)', ms: 15_000 },
  { label: '1 分钟', ms: 60_000 },
  { label: '5 分钟', ms: 5 * 60_000 },
  { label: '10 分钟', ms: 10 * 60_000 },
  { label: '30 分钟(默认)', ms: 30 * 60_000 },
];

export default function DebugInfo() {
  const [open, setOpen] = useState(true);
  const startEatingConfirm = useUI((s) => s.startEatingConfirm);
  const mon = useEatingMonitor((snap) =>
    startEatingConfirm({ id: snap.id, p: snap.p, time: snap.time, mealTime: snap.mealTime })
  );

  const [msgs, setMsgs] = useState<SessionMsg[]>([]);
  const [lastRoute, setLastRoute] = useState<RouteResult | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚到底部
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs]);

  const clearLog = () => setMsgs([]);

  return (
    <div className="debug-info">
      <button className="debug-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="debug-title">🔧 调试信息</span>
        <span className="debug-sub">进食识别 · 对话看板</span>
        <span className="debug-toggle">{open ? '▾ 收起' : '▸ 展开'}</span>
      </button>
      {open && (
        <div className="debug-body">
          <EatingMonitor mon={mon} />

          {/* LLM 路由判定面板 */}
          <RouteStatusPanel last={lastRoute} />

          {/* 冷却时间调节 */}
          <div className="em-field" style={{ marginTop: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 13 }}>冷却时长</label>
            <select
              defaultValue={30 * 60_000}
              onChange={(e) => mon.setCooldownMs(Number(e.target.value))}
            >
              {COOLDOWN_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            className="btn ghost sm"
            style={{ marginTop: 4 }}
            onClick={mon.reset}
            title="立即清除冷却，重新武装触发器（调试用）"
          >
            ⚡ 跳过冷却
          </button>

          {/* Session 对话看板 */}
          <div className="session-board">
            <div className="session-board-head">
              <span>💬 对话看板</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn ghost sm"
                  onClick={() => (window as any).__dietDebug?.triggerFilePick?.()}
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  title="从相册选图，模拟拍照上传"
                >📷 上传照片</button>
                <button className="btn ghost sm" onClick={clearLog} style={{ padding: '2px 8px', fontSize: 11 }}>清空</button>
              </div>
            </div>
            {/* 短等待倒计时(going_to_eat 期间显示) */}
            <ShortWaitCountdown />
            <div className="session-log" ref={logRef}>
              {msgs.length === 0 && <div className="session-empty">暂无对话记录</div>}
              {msgs.map((m) => (
                <div key={m.id} className={`session-msg ${m.role}`}>
                  <span className="session-role">{m.role === 'bot' ? '🤖' : '🧒'}</span>
                  <span className="session-text">{m.text || '…'}</span>
                </div>
              ))}
            </div>
          </div>

          <InfoPanel
            enterCooldown={mon.enterCooldown}
            markTrigger={mon.markTrigger}
            markMealSlotDone={mon.markMealSlotDone}
            setSpeechLevel={mon.setSpeechLevel}
            lockArmed={mon.lockArmed}
            unlockArmed={mon.unlockArmed}
            onMsgsChange={setMsgs}
            onRouteResult={setLastRoute}
          />
        </div>
      )}
    </div>
  );
}
