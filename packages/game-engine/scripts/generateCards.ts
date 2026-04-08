/**
 * Reads card-list.csv from the repo root and writes src/data/cards.json.
 * Run with: npx ts-node scripts/generateCards.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Card, CardAbility, CardColor } from '../src/types';

const CSV_PATH = path.resolve(__dirname, '../../../card-list.csv');
const OUT_PATH = path.resolve(__dirname, '../src/data/cards.json');

const ABILITY_VALUES = new Set<string>(['Turn', 'Token', 'Take', 'Privilege', 'Bonus', 'Bonus/Turn']);

function parseLevel(raw: string): Card['level'] {
  const n = parseInt(raw, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`Invalid level: ${raw}`);
}

function parseColor(raw: string): CardColor {
  const map: Record<string, CardColor> = {
    Black: 'black', Red: 'red', Green: 'green',
    Blue: 'blue', White: 'white', Joker: 'joker', Points: 'points',
  };
  const c = map[raw];
  if (!c) throw new Error(`Unknown color: ${raw}`);
  return c;
}

function parseAbility(raw: string): CardAbility | null {
  if (!raw) return null;
  if (ABILITY_VALUES.has(raw)) return raw as CardAbility;
  throw new Error(`Unknown ability: ${raw}`);
}

function num(raw: string): number {
  return raw ? parseInt(raw, 10) : 0;
}

function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  // Strip surrounding quotes from each line (the CSV wraps each row in quotes)
  const lines = raw.trim().split('\n').map(l => l.replace(/^"|"$/g, ''));
  const [_header, ...rows] = lines;

  const cards: Card[] = rows.map((row, i) => {
    const [
      level, color, points, bonus, ability, crowns,
      costPearl, costBlack, costRed, costGreen, costBlue, costWhite,
    ] = row.split(',');

    const cost: Card['cost'] = {};
    if (num(costPearl))  cost.pearl = num(costPearl);
    if (num(costBlack))  cost.black = num(costBlack);
    if (num(costRed))    cost.red   = num(costRed);
    if (num(costGreen))  cost.green = num(costGreen);
    if (num(costBlue))   cost.blue  = num(costBlue);
    if (num(costWhite))  cost.white = num(costWhite);

    return {
      id: i + 1,
      level: parseLevel(level),
      color: parseColor(color),
      points: num(points),
      bonus: num(bonus),
      ability: parseAbility(ability),
      crowns: num(crowns),
      cost,
      assignedColor: null,
      overlappingCardId: null,
    };
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(cards, null, 2));
  console.log(`Written ${cards.length} cards to ${OUT_PATH}`);
}

main();
