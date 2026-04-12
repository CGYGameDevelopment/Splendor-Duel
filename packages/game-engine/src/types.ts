// ─── Tokens ──────────────────────────────────────────────────────────────────

export type GemColor = 'black' | 'red' | 'green' | 'blue' | 'white';
export type TokenColor = GemColor | 'pearl' | 'gold';

export type TokenPool = Record<TokenColor, number>;

// ─── Cards ───────────────────────────────────────────────────────────────────

export type CardAbility = 'Turn' | 'Token' | 'Take' | 'Privilege' | 'Wild' | 'Wild/Turn';

export type CardColor = GemColor | 'wild';

export type Cost = Partial<Record<TokenColor, number>>;

export interface Card {
  id: number;
  level: 1 | 2 | 3 | 'royal';
  color: CardColor | null;
  points: number;
  bonus: number;           // number of bonus gems this card grants (usually 1, sometimes 2)
  ability: CardAbility | null;
  crowns: number;
  cost: Cost;
  // For Wild cards: the color permanently assigned after placement
  assignedColor: GemColor | null;
  // For Wild cards: the id of the card this is overlapping
  overlappingCardId: number | null;
}

// ─── Board ───────────────────────────────────────────────────────────────────

export type BoardCell = TokenColor | null;

// 25 cells indexed 0–24, spiral order from center
export type Board = BoardCell[];

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

// ─── Game State ──────────────────────────────────────────────────────────────

export type Phase =
  | 'optional_privilege'      // may use privileges
  | 'optional_replenish'      // may replenish board
  | 'mandatory'               // must take tokens | reserve | purchase
  | 'choose_royal'            // must choose a royal card after hitting a crown milestone
  | 'resolve_ability'         // resolving a card ability (Turn, Token, Take, etc.)
  | 'assign_wild'             // choosing which card a Wild card takes its color from
  | 'discard'                 // must discard down to 10 tokens
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
  // When true, endTurn repeats the current player's turn instead of switching
  repeatTurn: boolean;
  // Set when a crown milestone is crossed — player must choose a royal card after ability resolution
  pendingCrownCheck: boolean;
  // Pending ability to resolve after a purchase
  pendingAbility: CardAbility | null;
  // The card just purchased (needed for Token/Bonus ability resolution)
  lastPurchasedCard: Card | null;
  winner: PlayerId | null;
  winCondition: WinCondition | null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'END_OPTIONAL_PHASE' }                            // advance one optional phase
  | { type: 'SKIP_TO_MANDATORY' }                             // skip all remaining optional phases
  | { type: 'USE_PRIVILEGE'; indices: number[] }              // board cell indices (1 per privilege, non-gold)
  | { type: 'REPLENISH_BOARD' }
  | { type: 'TAKE_TOKENS'; indices: number[] }                // board cell indices (1–3, must be adjacent line)
  | { type: 'RESERVE_CARD_FROM_PYRAMID'; cardId: number }
  | { type: 'RESERVE_CARD'; source: 'deck_1' | 'deck_2' | 'deck_3' }
  | { type: 'PURCHASE_CARD'; cardId: number; goldUsage: Partial<Record<GemColor | 'pearl', number>>; wildColor?: GemColor }
  | { type: 'CHOOSE_ROYAL_CARD'; cardId: number }             // choose a royal card after crown milestone
  | { type: 'TAKE_TOKEN_FROM_BOARD'; index: number }          // Token ability resolution
  | { type: 'TAKE_TOKEN_FROM_OPPONENT'; color: TokenColor }   // Take ability resolution
  | { type: 'PLACE_WILD_CARD'; wildCardId: number; targetCardId: number }
  | { type: 'DISCARD_TOKENS'; tokens: Partial<Record<TokenColor, number>> };
