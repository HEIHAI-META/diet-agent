import { useEffect } from 'react';
import { useStore } from '../../store';
import { useUI } from '../../ui';
import { dateStr, dateLabel, weekdayLabel } from '../../utils';
import DailyReport from './DailyReport';
import PhotoWall from './PhotoWall';
import WeeklyReport from './WeeklyReport';
import Settings from './Settings';

export default function ParentApp() {
  const tab = useUI((s) => s.parentTab);
  const setTab = useUI((s) => s.setParentTab);
  const selectedDate = useUI((s) => s.selectedDate);
  const setSelectedDate = useUI((s) => s.setSelectedDate);
  const simDate = useUI((s) => s.simDate);
  const days = useStore((s) => s.days);
  const ensureDay = useStore((s) => s.ensureDay);

  // 模拟日期变化时,家长端自动跳到那一天(并确保该日存在)。
  useEffect(() => {
    const target = simDate || dateStr(0);
    ensureDay(target);
    setSelectedDate(target);
  }, [simDate, ensureDay, setSelectedDate]);

  const idx = Math.max(0, days.findIndex((d) => d.date === selectedDate));
  const atStart = idx <= 0;
  const atEnd = idx >= days.length - 1;
  const todayAnchor = simDate || dateStr(0);
  const isToday = selectedDate === todayAnchor;

  const go = (delta: number) => {
    const ni = Math.min(days.length - 1, Math.max(0, idx + delta));
    if (days[ni]) setSelectedDate(days[ni].date);
  };

  return (
    <div className="phone">
      <div className="phone-screen">
        <div className="phone-header">
          <div className="title">家长端 · 小宝的饮食</div>
          <div className="date-row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost sm" style={{ padding: '4px 12px', opacity: atStart ? 0.35 : 1 }} disabled={atStart} onClick={() => go(-1)}>‹</button>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)' }}>
              {isToday ? '今天 · ' : ''}{dateLabel(selectedDate)} {weekdayLabel(selectedDate)}
            </div>
            <button className="btn ghost sm" style={{ padding: '4px 12px', opacity: atEnd ? 0.35 : 1 }} disabled={atEnd} onClick={() => go(1)}>›</button>
          </div>
        </div>

        <div className="phone-body">
          {tab === 'daily' && <DailyReport date={selectedDate} />}
          {tab === 'photos' && <PhotoWall />}
          {tab === 'weekly' && <WeeklyReport />}
          {tab === 'settings' && <Settings />}
        </div>

        <div className="phone-tabs">
          <div className={`tab ${tab === 'daily' ? 'active' : ''}`} onClick={() => setTab('daily')}>
            <span className="ico">📋</span>日报
          </div>
          <div className={`tab ${tab === 'photos' ? 'active' : ''}`} onClick={() => setTab('photos')}>
            <span className="ico">📸</span>照片
          </div>
          <div className={`tab ${tab === 'weekly' ? 'active' : ''}`} onClick={() => setTab('weekly')}>
            <span className="ico">📈</span>周报
          </div>
          <div className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            <span className="ico">⚙️</span>配置
          </div>
        </div>
      </div>
    </div>
  );
}
