// L2 — Page map. Labels pages by section keyword patterns so later layers do not
// search every page blindly. Pure over page text; unit tested without a PDF.

import type { PageMap } from "./types.js";

// Ordered, multi-word patterns to keep false positives low. Matching is over the
// whole page's text; heading-aware refinement can come once font-size heading
// extraction lands.
const LABEL_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: "register_map",
    pattern:
      /\bregister\s+(map|description|summary|table|overview)\b|\bmemory\s+map\b/i,
  },
  {
    label: "electrical_characteristics",
    pattern:
      /\belectrical\s+(characteristics|specifications?)\b|\b(dc|ac)\s+characteristics\b/i,
  },
  {
    label: "timing",
    pattern:
      /\btiming\s+(diagram|characteristics|specifications?|requirements?|parameters?)\b/i,
  },
  {
    label: "pin_description",
    pattern:
      /\bpin\s+(description|configuration|assignment|function)\b|\bpin(-|\s)?out\b/i,
  },
  {
    label: "absolute_maximum_ratings",
    pattern: /\babsolute\s+maximum\s+ratings\b/i,
  },
  {
    label: "commands",
    pattern: /\bcommand\s+(set|table|description|list)\b|\blist\s+of\s+commands\b/i,
  },
];

/** Labels detected on a single page's text. */
export function labelPage(text: string): string[] {
  const labels: string[] = [];
  for (const { label, pattern } of LABEL_PATTERNS) {
    if (pattern.test(text)) labels.push(label);
  }
  return labels;
}

/** Build the page map from each page's text (index 0 => page 1). */
export function buildPageMap(pageTexts: string[]): PageMap {
  const map: PageMap = {};
  pageTexts.forEach((text, i) => {
    const pageNo = i + 1;
    for (const label of labelPage(text)) {
      (map[label] ??= []).push(pageNo);
    }
  });
  return map;
}
