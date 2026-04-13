export type GemColor = 'white' | 'blue' | 'green' | 'red' | 'black';
export type TokenColor = GemColor | 'pearl' | 'gold';
export type TokenPool = Record<TokenColor, number>;
export type CardAbility = 'Turn' | 'Token' | 'Take' | 'Privilege' | 'Bonus' | 'Bonus/Turn';
export type CardColor = GemColor | 'joker' | 'points';
export type Cost = Partial<Record<TokenColor, number>>;
export interface Card {
    id: number;
    level: 1 | 2 | 3 | 'royal';
    color: CardColor;
    points: number;
    bonus: number;
    ability: CardAbility | null;
    crowns: number;
    cost: Cost;
    assignedColor: GemColor | null;
    overlappingCardId: number | null;
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
export type Phase = 'optional_privilege' | 'optional_replenish' | 'mandatory' | 'discard' | 'resolve_ability' | 'place_bonus' | 'game_over';
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
    extraTurns: number;
    pendingAbility: CardAbility | null;
    lastPurchasedCard: Card | null;
    winner: PlayerId | null;
    winCondition: WinCondition | null;
}
export type Action = {
    type: 'USE_PRIVILEGE';
    tokens: Partial<Record<TokenColor, number>>;
} | {
    type: 'REPLENISH_BOARD';
} | {
    type: 'TAKE_TOKENS';
    indices: number[];
} | {
    type: 'RESERVE_CARD';
    source: 'pyramid_1' | 'pyramid_2' | 'pyramid_3' | 'deck_1' | 'deck_2' | 'deck_3';
} | {
    type: 'RESERVE_CARD_FROM_PYRAMID';
    cardId: number;
} | {
    type: 'PURCHASE_CARD';
    cardId: number;
    goldUsage: Partial<Record<GemColor | 'pearl', number>>;
} | {
    type: 'PLACE_BONUS_CARD';
    bonusCardId: number;
    targetCardId: number;
} | {
    type: 'TAKE_TOKEN_FROM_BOARD';
    color: TokenColor;
} | {
    type: 'TAKE_TOKEN_FROM_OPPONENT';
    color: TokenColor;
} | {
    type: 'DISCARD_TOKENS';
    tokens: Partial<Record<TokenColor, number>>;
} | {
    type: 'END_OPTIONAL_PHASE';
};
//# sourceMappingURL=types.d.ts.map