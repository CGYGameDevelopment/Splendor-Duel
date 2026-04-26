import type { Card as CardType } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import { Card, CardBack, EmptyCardSlot } from '../Card/Card';
import type { LegalMovesIndex } from '../../actions/legalMovesIndex';
import styles from './Pyramid.module.css';

export interface PyramidProps {
  state: ClientGameState;
  legal: LegalMovesIndex;
  isMyTurn: boolean;
  onBuyCard: (cardId: number) => void;
  onReservePyramidCard: (cardId: number) => void;
  onReserveDeckTop: (source: 'deck_1' | 'deck_2' | 'deck_3') => void;
}

export function Pyramid({
  state,
  legal,
  isMyTurn,
  onBuyCard,
  onReservePyramidCard,
  onReserveDeckTop,
}: PyramidProps) {
  const renderRow = (level: 1 | 2 | 3, cards: CardType[]) => {
    const deckKey = `deck_${level}` as 'deck_1' | 'deck_2' | 'deck_3';
    const deckRemaining = state.decks[`level${level}` as 'level1' | 'level2' | 'level3'].length;
    const canReserveDeck = isMyTurn && legal.reserveDeckBySource.has(deckKey);

    return (
      <div className={styles.row} key={level}>
        <span className={styles.rowLabel}>L{level}</span>
        <div className={styles.cards}>
          {deckRemaining > 0 ? (
            <CardBack
              level={level}
              remaining={deckRemaining}
              canReserve={canReserveDeck}
              onReserve={canReserveDeck ? () => onReserveDeckTop(deckKey) : undefined}
            />
          ) : (
            <EmptyCardSlot />
          )}
          {cards.length === 0
            ? <EmptyCardSlot />
            : cards.map(card => {
                const canBuy = isMyTurn && (legal.purchaseByCard.get(card.id)?.length ?? 0) > 0;
                const canReserve = isMyTurn && legal.reservePyramidByCard.has(card.id);
                return (
                  <Card
                    key={card.id}
                    card={card}
                    canBuy={canBuy}
                    canReserve={canReserve}
                    onBuy={canBuy ? () => onBuyCard(card.id) : undefined}
                    onReserve={canReserve ? () => onReservePyramidCard(card.id) : undefined}
                  />
                );
              })}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.pyramid}>
      {renderRow(3, state.pyramid.level3)}
      {renderRow(2, state.pyramid.level2)}
      {renderRow(1, state.pyramid.level1)}
    </div>
  );
}
