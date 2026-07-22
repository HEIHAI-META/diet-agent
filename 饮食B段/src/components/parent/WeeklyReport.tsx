import { useState } from 'react';
import { useStore } from '../../store';
import { useUI } from '../../ui';
import { weeklySuggestion } from '../../api';
import { dateStr } from '../../utils';
import { weeklySummary, weekValidDays, vegLowDays, snackCount } from '../../report';

function Stars({ n }: { n: number }) {
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return (
    <span className="stars" aria-label={`${n}/5`}>
      {'★'.repeat(full)}{half ? '½' : ''}
    </span>
  );
}

export default function WeeklyReport() {
  const days = useStore((s) => s.days);
  const setWeeklySuggestion = useStore((s) => s.setWeeklySuggestion);
  const ensureDay = useStore((s) => s.ensureDay);
  const pushToast = useUI((s) => s.push);
  const [loading, setLoading] = useState(false);

  const end = dateStr(0);
  const weekly = days.find((d) => d.date === end)?.weeklySuggestion;
  const valid = weekValidDays(days, end);
  const lowDays = vegLowDays(valid);
  const snackTotal = valid.reduce((a, d) => a + snackCount(d), 0);
  const lowAlert = lowDays >= 3;

  const generate = async () => {
    setLoading(true);
    try {
      const r = await weeklySuggestion({ weeklySummary: weeklySummary(days, end) });
      ensureDay(end);
      setWeeklySuggestion(end, r);
      pushToast({ ico: '📈', title: '周报解读已生成', body: '本周趋势评估已更新' });
    } catch (e: any) {
      pushToast({ ico: '⚠️', title: '生成失败', body: e?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3>📈 周报解读</h3>
      <div className="row gap8 wrap tiny" style={{ marginBottom: 8 }}>
        <span className={lowAlert ? 'badge abnormal' : 'badge low'}>🥬 蔬菜不足 {lowDays}/{valid.length} 天{lowAlert ? ' · 建议密切关注' : ''}</span>
        <span className="badge high">🍬 零食累计 {snackTotal} 次</span>
      </div>
      {weekly ? (
        <div className="nutri-report">
          <div className="nutri-stars">
            <Stars n={weekly.stars} />
            <span className="num">{weekly.stars.toFixed(1)}/5</span>
          </div>
          {weekly.summary && <div className="nutri-summary">{weekly.summary}</div>}
          {weekly.assessment && <div className="nutri-assessment">{weekly.assessment}</div>}
          {weekly.dimensions.length > 0 && (
            <div className="nutri-dims">
              {weekly.dimensions.map((d, i) => {
                const ok = /适中|充足|合理/.test(d.status);
                return (
                  <div key={i} className="dim">
                    <div className="dim-name">{d.name}</div>
                    <div className={`dim-status ${ok ? 'ok' : 'warn'}`}>{d.status || '—'}</div>
                    {d.note && <div className="dim-note">{d.note}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {weekly.advice.length > 0 && (
            <ul className="nutri-advice">
              {weekly.advice.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <div className="muted tiny">尚未生成。点击下方按钮生成本周趋势评估与建议。</div>
      )}
      <button className="btn full mt12" onClick={generate} disabled={loading}>
        {loading ? '生成中…' : weekly ? '重新生成周报解读' : '生成周报解读'}
      </button>
      <div className="tiny muted mt8">单次异常不焦虑,看趋势;连续偏低才触发趋势性建议。</div>
    </div>
  );
}
