# Diet Agent · 儿童饮食追踪 Demo

面向 4-10 岁儿童的饮食追踪原型。设备端通过模块一(Trigger 进食识别)在合适时机低打扰确认孩子是否在吃,确认后调起模块二(Recording)拍照识别食物、生成餐盘结构与营养小科普,必要时做零食轻劝导;家长端小程序查看日报、照片墙、周报,并可对低置信度记录做归类确认。晚间推送一份由 LLM 生成的「今日营养评估」。

> 定位:演示用原型。后端以 Vite 插件形式运行在 dev server 内,单进程,不单独起服务;LLM 走 TAL GPT-5.5 网关(OpenAI 兼容)。

---

## 技术栈

- **前端**:React 18 + TypeScript + Vite 5
- **状态**:Zustand(带 persist 中间件,持久化测试历史到 localStorage)
- **图表**:Recharts(周报趋势)
- **后端**:Vite 插件([server/plugin.ts](server/plugin.ts)),在 dev server 中间件挂载 `/api/*`,代理到 LLM 网关
- **语音**:浏览器 Web Speech API([src/hooks/useVoice.ts](src/hooks/useVoice.ts))
- **HTTPS**:`@vitejs/plugin-basic-ssl`(dev 自签证书)

---

## 快速开始

### 1. 配置凭证

复制 [.env.example](.env.example) 为 `.env`,填入 TAL 网关凭证:

```bash
TAL_MLOPS_APP_ID=300008183
TAL_MLOPS_APP_KEY=your_app_key_here
TAL_MODEL=gpt-5.5
```

> 凭证只留在后端 `.env`,绝不暴露到浏览器。`.env` 已在 `.gitignore` 中。

### 2. 安装与启动

```bash
npm install
npm run dev
```

打开 https://localhost:5173/ (HTTPS,首次访问浏览器会提示自签证书,点「继续前往」)。

### 3. 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 dev server(含后端 API 插件) |
| `npm run build` | `tsc -b && vite build` 类型检查 + 构建 |
| `npm run preview` | 预览构建产物 |
| `npx tsc -p tsconfig.check.json --noEmit` | 仅类型检查(src + server) |

### 4. 访问入口

默认页面同时展示「设备端 + 家长端」两栏,便于演示对照。也可用 URL 参数切到单端:

- `https://localhost:5173/` — 双栏(设备端 | 家长端)
- `https://localhost:5173/?watch` — 仅设备端(模拟手机/平板打开)
- `https://localhost:5173/?parent` — 仅家长端(Mac 查看,带测试时间面板与历史)

---

## 整体架构

```
┌─ 设备端 ─────────────────┐     ┌─ 家长端 ──────┐
│  无屏手环 Band            │     │  小程序 Phone  │
│   (佩戴/震动/抬腕门/状态) │     │  日报/照片/    │
│  调试信息 DebugInfo        │     │  周报/配置     │
│   ├ EatingMonitor(模块一)│     │               │
│   │  P(Eating) 引擎视图    │     │               │
│   └ InfoPanel(模块二对话) │     │               │
│  时间控制 TimeControl     │     │               │
└───────────┬──────────────┘     └───────┬───────┘
            │  Zustand store(days/config) │
            │  跨设备同步 sync.ts          │
            ▼                              ▼
      ┌─ dev server 内存中转 /api/state ──┐
      └──────────────┬─────────────────────┘
                     ▼
        ┌─ /api/* Vite 插件 ─┐
        │  analyze-intake     │
        │  clarify-intake     │
        │  eating-check       │
        │  interpret-reply     │
        │  persuade-snack      │
        │  report-suggestion   │
        │  weekly-suggestion   │
        └─────────┬───────────┘
                  ▼
        TAL GPT-5.5 网关(OpenAI 兼容)
```

- **设备端**:无屏手环只负责佩戴与状态(震动/抬腕门/说话/倾听/短等待)。模块一 P(Eating) 引擎与模块二拍照识别对话在「调试信息」内;`useEatingMonitor` 在 [DebugInfo.tsx](src/components/device/DebugInfo.tsx) 实例化,把 `enterCooldown`/`markTrigger` 下传 InfoPanel、`view` 下传 EatingMonitor。
- **家长端**:手机形态的小程序,四个 Tab——日报、照片、周报、配置。
- **后端**:Vite 插件,dev server 内挂 `/api/*` 中间件,把浏览器请求代理到 LLM 网关,API key 留在后端不暴露。同时提供 `/api/state` 做跨设备状态中转。

