import { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useUI } from '../../ui';
import { speak } from '../../lib/feedback';
import { dateLabel, weekdayLabel, uid, deriveMealTime, displayTime } from '../../utils';

type BandState = 'idle' | 'vibrating' | 'raising' | 'speaking' | 'listening' | 'waiting';

const STATE_BADGE: Record<BandState, { cls: string; ico: string; text: string } | null> = {
  idle: null,
  vibrating: { cls: 'st-vibrate', ico: '📳', text: '震动中·等抬腕' },
  raising: { cls: 'st-raise', ico: '⌚', text: '抬腕中' },
  speaking: { cls: 'st-speak', ico: '🗣️', text: '说话中' },
  listening: { cls: 'st-listen', ico: '🎧', text: '听中' },
  waiting: { cls: 'st-raise', ico: '⏳', text: '短等待中' },
};

// 无屏手环:不显示任何屏幕内容,仅靠指示灯 + 震动/抬腕动画表达状态。
// 触发后 bandState 驱动:震动(等抬腕) → 说话 → 倾听 → (going_to_eat)短等待,模拟真机时序。
// 抬腕门(PRD 模块一):震动等抬腕 8-10s 期间,点「抬腕」= 抬腕 → 进第一问;未点超时记「未唤醒」。
export default function Band() {
  const today = useStore((s) => s.today());
  const simDate = useUI((s) => s.simDate);
  const bandState = useUI((s) => s.bandState);
  const setBandState = useUI((s) => s.setBandState);
  const awaitingRaise = useUI((s) => s.awaitingRaise);
  const signalRaise = useUI((s) => s.signalRaise);
  const signalSkipWait = useUI((s) => s.signalSkipWait);
  const startEatingConfirm = useUI((s) => s.startEatingConfirm);
  const simTime = useUI((s) => s.simTime);
  const st = STATE_BADGE[bandState];

  const raiseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (raiseTimer.current) clearTimeout(raiseTimer.current); }, []);

  // 抬腕:门控期间(震动等抬腕)点击 = 解门 → 第一问;否则为演示性抬腕动画。
  const raiseWrist = () => {
    if (useUI.getState().awaitingRaise) { signalRaise(); return; }
    const prev = useUI.getState().bandState;
    setBandState('raising');
    if (raiseTimer.current) clearTimeout(raiseTimer.current);
    raiseTimer.current = setTimeout(() => {
      if (useUI.getState().bandState === 'raising') {
        setBandState(prev === 'raising' ? 'idle' : prev);
      }
    }, 1500);
  };

  return (
    <div className={`band-card ${bandState === 'vibrating' ? 'state-vibrate' : ''}`}>
      <div className="band">
        <div className="band-row">
          <div className="band-strap" />
          <div className={`band-pod ${st?.cls || ''}`}>
            <span className="band-led" />
            <div className="band-text">
              <div className="band-name">Diet Band</div>
              <div className="band-sub">无屏 · 自动同步</div>
            </div>
          </div>
          <div className="band-strap right" />
        </div>
        <div className="band-status">
          {st ? (
            <span className={`band-state-tag ${st.cls}`}>{st.ico} {st.text}…</span>
          ) : (
            <><span className="dot" />佩戴中 · 已同步 · {dateLabel(today.date)} {weekdayLabel(today.date)}{simDate ? ' · 🧪模拟' : ''}</>
          )}
        </div>
        <div className="band-actions">
          <button className={`btn sm ${awaitingRaise ? 'pri' : 'ghost'}`} onClick={raiseWrist} title={awaitingRaise ? '震动等抬腕中,点击 = 抬腕应答' : '模拟抬腕动作'}>
            ✋ {awaitingRaise ? '抬腕应答' : '抬腕'}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => speak('你好呀，我是你的饮食小助手，现在能听到我说话吗？')}
            title="测试语音播报(TTS)。若无声见下方提示"
          >
            🔊 测试语音
          </button>
          <button
            className="btn ghost sm"
            onClick={signalSkipWait}
            title="跳过短等待，立即触发二次轻提醒（调试用）"
          >
            ⏩ 跳过等待
          </button>
          <button
            className="btn sm"
            style={{ background: 'var(--accent,#4f6ef7)', color: '#fff' }}
            onClick={() => {
              const time = displayTime(simTime);
              startEatingConfirm({ id: uid(), p: 75, time, mealTime: deriveMealTime(time) });
            }}
            title="直接触发被动进食识别流程（调试用）"
          >
            🔔 触发被动模式
          </button>
        </div>
      </div>
    </div>
  );
}
