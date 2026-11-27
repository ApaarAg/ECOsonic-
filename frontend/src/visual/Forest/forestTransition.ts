import type { Group, Vector3 } from "three";

/**
 * Transition contract exposed by ACT 02 — FOREST so ACT 03 — LEAF can later
 * shift camera attention to the foreground bigleaf maple branch and detach
 * the hero leaf without rebuilding the forest scene.
 */
export interface ForestAct03TransitionHandle {
  /** World-space position of the hero bigleaf maple leaf attachment point. */
  getHeroLeafWorldPosition: (out: Vector3) => Vector3;
  /** Three.js Group containing the isolated hero leaf for ACT 03 detachment. */
  getHeroLeafGroup: () => Group;
  /** Adjusts foreground attention weight [0..1] as camera shifts toward the leaf. */
  setLeafAttention: (weight: number) => void;
}
