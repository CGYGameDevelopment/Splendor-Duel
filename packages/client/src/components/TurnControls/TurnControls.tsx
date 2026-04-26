import type { Action } from '@splendor-duel/game-engine';
import type { ClientGameState } from '@splendor-duel/protocol';
import type { LegalMovesIndex } from '../../actions/legalMovesIndex';
import styles from './TurnControls.module.css';

const PHASE_LABEL: Record<string, string> = {
  optional_privilege: 'Optional: use a privilege',
  optional_replenish: 'Optional: replenish board',
  mandatory: 'Pick an action',
  resolve_ability: 'Resolve ability',
  assign_wild: 'Assign wild color',
  discard: 'Discard down to 10',
  choose_royal: 'Choose a royal card',
  game_over: 'Game over',
};

export interface TurnControlsProps {
  state: ClientGameState;
  legal: LegalMovesIndex;
  isMyTurn: boolean;
  canUndo: boolean;
  /** Indices currently picked by the user as a TAKE_TOKENS line. */
  selectionLength: number;
  /** True if the current selection is a legal TAKE_TOKENS line. */
  canConfirmTake: boolean;
  errorMessage: string | null;
  onConfirmTake: () => void;
  onCancelTake: () => void;
  onUndo: () => void;
  onDispatch: (a: Action) => void;
  /** Toggle a "Use privilege" mode in which clicks on board cells dispatch USE_PRIVILEGE for that cell. */
  privilegeModeOn: boolean;
  togglePrivilegeMode: () => void;
}

export function TurnControls({
  state,
  legal,
  isMyTurn,
  canUndo,
  selectionLength,
  canConfirmTake,
  errorMessage,
  onConfirmTake,
  onCancelTake,
  onUndo,
  onDispatch,
  privilegeModeOn,
  togglePrivilegeMode,
}: TurnControlsProps) {
  if (!isMyTurn) {
    return (
      <div className={styles.controls}>
        <div className={styles.phaseLine}>
          Phase:<strong>{PHASE_LABEL[state.phase] ?? state.phase}</strong>
        </div>
        <div className={styles.hint}>Waiting for opponent...</div>
      </div>
    );
  }

  const skip = legal.endOptional;
  const skipAll = legal.skipToMandatory;
  const replenish = legal.replenish;

  return (
    <div className={styles.controls}>
      <div className={styles.phaseLine}>
        Phase:<strong>{PHASE_LABEL[state.phase] ?? state.phase}</strong>
        {state.pendingAbility && <> · ability: <strong>{state.pendingAbility}</strong></>}
      </div>

      {errorMessage && <div className={styles.error}>{errorMessage}</div>}

      {state.phase === 'mandatory' && (
        <div className={styles.row}>
          <span className={styles.hint}>
            {selectionLength === 0
              ? 'Click gems on the board to take a line of 1–3, or click a card to buy/reserve.'
              : `Selected ${selectionLength} gem${selectionLength === 1 ? '' : 's'}.`}
          </span>
          {selectionLength > 0 && (
            <>
              <button
                className="primary"
                disabled={!canConfirmTake}
                onClick={onConfirmTake}
              >
                Take ({selectionLength})
              </button>
              <button onClick={onCancelTake}>Cancel</button>
            </>
          )}
        </div>
      )}

      {state.phase === 'optional_privilege' && (
        <div className={styles.row}>
          {legal.hasPrivilege ? (
            <>
              <button
                className={privilegeModeOn ? 'primary' : ''}
                onClick={togglePrivilegeMode}
              >
                {privilegeModeOn ? 'Picking gem...' : 'Use privilege'}
              </button>
              <span className={styles.hint}>
                {privilegeModeOn ? 'Click a gem on the board to claim it.' : null}
              </span>
            </>
          ) : (
            <span className={styles.hint}>No privileges available.</span>
          )}
          {skip && <button onClick={() => onDispatch(skip)}>Skip</button>}
          {skipAll && <button onClick={() => onDispatch(skipAll)}>Skip all optional</button>}
        </div>
      )}

      {state.phase === 'optional_replenish' && (
        <div className={styles.row}>
          {replenish && (
            <button onClick={() => onDispatch(replenish)}>Replenish board</button>
          )}
          {skip && <button onClick={() => onDispatch(skip)}>Skip</button>}
          {skipAll && <button onClick={() => onDispatch(skipAll)}>Skip all optional</button>}
        </div>
      )}

      {state.phase === 'resolve_ability' && state.pendingAbility === 'Token' && (
        <div className={styles.hint}>
          Click a matching gem on the board to take it.
        </div>
      )}

      {state.phase === 'resolve_ability' && state.pendingAbility === 'Take' && (
        <div className={styles.hint}>
          Click a token from your opponent's pool to take it.
        </div>
      )}

      <div className={styles.row}>
        <button disabled={!canUndo} onClick={onUndo} title="Rewind to the start of your turn">
          ↶ Undo turn
        </button>
      </div>
    </div>
  );
}
