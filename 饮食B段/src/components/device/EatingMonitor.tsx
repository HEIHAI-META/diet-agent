import { type MonitorApi } from '../../hooks/useEatingMonitor';
import { useUI } from '../../ui';
import type { MealTimeLevel } from '../../utils';

const MEAL_LABEL: Record<MealTimeLevel, string> = { none: '非饭点', near: '接近饭点', in: '饭点中' };

export default function EatingMonitor({ mon }: { mon: MonitorApi }) {
  const { view } = mon;
  const voiceInterim = useUI((s) => s.voiceInterim);
  const voiceLastTranscript = useUI((s) => s.voiceLastTranscript);

  const cdLabel = view.cooldownRemaining > 0
    ? view.cooldownRemaining >= 60000
      ? `冷却中 · 剩 ${Math.ceil(view.cooldownRemaining / 60000)} 分钟`
      : `冷却中 · 剩 ${Math.ceil(view.cooldownRemaining / 1000)} 秒`
    : view.p >= 70 ? '已达触发阈值' : view.p >= 45 ? '接近阈值' : '监听中';
  const cdActive = view.cooldownRemaining > 0;

  return (
    <div className="eating-monitor">
      <div className="em-head">
        <span className="em-title">🎯 进食识别</span>
        <span className="em-thr">阈值 70%</span>
      </div>

      <div className="em-gauge">
        <div className="em-pval">
          {Math.round(view.p)}<span className="pct">%</span>
          <span className="em-state" style={{ color: cdActive ? 'var(--warn,#e8a200)' : view.p >= 70 ? 'var(--good,#1aa260)' : 'var(--mut,#8a919c)' }}>{cdLabel}</span>
        </div>
        <div className="em-bar"><div className="em-fill" style={{ width: view.p + '%' }} /></div>
        {!view.armed && !cdActive && <div className="em-armed">已触发,等待 P&lt;67% 重新武装</div>}
      </div>

      <div className="em-breakdown">
        {view.factors.length === 0 && <div className="em-empty">无进食信号</div>}
        {view.factors.map((f) => (
          <div key={f.k} className="em-row"><span>{f.k}</span><span>{(f.w >= 0 ? '+' : '') + f.w + '%'}</span></div>
        ))}
        <div className="em-row sum"><span>合计 / P(Eating)</span><span>{view.raw}% → {Math.round(view.p)}%</span></div>
      </div>

      <div className="em-controls">
        {!mon.supported ? (
          <div className="em-hint" style={{ color: 'var(--bad,#e0533d)' }}>浏览器不支持语音识别,请用 Chrome/Edge/Safari</div>
        ) : (
          <>
            <button className={`btn full ${mon.active ? '' : 'pri'}`} style={{ padding: 10 }} onClick={mon.active ? mon.stop : mon.start}>
              {mon.active ? '停止语音识别' : '启动语音识别'}
            </button>
            <div className="em-signals">
              <div className="em-sig"><span>临时转写</span><span>{voiceInterim ? `"${voiceInterim.slice(0, 16)}"` : '—'}</span></div>
              <div className="em-sig"><span>最终转写</span><span>{voiceLastTranscript ? `"${voiceLastTranscript.slice(0, 16)}"` : '—'}</span></div>
              <div className="em-sig"><span>进食语义</span><span style={{ color: view.semantic !== 'none' ? 'var(--good,#1aa260)' : 'var(--mut)' }}>{view.semantic !== 'none' ? view.semantic : '无'}</span></div>
              <div className="em-sig"><span>饭点(自动)</span><span>{MEAL_LABEL[view.mealTime]}</span></div>
            </div>
            <div className="em-hint">说"吃饭了/去吃饭/马上吃/在吃饭/开饭了"等 → 判语义等级 → 强=+75 触发。饭点按系统时间判定。</div>
          </>
        )}
      </div>

      {mon.triggers.length > 0 && (
        <div className="em-log">
          <div className="em-log-title">触发记录（{mon.triggers.length}）</div>
          {mon.triggers.map((t) => (
            <div key={t.id} className="em-log-row">
              <span className="em-log-time">{t.time}</span>
              <span className="em-log-p">P {t.p}%</span>
              <span className="em-log-f">{t.factors.map((f) => f.k).join('·')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
