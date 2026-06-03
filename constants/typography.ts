// Dynamic-Type scaling caps — INTENTIONAL, do not remove.
export const FONT_CAP = { display: 1.2, dense: 1.3, body: 1.6 } as const;
export type FontCapTier = keyof typeof FONT_CAP;
export default FONT_CAP;
