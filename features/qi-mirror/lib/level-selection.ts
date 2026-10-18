export const LEVEL_COUNT = 24;
export const WHEEL_SLOTS = 8;
export const WHEEL_STEP_DEGREES = 360 / WHEEL_SLOTS;

export const wrapLevel = (step: number) => ((step % LEVEL_COUNT) + LEVEL_COUNT) % LEVEL_COUNT;

/** Eight physical positions are reused over three revolutions, with labels recycled at the back. */
export function wheelSlot(step: number, slot: number) {
  const offset = (((slot - step + 3) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS - 3;
  return { offset, index: wrapLevel(step + offset), selected: offset === 0 };
}

export function nearestLevelStep(step: number, index: number) {
  const offset = wrapLevel(index - step + LEVEL_COUNT / 2) - LEVEL_COUNT / 2;
  return step + offset;
}

export function romanLevel(value: number): string {
  const digits: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = value, result = '';
  for (const [number, numeral] of digits) while (remaining >= number) { result += numeral; remaining -= number; }
  return result;
}

const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '二十一', '二十二', '二十三', '二十四'];
export const chineseLevel = (index: number) => `第${chineseNumbers[wrapLevel(index)]}式`;

export interface GameLevel {
  number: number;
  title: string;
  chineseTitle: string;
  src: string;
  durationSeconds: number;
}
