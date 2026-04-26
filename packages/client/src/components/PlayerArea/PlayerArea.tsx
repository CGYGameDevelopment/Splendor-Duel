import type { Card as CardType, GemColor, TokenColor } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import { TOKEN_COLORS } from '@splendor-duel/game-engine';
import { Token } from '../Token/Token';
import { Card } from '../Card/Card';
import type { LegalMovesIndex } from '../../actions/legalMovesIndex';
import styles from './PlayerArea.module.css';

export interface PlayerAreaProps {
  state: ClientGameState;
  legal: LegalMovesIndex;
  playerIndex: 0 | 1;
  isViewer: boolean;
  isActive: boolean;
  name: string;
  isMyTurn: boolean;
  onBuyReserved: (cardId: number) => void;
  onTakeOpponentToken?: (color: TokenColor) => void;  // active during resolve_ability/Take
}

export function PlayerArea({
  state,
  legal,
  playerIndex,
  isViewer,
  isActive,
  name,
  isMyTurn,
  onBuyReserved,
  onTakeOpponentToken,
}: PlayerAreaProps) {
  const player = state.players[playerIndex];

  const bonusByColor: Partial<Record<GemColor, number>> = {};
  for (const card of player.purchasedCards) {
    const c = (card.assignedColor ?? card.color) as GemColor | null;
    if (c !== null) bonusByColor[c] = (bonusByColor[c] ?? 0) + card.bonus;
  }

  const takeMode =
    !isViewer &&
    isMyTurn &&
    state.phase === 'resolve_ability' &&
    state.pendingAbility === 'Take';

  return (
    <div className={`${styles.player} ${isActive ? styles.active : ''}`}>
      <div className={styles.header}>
        <div className={styles.name}>
          {name}
          {isViewer && <span className={styles.youBadge}>YOU</span>}
        </div>
        {isActive && <span className={styles.turnTag}>TURN</span>}
      </div>
      <div className={styles.stats}>
        <span className={styles.stat}>⭐<strong>{player.prestige}</strong></span>
        <span className={styles.stat}>👑<strong>{player.crowns}</strong></span>
        <span className={styles.stat}>📜<strong>{player.privileges}</strong></span>
        <span className={styles.stat}>cards<strong>{player.purchasedCards.length}</strong></span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Tokens</div>
        <div className={styles.tokens}>
          {TOKEN_COLORS.map(c => {
            const n = player.tokens[c] ?? 0;
            if (n === 0) return null;
            const clickable =
              takeMode &&
              !!onTakeOpponentToken &&
              c !== 'gold' &&
              legal.takeOpponentByColor.has(c);
            return (
              <span key={c} className={styles.tokenWrap}>
                <Token
                  color={c}
                  size="md"
                  onClick={clickable ? () => onTakeOpponentToken!(c) : undefined}
                  title={clickable ? `Take ${c} from opponent` : undefined}
                />
                <span className={styles.tokenCount}>{n}</span>
              </span>
            );
          })}
          {TOKEN_COLORS.every(c => (player.tokens[c] ?? 0) === 0) && (
            <span className={styles.hidden}>(none)</span>
          )}
        </div>
      </div>

      {Object.keys(bonusByColor).length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Gem bonuses</div>
          <div className={styles.gemSummary}>
            {(Object.entries(bonusByColor) as [GemColor, number][]).map(([c, n]) => (
              <span key={c} className={styles.tokenWrap}>
                <Token color={c as TokenColor} size="md" />
                <span className={styles.tokenCount}>{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Reserved</div>
        <div className={styles.reserved}>
          {isViewer ? (
            player.reservedCards.length === 0
              ? <span className={styles.hidden}>(none)</span>
              : player.reservedCards.map((card: CardType) => {
                  const canBuy = isMyTurn && (legal.purchaseByCard.get(card.id)?.length ?? 0) > 0;
                  return (
                    <Card
                      key={card.id}
                      card={card}
                      size="sm"
                      canBuy={canBuy}
                      onBuy={canBuy ? () => onBuyReserved(card.id) : undefined}
                    />
                  );
                })
          ) : (
            <span className={styles.hidden}>{player.reservedCardCount} hidden</span>
          )}
        </div>
      </div>

      {player.royalCards.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Royals</div>
          <div className={styles.royals}>
            {player.royalCards.map(card => (
              <Card key={card.id} card={card} size="sm" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