---

## 模块一 · Trigger 进食识别

[P(Eating) 引擎](src/hooks/useEatingMonitor.ts)移植自 A段 eating-detector-demo.html,改为 React hook。

### 三类信号 + 加法模型

`P(Eating) = min(100, 饭点 + 历史习惯 + AI 进食语义)`

| 信号 | 取值与贡献 |
| --- | --- |
| 饭点时段(上下文加分,非触发依据) | 非饭点 0 / 接近饭点 25 / 饭点中 40 |
| 历史习惯(辅助,自动推导) | 不符合 0 / 符合 10 |
| AI 进食语义(`/api/eating-check`) | 无 0 / 弱 20 / 中 40 / 强 75 |

- 历史习惯**自动推导**:当前 simTime 落在某 slot,若任一已确认同 slot 餐时间在 ±20min 内即「符合历史」(不再手动勾选)。
- **触发阈值 P ≥ 70%**;**重新武装阈值 P < 67%**(须先跌破 67 再升回 70 才允许下一轮)。
- 触发前 5 条件全满足才提醒:P ≥ 70% ∧ 非冷却 ∧ armed ∧ 无进行中对话 ∧ 非背景音。

### 防打扰机制

| 机制 | 规则 |
| --- | --- |
| 抬腕唤醒门 | 短震后等抬腕 8-10s(sim 8s);未抬腕 → AI 不说话 + 记「未唤醒」+ 冷却;抬腕 → 第一问 |
| 30 分钟冷却 | 确认流程结束(拍照/语音补录/拒绝/否认/未唤醒/模糊/无回复/主动完成)进或刷新冷却(live 30min / sim 15s) |
| 短等待 | going_to_eat → 8-10min(sim 10s)→ 二次轻提醒 |
| 提醒次数上限 | 同一进食周期最多 2 次主动提醒 |
| 重新武装 | 冷却结束后 P 须先 <67% 再升至 ≥70% 才再次触发 |

> 冷却在**确认流程结束时**设置(`enterCooldown`),而非触发时 —— 对齐 PRD「本轮流程结束→进/刷新冷却」「主动完成后刷新冷却」。

### 被动入口全流程

```
短震 → 等抬腕(8-10s)
  ├─ 未抬腕 → 记「未唤醒」+ 冷却
  └─ 抬腕 → 第一问「你现在是在吃东西吗?」→ 倾听
        孩子回复 → /api/interpret-reply(6 类意图)→ 分支:
        ├─ eating     → 第二问「要不要拍一下帮你记录?」→ 同意→拍照 / 拒绝→记「在吃未拍照」+冷却
        ├─ finished   → 语音补录(AI 问「吃了啥」一轮)→ 记语音补录(待确认不计趋势)+冷却,不拍照
        ├─ going_to_eat → 短等待 → 二次轻提醒(≤2 次)→ 再判 eating/finished/其余→冷却
        ├─ not_eating → 记「没在吃」+冷却
        └─ ambiguous / no_response → 冷却
```

### 主动入口(独立路径)

孩子主动「帮我拍照」/「帮我记一下刚才吃的」:不卡 P(Eating)/armed/冷却/提醒次数,不走震动→抬腕链。意图明确直接执行(拍照→拍照链路 / 口述→语音补录);模糊「帮我记录一下」由 AI 确认一次。完成后刷新 30min 冷却。

---

## 模块二 · Recording 饮食记录

### 拍照执行链路(三类入口统一)

被动 eating / 二次确认 / 主动拍照进同一个执行链路([InfoPanel.handlePhoto](src/components/device/InfoPanel.tsx)):

```
AI 语音引导摆盘「从上面拍一下整个盘子」
  ↓
屏幕倒数 3-2-1 → AI 自动拍摄(无孩子点按钮;CameraCapture auto 模式)
  ↓
LLM 判质量 + 置信度
  ├─ 高 → 进识别下游(餐盘结构 + 营养小科普)
  └─ 低 且 needRetake 且未补拍 → AI「拿远一点点」+ 自动补拍 1 次 → 再判
        ├─ 高 → 进识别下游
        └─ 仍低 → 降级「待确认」(confirmed=false,照片保留给家长)
```

