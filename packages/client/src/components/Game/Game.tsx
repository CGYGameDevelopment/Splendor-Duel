import { useEffect, useMemo, useState } from 'react';
import type { Action, GemColor, TokenColor } from '@splendor-duel/game-engine';
import { TOKEN_COLORS } from '@splendor-duel/game-engine';
import type { GameSession } from '../../connection/useGameSession';
import { Board } from '../Board/Board';
import { Pyramid } from '../Pyramid/Pyramid';
import { PlayerArea } from '../PlayerArea/PlayerArea';
import { RoyalCards } from '../RoyalCards/RoyalCards';
import { TurnControls } from '../TurnControls/TurnControls';
import { WildAssignModal } from '../modals/WildAssignModal';
import { DiscardModal } from '../modals/DiscardModal';
import { RoyalChoiceModal } from '../modals/RoyalChoiceModal';
import { GameOver } from '../GameOver/GameOver';
import { useTokenSelection } from '../../selection/useTokenSelection';
import { buildLegalMovesIndex } from '../../actions/legalMovesIndex';
import styles from './Game.module.css';

export interface GameProps {
  session: GameSession;
}

export function Game({ session }: GameProps) {
  const { info, dispatch, undo, reset } = session;
  const state = info.state;

  const myPlayerId = info.playerId;
  const isMyTurn = state !== null && myPlayerId !== null && state.currentPlayer === myPlayerId;

  // Single legal-move computation per state — every component below reads this.
  const legal = useMemo(
    () => buildLegalMovesIndex(state, isMyTurn),
    [state, isMyTurn],
  );

  // Reset the token-pick selection only when the legal-move space actually
  // shifts (phase or active player change), not on every cosmetic STATE_UPDATE.
  const selectionResetKey = `${state?.phase ?? '-'}:${state?.currentPlayer ?? '-'}`;
  const tokenLines = isMyTurn && state?.phase === 'mandatory' ? legal.takeTokenLines : EMPTY_LINES;
  const tokenSelection = useTokenSelection(tokenLines, selectionResetKey);

  const [privilegeModeOn, setPrivilegeModeOn] = useState(false);

  // Reset privilege mode when phase changes away.
  useEffect(() => {
    if (state?.phase !== 'optional_privilege') setPrivilegeModeOn(false);
  }, [state?.phase]);

  // Auto-skip phases that have only no-op options. The 250ms delay gives the
  // user a moment to see the phase before it advances. If a STATE_UPDATE
  // arrives in that window, the effect's dependencies change and the cleanup
  // cancels the pending timer — so we never dispatch a stale skip action.
  useEffect(() => {
    if (!state || !isMyTurn) return;
    if (legal.all.length === 0) return;

    if (state.phase === 'optional_privilege' || state.phase === 'optional_replenish') {
      const onlySkips = legal.all.every(
        m => m.type === 'END_OPTIONAL_PHASE' || m.type === 'SKIP_TO_MANDATORY',
      );
      if (onlySkips && legal.endOptional) {
        const skip = legal.endOptional;
        const t = setTimeout(() => dispatch(skip), 250);
        return () => clearTimeout(t);
      }
    }

    if (state.phase === 'mandatory' && legal.all.length === 1 && legal.passMandatory) {
      const pass = legal.passMandatory;
      const t = setTimeout(() => dispatch(pass), 250);
      return () => clearTimeout(t);
    }
  }, [state, isMyTurn, legal, dispatch]);

  const cellInteraction = useMemo(() => {
    if (!state || !isMyTurn) return { clickable: new Set<number>(), dimmed: new Set<number>(), onClick: undefined };

    if (state.phase === 'mandatory') {
      const dimmed = new Set<number>();
      for (let i = 0; i < state.board.length; i++) {
        if (state.board[i] && !tokenSelection.highlightable.has(i)) dimmed.add(i);
      }
      return {
        clickable: tokenSelection.highlightable,
        dimmed,
        onClick: tokenSelection.onCellClick,
      };
    }

    if (state.phase === 'optional_privilege' && privilegeModeOn) {
      const click = new Set<number>(legal.privilegeByCell.keys());
      const dimmed = new Set<number>();
      for (let i = 0; i < state.board.length; i++) {
        if (state.board[i] && !click.has(i)) dimmed.add(i);
      }
      return {
        clickable: click,
        dimmed,
        onClick: (i: number) => {
          const move = legal.privilegeByCell.get(i);
          if (move) {
            dispatch(move);
            setPrivilegeModeOn(false);
          }
        },
      };
    }

    if (state.phase === 'resolve_ability' && state.pendingAbility === 'Token') {
      const click = new Set<number>(legal.takeBoardByCell.keys());
      const dimmed = new Set<number>();
      for (let i = 0; i < state.board.length; i++) {
        if (state.board[i] && !click.has(i)) dimmed.add(i);
      }
      return {
        clickable: click,
        dimmed,
        onClick: (i: number) => {
          const move = legal.takeBoardByCell.get(i);
          if (move) dispatch(move);
        },
      };
    }

    return { clickable: new Set<number>(), dimmed: new Set<number>(), onClick: undefined };
  }, [state, isMyTurn, tokenSelection, privilegeModeOn, legal, dispatch]);

  if (!state || myPlayerId === null) {
    return <div style={{ padding: 24 }}>Loading game state...</div>;
  }

  const opponentId = (1 - myPlayerId) as 0 | 1;
  const myName = info.playerName || 'You';
  const oppName = info.opponentName || 'Opponent';

  const onBuyCard = (cardId: number) => {
    const moves = legal.purchaseByCard.get(cardId);
    if (!moves || moves.length === 0) return;
    // goldUsageCombinations returns the unique minimal allocation; pick the first.
    // If the engine ever returns multiple, this picks one arbitrarily — a future
    // UI affordance could let the user choose the gold split.
    dispatch(moves[0]);
  };

  const onReservePyramidCard = (cardId: number) => {
    const m = legal.reservePyramidByCard.get(cardId);
    if (m) dispatch(m);
  };

  const onReserveDeckTop = (source: 'deck_1' | 'deck_2' | 'deck_3') => {
    const m = legal.reserveDeckBySource.get(source);
    if (m) dispatch(m);
  };

  const onConfirmTake = () => {
    if (tokenSelection.action) {
      dispatch(tokenSelection.action as Action);
      tokenSelection.clear();
    }
  };

  const onTakeOpponentToken = (color: TokenColor) => {
    const m = legal.takeOpponentByColor.get(color);
    if (m) dispatch(m);
  };

  const onAssignWild = (color: GemColor) => {
    const m = legal.assignWildByColor.get(color);
    if (m) dispatch(m);
  };

  const onDiscard = (color: TokenColor) => {
    const m = legal.discardByColor.get(color);
    if (m) dispatch(m);
  };

  const onChooseRoyal = (cardId: number) => {
    const m = legal.chooseRoyalById.get(cardId);
    if (m) dispatch(m);
  };

  const bagTotal = TOKEN_COLORS.reduce((s, c) => s + state.bag[c], 0);

  const showWildModal = isMyTurn && state.phase === 'assign_wild';
  const showDiscardModal = isMyTurn && state.phase === 'discard';
  const showRoyalModal = isMyTurn && state.phase === 'choose_royal';
  const showGameOver = state.phase === 'game_over';

  return (
    <div className={styles.gameRoot}>
      <div className={styles.topBar}>
        <h1>Splendor Duel</h1>
        <div className={styles.session}>
          Session <strong>{info.sessionId}</strong> · You are Player <strong>{myPlayerId}</strong>
        </div>
      </div>

      {showGameOver ? (
        <GameOver state={state} myPlayerId={myPlayerId} onPlayAgain={reset} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.left}>
            <PlayerArea
              state={state}
              legal={legal}
              playerIndex={opponentId}
              isViewer={false}
              isActive={state.currentPlayer === opponentId}
              name={oppName}
              isMyTurn={isMyTurn}
              onBuyReserved={() => { /* opponent's reserved are hidden */ }}
              onTakeOpponentToken={onTakeOpponentToken}
            />
            <PlayerArea
              state={state}
              legal={legal}
              playerIndex={myPlayerId}
              isViewer={true}
              isActive={state.currentPlayer === myPlayerId}
              name={myName}
              isMyTurn={isMyTurn}
              onBuyReserved={onBuyCard}
            />
          </div>

          <div className={styles.middle}>
            <Pyramid
              state={state}
              legal={legal}
              isMyTurn={isMyTurn}
              onBuyCard={onBuyCard}
              onReservePyramidCard={onReservePyramidCard}
              onReserveDeckTop={onReserveDeckTop}
            />
            <div className={styles.tableInfo}>
              <span>Table 📜<strong>{state.privileges}</strong></span>
              <span>Bag: <strong>{bagTotal}</strong> tokens</span>
            </div>
            <div className={styles.boardAndControls}>
              <Board
                board={state.board}
                selected={new Set(tokenSelection.selected)}
                clickable={cellInteraction.clickable}
                dimmed={cellInteraction.dimmed}
                onCellClick={cellInteraction.onClick}
              />
            </div>
            <TurnControls
              state={state}
              legal={legal}
              isMyTurn={isMyTurn}
              canUndo={info.canUndo}
              selectionLength={tokenSelection.selected.length}
              canConfirmTake={tokenSelection.canConfirm}
              errorMessage={info.errorMessage}
              onConfirmTake={onConfirmTake}
              onCancelTake={tokenSelection.clear}
              onUndo={undo}
              onDispatch={dispatch}
              privilegeModeOn={privilegeModeOn}
              togglePrivilegeMode={() => setPrivilegeModeOn(v => !v)}
            />
          </div>

          <div className={styles.right}>
            <RoyalCards state={state} />
          </div>
        </div>
      )}

      {showWildModal && <WildAssignModal legal={legal} onAssign={onAssignWild} />}
      {showDiscardModal && (
        <DiscardModal state={state} legal={legal} playerId={myPlayerId} onDiscard={onDiscard} />
      )}
      {showRoyalModal && <RoyalChoiceModal state={state} onChoose={onChooseRoyal} />}
    </div>
  );
}

const EMPTY_LINES: readonly Extract<Action, { type: 'TAKE_TOKENS' }>[] = [];
