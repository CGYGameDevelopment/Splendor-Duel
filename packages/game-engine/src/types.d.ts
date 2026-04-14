export type GemColor = 'white' | 'blue' | 'green' | 'red' | 'black';
export type TokenColor = GemColor | 'pearl' | 'gold';
export type TokenPool = Record<TokenColor, number>;
export type CardAbility = 'Turn' | 'Token' | 'Take' | 'Privilege' | 'Wild' | 'Wild/Turn';
export type CardColor = GemColor | 'wild';
export type Cost = Partial<Record<TokenColor, number>>;
export interface Card {
    id: number;
    level: 1 | 2 | 3 | 'royal';
    color: CardColor | null;
    points: number;
    bonus: number;
    ability: CardAbility | null;
    crowns: number;
    cost: Cost;
    assignedColor: GemColor | null;
}
export type BoardCell = TokenColor | null;
export type Board = BoardCell[];
export interface Pyramid {
    level1: Card[];
    level2: Card[];
    level3: Card[];
}
export interface Decks {
    level1: Card[];
    level2: Card[];
    level3: Card[];
}
export type PlayerId = 0 | 1;
export interface PlayerState {
    tokens: TokenPool;
    purchasedCards: Card[];
    reservedCards: Card[];
    privileges: number;
    crowns: number;
    prestige: number;
    royalCards: Card[];
}
export type Phase = 'optional_privilege' | 'optional_replenish' | 'mandatory' | 'choose_royal' | 'resolve_ability' | 'assign_wild' | 'discard' | 'game_over';
export type WinCondition = 'prestige' | 'crowns' | 'color_prestige';
export interface GameState {
    board: Board;
    bag: TokenPool;
    pyramid: Pyramid;
    decks: Decks;
    royalDeck: Card[];
    privileges: number;
    players: [PlayerState, PlayerState];
    currentPlayer: PlayerId;
    phase: Phase;
    repeatTurn: boolean;
    pendingCrownCheck: boolean;
    pendingAbility: CardAbility | null;
    lastPurchasedCard: Card | null;
    winner: PlayerId | null;
    winCondition: WinCondition | null;
}
export type Action = {
    type: 'END_OPTIONAL_PHASE';
} | {
    type: 'SKIP_TO_MANDATORY';
} | {
    type: 'USE_PRIVILEGE';
    indices: number[];
} | {
    type: 'REPLENISH_BOARD';
} | {
    type: 'TAKE_TOKENS';
    indices: number[];
} | {
    type: 'RESERVE_CARD_FROM_PYRAMID';
    cardId: number;
} | {
    type: 'RESERVE_CARD';
    source: 'deck_1' | 'deck_2' | 'deck_3';
} | {
    type: 'PURCHASE_CARD';
    cardId: number;
    goldUsage: Partial<Record<GemColor | 'pearl', number>>;
} | {
    type: 'CHOOSE_ROYAL_CARD';
    cardId: number;
} | {
    type: 'TAKE_TOKEN_FROM_BOARD';
    index: number;
} | {
    type: 'TAKE_TOKEN_FROM_OPPONENT';
    color: TokenColor;
} | {
    type: 'ASSIGN_WILD_COLOR';
    wildCardId: number;
    color: GemColor;
} | {
    type: 'DISCARD_TOKENS';
    tokens: Partial<Record<TokenColor, number>>;
};
//# sourceMappingURL=types.d.ts.map