import type { TokenColor } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import {
  GEM_COLORS,
  TOKEN_COLORS,
  MAX_TOKENS,
  PRESTIGE_WIN,
  CROWNS_WIN,
  COLOR_PRESTIGE_WIN,
  playerBonuses,
  prestigeByColor,
  totalTokens,
} from '@splendor-duel/game-engine';
import { Token } from '../Token/Token';
import { Card } from '../Card/Card';
import { RoyalCard } from '../RoyalCards/RoyalCards';
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

const isGemColor = (c: TokenColor): c is (typeof GEM_COLORS)[number] =>
  (GEM_COLORS as TokenColor[]).includes(c);

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
  const bonuses = playerBonuses(player);
  const colorPrestige = prestigeByColor(player);
  const tokenTotal = totalTokens(player.tokens);

  const takeMode =
    !isViewer &&
    isMyTurn &&
    state.phase === 'resolve_ability' &&
    state.pendingAbility === 'Take';

  return (
    <div className={`surface ${styles.player} ${isActive ? styles.active : ''}`}>
      <div className={styles.header}>
        <span className={styles.name}>{name}</span>
        {isViewer && <span className={styles.youBadge}>You</span>}
        {isActive && <span className={styles.turnTag}>To move</span>}
      </div>

      <div className={styles.stats}>
        <Stat label="Prestige" value={player.prestige} goal={PRESTIGE_WIN} />
        <Stat label="Crowns" value={player.crowns} goal={CROWNS_WIN} />
        <Stat label="Tokens" value={tokenTotal} goal={MAX_TOKENS} />
        <Stat label="Privileges" value={player.privileges} />
      </div>

      {/*
        One column per colour, so tokens, card bonuses and colour prestige for
        the same gem line up and the columns never shift as counts change.
      */}
      <div className={styles.gemGrid}>
        <span className={styles.rowLabel}>Tokens</span>
        {TOKEN_COLORS.map(c => {
          const n = player.tokens[c];
          const clickable =
            takeMode && !!onTakeOpponentToken && n > 0 && legal.takeOpponentByColor.has(c);
          return (
            <span key={c} className={`${styles.cell} ${n === 0 ? styles.zero : ''}`}>
              <Token
                color={c}
                size="sm"
                onClick={clickable ? () => onTakeOpponentToken(c) : undefined}
                title={clickable ? `Take ${c} from opponent` : undefined}
              />
              <span className={styles.count}>{n}</span>
            </span>
          );
        })}

        <span className={styles.rowLabel}>Bonus</span>
        {TOKEN_COLORS.map(c => (
          <span key={c} className={styles.cell}>
            {isGemColor(c) && (
              <span className={`${styles.bonus} ${styles[`bonus-${c}`]} ${bonuses[c] === 0 ? styles.zero : ''}`}>
                {bonuses[c]}
              </span>
            )}
          </span>
        ))}

        <span className={styles.rowLabel} title={`${COLOR_PRESTIGE_WIN} prestige in one colour wins`}>
          Points
        </span>
        {TOKEN_COLORS.map(c => (
          <span key={c} className={styles.cell}>
            {isGemColor(c) && (
              <span className={`${styles.colorPoints} ${colorPrestige[c] === 0 ? styles.zero : ''}`}>
                {colorPrestige[c]}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Reserved</div>
        <div className={styles.reserved}>
          {player.reservedCardCount === 0 && <span className={styles.none}>None</span>}
          {isViewer
            ? player.reservedCards.map(card => {
                const canBuy = isMyTurn && (legal.purchaseByCard.get(card.id)?.length ?? 0) > 0;
                return (
                  <Card
                    key={card.id}
                    card={card}
                    canBuy={canBuy}
                    onBuy={canBuy ? () => onBuyReserved(card.id) : undefined}
                  />
                );
              })
            : Array.from({ length: player.reservedCardCount }).map((_, i) => (
                <span key={i} className={styles.hiddenCard} title="Face-down reserved card" />
              ))}
        </div>
      </div>

      {player.royalCards.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Royals</div>
          <div className={styles.royals}>
            {player.royalCards.map(card => (
              <RoyalCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, goal }: { label: string; value: number; goal?: number }) {
  return (
    <span className={styles.stat}>
      <span className={styles.statValue}>
        {value}
        {goal !== undefined && <span className={styles.statGoal}>/{goal}</span>}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </span>
  );
}
