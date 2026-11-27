import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSpecimenArchive,
  computeArchiveSlotTransforms,
  isBiologicalTaxon,
} from './expectedSpeciesState';
import {
  computePlateTilt,
  computeSpecimenToViewportOrigin,
  resolveArchiveKeyboardAction,
} from './expectedSpeciesInteraction';
import { resolveSpeciesAsset } from './speciesAssetRegistry';
import { ExpectedSpeciesArchive } from './ExpectedSpeciesArchive';
import { SpeciesFieldNote } from './SpeciesFieldNote';
import type { ExpectedSpeciesBaseline } from '../../types/ecosonic';

function makeTestBaseline(overrides?: Partial<ExpectedSpeciesBaseline>): ExpectedSpeciesBaseline {
  return {
    source: 'observation_gap',
    isDemo: false,
    sessionId: 'ses-test-01',
    context: {
      locationName: 'Hoh Canopy Station',
      ecosystemCategory: 'temperate-rainforest',
      latitude: 47.86,
      longitude: -123.93,
      generalizedCoordinates: { latitude: 47.86, longitude: -123.93 },
      observationDate: '2026-11-21',
      meteorologicalWeek: 47,
      observationDurationSec: 1800,
      observationAdequacy: 'adequate',
      adequacyExplanation: 'Adequate sampling window.',
    },
    expectedSpecies: [
      {
        scientificName: 'Cyanocitta stelleri',
        commonName: "Steller's Jay",
        occurrenceScore: 0.78,
        occurrenceStatus: 'frequent',
        birdnetTaxonomyId: 'stejay',
        ebirdCode: 'stejay',
      },
      {
        scientificName: 'Troglodytes pacificus',
        commonName: 'Pacific Wren',
        occurrenceScore: 0.89,
        occurrenceStatus: 'frequent',
        birdnetTaxonomyId: 'pacwre',
        ebirdCode: 'pacwre',
      },
      {
        scientificName: 'Engine',
        commonName: 'Engine',
        occurrenceScore: 0.99,
        occurrenceStatus: 'frequent',
      },
      {
        scientificName: 'Troglodytes pacificus',
        commonName: 'Pacific Wren Duplicate',
        occurrenceScore: 0.5,
        occurrenceStatus: 'expected',
      },
      {
        scientificName: 'Glaucidium gnoma',
        commonName: 'Northern Pygmy-Owl',
        occurrenceScore: 0.41,
        occurrenceStatus: 'rare',
        birdnetTaxonomyId: 'nopowl',
        ebirdCode: 'nopowl',
      },
    ],
    disclaimer:
      'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.',
    ...overrides,
  };
}

test('buildSpecimenArchive filters non-biological classes, deduplicates, and sorts deterministically', () => {
  const archive = buildSpecimenArchive(makeTestBaseline());

  assert.equal(archive.length, 3);
  assert.equal(archive.some((s) => s.scientificName === 'Engine'), false);
  assert.equal(isBiologicalTaxon('Chainsaw', 'Chainsaw'), false);
  assert.equal(isBiologicalTaxon('Ixoreus naevius', 'Varied Thrush'), true);

  // Sorted deterministically by occurrenceScore desc
  assert.equal(archive[0].scientificName, 'Troglodytes pacificus');
  assert.equal(archive[0].indexLabel, '01');
  assert.equal(archive[0].abbreviatedScientific, 'T. pacificus');
  assert.equal(archive[1].scientificName, 'Cyanocitta stelleri');
  assert.equal(archive[1].indexLabel, '02');
  assert.equal(archive[2].scientificName, 'Glaucidium gnoma');
  assert.equal(archive[2].indexLabel, '03');
});

test('buildSpecimenArchive produces zero fabricated species when baseline is empty', () => {
  const archive = buildSpecimenArchive(makeTestBaseline({ expectedSpecies: [] }));
  assert.equal(archive.length, 0);
});

test('resolveSpeciesAsset maps cataloged species and uses transparent habitat fallback for unindexed taxa', () => {
  const wren = resolveSpeciesAsset('Troglodytes pacificus', 'Pacific Wren');
  assert.equal(wren.plateKind, 'species_photograph');
  assert.equal(wren.imageUrl, '/assets/specimens/pacific_wren.jpg');
  assert.ok(wren.license.includes('CC'));

  const unknown = resolveSpeciesAsset('Bubo scandiacus', 'Snowy Owl');
  assert.equal(unknown.plateKind, 'habitat_context_fallback');
  assert.equal(unknown.imageUrl, '/assets/canonical/rainforest_branch_overcast.jpg');
  assert.ok(unknown.captionNote?.includes('unindexed'));
});

