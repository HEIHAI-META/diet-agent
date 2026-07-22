import type { RouteResult } from './InfoPanel';

const ENTRY_LABEL: Record<string, { text: string; cls: string }> = {
  active:  { text: '入口二 · 主动记录', cls: 'rs-entry-active' },
  passive: { text: '入口一 · 被动触发', cls: 'rs-entry-passive' },
  none:    { text: '无触发', cls: 'rs-entry-none' },
};

const INTENT_LABEL: Record<string, string> = {
  photo:     '主动拍照',
  voice_log: '主动口述',
  record:    '模糊记录',
  eating:    '主动告知进食',
  none:      '无主动意图',
};

const LEVEL_LABEL: Record<string, { text: string; color: string }> = {
  strong: { text: '强 (+75)', color: '#1aa260' },
  mid:    { text: '中 (+40)', color: '#e8a200' },
  weak:   { text: '弱 (+20)', color: '#b06a1a' },
  none:   { text: '无 (+0)',  color: '#8a919c' },
};

const PASSIVE_CONDITIONS = [
  'P(Eating) ≥ 70%',
  '非冷却期',
  'armed',
  '无进行中对话',
];

interface Props {
  last: RouteResult | null;
}

export default function RouteStatusPanel({ last }: Props) {
  if (!last) {
    return (
      <div className="rs-panel">
        <div className="rs-head">🔀 LLM 路由判定</div>
        <div className="rs-empty">等待语音输入…</div>
      </div>
    );
  }

  const entry = ENTRY_LABEL[last.entry] ?? ENTRY_LABEL.none;
  const intentLabel = INTENT_LABEL[last.intent] ?? last.intent;
  const levelInfo = LEVEL_LABEL[last.level] ?? LEVEL_LABEL.none;

  return (
    <div className="rs-panel">
      <div className="rs-head">🔀 LLM 路由判定</div>

      {/* 原文 */}
      <div className="rs-row">
        <span className="rs-k">转写</span>
        <span className="rs-v rs-transcript">「{last.transcript}」</span>
      </div>

      {/* 走哪条入口 */}
      <div className="rs-row">
        <span className="rs-k">入口</span>
        <span className={`rs-tag ${entry.cls}`}>{entry.text}</span>
      </div>

      {last.entry === 'active' && (
        <>
          <div className="rs-row">
            <span className="rs-k">触发条件</span>
            <span className="rs-v">主动意图 = <b>{intentLabel}</b></span>
          </div>
          {last.phrase && (
            <div className="rs-row">
              <span className="rs-k">命中短语</span>
              <span className="rs-v rs-phrase">「{last.phrase}」</span>
            </div>
          )}
          <div className="rs-row">
            <span className="rs-k">P 引擎</span>
            <span className="rs-v rs-muted">不喂（主动路径绕过）</span>
          </div>
        </>
      )}

      {last.entry === 'passive' && (
        <>
          <div className="rs-row">
            <span className="rs-k">触发条件</span>
            <div className="rs-conditions">
              {PASSIVE_CONDITIONS.map((c) => (
                <span key={c} className="rs-cond">{c}</span>
              ))}
            </div>
          </div>
          <div className="rs-row">
            <span className="rs-k">进食语义</span>
            <span className="rs-v" style={{ color: levelInfo.color, fontWeight: 700 }}>
              {levelInfo.text}
              {last.phrase ? `  「${last.phrase}」` : ''}
            </span>
          </div>
          <div className="rs-row">
            <span className="rs-k">主动意图</span>
            <span className="rs-v rs-muted">无（idle，仅喂 P 引擎）</span>
          </div>
        </>
      )}

      {last.entry === 'none' && (
        <div className="rs-row">
          <span className="rs-k">原因</span>
          <span className="rs-v rs-muted">level=none 且无主动意图，P 引擎无贡献</span>
        </div>
      )}
    </div>
  );
}
