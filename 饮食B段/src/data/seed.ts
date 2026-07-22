import type { DayRecord, Meal, MealType, ParentConfig, ExtraRecord, FoodItem, SnackType } from '../types';
import { dateStr, emojiPhoto, uid } from '../utils';

export const DEFAULT_CONFIG: ParentConfig = {
  sceneToggles: { science: true },
  reportTime: '21:00',
};

function meal(
  type: MealType,
  time: string,
  emoji: string,
  bg: string,
  foods: FoodItem[],
  ratio: Record<string, any>,
  conf: 'high' | 'low',
  scienceTip?: string
): Meal {
  return {
    id: uid(),
    type,
    time,
    photoUrl: emojiPhoto(emoji, bg),
    foodsDetected: foods.map((f) => f.name).join('、'),
    foodItems: foods,
    categories: Object.keys(ratio) as any,
    plateRatio: ratio,
    confidence: conf,
    confirmed: conf === 'high',
    scienceTip: scienceTip ?? null,
  };
}

function snack(time: string, name: string, snackType?: SnackType | null): ExtraRecord {
  return { id: uid(), time, name, kind: 'snack', snackType: snackType ?? null, confidence: 'high', confirmed: true };
}

// 近 7 天历史(offset -7..-1)+ 今天(0)。
// 叙事:蔬菜占比连续 3 天偏低(-5,-4,-3)后回升;部分餐次未记录演示数据缺失处理。
export function buildSeedDays(): DayRecord[] {
  const days: DayRecord[] = [];

  days.push({
    date: dateStr(-7),
    meals: [
      meal('breakfast', '07:35', '🥚', '#5b8def', [{ cat: '肉蛋豆', name: '鸡蛋' }, { cat: '主食', name: '包子' }, { cat: '肉蛋豆', name: '牛奶' }], { 主食: '适中', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high', '鸡蛋里有优质蛋白,帮小朋友长高高哦~'),
      meal('lunch', '12:10', '🍱', '#6bbf8f', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '西红柿炒蛋' }, { cat: '蔬菜', name: '青菜' }], { 主食: '适中', 蔬菜: '适中', 肉蛋豆: '适中' }, 'high'),
      meal('dinner', '18:20', '🥣', '#e8a04f', [{ cat: '主食', name: '粥' }, { cat: '主食', name: '馒头' }, { cat: '蔬菜', name: '炒西兰花' }], { 主食: '适中', 蔬菜: '适中' }, 'high'),
    ],
    extras: [snack('15:40', '膨化食品', '膨化食品')],
  });

  // -6 早餐未记录(漏检)
  days.push({
    date: dateStr(-6),
    meals: [
      meal('lunch', '12:05', '🍜', '#5b8def', [{ cat: '主食', name: '面条' }, { cat: '肉蛋豆', name: '鸡腿' }, { cat: '蔬菜', name: '小白菜' }], { 主食: '偏多', 蔬菜: '偏少', 肉蛋豆: '适中' }, 'high'),
      meal('dinner', '18:30', '🍚', '#6bbf8f', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '红烧肉' }, { cat: '蔬菜', name: '菠菜' }], { 主食: '适中', 蔬菜: '偏少', 肉蛋豆: '偏多' }, 'high'),
    ],
    extras: [],
  });

  // -5 蔬菜偏低(1)
  days.push({
    date: dateStr(-5),
    meals: [
      meal('breakfast', '07:40', '🥛', '#e8a04f', [{ cat: '肉蛋豆', name: '牛奶' }, { cat: '主食', name: '面包' }], { 主食: '适中', 肉蛋豆: '适中' }, 'high'),
      meal('lunch', '12:15', '🍛', '#5b8def', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '糖醋排骨' }], { 主食: '适中', 蔬菜: '偏少', 肉蛋豆: '偏多' }, 'high'),
      meal('dinner', '18:25', '🥘', '#e07a5f', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '炸鸡块' }], { 主食: '适中', 肉蛋豆: '偏多', 蔬菜: '偏少' }, 'high'),
    ],
    extras: [snack('16:00', '糖果', '糖果')],
  });

  // -4 蔬菜偏低(2)
  days.push({
    date: dateStr(-4),
    meals: [
      meal('breakfast', '07:30', '🥪', '#6bbf8f', [{ cat: '主食', name: '三明治' }, { cat: '肉蛋豆', name: '牛奶' }], { 主食: '适中', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high'),
      meal('lunch', '12:00', '🍚', '#5b8def', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '红烧肉' }, { cat: '蔬菜', name: '黄瓜' }], { 主食: '适中', 蔬菜: '偏少', 肉蛋豆: '偏多' }, 'high'),
      meal('dinner', '18:40', '🍜', '#e8a04f', [{ cat: '主食', name: '面条' }, { cat: '肉蛋豆', name: '肉酱' }], { 主食: '偏多', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high'),
    ],
    extras: [],
  });

  // -3 蔬菜偏低(3) — 触发趋势性建议
  days.push({
    date: dateStr(-3),
    meals: [
      meal('breakfast', '07:45', '🥟', '#e07a5f', [{ cat: '肉蛋豆', name: '馄饨' }, { cat: '主食', name: '油条' }], { 主食: '偏多', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high'),
      meal('lunch', '12:20', '🍔', '#5b8def', [{ cat: '肉蛋豆', name: '汉堡' }, { cat: '主食', name: '薯条' }], { 主食: '偏多', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high'),
      meal('dinner', '18:35', '🍗', '#e8a04f', [{ cat: '肉蛋豆', name: '炸鸡腿' }, { cat: '主食', name: '米饭' }], { 主食: '适中', 肉蛋豆: '偏多', 蔬菜: '偏少' }, 'high'),
    ],
    extras: [{ id: uid(), time: '14:50', name: '含糖饮料', kind: 'drink', snackType: '含糖饮料', confidence: 'high', confirmed: true }],
  });

  // -2 生病异常日(不计入趋势)
  days.push({
    date: dateStr(-2),
    meals: [
      meal('breakfast', '08:00', '🥣', '#6bbf8f', [{ cat: '主食', name: '白粥' }], { 主食: '适中' }, 'high'),
      meal('lunch', '12:30', '🍜', '#5b8def', [{ cat: '主食', name: '清汤面' }], { 主食: '适中', 蔬菜: '偏少' }, 'high'),
    ],
    extras: [],
    isAbnormal: true,
  });

  // -1 蔬菜回升
  days.push({
    date: dateStr(-1),
    meals: [
      meal('breakfast', '07:30', '🥗', '#6bbf8f', [{ cat: '主食', name: '蔬菜三明治' }, { cat: '肉蛋豆', name: '牛奶' }], { 主食: '适中', 蔬菜: '适中', 肉蛋豆: '适中' }, 'high'),
      meal('lunch', '12:05', '🍱', '#5b8def', [{ cat: '主食', name: '米饭' }, { cat: '蔬菜', name: '清炒时蔬' }, { cat: '肉蛋豆', name: '鸡蛋' }], { 主食: '适中', 蔬菜: '适中', 肉蛋豆: '适中' }, 'high'),
      meal('dinner', '18:20', '🍲', '#e8a04f', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '番茄炖牛肉' }, { cat: '蔬菜', name: '青菜' }], { 主食: '适中', 蔬菜: '适中', 肉蛋豆: '适中' }, 'high'),
    ],
    extras: [],
  });

  // 今天:早午餐已记录(示例),晚餐留给现场走流程
  days.push({
    date: dateStr(0),
    meals: [
      meal('breakfast', '07:35', '🥚', '#5b8def', [{ cat: '肉蛋豆', name: '鸡蛋' }, { cat: '主食', name: '包子' }, { cat: '肉蛋豆', name: '豆浆' }], { 主食: '适中', 肉蛋豆: '适中', 蔬菜: '偏少' }, 'high', '豆浆里的植物蛋白和鸡蛋一起,是长身体的好帮手~'),
      meal('lunch', '12:10', '🍱', '#6bbf8f', [{ cat: '主食', name: '米饭' }, { cat: '肉蛋豆', name: '青椒肉丝' }, { cat: '蔬菜', name: '炒生菜' }], { 主食: '适中', 蔬菜: '适中', 肉蛋豆: '适中' }, 'high'),
    ],
    extras: [snack('15:30', '糖果', '糖果')],
  });

  return days;
}