> 补拍不另算打扰、不额外刷新冷却(冷却已在分支 finalize 设);实时质量评估折叠进引导话术,补拍由拍后 LLM 判定驱动。

### 食物识别输出

`/api/analyze-intake` 输出:摄入类型(meal/snack/drink)、具体菜品、食物类别、餐盘结构标签、置信度、**零食子类型**(糖果/膨化食品/含糖饮料)、**低置信度原因**、**是否需补拍**、营养小科普、追问。

### 置信度

| 置信度 | 结果 |
| --- | --- |
| 高 | 俯拍全盘+清晰+主体完整+可识别 → 计趋势、生成餐盘结构、生成家长建议、触发儿童科普 |
| 低(允许补拍 1 次) | 模糊/不完整/光线差/遮挡/主体不明/仅语音 → 待家长确认、不计趋势、不生成结构、不播科普 |

### 餐盘结构

只评估 蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4,输出 偏少/适中/偏多(仅家长端可见)。水果/汤/零食独立记录,不参与比例([DailyReport RatioEditor](src/components/parent/DailyReport.tsx) 仅蔬菜/主食/肉蛋豆可编辑)。

### 营养小科普

- **触发条件**:正餐 + 有照片 + 高置信度 + 已识别具体食物 + 本餐未播 + 当天同食物未播 + 当天 <3 + 非糖果/膨化/含糖饮料 + LLM 安全。
- **频次护栏**:每正餐 ≤1、每天 ≤3、同一具体食物当天不重复(类别可重复)。
- **LLM 规范**:一句话、15-30 秒、小伙伴型;禁止评价本餐/克数卡路里/「吃了会长高变聪明」「不吃会生病」等。
- 播放后属本轮记录流程,随 `enterCooldown` 刷新冷却;家长端只展示播放次数,不展示文案。

### 零食记录与劝导

零食与正餐同走 `analyze-intake` 识别链路,按 `kind` 自然分流,不做独立入口。零食独立记录、不归三餐、不参与餐盘结构、不生成科普。**劝导**仅糖果/膨化食品/含糖饮料,每天 ≤1(`/api/persuade-snack`),温和不批评/限制/恐吓。

---

## 家长端

- **日报**([DailyReport.tsx](src/components/parent/DailyReport.tsx)):
  - 日期与概况:正餐 X 项 / 零食 X 项 / 待确认 N / 🌱 科普 N/3
  - 数据完整度 X/4 餐 + 每 slot 状态(未记录/待确认/已记录)
  - 正餐按早/午/午后/晚排序;**待确认记录按时间归入对应 slot**(带待确认 badge),不再单列置顶块
  - 零食/饮料(待确认亦归入此处)
  - 已归档未确认(超 48h · 不计入趋势)折叠展示
  - 每条记录保留 **AI 原始识别** + 家长确认值双记录(家长修改不覆盖原始)
  - 今日营养评估(只定性不定量):星级 1-5(可半星,失败默认 3)/总评 ≤30 字/专业分析 2-3 句 ≤120 字/四维度(蔬菜·主食·肉蛋豆·添加糖·油脂)/不良摄入清单(真实食物名 + ≤20 字原因)/建议 2-3 条。默认 21:00 生成(可改)。
- **照片**([PhotoWall.tsx](src/components/parent/PhotoWall.tsx)):正餐/零食/饮料照片墙,新拍实时同步
- **周报**([WeeklyReport.tsx](src/components/parent/WeeklyReport.tsx)):近 7 天有效记录;**蔬菜不足 X/天(≥3 天高亮「建议密切关注」)** + 零食累计次数;异常日剔除
- **配置**([Settings.tsx](src/components/parent/Settings.tsx)):营养小科普开关、晚间报告时间、异常日标注

### 低置信度数据与 48h 归档

低置信度记录按时间归入对应餐次,带「待确认」badge。家长修改 → 置信度变「已确认」,纳入趋势/营养评估。超过 48h 未处理(按模拟时钟判定)→ 自动归档「未确认记录」,不计入趋势与营养评估,但仍可查看/修改。

### 趋势口径

趋势/周报过滤统一用 `confirmed`(高置信度创建即 true;低置信度待家长确认后才 true)——家长确认的低置信度记录也计入趋势。

### 跨设备同步([src/sync.ts](src/sync.ts))

