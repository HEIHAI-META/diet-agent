import { useUI, simOrNow } from '../../ui';
import { dateStr, dateLabel, nowHHMM } from '../../utils';

const TIME_PRESETS: Array<{ label: string; t: string }> = [
  { label: '早 07:35', t: '07:35' },
  { label: '午 12:10', t: '12:10' },
  { label: '晚 18:20', t: '18:20' },
  { label: '夜 20:00', t: '20:00' },
];

function shiftDate(ds: string, days: number): string {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  let total = (h * 60 + m + minutes) % (24 * 60);
  if (total < 0) total += 24 * 60;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function TimeControl() {
  const simTime = useUI((s) => s.simTime);
  const setSimTime = useUI((s) => s.setSimTime);
  const simDate = useUI((s) => s.simDate);
  const setSimDate = useUI((s) => s.setSimDate);

  const dateVal = simDate || dateStr(0);
  const timeVal = simOrNow(simTime);
  const effDate = simDate ? dateLabel(simDate) : '今天';
  const effTime = simTime || '实时';

  return (
    <div className="tc card">
      <div className="tc-title">🧪 测试时间 · 设备端 + 家长端共享</div>

      <div className="tc-row">
        <span className="tc-lbl">日期</span>
        <input type="date" value={dateVal} onChange={(e) => setSimDate(e.target.value)} />
        <button className="btn ghost sm" onClick={() => setSimDate(shiftDate(dateVal, -1))}>−1天</button>
        <button className="btn ghost sm" onClick={() => setSimDate(shiftDate(dateVal, 1))}>+1天</button>
        <button className="btn ghost sm" onClick={() => setSimDate(null)}>今天</button>
      </div>

      <div className="tc-row">
        <span className="tc-lbl">时间</span>
        <input type="time" value={timeVal} onChange={(e) => setSimTime(e.target.value)} />
        <button className="btn ghost sm" onClick={() => setSimTime(shiftTime(timeVal, -10))}>−10分</button>
        <button className="btn ghost sm" onClick={() => setSimTime(shiftTime(timeVal, 10))}>+10分</button>
        <button className="btn ghost sm" onClick={() => setSimTime(null)}>实时</button>
      </div>

      <div className="tc-presets">
        {TIME_PRESETS.map((p) => (
          <button key={p.label} className={simTime === p.t ? 'btn sm' : 'btn ghost sm'} onClick={() => setSimTime(p.t)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="tc-current">当前:{effDate} {effTime}{(!simDate && !simTime) ? '(真实时间)' : ''}</div>
    </div>
  );
}
