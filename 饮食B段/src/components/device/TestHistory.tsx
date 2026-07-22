import { useState } from 'react';
import { useStore, type HistoryEntry } from '../../store';
import { dateLabel, weekdayLabel, MEAL_LABEL } from '../../utils';

function HistoryModal({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const r = entry.report;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>{dateLabel(entry.date)} {weekdayLabel(entry.date)}</h3>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="row gap8 wrap tiny" style={{ margin: '8px 0' }}>
          <span className="badge high">🍽️ 正餐 {entry.mealCount}</span>
          <span className="badge low">🍬 零食/饮料 {entry.extraCount}</span>
          {r && <span className="badge abnormal">⭐ {r.stars.toFixed(1)}/5</span>}
        </div>
        {r && (
          <div className="nutri-report" style={{ marginBottom: 8 }}>
            {r.summary && <div className="nutri-summary">{r.summary}</div>}
            {r.assessment && <div className="nutri-assessment">{r.assessment}</div>}
            {r.dimensions.length > 0 && (
              <div className="nutri-dims">
                {r.dimensions.map((d, i) => {
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
            {r.unhealthy.length > 0 && (
              <div className="nutri-section">
                <div className="tiny muted">⚠️ 不良摄入</div>
                {r.unhealthy.map((u, i) => (
                  <div key={i} className="unhealthy-item"><b>{u.name}</b><span className="tiny muted"> · {u.reason}</span></div>
                ))}
              </div>
            )}
            {r.advice.length > 0 && (
              <ul className="nutri-advice">
                {r.advice.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="divider" />
        <div className="tiny muted" style={{ fontWeight: 600, margin: '6px 0 2px' }}>🍽️ 正餐</div>
        {entry.snapshot.meals.length === 0 ? (
          <div className="tiny muted">无</div>
        ) : (
          entry.snapshot.meals.map((m, i) => (
            <div key={i} className="meal-block">
              <div className="info">
                <div className="row between"><span className="name">{MEAL_LABEL[m.type]} · {m.time}</span></div>
                <div className="sub">{m.name}</div>
                {Object.keys(m.ratio).length > 0 && (
                  <div className="ratio-row">{Object.entries(m.ratio).map(([cat, ord]) => (
                    <span key={cat} className="ratio-chip">{cat}·{ord}</span>
                  ))}</div>
                )}
              </div>
            </div>
          ))
        )}
        <div className="tiny muted" style={{ fontWeight: 600, margin: '10px 0 2px' }}>🍬 零食 / 🥤 饮料</div>
        {entry.snapshot.extras.length === 0 ? (
          <div className="tiny muted">无</div>
        ) : (
          entry.snapshot.extras.map((e, i) => {
            const ico = e.kind === 'snack' ? '🍬' : '🥤';
            return (
              <div key={i} className="meal-block">
                <div className="info"><div className="name">{ico} {e.name} · {e.time}</div></div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function TestHistory() {
  const history = useStore((s) => s.history);
  const [open, setOpen] = useState<HistoryEntry | null>(null);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>📋 测试历史</h3>
      {history.length === 0 ? (
        <div className="tiny muted">还没有测试记录。在设备端拍照/记录后,这里会留下每天的只读快照(刷新浏览器仍在)。</div>
      ) : (
        <div className="history-list">
          {history.map((h) => (
            <button key={h.date} className="history-item" onClick={() => setOpen(h)}>
              <div className="row between">
                <span className="hi-date">{dateLabel(h.date)} {weekdayLabel(h.date)}</span>
                {typeof h.stars === 'number' && <span className="hi-stars">⭐ {h.stars.toFixed(1)}</span>}
              </div>
              <div className="tiny muted">🍽️ {h.mealCount} · 🍬 {h.extraCount}{h.summary ? ' · ' + h.summary : ''}</div>
            </button>
          ))}
        </div>
      )}
      {open && <HistoryModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