通过 dev server 内存中转实现手机 ↔ Mac 实时同步:

- 启动时拉取后端快照覆盖本地种子(防御性校验,旧结构数据会被忽略)
- 本地 store 变更 → debounce 400ms POST 完整状态到后端
- 每 1.5s 轮询版本号,版本前进则拉取完整状态覆盖本地
- 同步内容:`days` / `config` / 模拟时间 `sim`(科普/劝导计数随 `days.interactions` 自动同步)

> 同步状态存内存,dev server 重启后会清空(回退到种子数据)。

### 测试时间模拟([TimeControl.tsx](src/components/device/TimeControl.tsx))

设备端与家长端共享一套模拟时钟:可设模拟日期与时间(或用预设按钮:早 07:35 / 午 12:10 / 晚 18:20 / 夜 20:00)。设了之后,记录会落到对应日期,餐次按时间自动归入早/午/午后/晚;**48h 归档以模拟时钟判定**,可在时间面板快进触发。`null` 表示跟随真实时间。

### 测试历史持久化([TestHistory.tsx](src/components/device/TestHistory.tsx))

每天数据变化时,把「去图片的只读快照」写进 localStorage(跨会话保留)。点击历史条目可回看当天的评估与餐食清单。种子数据不写历史,避免污染。

---

## LLM 接口

均定义在 [server/llm.ts](server/llm.ts),护栏:**禁止输出任何克数 / 卡路里 / 蛋白质克数 / 营养缺口数值,只做定性结构判断**。

| 接口 | 路径 | 用途 |
| --- | --- | --- |
| `analyzeIntake` | `/api/analyze-intake` | 食物识别:类型/名称/餐盘占比/置信度/零食子类型/低置信度原因/是否补拍/小科普/追问 |
| `clarifyIntake` | `/api/clarify-intake` | 追问回合:结合孩子回答做第二轮最终识别,`clarify` 必须为 null |
| `eatingCheck` | `/api/eating-check` | 进食语义等级(无/弱/中/强),驱动 P(Eating) 贡献 |
| `interpretReply` | `/api/interpret-reply` | 孩子回复意图 6 类(eating/finished/going_to_eat/not_eating/ambiguous/no_response)+ 儿童接话 |
| `persuadeSnack` | `/api/persuade-snack` | 零食轻劝导(糖果/膨化食品/含糖饮料) |
| `reportSuggestion` | `/api/report-suggestion` | 家长端「今日营养评估」:星级/总评/四维度/不良摄入/建议 |
| `weeklySuggestion` | `/api/weekly-suggestion` | 周报趋势解读 |

---

## 图片生成接口

走 TAL gpt-image-1.5 网关(OpenAI 兼容 images 接口),鉴权头用 `api-key: appId:appKey`(与 chat 接口的 `Authorization: Bearer` 不同)。凭证同样从 `.env` 注入,`TAL_IMAGE_MODEL` 可单独指定。定义在 [server/image.ts](server/image.ts)。

| 接口 | 路径 | 用途 |
| --- | --- | --- |
| `generateImage` | `/api/image-gen` | 文生图:`{prompt, size?, quality?}` → `{image}`,image 为 data URL 或远程 url |
| `editImage` | `/api/image-edit` | 图生图:`{prompt, images[], size?}` → `{image}`;单图用 `image`、多图用 `image[]` |

`images` 元素与 `analyzeIntake` 的 `image` 同为 `data:image/...;base64,...` 形式;返回的 `image` 可直接 `<img src>`。

---

## 数据模型([src/types.ts](src/types.ts))

- **`DayRecord`**:一天 = `meals`(正餐)+ `extras`(零食/饮料)+ `reportSuggestion`+ `weeklySuggestion`+ `isAbnormal`+ `interactions`(科普/劝导频次)
- **`Meal`**:餐次/时间/照片/食物列表(带类别)/餐盘占比序数/置信度/是否已确认/科普 + `original`(原始识别快照)+ `createdAt`(sim epoch,48h 归档)+ `isVoice`(语音补录)+ `sciencePlayed`
- **`ExtraRecord`**:零食或饮料(`kind: 'snack' | 'drink'`)/时间/名称/`snackType`(糖果/膨化食品/含糖饮料)/照片/置信度/是否已确认 + `original`/`createdAt`/`isVoice`
- **`NutritionReport`**:星级(0.5-5)/总评/专业分析/四维度评估/不良摄入清单/可执行建议
- **`ParentConfig`**:`sceneToggles.science`(科普开关)/`reportTime`(默认 21:00)
- 辅助类型:`SemanticLevel`(无/弱/中/强)、`SnackType`(糖果/膨化食品/含糖饮料)、`DayInteractions`(scienceCount/scienceFoods/persuadeCount)

