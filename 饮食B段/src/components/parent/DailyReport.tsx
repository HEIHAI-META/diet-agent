import { useState } from 'react';
import type { DayRecord, Meal, MealType, ExtraRecord, Ordinal, PlateRatio, FoodCategory, FoodItem } from '../../types';
import { useStore } from '../../store';
import { useUI } from '../../ui';
import { reportSuggestion } from '../../api';
import { todaySummary, trend7d, completeness, dayInteractions, isArchived, type SlotStatus } from '../../report';
import { MEAL_LABEL, dateLabel, weekdayLabel, ORDINAL_COLOR, slotFromTime } from '../../utils';

// 餐盘结构只评估 蔬菜/主食/肉蛋豆(PRD §二:水果/汤/零食独立记录,不参与比例)。
const RATIO_CATS: FoodCategory[] = ['蔬菜', '主食', '肉蛋豆'];
const SLOTS: MealType[] = ['breakfast', 'lunch', 'afternoon', 'dinner'];
const TARGETS: Array<{ k: 'meal' | 'snack' | 'drink' | 'fruit'; lbl: string }> = [
  { k: 'meal', lbl: '🍽️ 正餐' },
  { k: 'snack', lbl: '🍬 零食' },
  { k: 'drink', lbl: '🥤 饮料' },
  { k: 'fruit', lbl: '🍎 水果' },
];

const CAT_COLOR: Record<FoodCategory, string> = {
  蔬菜: '#6bbf8f',
  主食: '#e8a04f',
  肉蛋豆: '#e07a5f',
  水果: '#b794f4',
  汤: '#5b8def',
};
const CAT_ORDER: FoodCategory[] = ['蔬菜', '主食', '肉蛋豆', '水果', '汤'];

function FoodTags({ items }: { items: FoodItem[] }) {
  const ordered = [...items].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
  return (
    <div className="sub" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
      {ordered.map((f, i) => (
        <span key={i} style={{ color: CAT_COLOR[f.cat] || '#9aa3b2' }}>{f.name}</span>
      ))}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return (
    <span className="stars" aria-label={`${n}/5`}>
      {'★'.repeat(full)}{half ? '½' : ''}
    </span>
  );
}

function RatioEditor({ value, onChange }: { value: PlateRatio; onChange: (v: PlateRatio) => void }) {
  const cycle = (cat: string) => {
    const cur = value[cat];
    const next: Ordinal | undefined = !cur ? '偏少' : cur === '偏少' ? '适中' : cur === '适中' ? '偏多' : undefined;
    const copy = { ...value };
    if (next) copy[cat] = next; else delete copy[cat];
    onChange(copy);
  };
  return (
    <div className="ratio-row mt8">
      {RATIO_CATS.map((cat) => {
        const ord = value[cat];
        return (
          <button key={cat} className="ratio-chip" style={{ cursor: 'pointer', border: '1px solid var(--line)', color: ord ? ORDINAL_COLOR[ord] : 'var(--muted)', background: '#fff' }} onClick={() => cycle(cat)}>
            {cat}{ord ? `·${ord}` : '·—'}
          </button>
        );
      })}
    </div>
  );
}

function chipBtn(active: boolean, lbl: string, onClick: () => void) {
  return (
    <button className="ratio-chip" style={{ cursor: 'pointer', border: '1px solid var(--line)', background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : 'var(--ink-soft)' }} onClick={onClick}>
      {lbl}
    </button>
  );
}

// 待确认项:可在 正餐/零食/饮料/水 之间跨类归类(仅低置信度)。
function PendingItem({ date, item, source }: { date: string; item: Meal | ExtraRecord; source: 'meal' | 'extra' }) {
  const patchMeal = useStore((s) => s.patchMeal);
  const mealToExtra = useStore((s) => s.mealToExtra);
  const extraToMeal = useStore((s) => s.extraToMeal);
  const patchExtra = useStore((s) => s.patchExtra);
  const removeMeal = useStore((s) => s.removeMeal);
  const removeExtra = useStore((s) => s.removeExtra);

  const isMeal = source === 'meal';
  const m = item as Meal;
  const e = item as ExtraRecord;
  const initTarget: 'meal' | 'snack' | 'drink' | 'fruit' = isMeal ? 'meal' : e.kind === 'snack' ? 'snack' : e.kind === 'fruit' ? 'fruit' : 'drink';
  const [target, setTarget] = useState(initTarget);
  const [name, setName] = useState(isMeal ? m.foodsDetected || '' : e.name);
  const [slot, setSlot] = useState<MealType>(isMeal ? m.type : slotFromTime(e.time));
  const [ratio, setRatio] = useState<PlateRatio>(isMeal ? m.plateRatio || {} : {});
  const photo = isMeal ? m.photoUrl : e.photoUrl;
  const time = isMeal ? m.time : e.time;
  const id = isMeal ? m.id : e.id;

  const save = () => {
    if (target === 'meal') {
      if (isMeal) patchMeal(date, id, { type: slot, foodsDetected: name, plateRatio: ratio, confirmed: true, foodItems: name === (m.foodsDetected || '') ? m.foodItems : undefined });
      else extraToMeal(date, id, { slot, foodsDetected: name, plateRatio: ratio });
    } else {
      const kind: 'snack' | 'drink' | 'fruit' = target === 'snack' ? 'snack' : target === 'fruit' ? 'fruit' : 'drink';
      if (isMeal) mealToExtra(date, id, { name, kind });
      else patchExtra(date, id, { name, kind, confirmed: true });
    }
  };
  const del = () => (isMeal ? removeMeal(date, id) : removeExtra(date, id));

  return (
    <div className="meal-block" style={{ background: 'rgba(232,160,79,0.06)', borderRadius: 10, padding: 10, flexDirection: 'column', gap: 6 }}>
      <div className="row between">
        <span className="name">⚠️ 待确认 · {time} · AI 预判:{isMeal ? `正餐(${MEAL_LABEL[m.type]})` : e.kind === 'snack' ? '零食' : '饮料'}</span>
        <span className="badge low">置信度低</span>
      </div>
      {photo && <img className="thumb-inline" src={photo} alt="" />}
      {item.childNote && <div className="tiny muted" style={{ marginBottom: 4 }}>孩子补充：{item.childNote}</div>}
      <input value={name} onChange={(e2) => setName(e2.target.value)} placeholder="名称" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontSize: 13 }} />
      <div className="ratio-row mt8">{TARGETS.map((t) => chipBtn(target === t.k, t.lbl, () => setTarget(t.k)))}</div>
      {target === 'meal' && (
        <>
          <div className="ratio-row mt8">{SLOTS.map((s) => chipBtn(slot === s, MEAL_LABEL[s], () => setSlot(s)))}</div>
          <RatioEditor value={ratio} onChange={setRatio} />
        </>
      )}
      <div className="quick-yesno mt8">
        <button className="btn sm" onClick={save}>✅ 确认归类</button>
        <button className="btn ghost sm" onClick={del}>🗑️ 删除</button>
      </div>
    </div>
  );
}

