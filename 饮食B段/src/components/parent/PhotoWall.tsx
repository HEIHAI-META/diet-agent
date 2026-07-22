import { useState } from 'react';
import { useStore } from '../../store';
import { MEAL_LABEL, dateLabel } from '../../utils';

interface PhotoItem {
  url: string;
  label: string;
  date: string;
  confidence: 'high' | 'low';
  foods: string;
}

export default function PhotoWall() {
  const days = useStore((s) => s.days);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);

  const items: PhotoItem[] = [];
  for (const d of [...days].reverse()) {
    for (const m of d.meals) {
      if (m.photoUrl) {
        items.push({ url: m.photoUrl, label: MEAL_LABEL[m.type], date: d.date, confidence: m.confidence, foods: m.foodsDetected || '' });
      }
    }
    for (const e of d.extras) {
      if (e.photoUrl) {
        const ico = e.kind === 'snack' ? '零食' : '饮料';
        items.push({ url: e.photoUrl, label: ico, date: d.date, confidence: e.confidence, foods: e.name });
      }
    }
  }

  return (
    <>
      <div className="card">
        <h3>📸 餐食照片墙</h3>
        <div className="tiny muted mb0">共 {items.length} 张 · 正餐 / 零食 / 饮料统一展示,新拍的实时同步</div>
      </div>
      <div className="card">
        {items.length === 0 ? (
          <div className="photo-empty">还没有照片</div>
        ) : (
          <div className="photo-grid">
            {items.map((it, i) => (
              <div key={i} className="photo-tile" onClick={() => setLightbox(it)}>
                <img src={it.url} alt={it.foods} />
                <div className="overlay">
                  <div>{it.label} · {dateLabel(it.date)}</div>
                  <span className="badge high" style={{ fontSize: 9, padding: '1px 6px', marginTop: 2 }}>{it.confidence === 'high' ? '高' : '低'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <span className="close">×</span>
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <img src={lightbox.url} alt="" />
            <div style={{ marginTop: 10, fontSize: 14 }}>{lightbox.label} · {dateLabel(lightbox.date)} · {lightbox.foods}</div>
          </div>
        </div>
      )}
    </>
  );
}