---

## 目录结构

```
.
├── index.html
├── vite.config.ts          # react + basicSsl + apiPlugin
├── tsconfig*.json
├── .env / .env.example     # TAL 网关凭证
├── server/
│   ├── llm.ts              # 7 个 LLM 接口 + 护栏
│   ├── image.ts            # 文生图 / 图生图接口(gpt-image-1.5)
│   └── plugin.ts           # Vite 插件:/api/* 中间件 + /api/state 中转
└── src/
    ├── App.tsx             # 双栏布局 + ?watch / ?parent 单端视图
    ├── main.tsx
    ├── api.ts              # 浏览器侧 fetch 封装
    ├── store.ts            # Zustand store + 互动计数 + 测试历史持久化
    ├── sync.ts             # 跨设备状态同步
    ├── ui.ts               # UI 状态(toast / 当前 Tab / 模拟时间 / eatingConfirm / 抬腕门信号)
    ├── report.ts           # 日报汇总 + 趋势统计 + 完整度/科普频次/归档判定
    ├── utils.ts            # 时间 / 日期 / emoji 缩略图 / simEpoch / 历史习惯推导
    ├── types.ts
    ├── styles.css
    ├── data/seed.ts        # 近 7 天种子数据 + 默认配置(reportTime 21:00)
    ├── hooks/
    │   ├── useVoice.ts     # 语音输入
    │   └── useEatingMonitor.ts  # 模块一 P(Eating) 引擎(4 级语义 + 冷却后移 + enterCooldown)
    └── components/
        ├── Toaster.tsx
        ├── device/
        │   ├── Band.tsx          # 无屏手环(震动/抬腕门控/说话/倾听/短等待)
        │   ├── DebugInfo.tsx     # 实例化 useEatingMonitor,下传 InfoPanel/EatingMonitor
        │   ├── EatingMonitor.tsx # P(Eating) 引擎视图(4 级语义下拉 + 自动历史)
        │   ├── InfoPanel.tsx     # 模块二对话:被动入口状态机 + 主动入口 + 拍照链路 + 科普/劝导
        │   ├── CameraCapture.tsx # 摄像头拍照(auto 倒数自动拍) / 相册
        │   ├── TimeControl.tsx   # 测试时间模拟
        │   └── TestHistory.tsx   # 测试历史
        └── parent/
            ├── ParentApp.tsx     # 手机壳 + Tab 切换 + 日期翻页
            ├── DailyReport.tsx
            ├── PhotoWall.tsx
            ├── WeeklyReport.tsx
            └── Settings.tsx
```

---

## 设计护栏

- **只定性,不定量**:全程不输出克数 / 卡路里 / 蛋白质克数等数值,参照《中国学龄儿童膳食指南》餐盘建议(蔬菜≈1/2、主食≈1/4、肉蛋豆≈1/4)做序数判断。
- **拍照链路三类入口统一**:被动 eating / 二次确认 / 主动拍照进同一条 引导+倒数+自动拍+判质量+补拍+降级 链路;零食与正餐同走识别链路,按食物类别自然分流,不做零食独立入口。
- **频次护栏**:营养小科普每正餐 ≤1、每天 ≤3、同食物当天不重复;零食劝导每天 ≤1;补拍不另算打扰、不刷新冷却。
- **双记录保留**:每条记录同时保留 AI 原始识别 + 家长确认值,日报/周报/趋势优先用家长确认记录。
- **低置信度交给家长**:照片模糊 / 仅文字描述时 `confidence=low`,标记「待确认」,按时间归入对应餐次由家长归类确认;48h 未处理自动归档不计趋势。
- **趋势口径 = confirmed**:高置信度与家长确认的低置信度均计趋势;未确认/归档不计。
- **单次异常不焦虑**:周报只看趋势;连续偏低(蔬菜不足 ≥3 天)才高亮提示。异常日(如生病)可标注,不计入趋势。
