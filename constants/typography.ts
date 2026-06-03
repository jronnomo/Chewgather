// Dynamic-Type scaling caps — INTENTIONAL, do not remove.
//
// iOS Dynamic-Type at the highest accessibility category (AX5) can scale text
// to ~310% of its design size. On a card-heavy layout this causes catastrophic
// overflow and truncation. The caps below are a standard iOS engineering
// practice: they keep text readable while preventing layout blow-out.
//
// WCAG 1.4.4 tension: Success Criterion 1.4.4 (Resize Text, AA) asks that
// text can be resized up to 200% without loss of content. A future a11y sweep
// should audit whether the 'display' and 'dense' caps (1.2× and 1.3×) meet
// that bar for the screens where they appear, and relax or replace them with
// layout-safe alternatives (e.g. scrollable containers) if needed.

export const FONT_CAP = { display: 1.2, dense: 1.3, body: 1.6 } as const;

export type FontCapTier = keyof typeof FONT_CAP;

export default FONT_CAP;
