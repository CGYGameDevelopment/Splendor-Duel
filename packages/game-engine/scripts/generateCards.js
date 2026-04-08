"use strict";
/**
 * Reads card-list.csv from the repo root and writes src/data/cards.json.
 * Run with: npx ts-node scripts/generateCards.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CSV_PATH = path.resolve(__dirname, '../../../card-list.csv');
const OUT_PATH = path.resolve(__dirname, '../src/data/cards.json');
const ABILITY_VALUES = new Set(['Turn', 'Token', 'Take', 'Privilege', 'Bonus', 'Bonus/Turn']);
function parseLevel(raw) {
    const n = parseInt(raw, 10);
    if (n === 1 || n === 2 || n === 3)
        return n;
    throw new Error(`Invalid level: ${raw}`);
}
function parseColor(raw) {
    const map = {
        Black: 'black', Red: 'red', Green: 'green',
        Blue: 'blue', White: 'white', Joker: 'joker', Points: 'points',
    };
    const c = map[raw];
    if (!c)
        throw new Error(`Unknown color: ${raw}`);
    return c;
}
function parseAbility(raw) {
    if (!raw)
        return null;
    if (ABILITY_VALUES.has(raw))
        return raw;
    throw new Error(`Unknown ability: ${raw}`);
}
function num(raw) {
    return raw ? parseInt(raw, 10) : 0;
}
function main() {
    const raw = fs.readFileSync(CSV_PATH, 'utf-8');
    // Strip surrounding quotes from each line (the CSV wraps each row in quotes)
    const lines = raw.trim().split('\n').map(l => l.replace(/^"|"$/g, ''));
    const [_header, ...rows] = lines;
    const cards = rows.map((row, i) => {
        const [level, color, points, bonus, ability, crowns, costPearl, costBlack, costRed, costGreen, costBlue, costWhite,] = row.split(',');
        const cost = {};
        if (num(costPearl))
            cost.pearl = num(costPearl);
        if (num(costBlack))
            cost.black = num(costBlack);
        if (num(costRed))
            cost.red = num(costRed);
        if (num(costGreen))
            cost.green = num(costGreen);
        if (num(costBlue))
            cost.blue = num(costBlue);
        if (num(costWhite))
            cost.white = num(costWhite);
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
//# sourceMappingURL=generateCards.js.map