/**
 * ── 音长判定：按住多久算「按住了」 ─────────────────────────
 * 跟弹（`practice/rhythm.ts`）与视奏复盘（`domain/compare.ts`）共用同一把尺。
 *
 * 放在 domain 层：两个判题模块都依赖它，谁也不需要反向 import；
 * 改阈值只改这一处，两条路径的口径不会各自漂移。
 */

/**
 * 时值下限：按足目标时值的这个比例算「按住了」。
 *
 * 不追求毫秒精确：钢琴上音尾本来就会随触键与踏板浮动，而初学者最普遍的
 * 问题是**贴键就抬**（全音符弹成四分音符），不是抬晚了 20ms。下限放宽到
 * 六成，正好把「明显弹短」和「正常的音尾浮动」分开。
 *
 * 不设上限：弹长了通常是踏板或乐感，不算错。
 */
export const MIN_HELD_RATIO = 0.6;

/** 按住拍数是否达到目标时值的下限。 */
export function isHeldEnough(heldBeats: number, targetBeats: number): boolean {
  return heldBeats >= targetBeats * MIN_HELD_RATIO;
}
