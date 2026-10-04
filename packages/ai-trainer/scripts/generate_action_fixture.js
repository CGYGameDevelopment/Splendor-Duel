#!/usr/bin/env node
/**
 * Dumps real legal-move lists from the TypeScript engine for the Python tests.
 *
 * `action_space.py` reimplements part of the engine's rules: the 145 valid token
 * lines, the card id ranges, and the shape of every action. Nothing links the two,
 * so an engine change silently desyncs the RL action mask — the trainer does not
 * crash, it just learns against a wrong mask.
 *
 * This writes a fixture of actions the engine actually produces. The Python tests
 * assert every one maps to a unique canonical index, and CI regenerates the
 * fixture and fails if it differs from the committed copy, so a divergence shows
 * up as a failing build rather than a bad training run.
 *
 * Usage: node scripts/generate_action_fixture.js
 * Requires the game-engine package to be built.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const engine = require('../../game-engine/dist/index.js');
const { createInitialState, reducer, legalMoves, randomInt } = engine;

/** How many games to walk, and the per-game step ceiling. */
const GAMES = 40;
const MAX_STEPS = 2000;

/** Collects legal-move lists from states reached along random playthroughs. */
function collect() {
  const samples = [];
  const seenPhases = new Set();

  for (let game = 0; game < GAMES; game++) {
    const seed = game * 104729 + 7;
    let state = createInitialState(game % 2 === 0, seed);
    let choiceSeed = seed ^ 0x2545f491;
    let steps = 0;

    while (state.phase !== 'game_over' && steps < MAX_STEPS) {
      const moves = legalMoves(state);
      if (moves.length === 0) break;

      samples.push({ phase: state.phase, legalMoves: moves });
      seenPhases.add(state.phase);

      const drawn = randomInt(choiceSeed, moves.length);
      choiceSeed = drawn.seed;
      state = reducer(state, moves[drawn.value]);
      steps++;
    }
  }

  return { samples, seenPhases: [...seenPhases].sort() };
}

const { samples, seenPhases } = collect();

// Keep the fixture small and deterministic: one sample per distinct
// (phase, sorted action-type set), which is what exercises the mapping.
const bySignature = new Map();
for (const sample of samples) {
  const signature = `${sample.phase}|${[...new Set(sample.legalMoves.map(m => m.type))].sort().join(',')}`;
  if (!bySignature.has(signature)) bySignature.set(signature, sample);
}

const fixture = {
  // Bump when the generator's own output format changes.
  formatVersion: 1,
  generatedFrom: 'packages/game-engine (see scripts/generate_action_fixture.js)',
  phasesCovered: seenPhases,
  samples: [...bySignature.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([signature, sample]) => ({ signature, phase: sample.phase, legalMoves: sample.legalMoves })),
};

const outPath = path.join(__dirname, '..', 'tests', 'fixtures', 'legal_moves.json');
fs.writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);

const totalActions = fixture.samples.reduce((sum, s) => sum + s.legalMoves.length, 0);
console.log(
  `Wrote ${path.relative(process.cwd(), outPath)}: ` +
  `${fixture.samples.length} samples, ${totalActions} actions, phases: ${seenPhases.join(', ')}`,
);
