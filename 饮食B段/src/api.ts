import type { FoodItem, SemanticLevel, SnackType } from './types';

export interface AnalyzeIntakeResult {
  kind: 'meal' | 'snack' | 'drink' | 'fruit';
  name: string;
  foodsDetected: string;
  foodItems?: FoodItem[];
  categories: string[];
  plateRatio: Record<string, string>;
  confidence: 'high' | 'low';
  scienceTip: string | null;
  snackType: SnackType | null; // 糖果/膨化食品/含糖饮料(零食子类型,触发劝导)
  lowConfidenceReason: string | null;
  needRetake: boolean; // 低置信且补拍可救(模糊/局部/光线差/遮挡);仅语音无图=false
  clarify: { question: string } | null;
  raw: string;
}

// 对齐 PRD 模块一 §1.3 + 主动覆盖意图。
export type ReplyIntent = 'eating' | 'finished' | 'going_to_eat' | 'not_eating' | 'ambiguous' | 'no_response' | 'wants_photo' | 'wants_voice_log' | 'wants_record';

async function post(url: string, body: any): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `请求失败 (${r.status})`);
  return data;
}

export function analyzeIntake(p: { image?: string; text?: string }): Promise<AnalyzeIntakeResult> {
  return post('/api/analyze-intake', p);
}

export function clarifyIntake(p: { image?: string; text?: string; question?: string; answer: string }): Promise<AnalyzeIntakeResult> {
  return post('/api/clarify-intake', p);
}

// 模块一·进食识别:判断转写文字的进食语义等级(无/弱/中/强),命中强语义给 P(Eating) +75。
export function eatingCheck(p: { transcript: string }): Promise<{ matched: boolean; level: SemanticLevel; phrase: string; transcript: string; error?: string }> {
  return post('/api/eating-check', p);
}

export type VoiceIntent = 'photo' | 'voice_log' | 'record' | 'none';

// 统一语音路由(idle 状态):一次 LLM 同时返回进食语义等级(驱动 P(Eating))和主动意图(驱动主动触发)。
export function voiceRoute(p: { transcript: string; recentContext?: string[] }): Promise<{ level: SemanticLevel; intent: VoiceIntent; phrase: string; hasFood: boolean }> {
  return post('/api/voice-route', p);
}

// 模块二·零食轻劝导(糖果/膨化食品/含糖饮料,每天 ≤1)。
export function checkChildNote(p: { foodName: string; transcript: string }): Promise<{ isNote: boolean; note: string; reply: string }> {
  return post('/api/child-note', p);
}

export function persuadeSnack(p: { snackType: SnackType; name: string }): Promise<{ tip: string }> {
  return post('/api/persuade-snack', p);
}

export type TurnType = 'first' | 'second_nudge' | 'second_yes_no' | 'active_disambig';

// 模块一·对话轮次确认:判断孩子回复意图 + 生成接话 + 生成下一步问句。
// reply = 对孩子上一句的接话；question = 这一步要问的问题（无需追问时为空字符串）。
// turnType=first 时孩子还没说话，reply 即开场问句，question 为空。
export function conversationTurn(p: { reply: string; turnType: TurnType; mealTime?: string }): Promise<{ intent: ReplyIntent; reply: string; question: string }> {
  return post('/api/conversation-turn', p);
}

export function reportSuggestion(p: {
  todaySummary: string;
  trend7d: string;
}): Promise<{ stars: number; summary: string; assessment: string; dimensions: { name: string; status: string; note: string }[]; unhealthy: { name: string; reason: string }[]; advice: string[] }> {
  return post('/api/report-suggestion', p);
}

export function weeklySuggestion(p: {
  weeklySummary: string;
}): Promise<{ stars: number; summary: string; assessment: string; dimensions: { name: string; status: string; note: string }[]; advice: string[] }> {
  return post('/api/weekly-suggestion', p);
}

// 文生图:prompt 必填;size 可选(1024x1024/1024x1536/1536x1024/auto);quality 可选(low/medium/high/auto)。
// 返回 image 为 data:image/png;base64,... 或远程 url,可直接 <img src>。
export function generateImage(p: { prompt: string; size?: string; quality?: string }): Promise<{ image: string }> {
  return post('/api/image-gen', p);
}

// 图生图:images 为 1 张或多张 data URL(同 analyzeIntake 的 image 格式);单图用 image、多图用 image[]。
export function editImage(p: { prompt: string; images: string[]; size?: string }): Promise<{ image: string }> {
  return post('/api/image-edit', p);
}
