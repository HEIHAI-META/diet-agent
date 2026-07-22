// LLM 调用:直接用 fetch 打 OpenAI 兼容网关。
// 凭证从 .env 注入,绝不暴露到浏览器。

export type Env = Record<string, string>;

interface CallOpts {
  system: string;
  user: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

async function callLLM(opts: CallOpts, env: Env): Promise<string> {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('后端缺少 LLM_API_KEY,请在 .env 配置');
  const base = (env.LLM_BASE_URL || '').replace(/\/$/, '');
  const body = {
    model: env.LLM_MODEL || 'doubao-seed-2.0-mini',
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`);
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

function extractJSON(s: string): any {
  let t = (s || '').trim();
  // Strip reasoning/thinking blocks emitted by some models (e.g. doubao-seed)
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    // Try replacing curly quotes some models emit inside JSON
    const repaired = t
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try {
      return JSON.parse(repaired);
    } catch {
      console.error('[extractJSON] parse failed. Raw LLM output:\n', s);
      throw e;
    }
  }
}

// ---------- 接口 1:食物识别(正餐 / 零食 / 饮料) ----------

const PERSONA = `【你是谁】你叫小布，住在孩子手环里，是他们的贴身小伙伴，服务 4-10 岁儿童。
你的性格：活泼、自来熟、精力充沛。第一次见面就跟老朋友一样，反应快，爱分享，遇到好吃的会真的兴奋，遇到孩子不理你也不尴尬，就是个自在的小朋友。
说话风格：口语自然，节奏轻快，会说"哇""诶""嗯嗯""哦哦""哇塞"这类有情绪的词，偶尔说"好嘞""懂了懂了""知道啦"。同一件事每次说法都不一样，不用固定句式，不像播报员。
每次只说一件事，说完就停，不拖。简单的事一句话，有情绪的时候可以两句，但别超过两句。不说教，不讲大道理，不啰嗦。`;

const INTAKE_SYSTEM = `${PERSONA}
你同时也是食物识别助手,服务 4-10 岁儿童。
根据孩子上传的照片(优先俯拍全盘)和可选文字描述,完成:
1. 判断这一口摄入的类型 kind:
   - "meal":正餐(米饭菜/面条/包子/粥/汉堡等正餐食物组合;以食物为主料的汤羹单独食用时也归此类,如绿豆汤/银耳羹/玉米汤/骨头汤/紫米粥等)
   - "fruit":水果(苹果/香蕉/橙子/葡萄/番石榴/草莓/西瓜/桃子等新鲜水果,单独吃而非作为正餐的一部分)
   - "snack":零食(糖果/膨化食品/巧克力/糕点/饼干等休闲零食;水果不属于此类)
   - "drink":饮料或饮水(果汁/牛奶/豆浆/碳酸饮料/白开水/矿泉水等液体;以食物为主料的汤羹不属于此类,归 meal)
2. 给一个简短名称 name(如"米饭+西红柿炒蛋"/"水果糖"/"白开水")。
3. 仅当 kind="meal" 时:识别食物类别(只从 蔬菜/主食/肉蛋豆/水果/汤 中选实际出现的),判定每类餐盘占比序数 偏少/适中/偏多(参照《中国学龄儿童膳食指南》餐盘:蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4),并写 foodsDetected:把每样食物标上其所属类别,返回数组 [{cat, name}, ...],cat ∈ 蔬菜/主食/肉蛋豆/水果/汤(如 [{cat:"主食",name:"米饭"},{cat:"蔬菜",name:"青菜"},{cat:"肉蛋豆",name:"西红柿炒蛋"}])。非 meal 时 categories=[]、plateRatio={}、foodsDetected=[]。
4. 评估置信度 confidence:俯拍全盘且清晰=high;局部/模糊/仅文字描述无图=low。

护栏(必须遵守):禁止输出任何克数、卡路里、蛋白质克数、营养缺口数值;只做定性结构判断。
若 kind="meal" 且 confidence="high",或 kind="fruit" 且 confidence="high":生成 1 句适合 4-10 岁儿童的营养小科普 scienceTip:
- 一句话,小伙伴型、简短温和亲近,4-10 岁能懂,语音 15-30 秒能说完。
- kind="meal":选其中一样食物讲它对身体的一般性帮助;若整体以重油/重辣/油炸/腌制/烧烤/红油为主,改为轻柔生活小提示(如「吃完辣的记得多喝点水哦」),语气像朋友提醒。若一餐多个食物,按优先级选:识别更明确的 > 当天未科普过的 > 非零食类。
- kind="fruit":讲这种水果对身体的一般性帮助;角度多样,可讲维生素、水分、抗氧化、保护眼睛等不同维度,同一角度在连续几次科普中不重复。
- 禁止:评价吃得好不好;输出克数/卡路里/营养缺口;"吃了会长高/变聪明"、"不吃会生病"、"吃多了会胖"、"这个不能吃"、"必须多吃";缺钙缺铁缺蛋白质等判断;医学/疾病/减重表达。
否则 scienceTip=null。
零食子类型 snackType:仅当 kind="snack" 或 kind="drink" 时,判断是否属于 糖果 / 膨化食品 / 含糖饮料 三类之一(是则填对应值,否则 null)。kind="fruit" 时 snackType 固定为 null。
低置信度原因 lowConfidenceReason:仅当 confidence="low" 时一句话说明原因(如"画面模糊""只拍到局部""光线过暗""主体不明确"),否则 null。
是否需补拍 needRetake:仅当 confidence="low" 且补拍可改善时 true(模糊/局部/光线差/遮挡/主体不明);仅语音无图或无论如何都救不回来时 false。

5. 追问(clarify):本轮只追问【食物里包含什么主体食材】一件事。当照片+文字凭外观难判食物内容、且孩子一句话能说清、且会显著影响营养定性时才追问。典型场景:
   - 馅料类:包子/饺子/馅饼/烧麦/馄饨/粽子/卷/夹心糕点/汉堡——看不出是什么馅
   - 家常复合菜:一盘炒菜/炖菜,外观看不出主体食材组合(如分不清番茄炒蛋还是番茄炒肉、看不出有无肉/蛋/豆制品)
   - 汤/粥/羹:看不出里面用什么料
   不要追问的情况(均由你自己判断,不问孩子):
   - 正餐还是零食、饮料还是零食的归类 → 按食物性质+时间自己定
   - 餐次早/午/晚 → 由时间自动划分
   - 做法(蒸/炸/红烧等烹饪方式)、调味(加糖/浇酱/葱姜蒜等小料)、份量(吃了多少)
   - 照片已能合理看清主体食材、单一食物(米饭/面条/水果/白开水/糖果/面包等)
   - 只是占比略偏、confidence=low 但能合理记下交给家长确认
   追问时 clarify={question},question ≤18 字、口语亲切、适合 4-10 岁、只问"里面是什么/什么馅"(如"包子是什么馅的呀?"/"这盘菜里都有什么呀?");不追问时 clarify=null。

只返回 JSON:{kind, name, foodsDetected, categories, plateRatio, confidence, scienceTip, snackType, lowConfidenceReason, needRetake, clarify}。不要输出 JSON 以外的文字。`;

const FOOD_CATS = ['蔬菜', '主食', '肉蛋豆', '水果', '汤'] as const;
type FoodCat = (typeof FOOD_CATS)[number];
const SNACK_TYPES = ['糖果', '膨化食品', '含糖饮料'] as const;
type SnackTypeT = (typeof SNACK_TYPES)[number];

interface IntakeResult {
  kind: 'meal' | 'snack' | 'drink' | 'fruit';
  name: string;
  foodsDetected: string;
  foodItems?: { cat: string; name: string }[];
  categories: string[];
  plateRatio: Record<string, string>;
  confidence: 'high' | 'low';
  scienceTip: string | null;
  snackType: SnackTypeT | null;
  lowConfidenceReason: string | null;
  needRetake: boolean;
  clarify: { question: string } | null;
  raw: string;
}

function parseIntake(parsed: any, raw: string): IntakeResult {
  const kind = (parsed.kind === 'snack' || parsed.kind === 'drink' || parsed.kind === 'fruit') ? parsed.kind : 'meal';
  const clarify = parsed.clarify && typeof parsed.clarify.question === 'string' && parsed.clarify.question.trim()
    ? { question: parsed.clarify.question.trim() }
    : null;
  const rawFoods = parsed.foodsDetected;
  let foodItems: { cat: string; name: string }[] | undefined;
  let foodsDetected = '';
  if (Array.isArray(rawFoods)) {
    const items = rawFoods
      .map((f: any) => ({
        cat: typeof f?.cat === 'string' && (FOOD_CATS as readonly string[]).includes(f.cat) ? (f.cat as FoodCat) : '主食',
        name: (typeof f === 'string' ? f : String(f?.name || '')).trim(),
      }))
      .filter((f: { name: string }) => f.name);
    if (items.length) { foodItems = items; foodsDetected = items.map((f) => f.name).join('、'); }
  } else if (typeof rawFoods === 'string' && rawFoods.trim()) {
    foodsDetected = rawFoods.trim();
  }
  return {
    kind,
    name: parsed.name || '',
    foodsDetected: foodsDetected || (kind === 'meal' ? '' : parsed.name || ''),
    foodItems,
    categories: parsed.categories || [],
    plateRatio: parsed.plateRatio || {},
    confidence: parsed.confidence === 'high' ? 'high' : 'low',
    scienceTip: parsed.scienceTip ?? null,
    snackType: (SNACK_TYPES as readonly string[]).includes(parsed.snackType) ? (parsed.snackType as SnackTypeT) : null,
    lowConfidenceReason: parsed.lowConfidenceReason ? String(parsed.lowConfidenceReason).slice(0, 30) : null,
    needRetake: !!parsed.needRetake,
    clarify,
    raw,
  };
}

export async function analyzeIntake(
  payload: { image?: string; text?: string },
  env: Env
): Promise<IntakeResult> {
  const textPart = `${payload.text ? '孩子补充描述:' + payload.text : '孩子未提供文字描述。'}请识别食物类型、名称,若为正餐判定占比与置信度,并按规则生成科普,必要时给出追问。`;
  const user: CallOpts['user'] = payload.image
    ? [
        { type: 'text', text: textPart },
        { type: 'image_url', image_url: { url: payload.image } },
      ]
    : textPart;
  const raw = await callLLM({ system: INTAKE_SYSTEM, user, reasoningEffort: 'medium' }, env);
  return parseIntake(extractJSON(raw), raw);
}

// 追问回合:孩子已回答 agent 的提问,结合原图+回答做第二轮最终识别(必须落库,不再追问)。
const CLARIFY_SYSTEM = INTAKE_SYSTEM + '\n\n【第二轮·追问回合】你现在拿到了孩子对你追问的回答。必须最终确定识别结果,clarify 字段必须为 null,不要再追问。';

export async function clarifyIntake(
  payload: { image?: string; text?: string; question?: string; answer: string },
  env: Env
): Promise<IntakeResult> {
  const textPart = `刚才你问了:"${payload.question || ''}"。孩子的回答:${payload.answer}。${payload.text ? '孩子原始补充描述:' + payload.text + '。' : ''}请结合${payload.image ? '原图' : '原始描述'}与回答,最终确定食物类型/名称/占比/置信度并生成科普。把孩子的回答(食材/馅料)合并进 name(如"包子(猪肉馅)"/"番茄炒蛋")与 foodsDetected(每样食物带类别),让记录更精准。clarify 必须为 null。`;
  const user: CallOpts['user'] = payload.image
    ? [
        { type: 'text', text: textPart },
        { type: 'image_url', image_url: { url: payload.image } },
      ]
    : textPart;
  const raw = await callLLM({ system: CLARIFY_SYSTEM, user, reasoningEffort: 'medium' }, env);
  const r = parseIntake(extractJSON(raw), raw);
  return { ...r, clarify: null };
}

// ---------- 接口 2:家长"今日营养评估"(整日专业总评 + 建议) ----------

const REPORT_SYSTEM = `你是注册营养师,面向家长对 4-10 岁儿童今日膳食做专业评估。依据:当日各餐食物与餐盘占比定性标签、零食/饮料记录、近 7 天趋势。参照《中国学龄儿童膳食指南》(餐盘建议:蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4;控制添加糖与高脂油炸食物)。

只返回 JSON:
- stars:1-5(可 .5)。5=膳食结构均衡,3=中等,1=明显失衡。综合评估蔬菜/主食/肉蛋豆比例、添加糖与高脂摄入、连续偏低趋势。
- summary:专业一句话总评 ≤30 字,用膳食结构/宏量营养素术语。部分数据待确认时末尾标注"部分数据待确认"。
- assessment:专业分析段落 2-3 句(≤140 字)。须覆盖:宏量营养素(碳水/蛋白质/脂肪)比例是否合理、蔬菜/主食/肉蛋豆与指南餐盘建议的差距、添加糖与油脂摄入、若有连续偏低趋势需点明;若数据中有水果记录则顺带一句水果摄入情况。引用指南建议。
- dimensions:逐维度评估,返回数组,每项 {name, status, note}。name 依次为 "蔬菜"|"主食"|"肉蛋豆"|"添加糖·油脂";status 取 "偏低"|"适中"|"偏高"|"不足"|"充足"之一;note ≤15 字对照指南(如"低于餐盘 1/2 推荐")。
- unhealthy:从当天【具体食物】里挑出不健康的——油炸/高脂正餐(如炸鸡腿)、添加糖零食(如糖果)、含糖饮料、蔬菜严重偏少的餐。name 必须用【数据里的真实食物名】,不要写笼统类别;reason ≤20 字说明营养学原因(如"油炸高脂,增加代谢负担")。当天膳食很健康则返回空数组。
- advice:2-3 条可执行建议,每条 ≤30 字,贴合指南(如"下一餐补足深色绿叶蔬菜至餐盘约 1/2")。

护栏:禁止克数/卡路里/蛋白质克数等数值,只做定性。语气专业权威、不制造焦虑。
只返回 JSON,不要 JSON 以外的文字。`;

export async function reportSuggestion(
  payload: { todaySummary: string; trend7d: string },
  env: Env
): Promise<{ stars: number; summary: string; assessment: string; dimensions: { name: string; status: string; note: string }[]; unhealthy: { name: string; reason: string }[]; advice: string[] }> {
  const user = `【当日数据】
${payload.todaySummary}

【近 7 天趋势】
${payload.trend7d}

请生成今日营养评估 JSON。`;
  const raw = await callLLM({ system: REPORT_SYSTEM, user, reasoningEffort: 'medium' }, env);
  const parsed = extractJSON(raw);
  let stars = Number(parsed.stars);
  if (!isFinite(stars)) stars = 3;
  stars = Math.max(0.5, Math.min(5, Math.round(stars * 2) / 2));
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.filter((d: any) => d && d.name).map((d: any) => ({ name: String(d.name), status: String(d.status || ''), note: String(d.note || '') }))
    : [];
  const unhealthy = Array.isArray(parsed.unhealthy)
    ? parsed.unhealthy.filter((u: any) => u && u.name).map((u: any) => ({ name: String(u.name), reason: String(u.reason || '') }))
    : [];
  const advice = Array.isArray(parsed.advice) ? parsed.advice.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim()) : [];
  return {
    stars,
    summary: String(parsed.summary || '').trim(),
    assessment: String(parsed.assessment || '').trim(),
    dimensions,
    unhealthy,
    advice,
  };
}

// ---------- 接口 3:家长"周报解读"(近 7 天趋势评估 + 建议) ----------

const WEEKLY_SYSTEM = `你是注册营养师,面向家长对 4-10 岁儿童【近 7 天膳食趋势】做专业评估。依据:近 7 天每日蔬菜占比等级(偏少/适中/偏多/无数据)、每日零食次数、异常日(如生病,不计入趋势)。参照《中国学龄儿童膳食指南》(餐盘建议:蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4;控制添加糖与高脂油炸食物)。

只返回 JSON:
- stars:1-5(可 .5)。5=本周膳食趋势均衡,3=中等,1=明显失衡。综合蔬菜趋势(是否连续偏低)、零食频率、异常日情况。
- summary:本周一句话总评 ≤30 字,用膳食结构/趋势术语。部分数据不足时末尾标注"部分数据待确认"。
- assessment:本周趋势分析 2-3 句 ≤120 字。须覆盖:蔬菜整体水平及是否连续偏低、零食频率是否偏高、异常日如何处理。引用指南建议。
- dimensions:逐维度评估本周趋势,返回数组,每项 {name, status, note}。name 依次为 "蔬菜"|"零食频率"|"饮食规律";status 取 "偏低"|"适中"|"偏高"|"不足"|"充足"之一;note ≤15 字对照指南(如"连续偏低,低于餐盘1/2")。
- advice:2-3 条针对【本周趋势】的可执行建议,每条 ≤30 字(如"本周蔬菜后三天偏低,建议每日午餐补足至餐盘约 1/2")。

护栏:禁止克数/卡路里等数值,只做定性。单次异常不焦虑,看趋势;连续偏低才触发趋势性建议。语气专业权威、不制造焦虑。
只返回 JSON,不要 JSON 以外的文字。`;

export async function weeklySuggestion(
  payload: { weeklySummary: string },
  env: Env
): Promise<{ stars: number; summary: string; assessment: string; dimensions: { name: string; status: string; note: string }[]; advice: string[] }> {
  const user = `【近 7 天数据】
${payload.weeklySummary}

请生成本周趋势评估 JSON。`;
  const raw = await callLLM({ system: WEEKLY_SYSTEM, user, reasoningEffort: 'medium' }, env);
  const parsed = extractJSON(raw);
  let stars = Number(parsed.stars);
  if (!isFinite(stars)) stars = 3;
  stars = Math.max(0.5, Math.min(5, Math.round(stars * 2) / 2));
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.filter((d: any) => d && d.name).map((d: any) => ({ name: String(d.name), status: String(d.status || ''), note: String(d.note || '') }))
    : [];
  const advice = Array.isArray(parsed.advice) ? parsed.advice.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim()) : [];
  return {
    stars,
    summary: String(parsed.summary || '').trim(),
    assessment: String(parsed.assessment || '').trim(),
    dimensions,
    advice,
  };
}

// ---------- 模块一·进食识别:语音确认语判断 + 回复意图判断 ----------

// 判断浏览器转写出的一句文字的进食语义等级（无/弱/中/强）。
// 移植自 A段 serve-https.py 的 JUDGE_SYS。等级驱动 P(Eating) 贡献（强=75/中=40/弱=20/无=0）。
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

export type SemanticLevel = 'none' | 'weak' | 'mid' | 'strong';

export async function eatingCheck(
  payload: { transcript: string },
  env: Env
): Promise<{ matched: boolean; level: SemanticLevel; phrase: string; transcript: string; error?: string }> {
  const transcript = (payload.transcript || '').trim();
  if (!transcript) return { matched: false, level: 'none', phrase: '', transcript: '', error: 'empty transcript' };
  const user = '判断这句话的进食语义等级：' + transcript;
  const raw = await callLLM({ system: EATING_CHECK_SYSTEM, user, reasoningEffort: 'low' }, env);
  const parsed = extractJSON(raw);
  const level = (['strong', 'mid', 'weak', 'none'] as const).includes(parsed.level) ? (parsed.level as SemanticLevel) : 'none';
  return {
    matched: level !== 'none',
    level,
    phrase: String(parsed.phrase || ''),
    transcript: String(parsed.transcript || transcript),
  };
}

// 对话轮次确认：判断孩子回复意图 + 生成接话。
// turnType 对应 PRD 模块一触发后流程中 LLM 介入的三个节点：
//   first        = 第一问（「你现在是在吃东西吗？」）后的孩子回复
//   second_nudge = going_to_eat 短等待后二次轻提醒的孩子回复
// 硬护栏（P(Eating)/冷却/armed/提醒次数/抬腕唤醒）由 TypeScript 前端持有，LLM 不介入。

const CONVERSATION_TURN_SYSTEM = `${PERSONA}
你同时也是手环上的进食确认助手。孩子的回复可能是语音转写，有错别字、口音、口语化，一律按发音和语境近似理解。

【你在流程中的位置】
系统触发流程如下（硬护栏由系统执行，你只负责打了「LLM判断」标记的节点）：

被动触发流程：
  系统满足 P(Eating)≥70% ∧ 非冷却 ∧ armed ∧ 无进行中对话
  → 手环短震 → 等抬腕（8-10秒，未抬腕系统静默进冷却）
  → 抬腕后 AI 第一问：「你现在是在吃东西吗？」
  → 【LLM判断·turnType=first】孩子回复 → 你判断 intent + 生成 reply + question
      intent 驱动后续：
      - eating      → 系统第二问「要不要拍一下帮你记录？」→ 同意→拍照；拒绝→AI追问「吃了啥」→语音补录→30min冷却
      - finished    → 系统问「吃了啥」→ 语音补录（待家长确认，不计趋势）→ 30min冷却
      - going_to_eat → AI 回复「等你开始吃的时候告诉我，我帮你记录」→ 系统进 8-10min 短等待
                       → 【LLM判断·turnType=second_nudge】二次轻提醒后判孩子回复
                         - eating   → 系统直接调起摄像头拍照 → 30min冷却（不再问第二问）
                         - finished → 语音补录 → 30min冷却
                         - 其余     → 30min冷却，不再追问
      - not_eating  → 30min冷却
      - ambiguous / no_response → 30min冷却

【硬护栏，你不可越过】
- 抬腕唤醒、冷却计时、P(Eating)计算、提醒次数上限：均由系统执行，你无需输出这些
- 不评价孩子吃得好不好，不输出营养或医学内容
- 每轮生成一到两句接话，≤25字，小伙伴型、温和亲近，有情绪反应时可以两句

【主动覆盖意图（任何 turnType 均适用，优先级最高）】
无论当前处于哪个流程阶段，如果孩子的话明确表达了主动记录意图，优先返回以下 intent，不要继续按原流程判断：
- "wants_photo"：孩子主动要求拍照记录食物。
  判断要点：明确说要拍/拍照，且没有否定（如"不想拍"/"别拍"/"不拍"→不算）。
  示例：想拍一下、帮我拍、我要拍个照、拍一张、来拍吧
- "wants_voice_log"：孩子主动口述刚才吃了什么，要求记录。
  判断要点：提到"刚才吃的""吃了什么""告诉你吃了"或直接说"我吃了……（接食物名）"。
  示例：我刚才吃了米饭、告诉你我吃了什么、帮我记一下刚才吃的
- "wants_record"：模糊主动记录，未明确拍照或口述。
  判断要点：有"帮我记""记一下""记录"等意图，但没说清楚要拍还是说。
  示例：帮我记录一下、记一下、我要记录

【turnType=first 时的 intent 定义】
- "eating"：正在吃 / 已经开始吃（如"我在吃饭"/"开始了"/"在吃面"/"吃着呢"）
- "going_to_eat"：即将吃 / 还没开始（如"马上吃"/"等会吃"/"还没开始"/"准备吃"）
- "finished"：刚吃完（如"刚吃完"/"吃好了"/"吃过了"/"吃完了"）
- "not_eating"：没在吃 / 否认（如"没有"/"我在玩"/"没吃"/"不吃"）
- "ambiguous"：模糊或难以判断（如"嗯？"/"啥"/"不知道"）
- "no_response"：无回复 / 听不清 / 静默

【turnType=second_nudge 时的 intent 定义】
- "eating"：确认开始吃了
- "finished"：刚吃完
- "not_eating" / "ambiguous" / "no_response"：否认、模糊或无回复（系统均进冷却，不再追问）
- going_to_eat 在此轮不再有效，归入 ambiguous

【turnType=second_yes_no 时的 intent 定义】
这是系统问完「要不要拍一下帮你记录呀？」之后收到的孩子回复。
- "wants_photo"：同意拍 / 主动要拍。示例：好、要、来拍、可以、行、拍吧、拍一下、嗯嗯
- "not_eating"：拒绝拍照 / 不想拍。示例：不用了、算了、不拍、不想拍、不要

【turnType=active_disambig 时的 intent 定义】
这是系统问完「想拍照还是说给我听？」之后收到的孩子回复。
- "wants_photo"：想拍照。示例：拍照、拍一下、拍、用拍的
- "wants_voice_log"：想口述。示例：告诉你、说、我说、口述、不拍

【reply + question 生成规则】
每轮返回两个字段：
- reply：对孩子上一句的自然接话，≤20字。活泼口语，像精力充沛的小伙伴，有情绪有反应，每次可以不一样。
  - 若 turnType=first（第一次抬腕开口），孩子还没说过话，reply 就是这第一句问话，question 返回空字符串。
  - 其他 turnType：reply 是接孩子上一句的话，question 是紧跟着要问的下一句问题（见下）。
- question：这一步流程要向孩子提的问题，≤20字，口语亲切，适合 4-10 岁。根据 intent 和当前步骤生成：
  - turnType=first：question 为空（第一问已在 reply 里）
  - turnType=first → intent=eating：question = 「要不要拍一下？」类（询问是否拍照）
  - turnType=first → intent=going_to_eat：question = 空（系统进短等待，不追问）
  - turnType=first → intent=finished：question = 「吃了啥？」类（引导口述）
  - turnType=second_nudge → intent=eating：question = 空（系统直接调摄像头，不再问是否拍）
  - turnType=second_nudge → intent=finished：question = 「吃了啥？」类
  - turnType=second_yes_no → intent=not_eating：question = 「那说说吃了啥？」类（引导口述）
  - 其余（not_eating/ambiguous/no_response/进冷却分支）：question = 空字符串

参考方向（只是举例，不要照抄）：
- first 开场（reply 即第一问）："你在吃东西吗？" / "诶，是不是在吃饭呀？" / "感觉你在吃东西？"
- first·eating reply+question："在吃呀！" + "要拍一下记一下不？" / "哦吃上了" + "拍一下？"
- first·going_to_eat reply："等你开始吃告诉我，我帮你记" / "好，吃的时候叫我" （question 空）
- first·finished reply+question："吃好了呀" + "吃了什么呀？" / "哦吃完了" + "吃了啥？"
- first·not_eating/ambiguous/no_response reply："好的那我先走啦" / "没事，不打扰你" （question 空）
- second_nudge 主动发起（reply=''，系统在短等待结束后主动询问）：reply 即问句，问孩子吃了没，语气轻松自然，≤15字，像朋友顺口一问，不催促。示例："吃上了吗？" / "开始吃啦？" / "现在吃了没？" / "吃了没呀？" （question 空）
- second_nudge·eating reply："哦开吃啦！" / "好，我去帮你拍！" （question 空，系统直接拍照）
- second_nudge·finished reply+question："哦吃好了" + "吃了什么呀？"
- second_nudge·其余 reply："行，先不管你了" / "好，你忙" （question 空）
- second_yes_no·wants_photo reply："好嘞来拍！" / "好呀，举起来" （question 空）
- second_yes_no·not_eating reply+question："那好" + "说说吃了啥吧？" / "好" + "跟我说说吃了什么？"
- active_disambig·wants_photo reply："好来拍！" （question 空）
- active_disambig·wants_voice_log reply："好嘞说吧！" / "嗯嗯，我听着" （question 空）

只返回 JSON：{"intent":...,"reply":...,"question":...}。不要输出 JSON 以外的文字。`;

export type ReplyIntent = 'eating' | 'finished' | 'going_to_eat' | 'not_eating' | 'ambiguous' | 'no_response' | 'wants_photo' | 'wants_voice_log' | 'wants_record';
export type TurnType = 'first' | 'second_nudge' | 'second_yes_no' | 'active_disambig';

export async function conversationTurn(
  payload: { reply: string; turnType: TurnType; mealTime?: string },
  env: Env
): Promise<{ intent: ReplyIntent; reply: string; question: string }> {
  const ctx = payload.mealTime ? `（当前饭点上下文：${payload.mealTime}）` : '';
  // first/second_nudge 主动发起时 reply 为空，LLM 生成问句；其余情况 reply 是孩子的回复
  const replyPart = (payload.turnType === 'first' && !payload.reply)
    ? `这是第一次开口，孩子还没说话，请在 reply 里生成开场问句，question 返回空字符串。`
    : (payload.turnType === 'second_nudge' && !payload.reply)
    ? `8分钟等待结束，系统主动二次询问，孩子还没说话。请在 reply 里生成二次询问句（问孩子现在吃了没，语气轻松自然，≤15字），question 返回空字符串。intent 填 "no_response"（系统不会用这个值，仅占位）。`
    : `孩子的回复：「${payload.reply}」。请判断意图，在 reply 里接孩子的话，在 question 里生成下一步要问的问题（若无需追问则返回空字符串）。`;
  const user = `turnType=${payload.turnType}。${replyPart}${ctx}`;
  const raw = await callLLM({ system: CONVERSATION_TURN_SYSTEM, user, reasoningEffort: 'low' }, env);
  const parsed = extractJSON(raw);
  const VALID_INTENTS = ['eating', 'finished', 'going_to_eat', 'not_eating', 'ambiguous', 'no_response', 'wants_photo', 'wants_voice_log', 'wants_record'] as const;
  const intent = (VALID_INTENTS as readonly string[]).includes(parsed.intent)
    ? (parsed.intent as ReplyIntent)
    : (payload.turnType === 'first' ? 'ambiguous' : 'ambiguous');
  const reply = String(parsed.reply || '').trim() || '没关系，那我先不打扰啦～';
  const question = String(parsed.question || '').trim();
  return { intent, reply, question };
}

// ---------- 统一语音路由:进食语义等级 + 主动意图 ----------

// idle 状态下每句 final 转写调一次,返回进食语义等级(驱动 P(Eating))和主动意图(驱动拍照/补录/记录触发)。
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
- "voice_log"：孩子想口述吃了什么，或主动说出刚才吃的食物，要求记录。
  核心判断：明确表达「想说/告诉你/跟你说 吃了什么」，或直接说出「我吃了……（接食物名）」，或「我在吃……（接具体食物名）」，或表明不想拍照但想用说的方式记录。
  关键词：记一下刚才/刚才吃的/吃了什么/告诉我吃了/我吃了……（后接食物名）/我在吃……（后接食物名）/跟你说吃啥/说说我吃啥/说说吃了什么/我想说我吃的/不想拍（照）+想说/用说的/口述
  示例："我不想拍照我想跟你说说我吃啥"/"我想告诉你我吃了什么"/"我吃了米饭和鸡腿"/"我在吃面条"/"我在吃鸡腿"/"我想说说我吃的"/"不想拍，我说给你听"
- "record"：模糊主动记录，未明确拍照或口述。两类情形：
  ① 明确说要记录但没说怎么记：帮我记录/记录一下/帮我记/我要记录/记一下（无「刚才吃」语境，且未明确说「想说/口述」）
  ② 孩子主动声称自己正在吃/在吃饭，但没说具体吃什么——说了就是想让设备知道并记录，直接走主动入口比被动触发更自然。
  示例："我在吃东西"/"在吃饭呢"/"我在吃饭"/"我正在吃东西"/"吃着呢"（后者不含具体食物名）
- "none"：无上述主动意图。

【二】进食语义等级 level（只选一个）：
- "strong"（强·明确进食）：孩子本人正在吃/即将吃/刚吃完/被真实召唤去吃饭。
  正在吃："在吃饭"/"我在吃"/"正在吃"/"吃着呢"/"开吃了"/"嗯在吃"
  即将吃："去吃饭"/"马上吃"/"要吃饭了"/"准备吃"/"该吃饭了"/"开动咯"/"等会儿吃"
  刚吃完："吃好了"/"吃过了"/"刚吃完"/"吃完了"/"吃饱了"
  被召唤："过来吃饭"/"快来吃饭"/"吃饭啦"/"来吃饭"/"饭好了"/"开饭了"
- "mid"（中·进食场景强烈但未明示正在吃）：餐桌上的品尝感叹、进食拟声/环境音。
  品尝感叹："好吃"/"真好吃"/"好香啊"/"再来一碗"/"还要"/"我喜欢吃这个"
  餐桌场景："给我夹点"/"盛饭"/"喝口汤"/"别抢我的"/"菜好了吗"/"摆碗筷了"
  进食拟声："吧唧吧唧"(咀嚼)/"咔嚓咔嚓"(脆食)/"咕咚"(吞咽)/"吸溜"(吸面)/"啊呜"(咬一口)
- "weak"（弱·仅提到食物，无进食迹象）：把食物当话题、评价或计划。
  "我想吃苹果"/"苹果好吃"/"中午吃什么"/"晚上吃面条吧"
- "none"（无·与孩子本人进食无关）：旁人闲聊、背景电视、第三人称描述、与吃饭无关的话。

【上下文感知规则（有上文时优先参考）】
系统会在「上文」字段提供最近几句转写（由旧到新，每句用「→」分隔）。用上文辅助判断当前句，规则如下：
1. 上文已有 strong/mid 进食信号，当前句是含糊的「嗯」「哦」「对」「好」「然后」等接续词 → 当前句继承上文最高等级（至多 mid，不自动升为 strong；需当前句本身有明确进食词才给 strong）。
2. 上文已确立「要/准备/马上」吃饭的意图，当前句出现「开吃了」「来了」「这就」等短促接续 → 可判 strong。
3. 上文全是 none/weak，当前句也是模糊词（「嗯」「对」「哦」）→ 维持 none，不因上文模糊放大。
4. 上下文跨度超过约 60 秒、或上文明显是另一话题（非进食）→ 忽略上文，独立判断当前句。
5. 上下文规则仅影响 level，不影响 intent 判断（intent 始终只看当前句是否有明确主动意图）。

判断要点：
1. level 主体必须是佩戴手环的孩子本人；第三人称→none 或 weak。
2. intent 优先级：photo > voice_log > record > none；intent≠none 时 level 仍照常判，两者均返回。
3. 若一句话既有主动意图又有进食语义（如「我要拍我吃饭的」），两者均返回各自最高等级。
4. 错别字/口语按发音近似：恰饭/造饭/干饭=吃饭。

只返回 JSON：{"level":"strong|mid|weak|none","intent":"photo|voice_log|record|none","phrase":"最能代表结果的原话片段(无则空)","hasFood":true|false}
hasFood：仅当 intent="voice_log" 时有意义。true=这句话里已经包含具体食物名称（可直接识别，如「我吃了麦香鱼」「刚吃完米饭和青菜」「我吃了牛肉」「我刚吃了面条」「我吃了苹果」「我吃了饺子和汤」「直接告诉你我吃了玉米」「跟你说我吃了面」）；false=只是表达想口述的意愿、用疑问词"什么/啥"占位、还没说出具体食物（如「我想跟你说说我吃啥」「我不想拍照，想说给你听」「告诉你我吃了什么」「我要跟你讲我吃了啥」）。关键区别：句中出现具体食物词就是 true，出现"什么/啥"等疑问占位词则是 false。intent≠voice_log 时固定返回 false。
不要输出 JSON 以外的文字。`;

export type VoiceIntent = 'photo' | 'voice_log' | 'record' | 'none';

export async function voiceRouteCheck(
  payload: { transcript: string; recentContext?: string[] },
  env: Env
): Promise<{ level: SemanticLevel; intent: VoiceIntent; phrase: string; hasFood: boolean }> {
  const transcript = (payload.transcript || '').trim();
  if (!transcript) return { level: 'none', intent: 'none', phrase: '', hasFood: false };
  const ctxPart = payload.recentContext && payload.recentContext.length > 0
    ? `上文（由旧到新）：${payload.recentContext.join(' → ')}\n当前句：${transcript}`
    : `当前句：${transcript}`;
  const user = '判断进食语义等级与主动意图。\n' + ctxPart;
  const raw = await callLLM({ system: VOICE_ROUTE_SYSTEM, user, reasoningEffort: 'low' }, env);
  const parsed = extractJSON(raw);
  const level = (['strong', 'mid', 'weak', 'none'] as const).includes(parsed.level) ? (parsed.level as SemanticLevel) : 'none';
  const intent = (['photo', 'voice_log', 'record', 'none'] as const).includes(parsed.intent) ? (parsed.intent as VoiceIntent) : 'none';
  const hasFood = intent === 'voice_log' ? !!parsed.hasFood : false;
  return { level, intent, phrase: String(parsed.phrase || ''), hasFood };
}

// ---------- 模块二·零食轻劝导(糖果/膨化食品/含糖饮料,每天 ≤1) ----------

const PERSUADE_SYSTEM = `${PERSONA}
孩子刚拍下并识别到一类零食（糖果 / 膨化食品 / 含糖饮料），生成一句轻劝导 tip，≤20字。只针对该类零食温和提一下，不批评、不限制、不恐吓，不说"不能吃""不健康""会胖""对身体不好"，不输出克数/卡路里。
只返回 JSON：{"tip":"..."}。不要输出 JSON 以外的文字。`;

export async function persuadeSnack(
  payload: { snackType: string; name: string },
  env: Env
): Promise<{ tip: string }> {
  const user = `零食类型：${payload.snackType}；名称：${payload.name}。请生成一句轻劝导。`;
  const raw = await callLLM({ system: PERSUADE_SYSTEM, user, reasoningEffort: 'low' }, env);
  const parsed = extractJSON(raw);
  const tip = String(parsed.tip || '').trim();
  return { tip };
}

// ---------- 孩子补充备注:判断孩子在记录后说的话是否是补充信息 ----------

const CHILD_NOTE_SYSTEM = `${PERSONA}
孩子刚完成一条饮食记录，随后说了一句话。判断这句话是否是对刚才那条记录的补充说明（如口味、做法、配料细节等），若是则提取简短备注。

判断规则：
- 是补充：对食物本身做进一步描述（如"是无糖的""加了辣椒""是炸的""放了很多酱"）
- 不是补充：和食物记录无关的话（如"我要去玩了""谢谢"）

若是补充，生成 note（≤15字，客观描述，不加"孩子说"前缀，如"无糖"/"加了辣椒"/"是炸的"）。
同时生成自然的 reply（≤25字，小伙伴型，顺着孩子说的接，可以一句也可以两句，如"哦无糖的啊，记下啦！"/"加了辣椒呀，辣不辣？记上了～"）。

只返回 JSON：{"isNote":true|false,"note":"...","reply":"..."}。不要输出 JSON 以外的文字。`;

export async function checkChildNote(
  payload: { foodName: string; transcript: string },
  env: Env
): Promise<{ isNote: boolean; note: string; reply: string }> {
  const user = `刚记录的食物：${payload.foodName}。孩子接着说：${payload.transcript}。`;
  const raw = await callLLM({ system: CHILD_NOTE_SYSTEM, user, reasoningEffort: 'low' }, env);
  const parsed = extractJSON(raw);
  return {
    isNote: !!parsed.isNote,
    note: String(parsed.note || '').trim().slice(0, 15),
    reply: String(parsed.reply || '').trim(),
  };
}