// 已确认正餐:仅类内编辑(名称/餐次/占比)。
function MealRow({ date, meal }: { date: string; meal: Meal }) {
  const patchMeal = useStore((s) => s.patchMeal);
  const removeMeal = useStore((s) => s.removeMeal);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(meal.foodsDetected || '');
  const [slot, setSlot] = useState<MealType>(meal.type);
  const [ratio, setRatio] = useState<PlateRatio>(meal.plateRatio || {});

  const save = () => {
    patchMeal(date, meal.id, { type: slot, foodsDetected: name, plateRatio: ratio, foodItems: name === (meal.foodsDetected || '') ? meal.foodItems : undefined });
    setEditing(false);
  };

  return (
    <div className="meal-block" style={{ flexDirection: 'column', gap: 6 }}>
      {editing ? (
        <>
          {meal.photoUrl && <img className="thumb-inline" src={meal.photoUrl} alt="" />}
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontSize: 13 }} />
          <div className="ratio-row mt8">{SLOTS.map((s) => chipBtn(slot === s, MEAL_LABEL[s], () => setSlot(s)))}</div>
          <RatioEditor value={ratio} onChange={setRatio} />
          <div className="quick-yesno mt8">
            <button className="btn sm" onClick={save}>✅ 保存</button>
            <button className="btn ghost sm" onClick={() => removeMeal(date, meal.id)}>🗑️ 删除</button>
          </div>
        </>
      ) : (
        <>
          <div className="row between">
            <span className="name">{MEAL_LABEL[meal.type]} · {meal.time}</span>
            <span className="badge high">{meal.confidence === 'high' ? '置信度高' : '已确认'}</span>
          </div>
          {meal.photoUrl && <img className="thumb-inline" src={meal.photoUrl} alt="" style={{ marginTop: 4 }} />}
          {meal.foodItems && meal.foodItems.length > 0
            ? <FoodTags items={meal.foodItems} />
            : <div className="sub">{meal.foodsDetected || '—'}</div>}
          <div className="ratio-row">{Object.entries(meal.plateRatio).map(([cat, ord]) => (
            <span key={cat} className="ratio-chip" style={{ color: ORDINAL_COLOR[ord as Ordinal] }}>{cat}·{ord}</span>
          ))}</div>
          {meal.childNote && <div className="tiny muted" style={{ marginTop: 2 }}>孩子补充：{meal.childNote}</div>}
          {meal.original && meal.original.foodsDetected && meal.original.foodsDetected !== meal.foodsDetected && (
            <div className="tiny muted" style={{ marginTop: 2 }}>AI 原始:{meal.original.foodsDetected}</div>
          )}
          <button className="btn ghost sm mt8" onClick={() => { setName(meal.foodsDetected || ''); setSlot(meal.type); setRatio(meal.plateRatio || {}); setEditing(true); }}>✎ 修改</button>
        </>
      )}
    </div>
  );
}

