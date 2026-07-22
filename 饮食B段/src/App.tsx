import { useEffect, useState } from 'react';
import Band from './components/device/Band';
import DebugInfo from './components/device/DebugInfo';
import TimeControl from './components/device/TimeControl';
import TestHistory from './components/device/TestHistory';
import ParentApp from './components/parent/ParentApp';
import Toaster from './components/Toaster';
import { useStore } from './store';
import { useUI } from './ui';
import { reportSuggestion } from './api';
import { todaySummary, trend7d } from './report';
import { dateStr } from './utils';

export default function App() {
  const days = useStore((s) => s.days);
  const config = useStore((s) => s.config);
  const setReportSuggestion = useStore((s) => s.setReportSuggestion);
  const ensureDay = useStore((s) => s.ensureDay);
  const today = useStore((s) => s.today());
  const pushToast = useUI((s) => s.push);
  const setParentTab = useUI((s) => s.setParentTab);
  const setSelectedDate = useUI((s) => s.setSelectedDate);
  const simDate = useUI((s) => s.simDate);
  const simTime = useUI((s) => s.simTime);
  const [busy, setBusy] = useState(false);

  // 模拟日期变化时,确保该日期的空白天存在(便于在家长端查看)。
  useEffect(() => {
    ensureDay(simDate || dateStr(0));
  }, [simDate, ensureDay]);

  const reportClock = simTime || config.reportTime;

  const triggerEveningReport = async () => {
    setParentTab('daily');
    setSelectedDate(today.date);
    pushToast({ ico: '🥗', title: `${reportClock} · 今日营养评估已推送`, body: '已汇总三餐、零食与近 7 天趋势' });
    setBusy(true);
    try {
      const r = await reportSuggestion({
        todaySummary: todaySummary(today),
        trend7d: trend7d(days, today.date),
      });
      setReportSuggestion(today.date, r);
      pushToast({ ico: '🥗', title: '营养评估已生成', body: '查看日报底部' });
    } catch (e: any) {
      pushToast({ ico: '⚠️', title: '建议生成失败', body: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const watchOnly = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('watch');
  const parentOnly = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('parent');

  if (watchOnly) {
    return (
      <div className="device-only">
        <Band />
        <DebugInfo />
        <TimeControl />
        <Toaster />
      </div>
    );
  }

  if (parentOnly) {
    return (
      <div className="parent-only">
        <header className="app-header">
          <div className="logo"><span className="dot" />Diet Agent · 家长端</div>
          <div className="sub">小宝的饮食追踪</div>
          <div className="spacer" />
          {(simDate || simTime) && <span className="badge-env">🧪 {simDate ? dateStr(0) === simDate ? '今天' : simDate.slice(5) : '今天'} {simTime || ''}</span>}
          <span className="badge-env">doubao-seed-2.0-mini · OpenAI 兼容</span>
          <button className="btn" onClick={triggerEveningReport} disabled={busy}>
            {busy ? '生成中…' : `🔔 模拟 ${reportClock} 推送`}
          </button>
        </header>
        <div className="parent-only-body">
          <ParentApp />
          <aside className="test-panel">
            <TimeControl />
            <div className="tiny muted" style={{ marginTop: 8, maxWidth: 320 }}>
              调到这里的时间会即时同步到设备端与家长端;拍照记录会落到对应日期与时间,餐次按时间自动归入早/午/晚。
            </div>
            <TestHistory />
          </aside>
        </div>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo"><span className="dot" />Diet Agent</div>
        <div className="sub">儿童饮食追踪 Demo · 设备端</div>
        <div className="spacer" />
        {(simDate || simTime) && <span className="badge-env">🧪 {simDate ? dateStr(0) === simDate ? '今天' : simDate.slice(5) : '今天'} {simTime || ''}</span>}
        <span className="badge-env">doubao-seed-2.0-mini · OpenAI 兼容</span>
        <a className="btn ghost" href="?parent" target="_blank" rel="noopener" title="在新标签页打开家长端(也可直接访问 /?parent)">
          📱 家长端 ↗
        </a>
        <button className="btn" onClick={triggerEveningReport} disabled={busy}>
          {busy ? '生成中…' : `🔔 模拟 ${reportClock} 推送`}
        </button>
      </header>

      <div className="app-body app-body-single">
        <div className="device-col">
          <div className="col-title">⌚ 设备端 · 无屏手环 + 调试信息</div>
          <Band />
          <DebugInfo />
          <TimeControl />
          <div className="tiny muted" style={{ marginTop: 8, maxWidth: 340, textAlign: 'center' }}>
            手环无屏 · 拍照 / 语音 / 文字输入在「调试信息」内 · 真实 LLM 食物识别 · 家长端已拆为独立网页
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  );
}
