// ─── Tokens ──────────────────────────────────────────────────────────────────

export type GemColor = 'black' | 'red' | 'green' | 'blue' | 'white';
export type TokenColor = GemColor | 'pearl' | 'gold';

export type TokenPool = Record<TokenColor, number>;

// ─── Cards ───────────────────────────────────────────────────────────────────

export type CardAbility = 'Turn' | 'Token' | 'Take' | 'Privilege' | 'Bonus' | 'Bonus/Turn';

export type CardColor = GemColor | 'joker' | 'points';

export type Cost = Partial<Record<TokenColor, number>>;

export interface Card {
  id: number;
  level: 1 | 2 | 3 | 'royal';
  color: CardColor;
  points: number;
  bonus: number;           // number of bonus gems this card grants (usually 1, sometimes 2)
  ability: CardAbility | null;
  crowns: number;
  cost: Cost;
  // For Joker/Bonus cards: the color assigned when placed on another card
  assignedColor: GemColor | null;
  // For Bonus cards: the id of the card this is overlapping
  overlappingCardId: number | null;
}

// ─── Board ───────────────────────────────────────────────────────────────────

export type BoardCell = TokenColor | null;

// 25 cells indexed 0–24, spiral order from center
export type Board = BoardCell[];

// ─── Players ─────────────────────────────────────────────────────────────────

export type PlayerId = 0 | 1;

export interface PlayerState {
  tokens: TokenPool;
  purchasedCards: Card[];
  reservedCards: Card[];   // kept secret from opponent; max 3
  privileges: number;      // 0–3
  crowns: number;
  prestige: number;
  royalCards: Card[];
}

// ─── Decks / Pyramid ─────────────────────────────────────────────────────────

export interface Pyramid {
  level1: Card[];   // 5 face-up
  level2: Card[];   // 4 face-up
  level3: Card[];   // 3 face-up
}

export interface Decks {
  level1: Card[];
  level2: Card[];
  level3: Card[];
}

// ─── Game State ──────────────────────────────────────────────────────────────

export type Phase =
  | 'optional_privilege'      // may use privileges
  | 'optional_replenish'      // may replenish board
  | 'mandatory'               // must take tokens | reserve | purchase
  | 'discard'                 // must discard down to 10 tokens
  | 'resolve_ability'         // resolving a card ability (Turn, Token, Take, etc.)
  | 'place_bonus'             // choosing which card a Bonus card overlaps
  | 'game_over';

export type WinCondition = 'prestige' | 'crowns' | 'color_prestige';

export interface GameState {
  board: Board;
  bag: TokenPool;
  pyramid: Pyramid;
  decks: Decks;
  royalDeck: Card[];         // available royal cards (max 4)
  privileges: number;        // scrolls on the table (0–3)
  players: [PlayerState, PlayerState];
  currentPlayer: PlayerId;
  phase: Phase;
  // Extra turns queued from Turn ability
  extraTurns: number;
  // Pending ability to resolve after a purchase
  pendingAbility: CardAbility | null;
  // The card just purchased (needed for Token/Bonus ability resolution)
  lastPurchasedCard: Card | null;
  winner: PlayerId | null;
  winCondition: WinCondition | null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'USE_PRIVILEGE'; tokens: Partial<Record<TokenColor, number>> }
  | { type: 'REPLENISH_BOARD' }
  | { type: 'TAKE_TOKENS'; indices: number[] }          // board cell indices (1–3, must be adjacent line)
  | { type: 'RESERVE_CARD'; source: 'pyramid_1' | 'pyramid_2' | 'pyramid_3' | 'deck_1' | 'deck_2' | 'deck_3' }
  | { type: 'RESERVE_CARD_FROM_PYRAMID'; cardId: number }
  | { type: 'PURCHASE_CARD'; cardId: number; goldUsage: Partial<Record<GemColor | 'pearl', number>> }
  | { type: 'PLACE_BONUS_CARD'; bonusCardId: number; targetCardId: number }
  | { type: 'TAKE_TOKEN_FROM_BOARD'; color: TokenColor }   // Token ability resolution
  | { type: 'TAKE_TOKEN_FROM_OPPONENT'; color: TokenColor } // Take ability resolution
  | { type: 'DISCARD_TOKENS'; tokens: Partial<Record<TokenColor, number>> }
  | { type: 'END_OPTIONAL_PHASE' };                        // skip optional actions