// 已确认零食/饮料:仅类内编辑(名称/类型 零食↔饮料↔水)。
function ExtraRow({ date, e }: { date: string; e: ExtraRecord }) {
  const patchExtra = useStore((s) => s.patchExtra);
  const removeExtra = useStore((s) => s.removeExtra);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const [target, setTarget] = useState<'snack' | 'drink' | 'fruit'>(e.kind === 'snack' ? 'snack' : e.kind === 'fruit' ? 'fruit' : 'drink');

  const save = () => {
    const kind: 'snack' | 'drink' | 'fruit' = target === 'snack' ? 'snack' : target === 'fruit' ? 'fruit' : 'drink';
    patchExtra(date, e.id, { name, kind });
    setEditing(false);
  };
  const ico = e.kind === 'snack' ? '🍬' : e.kind === 'fruit' ? '🍎' : '🥤';

  return (
    <div className="meal-block" style={{ flexDirection: 'column', gap: 6 }}>
      {editing ? (
        <>
          {e.photoUrl && <img className="thumb-inline" src={e.photoUrl} alt="" />}
          <input value={name} onChange={(e2) => setName(e2.target.value)} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontSize: 13 }} />
          <div className="ratio-row mt8">
            {chipBtn(target === 'snack', '🍬 零食', () => setTarget('snack'))}
            {chipBtn(target === 'drink', '🥤 饮料', () => setTarget('drink'))}
            {chipBtn(target === 'fruit', '🍎 水果', () => setTarget('fruit'))}
          </div>
          <div className="quick-yesno mt8">
            <button className="btn sm" onClick={save}>✅ 保存</button>
            <button className="btn ghost sm" onClick={() => removeExtra(date, e.id)}>🗑️ 删除</button>
          </div>
        </>
      ) : (
        <>
          <div className="row between">
            <span className="name">{ico} {e.name} · {e.time}</span>
            <span className="badge high">{e.confidence === 'high' ? '置信度高' : '已确认'}</span>
          </div>
          {e.photoUrl && <img className="thumb-inline" src={e.photoUrl} alt="" style={{ marginTop: 4 }} />}
          {e.childNote && <div className="tiny muted" style={{ marginTop: 2 }}>孩子补充：{e.childNote}</div>}
          <button className="btn ghost sm mt8" onClick={() => { setName(e.name); setTarget(e.kind === 'snack' ? 'snack' : 'drink'); setEditing(true); }}>✎ 修改</button>
        </>
      )}
    </div>
  );
}

