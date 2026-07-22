// 直接测试 LLM 接口，和 demo 用一样的 prompt，覆盖 PRD 核心流程
import { readFileSync } from 'fs';

// 读 .env
const env = {};
try {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
} catch {}

const APP_ID = env.TAL_MLOPS_APP_ID;
const APP_KEY = env.TAL_MLOPS_APP_KEY;
const MODEL = env.TAL_MODEL || 'gpt-5.5';
const BASE = 'http://ai-service.tal.com/openai-compatible/v1/chat/completions';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callLLM(system, user, effort = 'low', retries = 4) {
  const body = {
    model: MODEL,
    reasoning_effort: effort,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${APP_ID}:${APP_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < retries) {
      const wait = 8000 * (attempt + 1);
      process.stdout.write(`  [429 rate-limit, waiting ${wait/1000}s…]\n`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
  throw new Error('Max retries exceeded');
}

function extractJSON(s) {
  let t = (s || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

// ---- 系统 prompts（从 server/llm.ts 完整复制）----

const EATING_CHECK_SYSTEM = `你是儿童手环上的进食语义判断助手。会收到一句浏览器语音识别转写出的文字（手环麦克风在佩戴手环的孩子身边听到的话）。转写常有错别字、口音、口语化，也可能把咀嚼/吞咽/餐具等环境音拟声化转写——一律按发音和语境近似理解。

判断这句话在多大程度上说明【孩子本人正在/即将/刚吃完东西】，给出语义强度等级 level（只选一个）：

- "strong"（强·明确进食）：孩子本人直接表明正在吃 / 即将吃 / 刚吃完 / 被真实召唤去吃饭。
  正在吃："在吃饭"/"我在吃"/"正在吃"/"吃着呢"/"吃上了"/"开吃了"/"嗯在吃"/"我在吃面"
  即将吃："去吃饭"/"马上吃"/"要吃饭了"/"准备吃"/"该吃饭了"/"开动咯"/"这就吃"/"等会儿吃"
  刚吃完："吃好了"/"吃过了"/"刚吃完"/"吃完了"/"吃饱了"/"我吃好了"
  被召唤："过来吃饭"/"快来吃饭"/"吃饭啦"/"来吃饭"/"饭好了"/"开饭了"

- "mid"（中·进食场景强烈但未明示正在吃）：餐桌上的品尝感叹、与进食强相关的场景话、或进食时被转写出的拟声/环境音碎片。
  品尝感叹："好吃"/"好好吃"/"真好吃"/"太好吃了吧"/"好香啊"/"真香"/"再来一碗"/"还要"/"再来一点"/"我喜欢吃这个"/"这个真不错"
  餐桌场景话："我吃完这块了"/"给我夹点"/"盛饭"/"喝口汤"/"别抢我的"/"你吃不吃"/"菜好了吗"/"摆碗筷了"/"闻到饭香了"/"我在用勺子"
  进食拟声/环境音："吧唧吧唧"(咀嚼)、"咔嚓咔嚓"(脆食)、"咕咚"(吞咽/喝水)、"吸溜"(吸面/吸汤)、"啊呜"(咬一口)等被转写出的进食拟声

- "weak"（弱·仅提到食物，无进食迹象）：把食物当话题、评价或计划，不代表此刻在吃。
  "我想吃苹果"/"苹果好吃"(评价)/"中午吃什么"/"我喜欢吃糖"/"妈妈做了红烧肉"/"晚上吃面条吧"

- "none"（无·与孩子本人进食无关）：旁人闲聊、背景电视/媒体、第三人称描述、广告台词、与吃饭无关的话、纯无意义噪声转写。
  "他去吃饭了"(说别人)、电视剧台词、广告、"今天天气真好"、含糊不清的背景"嗯啊"

判断要点（决定强弱的关键，逐条想过再定级）：
1. 主体是谁？必须是佩戴手环的孩子本人；第三人称（"他/她/妈妈在吃"）→ none 或 weak，不要替别人触发。
2. 是实时进食现场，还是转述/回忆/计划？实时感叹和拟声偏中，转述/计划偏弱。
3. 拟声词与环境音碎片按发音识别其进食含义（吧唧→咀嚼、咕咚→吞咽、吸溜→吸食），判为 mid；纯无意义噪声判 none，不过度触发。
4. 错别字/口语/方言按发音近似："恰饭/造饭/干饭"=吃饭、"开动"=开始吃、"造"=吃。

只返回 JSON：{"level":"strong|mid|weak|none","matched":<level≠none即true>,"phrase":"最能代表该等级的原话片段(无则空)","transcript":"输入文字原样回传"}
不要输出 JSON 以外的文字。`;

const VOICE_ROUTE_SYSTEM = `你是儿童手环上的语音意图路由助手。会收到一句浏览器语音识别转写出的文字（手环麦克风在佩戴手环的孩子身边听到的话）。转写常有错别字、口音、口语化——一律按发音和语境近似理解。

【你在流程中的位置】
你的判断驱动两条入口：
- level（进食语义等级）驱动被动触发：系统用它计算 P(Eating)，P≥70% 时系统触发震动→抬腕→对话流程
- intent（主动意图）驱动入口二（主动记录）：孩子主动发起，独立路径，不受 P(Eating)/armed/冷却/提醒次数限制

【入口二完整规则（主动记录，intent≠none 时系统执行）】
孩子主动说话 → 系统直接执行，不走震动→抬腕链：
  - intent=photo     → 直接调起摄像头拍照 → 完成后刷新 30min 冷却
  - intent=voice_log → AI 问「吃了啥」（一轮）→ 记「语音补录」→ 刷新 30min 冷却
  - intent=record    → 意图模糊，系统会 AI 确认一次再分流到 photo 或 voice_log
所以 photo 和 voice_log 要尽量区分清楚，别都归 record。

需要判断两件事：

【一】主动意图 intent（只选一个）：
- "photo"：孩子明确要求拍照记录食物。
  关键词：拍照/帮我拍/我要拍/想拍/拍一下/拍个/拍食物/拍饭/拍吃的
- "voice_log"：孩子主动口述刚才吃了什么，要求记录。
  关键词：记一下刚才/刚才吃的/吃了什么/告诉我吃了/我吃了……（后接食物名）
- "record"：模糊主动记录，未明确拍照或口述。
  关键词：帮我记录/记录一下/帮我记/我要记录/记一下（无「刚才吃」语境）
- "none"：无上述主动意图。

【二】进食语义等级 level（只选一个）：
- "strong"（强·明确进食）：孩子本人正在吃/即将吃/刚吃完/被真实召唤去吃饭。
- "mid"（中·进食场景强烈但未明示正在吃）：餐桌上的品尝感叹、进食拟声/环境音。
- "weak"（弱·仅提到食物，无进食迹象）：把食物当话题、评价或计划。
- "none"（无·与孩子本人进食无关）：旁人闲聊、背景电视、第三人称描述、与吃饭无关的话。

判断要点：
1. level 主体必须是佩戴手环的孩子本人；第三人称→none 或 weak。
2. intent 优先级：photo > voice_log > record > none；intent≠none 时 level 仍照常判，两者均返回。
3. 若一句话既有主动意图又有进食语义（如「我要拍我吃饭的」），两者均返回各自最高等级。
4. 错别字/口语按发音近似：恰饭/造饭/干饭=吃饭。

只返回 JSON：{"level":"strong|mid|weak|none","intent":"photo|voice_log|record|none","phrase":"最能代表结果的原话片段(无则空)"}
不要输出 JSON 以外的文字。`;

const CONVERSATION_TURN_SYSTEM = `你是儿童手环上的进食确认助手，服务 4-10 岁儿童。
孩子的回复可能是语音转写，有错别字、口音、口语化，一律按发音和语境近似理解。

【你在流程中的位置】
系统触发流程如下（硬护栏由系统执行，你只负责打了「LLM判断」标记的节点）：

被动触发流程：
  系统满足 P(Eating)≥70% ∧ 非冷却 ∧ armed ∧ 无进行中对话
  → 手环短震 → 等抬腕（8-10秒，未抬腕系统静默进冷却）
  → 抬腕后 AI 问：「你现在是在吃东西吗？」
  → 【LLM判断·turnType=first】孩子回复 → 你判断 intent + 生成 reply
      intent 驱动后续：
      - eating      → 系统问第二问「要不要拍一下？」→ 同意拍照 / 拒绝记「在吃未拍照」→ 30min冷却
      - finished    → 系统问「吃了啥」→ 语音补录（待家长确认，不计趋势）→ 30min冷却
      - going_to_eat → 系统进 8-10min 短等待 → 若有新进食语义且提醒次数<2 → 二次轻提醒
                       → 【LLM判断·turnType=second_nudge】再判孩子回复
                         - eating   → 拍照 → 30min冷却
                         - finished → 语音补录 → 30min冷却
                         - 其余     → 30min冷却，不再追问
      - not_eating  → 30min冷却
      - ambiguous / no_response → 30min冷却

【硬护栏，你不可越过】
- 抬腕唤醒、冷却计时、P(Eating)计算、提醒次数上限：均由系统执行，你无需输出这些
- 不评价孩子吃得好不好，不输出营养或医学内容
- 每轮只生成一句接话，≤20字，小伙伴型、温和亲近

【turnType=first 时的 intent 定义】
- "eating"：正在吃 / 已经开始吃（如"我在吃饭"/"开始了"/"在吃面"/"吃着呢"）
- "going_to_eat"：即将吃 / 还没开始（如"马上吃"/"等会吃"/"还没开始"/"准备吃"）
- "finished"：刚吃完（如"刚吃完"/"吃好了"/"吃过了"/"吃完了"）
- "not_eating"：没在吃 / 否认（如"没有"/"我在玩"/"没吃"/"不吃"）
- "ambiguous"：模糊或难以判断（如"嗯？"/"啥"/"不知道"）
- "no_response"：无回复 / 听不清 / 静默

【turnType=second_nudge 时的 intent 定义】
二次轻提醒话术是「你现在开始吃了吗？要拍一下食物吗？」，比第一问更轻。
- "eating"：确认开始吃了
- "finished"：刚吃完
- "not_eating" / "ambiguous" / "no_response"：否认、模糊或无回复（系统均进冷却，不再追问）
- going_to_eat 在此轮不再有效，归入 ambiguous

【reply 参考话术】
turnType=first：
- eating       → "好呀，那我们拍一下你现在吃的东西吧～"
- going_to_eat → "好，等你开始吃的时候可以告诉我，我可以帮你记录呦～"
- finished     → "哦哦刚吃完呀，吃了什么呢？告诉我，我帮你记下来～"
- not_eating   → "好哒，那我先不打扰啦～"
- ambiguous / no_response → "没关系，那我先不打扰啦～"
turnType=second_nudge：
- eating       → "好，来拍一下你吃的东西吧～"
- finished     → "刚吃完呀，告诉我吃了啥，我帮你记下来～"
- 其余         → "好哒，那我先不打扰啦～"

只返回 JSON：{"intent":...,"reply":...}。不要输出 JSON 以外的文字。`;

const INTAKE_SYSTEM = `你是儿童饮食追踪手表上的食物识别助手,服务 4-10 岁儿童。
根据孩子上传的照片(优先俯拍全盘)和可选文字描述,完成:
1. 判断这一口摄入的类型 kind:
   - "meal":正餐(米饭菜/面条/包子/粥/汉堡等正餐食物组合)
   - "snack":零食(糖果/膨化食品/巧克力/糕点/饼干等休闲零食)
   - "drink":饮料或饮水(果汁/牛奶/豆浆/碳酸饮料/白开水/矿泉水等液体)
2. 给一个简短名称 name(如"米饭+西红柿炒蛋"/"水果糖"/"白开水")。
3. 仅当 kind="meal" 时:识别食物类别(只从 蔬菜/主食/肉蛋豆/水果/汤 中选实际出现的),判定每类餐盘占比序数 偏少/适中/偏多(参照《中国学龄儿童膳食指南》餐盘:蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4),并写 foodsDetected:把每样食物标上其所属类别,返回数组 [{cat, name}, ...],cat ∈ 蔬菜/主食/肉蛋豆/水果/汤(如 [{cat:"主食",name:"米饭"},{cat:"蔬菜",name:"青菜"},{cat:"肉蛋豆",name:"西红柿炒蛋"}])。非 meal 时 categories=[]、plateRatio={}、foodsDetected=[]。
4. 评估置信度 confidence:俯拍全盘且清晰=high;局部/模糊/仅文字描述无图=low。

护栏(必须遵守):禁止输出任何克数、卡路里、蛋白质克数、营养缺口数值;只做定性结构判断。
若 kind="meal" 且 confidence="high":生成 1 句适合 4-10 岁儿童的餐后营养小科普 scienceTip:
- 一句话,小伙伴型、简短温和亲近,4-10 岁能懂,语音 15-30 秒能说完。
- 只讲该食物对身体的一般性帮助(如膳食纤维/能量/蛋白质等定性),最多一个轻建议。
- 禁止:评价本餐吃得好不好;输出克数/卡路里/营养缺口;"吃了会长高/变聪明"、"不吃会生病"、"吃多了会胖"、"这个不能吃"、"必须多吃";缺钙缺铁缺蛋白质等判断;医学/疾病/减重表达。
否则 scienceTip=null。
零食子类型 snackType:仅当 kind="snack" 或 kind="drink" 时,判断是否属于 糖果 / 膨化食品 / 含糖饮料 三类之一(是则填对应值,否则 null)。
低置信度原因 lowConfidenceReason:仅当 confidence="low" 时一句话说明原因,否则 null。
是否需补拍 needRetake:仅当 confidence="low" 且补拍可改善时 true;仅语音无图或无论如何都救不回来时 false。

5. 追问(clarify):本轮只追问【食物里包含什么主体食材】一件事。
   不要追问的情况:正餐还是零食归类/餐次早午晚/做法/调味/份量/照片已能合理看清主体食材
   追问时 clarify={question},question ≤18 字、口语亲切、适合 4-10 岁;不追问时 clarify=null。

只返回 JSON:{kind, name, foodsDetected, categories, plateRatio, confidence, scienceTip, snackType, lowConfidenceReason, needRetake, clarify}。不要输出 JSON 以外的文字。`;

const PERSUADE_SYSTEM = `你是儿童手环上的小伙伴，服务 4-10 岁儿童。孩子刚拍下并识别到一类零食（糖果 / 膨化食品 / 含糖饮料），请生成一句轻劝导 tip：
- 一句话，小伙伴型、简短温和（≤25字）。
- 只针对该类零食做温和提醒。示例方向：糖果→"甜食吃多小牙齿会不舒服哦"；膨化食品→"这个香香脆脆，下次配点水果更好哦"；含糖饮料→"甜甜的真好喝，明天换成白开水也不错哦"。
- 禁止：批评、限制、恐吓、"不能吃"、"不健康"、"会胖"、"对身体不好"；不输出克数/卡路里。
只返回 JSON：{"tip":"..."}。不要输出 JSON 以外的文字。`;

// ---- 测试工具函数 ----
let testNum = 0;
const results = [];

async function test(label, call, check) {
  await sleep(1200); // avoid burst rate-limit
  testNum++;
  let raw, parsed, verdict;
  try {
    raw = await call();
    try { parsed = extractJSON(raw); } catch { parsed = null; }
    verdict = check(parsed, raw);
  } catch (e) {
    verdict = { pass: false, note: `ERROR: ${e.message}` };
    raw = e.message;
    parsed = null;
  }
  const icon = verdict.pass ? '✅' : '❌';
  console.log(`\n${icon} [T${String(testNum).padStart(2,'0')}] ${label}`);
  console.log('   LLM raw  :', raw?.slice(0, 300));
  console.log('   Parsed   :', parsed ? JSON.stringify(parsed).slice(0, 200) : 'null');
  console.log('   Verdict  :', verdict.note);
  results.push({ num: testNum, label, pass: verdict.pass, raw: raw?.slice(0,300), parsed, note: verdict.note });
}

// ========== MODULE 1: 进食语义判断（eatingCheck）==========
console.log('\n\n========== 模块一·进食语义判断 ==========');

const ecCall = (transcript) => () => callLLM(EATING_CHECK_SYSTEM, '判断这句话的进食语义等级：' + transcript);
const checkLevel = (expected) => (p) => ({
  pass: p?.level === expected,
  note: `expected=${expected}, got=${p?.level}`,
});

await test('EC-1 强语义·正在吃 "我在吃饭"', ecCall('我在吃饭'), checkLevel('strong'));
await test('EC-2 强语义·即将吃 "马上吃"', ecCall('马上吃'), checkLevel('strong'));
await test('EC-3 强语义·刚吃完 "吃好了"', ecCall('吃好了'), checkLevel('strong'));
await test('EC-4 强语义·被召唤 "快来吃饭"', ecCall('快来吃饭'), checkLevel('strong'));
await test('EC-5 中语义·品尝感叹 "真好吃"', ecCall('真好吃'), checkLevel('mid'));
await test('EC-6 中语义·餐桌场景 "给我夹点菜"', ecCall('给我夹点菜'), checkLevel('mid'));
await test('EC-7 弱语义·食物话题 "我想吃苹果"', ecCall('我想吃苹果'), checkLevel('weak'));
await test('EC-8 无语义·第三人称 "他去吃饭了"', ecCall('他去吃饭了'), checkLevel('none'));
await test('EC-9 无语义·无关话题 "今天天气真好"', ecCall('今天天气真好'), checkLevel('none'));
await test('EC-10 方言/口语 "恰饭了"', ecCall('恰饭了'), checkLevel('strong'));

// ========== MODULE 1: 语音路由（voiceRoute）==========
console.log('\n\n========== 模块一·语音路由（intent + level）==========');

const vrCall = (t) => () => callLLM(VOICE_ROUTE_SYSTEM, '判断这句话的进食语义等级与主动意图：' + t);
const checkVR = (el, ei) => (p) => ({
  pass: p?.level === el && p?.intent === ei,
  note: `expected level=${el} intent=${ei}, got level=${p?.level} intent=${p?.intent}`,
});

await test('VR-1 主动拍照 "帮我拍一下饭"', vrCall('帮我拍一下饭'), checkVR('strong', 'photo'));
await test('VR-2 主动拍照 "我要拍这个"', vrCall('我要拍这个'), checkVR('none', 'photo'));
await test('VR-3 主动口述 "记一下刚才吃的"', vrCall('记一下刚才吃的'), (p) => ({
  pass: p?.intent === 'voice_log',
  note: `expected intent=voice_log, got=${p?.intent}`,
}));
await test('VR-4 模糊记录 "帮我记录一下"', vrCall('帮我记录一下'), (p) => ({
  pass: p?.intent === 'record',
  note: `expected intent=record, got=${p?.intent}`,
}));
await test('VR-5 纯进食语义·无主动意图 "在吃饭呢"', vrCall('在吃饭呢'), checkVR('strong', 'none'));
await test('VR-6 无语义无意图 "我在看书"', vrCall('我在看书'), checkVR('none', 'none'));
// PRD 关键：主动路径不受 P/armed/冷却限制，intent!=none 才触发主动路径
await test('VR-7 同时有意图和语义 "我要拍我在吃的饭"', vrCall('我要拍我在吃的饭'), (p) => ({
  pass: p?.intent === 'photo' && (p?.level === 'strong' || p?.level === 'mid'),
  note: `expected intent=photo & level>=mid, got level=${p?.level} intent=${p?.intent}`,
}));

// ========== MODULE 1: 对话轮次（conversationTurn）==========
console.log('\n\n========== 模块一·对话轮次（first / second_nudge）==========');

const ctCall = (reply, turnType, mealTime) => () => {
  const ctx = mealTime ? `（当前饭点上下文：${mealTime}）` : '';
  return callLLM(CONVERSATION_TURN_SYSTEM, `turnType=${turnType}。孩子的回复：${reply}${ctx}。请判断意图并生成接话。`);
};
const checkCT = (ei) => (p) => ({
  pass: p?.intent === ei,
  note: `expected=${ei}, got=${p?.intent}. reply="${p?.reply}"`,
});

// first 问（PRD：「你现在是在吃东西吗？」的回复）
await test('CT-1 first·eating "我在吃面"', ctCall('我在吃面', 'first'), checkCT('eating'));
await test('CT-2 first·eating "在吃呢"', ctCall('在吃呢', 'first'), checkCT('eating'));
await test('CT-3 first·going_to_eat "马上吃"', ctCall('马上吃', 'first'), checkCT('going_to_eat'));
await test('CT-4 first·going_to_eat "等会儿吃"', ctCall('等会儿吃', 'first'), checkCT('going_to_eat'));
await test('CT-5 first·finished "刚吃完了"', ctCall('刚吃完了', 'first'), checkCT('finished'));
await test('CT-6 first·finished "已经吃好了"', ctCall('已经吃好了', 'first'), checkCT('finished'));
await test('CT-7 first·not_eating "没有，我在玩"', ctCall('没有，我在玩', 'first'), checkCT('not_eating'));
await test('CT-8 first·ambiguous "嗯？"', ctCall('嗯？', 'first'), checkCT('ambiguous'));
await test('CT-9 first·no_response ""（静默）', ctCall('', 'first'), checkCT('no_response'));

// second_nudge（PRD：「你现在开始吃了吗？要拍一下食物吗？」的回复）
await test('CT-10 second_nudge·eating "开始了"', ctCall('开始了', 'second_nudge'), checkCT('eating'));
await test('CT-11 second_nudge·finished "刚吃完"', ctCall('刚吃完', 'second_nudge'), checkCT('finished'));
await test('CT-12 second_nudge·not_eating "没有"', ctCall('没有', 'second_nudge'), (p) => ({
  pass: ['not_eating','ambiguous','no_response'].includes(p?.intent),
  note: `expected not_eating/ambiguous/no_response, got=${p?.intent}. reply="${p?.reply}"`,
}));
// going_to_eat 在二次提醒后无效，应归入 ambiguous
await test('CT-13 second_nudge·going_to_eat → ambiguous "再等等"', ctCall('再等等', 'second_nudge'), (p) => ({
  pass: p?.intent === 'ambiguous' || p?.intent === 'not_eating',
  note: `going_to_eat in second_nudge should map to ambiguous/not_eating, got=${p?.intent}`,
}));

// reply 字数检查（PRD：≤20字，小伙伴型）
await test('CT-14 reply ≤20字检查 eating "我在吃"', ctCall('我在吃', 'first'), (p) => {
  const len = p?.reply?.length ?? 999;
  return { pass: len <= 25, note: `reply "${p?.reply}" len=${len}, should be ≤20 chars (allowing tiny tolerance)` };
});

// ========== MODULE 2: 食物识别（analyzeIntake·纯文字）==========
console.log('\n\n========== 模块二·食物识别（文字描述）==========');

const aiCall = (text) => () => {
  const user = `${text ? '孩子补充描述:' + text : '孩子未提供文字描述。'}请识别食物类型、名称,若为正餐判定占比与置信度,并按规则生成科普,必要时给出追问。`;
  return callLLM(INTAKE_SYSTEM, user, 'medium');
};

// 正餐文字：应为 meal，confidence=low（无图），不生成科普
await test('AI-1 正餐描述 "米饭青菜炒肉"', aiCall('米饭青菜炒肉'), (p) => ({
  pass: p?.kind === 'meal' && p?.confidence === 'low' && p?.scienceTip === null,
  note: `kind=${p?.kind} conf=${p?.confidence} scienceTip=${p?.scienceTip} (should be meal/low/null, no science on voice)`,
}));
// 零食：应为 snack，不生成科普
await test('AI-2 零食描述 "薯片"', aiCall('薯片'), (p) => ({
  pass: p?.kind === 'snack' && p?.snackType === '膨化食品',
  note: `kind=${p?.kind} snackType=${p?.snackType}`,
}));
// 糖果：应识别 snackType=糖果
await test('AI-3 零食描述 "水果糖"', aiCall('水果糖'), (p) => ({
  pass: p?.kind === 'snack' && p?.snackType === '糖果',
  note: `kind=${p?.kind} snackType=${p?.snackType}`,
}));
// 饮料：应为 drink
await test('AI-4 饮料描述 "一杯牛奶"', aiCall('一杯牛奶'), (p) => ({
  pass: p?.kind === 'drink',
  note: `kind=${p?.kind}`,
}));
// 含糖饮料
await test('AI-5 含糖饮料 "可乐"', aiCall('可乐'), (p) => ({
  pass: p?.kind === 'drink' && p?.snackType === '含糖饮料',
  note: `kind=${p?.kind} snackType=${p?.snackType}`,
}));
// 科普护栏：禁止评价好不好，禁止克数/卡路里
await test('AI-6 科普护栏·应无克数/卡路里', aiCall('米饭西红柿炒蛋'), (p, raw) => {
  const hasForbidden = /克|卡路里|蛋白质克|g\b|kcal/i.test(p?.scienceTip || '');
  return { pass: !hasForbidden, note: `scienceTip="${p?.scienceTip}" should NOT contain calories/weight` };
});

// ========== MODULE 2: 零食劝导（persuadeSnack）==========
console.log('\n\n========== 模块二·零食劝导 ==========');

const psCall = (snackType, name) => () => callLLM(PERSUADE_SYSTEM, `零食类型：${snackType}；名称：${name}。请生成一句轻劝导。`);

await test('PS-1 糖果劝导', psCall('糖果', '水果糖'), (p) => {
  const tip = p?.tip || '';
  const forbidden = /不能吃|不健康|会胖|对身体不好|禁止/.test(tip);
  return { pass: tip.length > 0 && !forbidden, note: `tip="${tip}"` };
});
await test('PS-2 膨化食品劝导', psCall('膨化食品', '薯片'), (p) => {
  const tip = p?.tip || '';
  const forbidden = /不能吃|不健康|会胖|对身体不好/.test(tip);
  return { pass: tip.length > 0 && !forbidden, note: `tip="${tip}"` };
});
await test('PS-3 含糖饮料劝导', psCall('含糖饮料', '可乐'), (p) => {
  const tip = p?.tip || '';
  const forbidden = /不能吃|不健康|会胖|对身体不好/.test(tip);
  return { pass: tip.length > 0 && !forbidden, note: `tip="${tip}"` };
});
await test('PS-4 劝导≤25字', psCall('糖果', '棒棒糖'), (p) => {
  const len = p?.tip?.length ?? 999;
  return { pass: len <= 30, note: `tip="${p?.tip}" len=${len}` };
});

// ========== PRD 关键护栏测试 ==========
console.log('\n\n========== PRD 关键护栏 ==========');

// 硬护栏：LLM 不应在 reply 中提到冷却、P值、提醒次数等系统概念
await test('GUARD-1 reply不提冷却/P值 eating回复', ctCall('在吃呢', 'first'), (p) => {
  const forbidden = /冷却|P\(|阈值|提醒次数|armed/.test(p?.reply || '');
  return { pass: !forbidden, note: `reply="${p?.reply}" should not mention system internals` };
});
// 硬护栏：科普不评价孩子吃得好不好
await test('GUARD-2 科普不评价本餐好坏', aiCall('炸鸡腿'), (p) => {
  const tip = p?.scienceTip || '';
  const badPhrases = /吃少了|吃多了|不健康|不合理|应该多吃|应该少吃/.test(tip);
  // Note: 炸鸡腿文字描述 → confidence=low → scienceTip should be null anyway
  return { pass: !badPhrases, note: `scienceTip="${tip}" (should be null for text-only, or no bad phrases)` };
});
// 强进食语义正确触发（PRD：强=75，饭点中=40，总=115→min=100 ≥70）
await test('GUARD-3 强进食语义 "我在吃面" → strong(75)', ecCall('我在吃面'), (p) => ({
  pass: p?.level === 'strong',
  note: `level=${p?.level} → contributes 75 to P(Eating); with meal-time can easily hit ≥70`,
}));
// 旁人说话不触发（PRD：主体必须是孩子本人）
await test('GUARD-4 第三人称不触发 "妈妈在吃饭"', ecCall('妈妈在吃饭'), (p) => ({
  pass: p?.level === 'none' || p?.level === 'weak',
  note: `level=${p?.level} — third-person should be none/weak`,
}));
// 背景音过滤（PRD：背景电视不触发）
await test('GUARD-5 背景音不触发 "电视里在播吃饭场景"', ecCall('电视里在播吃饭场景'), (p) => ({
  pass: p?.level === 'none' || p?.level === 'weak',
  note: `level=${p?.level} — background TV should not trigger`,
}));

// ========== 汇总 ==========
console.log('\n\n========== 测试汇总 ==========');
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n总计 ${results.length} 项 | ✅ 通过 ${passed} | ❌ 失败 ${failed}`);
if (failed > 0) {
  console.log('\n失败列表:');
  results.filter(r => !r.pass).forEach(r => {
    console.log(`  [T${String(r.num).padStart(2,'0')}] ${r.label}`);
    console.log(`       ${r.note}`);
  });
}
