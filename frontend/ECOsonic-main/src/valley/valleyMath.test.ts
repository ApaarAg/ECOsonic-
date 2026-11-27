import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTouchDelta,
  applyWheelDelta,
  computeFlowerBloomScale,
  computeLeafGrowthScale,
  computeScreenRepulsion,
  createInitialScrollerState,
  fbm2D,
  generateValleyPathPoints,
  getTerrainHeight,
  stepScroller,
  TOUCH_SCROLL_MULTIPLIER,
} from './valleyMath';

test('touch scroll applies 20x multiplier compared to wheel scroll', () => {
  const wheelState = createInitialScrollerState();
  const touchState = createInitialScrollerState();

  applyWheelDelta(wheelState, 100);
  applyTouchDelta(touchState, 100);

  assert.ok(
    Math.abs(touchState.targetProgress - wheelState.targetProgress * TOUCH_SCROLL_MULTIPLIER) < 1e-9,
  );
  assert.equal(TOUCH_SCROLL_MULTIPLIER, 20);
});

test('idle scroller drifts forward and tightens vignette when scrolling faster', () => {
  const state = createInitialScrollerState();
  let idleResult = stepScroller(state, 0.016);
  for (let i = 0; i < 15; i++) {
    idleResult = stepScroller(state, 0.016);
  }
  assert.ok(idleResult.progress > 0, 'idle scroller should advance forward');

  applyWheelDelta(state, 420);
  const fastResult = stepScroller(state, 0.016);
  assert.ok(
    fastResult.vignetteTightness > idleResult.vignetteTightness,
    'faster motion should tighten vignette',
  );
});

test('hover transition eases camera flight toward stop', () => {
  const state = createInitialScrollerState();
  state.hoverTarget = 1;

  for (let i = 0; i < 120; i++) {
    stepScroller(state, 0.016);
  }

  assert.ok(state.hoverAmount > 0.98, 'hoverAmount should converge near 1');
  const before = state.targetProgress;
  stepScroller(state, 0.016);
  const deltaWhileHovered = state.targetProgress - before;
  assert.ok(deltaWhileHovered < 0.0001, 'auto-drift should ease to a stop while hovered');
});

test('flowers bloom larger as distance decreases while leaves grow further back', () => {
  const farFlower = computeFlowerBloomScale(70);
  const nearFlower = computeFlowerBloomScale(18);
  assert.ok(nearFlower > farFlower, 'flowers bloom to full size closer to camera');
  assert.equal(nearFlower, 1.0);

  const tooCloseLeaf = computeLeafGrowthScale(5);
  const midBackLeaf = computeLeafGrowthScale(42);
  assert.equal(tooCloseLeaf, 0);
  assert.ok(midBackLeaf > 0.9, 'leaves reach full growth further back');
});

test('screen-space mouse repulsion pushes nearby points away and adds cursor glow', () => {
  const near = computeScreenRepulsion(0.08, 0.0, 0.0, 0.0, 16 / 9);
  const far = computeScreenRepulsion(0.9, 0.9, 0.0, 0.0, 16 / 9);

  assert.ok(near.offsetX > 0, 'point right of cursor is pushed further right');
  assert.ok(near.glow > 0.2, 'point near cursor receives glow');
  assert.equal(far.offsetX, 0);
  assert.equal(far.glow, 0);
});

test('terrain height forms a valley floor flanked by higher ridges and valid path waypoints', () => {
  const centerHeight = getTerrainHeight(0, 0);
  const ridgeHeight = getTerrainHeight(45, 0);
  assert.ok(ridgeHeight > centerHeight + 2, 'valley ridges should rise above floor');

  const n1 = fbm2D(12.4, -4.8);
  const n2 = fbm2D(12.4, -4.8);
  assert.equal(n1, n2);
  assert.ok(n1 >= 0 && n1 <= 1, 'fbm2D returns normalized [0, 1] noise');

  const waypoints = generateValleyPathPoints(24, 220);
  assert.equal(waypoints.length, 24);
  for (const pt of waypoints) {
    assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z));
    assert.ok(pt.y > getTerrainHeight(pt.x, pt.z), 'camera path stays above terrain');
  }
});
