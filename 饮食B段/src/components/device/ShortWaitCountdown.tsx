import { useEffect, useState } from 'react';
import { useUI } from '../../ui';

export default function ShortWaitCountdown() {
  const startedAt = useUI((s) => s.shortWaitStartedAt);
  const durationMs = useUI((s) => s.shortWaitDurationMs);
  const signalSkipWait = useUI((s) => s.signalSkipWait);

  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!startedAt || !durationMs) { setRemaining(0); return; }
    const tick = () => {
      const rem = Math.max(0, startedAt + durationMs - Date.now());
      setRemaining(rem);
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [startedAt, durationMs]);

  if (!startedAt || remaining === 0) return null;

  const secs = Math.ceil(remaining / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  const pct = (remaining / durationMs) * 100;

  return (
    <div className="sw-countdown">
      <div className="sw-head">
        <span className="sw-ico">⏳</span>
        <span className="sw-label">短等待中（going_to_eat）</span>
        <span className="sw-time">{mins}:{String(s).padStart(2, '0')}</span>
      </div>
      <div className="sw-bar">
        <div className="sw-fill" style={{ width: pct + '%' }} />
      </div>
      <button className="btn ghost sm sw-skip" onClick={signalSkipWait}>
        ⏩ 跳过等待（测试）
      </button>
    </div>
  );
}