test('computeArchiveSlotTransforms pulls selected plate forward and angles peripheral plates in 3D space', () => {
  const archive = buildSpecimenArchive(makeTestBaseline());
  const slots = computeArchiveSlotTransforms(archive, 1, 1440, false);

  assert.equal(slots.length, 3);
  const left = slots[0];
  const center = slots[1];
  const right = slots[2];

  assert.equal(center.isSelected, true);
  assert.equal(center.rotateYDeg, 0);
  assert.ok(center.zPx > 50);
  assert.ok(center.widthPx > left.widthPx);

  assert.equal(left.isSelected, false);
  assert.ok(left.xPx < 0);
  assert.ok(left.zPx < 0);
  assert.ok(left.rotateYDeg > 0);

  assert.equal(right.isSelected, false);
  assert.ok(right.xPx > 0);
  assert.ok(right.zPx < 0);
  assert.ok(right.rotateYDeg < 0);

  // Reduced motion eliminates 3D depth tilt and rotation
  const reducedSlots = computeArchiveSlotTransforms(archive, 1, 1440, true);
  assert.equal(reducedSlots[0].rotateYDeg, 0);
  assert.equal(reducedSlots[0].zPx, 0);
});

test('keyboard navigation, tilt, and specimen-to-viewport origin geometry transition cleanly', () => {
  assert.deepEqual(resolveArchiveKeyboardAction('ArrowRight', 0, 4, false), {
    type: 'select',
    nextIndex: 1,
  });
  assert.deepEqual(resolveArchiveKeyboardAction('ArrowLeft', 0, 4, false), {
    type: 'select',
    nextIndex: 0,
  });
  assert.deepEqual(resolveArchiveKeyboardAction('Enter', 1, 4, false), {
    type: 'open_note',
  });
  assert.deepEqual(resolveArchiveKeyboardAction('Escape', 1, 4, true), {
    type: 'close_note',
  });
  assert.equal(resolveArchiveKeyboardAction('ArrowRight', 1, 4, true), null);

  assert.deepEqual(computePlateTilt(1, -1, true), { rotateXDeg: 0, rotateYDeg: 0 });
  const activeTilt = computePlateTilt(0.5, -0.5, false);
  assert.ok(activeTilt.rotateYDeg > 0 && activeTilt.rotateXDeg > 0);

  const origin = computeSpecimenToViewportOrigin(
    { left: 200, top: 150, width: 300, height: 400 },
    1440,
    900
  );
  assert.ok(origin.dxPx < 0);
  assert.ok(origin.scaleX > 0.16 && origin.scaleX < 0.85);
});

test('ExpectedSpeciesArchive and SpeciesFieldNote emit semantic accessibility roles and disclaimers', () => {
  const archive = buildSpecimenArchive(makeTestBaseline());

  const archiveHtml = renderToStaticMarkup(
    React.createElement(ExpectedSpeciesArchive, {
      specimens: archive,
      selectedIndex: 0,
      isFieldNoteOpen: false,
      reducedMotion: false,
      onSelectIndex: () => {},
      onOpenFieldNote: () => {},
      registerSelectedButtonRef: () => {},
    })
  );

  assert.ok(archiveHtml.includes('aria-label="Open field note for Pacific Wren"'));
  assert.ok(archiveHtml.includes('aria-label="Select expected species Steller&#x27;s Jay"'));
  assert.ok(archiveHtml.includes('aria-pressed="true"'));
  assert.ok(archiveHtml.includes('Troglodytes pacificus'));

  const noteHtml = renderToStaticMarkup(
    React.createElement(SpeciesFieldNote, {
      specimen: archive[0],
      originRect: null,
      isDemo: true,
      disclaimer:
        'Expected species reflects the available ecological context and does not imply presence or absence at the observation site.',
      reducedMotion: true,
      onCloseComplete: () => {},
    })
  );

  assert.ok(noteHtml.includes('role="dialog"'));
  assert.ok(noteHtml.includes('aria-modal="true"'));
  assert.ok(noteHtml.includes('EXPECTED SPECIES'));
  assert.ok(noteHtml.includes('ECOLOGICAL FIELD NOTE'));
  assert.ok(noteHtml.includes('DEMO OBSERVATION'));
  assert.ok(noteHtml.includes('does not imply presence or absence at the observation site'));
});
