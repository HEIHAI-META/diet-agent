export type MealType = 'breakfast' | 'lunch' | 'afternoon' | 'dinner';
export type Confidence = 'high' | 'low';
export type Ordinal = '偏少' | '适中' | '偏多';
export type FoodCategory = '蔬菜' | '主食' | '肉蛋豆' | '水果' | '汤';

// 模块一·AI 进食语义 4 级（无/弱/中/强）。
export type SemanticLevel = 'none' | 'weak' | 'mid' | 'strong';

// 零食劝导适用的 3 类（糖果/膨化食品/含糖饮料）。
export type SnackType = '糖果' | '膨化食品' | '含糖饮料';

export interface PlateRatio {
  [cat: string]: Ordinal;
}

// 原始识别快照（PRD §五·修正记录保留：家长修改不覆盖原始）。
export interface RecordOriginal {
  foodsDetected?: string;
  foodItems?: FoodItem[];
  categories?: FoodCategory[];
  plateRatio?: PlateRatio;
  name?: string;
  confidence?: Confidence;
  uploadedAt?: string;
}

// 当日儿童端互动统计（科普/劝导频次 + 家长端展示播放次数）。
export interface DayInteractions {
  scienceCount: number;
  scienceFoods: string[];
  persuadeCount: number;
}

// 一样食物 + 其所属餐盘类别(用于按类别分组展示)。
export interface FoodItem {
  cat: FoodCategory;
  name: string;
}

// 正餐:一条照片/记录对应一项;同一餐次可多条(加餐)。
export interface Meal {
  id: string;
  type: MealType; // 餐次:早/午/午后/晚
  time: string; // HH:MM
  photoUrl?: string; // data URL
  textDesc?: string;
  foodsDetected?: string; // 扁平展示文本(由 foodItems 派生或手填)
  foodItems?: FoodItem[]; // 每样食物 + 类别,用于色块标签展示
  categories: FoodCategory[];
  plateRatio: PlateRatio;
  confidence: Confidence;
  confirmed: boolean; // 高置信度自动 true;低置信度待家长确认
  scienceTip?: string | null;
  original?: RecordOriginal; // 设备端原始识别(家长修改不覆盖)
  createdAt?: number; // sim epoch ms(48h 归档判定)
  isVoice?: boolean; // 语音补录(不计趋势、待家长确认)
  sciencePlayed?: boolean; // 本餐是否已播过科普(每正餐 ≤1)
  childNote?: string; // 孩子记录后主动补充的备注(如「是无糖的」)
}

// 零食 / 饮料:照片识别出的非正餐摄入。
export interface ExtraRecord {
  id: string;
  time: string;
  name: string;
  kind: 'snack' | 'drink' | 'fruit';
  snackType?: SnackType | null; // 糖果/膨化食品/含糖饮料(触发劝导)
  photoUrl?: string;
  confidence: Confidence;
  confirmed: boolean;
  original?: RecordOriginal;
  createdAt?: number;
  isVoice?: boolean;
  childNote?: string; // 孩子记录后主动补充的备注
}

export interface UnhealthyItem {
  name: string;
  reason: string;
}

export interface DimensionNote {
  name: string; // 蔬菜 / 主食 / 肉蛋豆 / 添加糖·油脂
  status: string; // 偏低 / 适中 / 偏高 / 不足 / 充足 等
  note: string; // 对照指南的简短说明
}

// 今日营养评估(LLM 生成,结构化)。
export interface NutritionReport {
  stars: number; // 0.5-5,可半星
  summary: string; // 一句话总评
  assessment: string; // 专业分析段落(宏量营养素/指南差距/趋势)
  dimensions: DimensionNote[]; // 五维度评估
  unhealthy: UnhealthyItem[]; // 不良食物摄入 + 原因
  advice: string[]; // 2-3 条可执行建议
}

// 周报解读(LLM 生成,看 7 天趋势):星级/总评/分析/维度/建议,结构对齐今日营养评估。
export interface WeeklySuggestion {
  stars: number; // 0.5-5,可半星
  summary: string; // 本周一句话总评
  assessment: string; // 本周趋势分析段落
  dimensions: DimensionNote[]; // 趋势维度:蔬菜/零食频率/饮食规律
  advice: string[]; // 2-3 条针对趋势的可执行建议
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  meals: Meal[]; // 正餐列表(按时间排序,同餐次可多条)
  extras: ExtraRecord[]; // 零食 / 饮料
  reportSuggestion?: NutritionReport;
  weeklySuggestion?: WeeklySuggestion;
  isAbnormal?: boolean;
  interactions?: DayInteractions; // 当日科普/劝导频次
}

export interface ParentConfig {
  sceneToggles: { science: boolean };
  reportTime: string;
}
