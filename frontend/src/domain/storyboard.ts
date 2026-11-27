export const STORYBOARD_ACTS = [
  "BLACKNESS",
  "FOREST",
  "LEAF",
  "WATER",
  "SOUND",
  "ACOUSTIC FIELD",
  "SPECIES",
  "DISTURBANCE",
  "SILENCE",
  "ECOLOGICAL CONTEXT",
  "EXPECTED SPECIES",
  "OBSERVATION GAP",
  "UNEXPECTED TAXA",
  "GROUNDED INTERPRETATION",
  "RETURN TO FOREST",
  "OBSERVATORY",
] as const;

export type StoryboardAct = (typeof STORYBOARD_ACTS)[number];

export interface StoryboardActMeta {
  index: number;
  act: StoryboardAct;
  slug: string;
  implemented: boolean;
}

export const STORYBOARD_REGISTRY: readonly StoryboardActMeta[] =
  STORYBOARD_ACTS.map((act, index) => ({
    index: index + 1,
    act,
    slug: act.toLowerCase().replace(/\s+/g, "-"),
    implemented: index <= 11,
  }));

export function getStoryboardActMeta(act: StoryboardAct): StoryboardActMeta {
  const found = STORYBOARD_REGISTRY.find((item) => item.act === act);
  if (!found) {
    throw new Error(`Unknown storyboard act: ${act}`);
  }
  return found;
}
