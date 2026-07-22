import { useStore } from '../../store';
import { useUI } from '../../ui';
import { dateLabel } from '../../utils';

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <div className={`switch ${on ? 'on' : ''}`} onClick={onClick} />;
}

export default function Settings() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const today = useStore((s) => s.today());
  const toggleAbnormal = useStore((s) => s.toggleAbnormal);
  const simDate = useUI((s) => s.simDate); // 订阅,使 today() 随模拟日期刷新

  return (
    <>
      <div className="card">
        <h3>⚙️ 家长配置</h3>
        <div className="tiny muted mb0">所有配置即时生效,影响设备端识别行为与晚间报告。</div>
      </div>

      <div className="card">
        <h3>🎯 识别开关</h3>
        <div className="set-row">
          <div className="k">营养小科普<div className="desc">正餐识别后由 LLM 生成餐后科普</div></div>
          <Switch on={config.sceneToggles.science} onClick={() => setConfig({ sceneToggles: { ...config.sceneToggles, science: !config.sceneToggles.science } })} />
        </div>
      </div>

      <div className="card">
        <h3>⏰ 晚间报告</h3>
        <div className="set-row">
          <div className="k">晚间报告时间</div>
          <input type="time" value={config.reportTime} onChange={(e) => setConfig({ reportTime: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <h3>🩺 异常日标注</h3>
        <div className="set-row">
          <div className="k">标记 {dateLabel(today.date)} 为异常日
            <div className="desc">如孩子生病,该日数据不计入趋势统计</div>
          </div>
          <Switch on={!!today.isAbnormal} onClick={() => toggleAbnormal(today.date)} />
        </div>
      </div>
    </>
  );
}