export default function DailyReport({ date }: { date: string }) {
  const days = useStore((s) => s.days);
  const config = useStore((s) => s.config);
  const setReportSuggestion = useStore((s) => s.setReportSuggestion);
  const pushToast = useUI((s) => s.push);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const day = days.find((d) => d.date === date) as DayRecord | undefined;
  if (!day) return <div className="card"><div className="muted">该日期暂无数据。</div></div>;

  // 48h 未确认归档:不计入趋势/评估,单独折叠展示(PRD §五)。
  const nonArchMeals = day.meals.filter((m) => !isArchived(m));
  const nonArchExtras = day.extras.filter((e) => !isArchived(e));
  const archivedMeals = day.meals.filter((m) => isArchived(m));
  const archivedExtras = day.extras.filter((e) => isArchived(e));

  const confirmedMeals = nonArchMeals.filter((m) => m.confirmed);
  const pendingMeals = nonArchMeals.filter((m) => !m.confirmed);
  const confirmedExtras = nonArchExtras.filter((e) => e.confirmed);
  const pendingExtras = nonArchExtras.filter((e) => !e.confirmed);
  const pending = pendingMeals.length + pendingExtras.length;
  const archivedCount = archivedMeals.length + archivedExtras.length;

  const comp = completeness(day);
  const interactions = dayInteractions(day);
  const SLOT_CHIP: Record<SlotStatus, string> = { unrecorded: 'badge low', pending: 'badge abnormal', confirmed: 'badge high' };
  const SLOT_TXT: Record<SlotStatus, string> = { unrecorded: '未记录', pending: '待确认', confirmed: '已记录' };

  const generate = async () => {
    setLoading(true);
    try {
      const r = await reportSuggestion({
        todaySummary: todaySummary(day),
        trend7d: trend7d(days, day.date),
      });
      setReportSuggestion(day.date, r);
      pushToast({ ico: '🥗', title: `${dateLabel(day.date)} 营养评估已生成`, body: '专业评估已更新' });
    } catch (e: any) {
      pushToast({ ico: '⚠️', title: '生成失败', body: e?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <h3 style={{ margin: 0 }}>📋 {dateLabel(day.date)} {weekdayLabel(day.date)} {day.isAbnormal && <span className="badge abnormal">异常日</span>}</h3>
          <span className="tiny muted">科普 {interactions.scienceCount}/3</span>
        </div>
        <div className="row gap8 wrap tiny mt8" style={{ alignItems: 'center' }}>
          <span className="muted">数据完整度 {comp.recorded}/{comp.total} 餐</span>
          {pending > 0 && <span className="badge abnormal">⚠️ 待确认 {pending}</span>}
        </div>
        <div className="row gap8 wrap tiny mt8" style={{ alignItems: 'center' }}>
          {SLOTS.map((s) => { const st = comp.slots[s]; return <span key={s} className={SLOT_CHIP[st]}>{MEAL_LABEL[s]}·{SLOT_TXT[st]}</span>; })}
        </div>
      </div>

      <div className="card">
        <h3>🍽️ 正餐</h3>
        {confirmedMeals.length === 0 && pendingMeals.length === 0 ? (
          <div className="tiny muted">今天还没有正餐记录。</div>
        ) : (
          SLOTS.map((slot) => {
            const conf = confirmedMeals.filter((m) => m.type === slot);
            const pend = pendingMeals.filter((m) => m.type === slot);
            if (!conf.length && !pend.length) return null;
            return (
              <div key={slot} style={{ marginTop: 4 }}>
                <div className="tiny muted" style={{ fontWeight: 600, color: 'var(--ink-soft)', margin: '6px 0 2px' }}>{MEAL_LABEL[slot]}</div>
                {conf.map((m) => <MealRow key={m.id} date={day.date} meal={m} />)}
                {pend.map((m) => <PendingItem key={m.id} date={day.date} item={m} source="meal" />)}
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <h3>🍬 零食 / 🥤 饮料 / 🍎 水果</h3>
        {confirmedExtras.length === 0 && pendingExtras.length === 0 ? (
          <div className="tiny muted">今天还没有零食 / 饮料 / 水果记录。</div>
        ) : (
          <>
            {confirmedExtras.map((e) => <ExtraRow key={e.id} date={day.date} e={e} />)}
            {pendingExtras.map((e) => <PendingItem key={e.id} date={day.date} item={e} source="extra" />)}
          </>
        )}
      </div>

      {archivedCount > 0 && (
        <div className="card">
          <button className="debug-head" onClick={() => setShowArchived((o) => !o)} style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <span className="tiny muted">🗄️ 已归档未确认 {archivedCount}(超 48h · 不计入趋势)</span>
            <span className="tiny">{showArchived ? '▾' : '▸'}</span>
          </button>
          {showArchived && (
            <>
              {archivedMeals.map((m) => <PendingItem key={m.id} date={day.date} item={m} source="meal" />)}
              {archivedExtras.map((e) => <PendingItem key={e.id} date={day.date} item={e} source="extra" />)}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>🥗 今日营养评估</h3>
        {day.reportSuggestion ? (() => {
          const r = day.reportSuggestion!;
          return (
            <div className="nutri-report">
              <div className="nutri-stars">
                <Stars n={r.stars} />
                <span className="num">{r.stars.toFixed(1)}/5</span>
              </div>
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
          );
        })() : (
          <div className="muted tiny">尚未生成。点击下方按钮生成评级、不良摄入清单与建议。</div>
        )}
        <button className="btn full mt12" onClick={generate} disabled={loading}>
          {loading ? '生成中…' : day.reportSuggestion ? '重新生成今日营养评估' : `生成今日营养评估(模拟 ${config.reportTime} 推送)`}
        </button>
      </div>
    </>
  );
}
