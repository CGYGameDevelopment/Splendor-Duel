import { useState } from 'react';
import type { GameSession } from '../../connection/useGameSession';
import styles from './Lobby.module.css';

const DEFAULT_SERVER = 'ws://localhost:3001';

export interface LobbyProps {
  session: GameSession;
}

export function Lobby({ session }: LobbyProps) {
  const [name, setName] = useState('');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [joinId, setJoinId] = useState('');

  const { info, connectAndCreate, connectAndJoin } = session;

  const handleCreate = () => {
    if (!name.trim()) return;
    connectAndCreate(server.trim() || DEFAULT_SERVER, name.trim());
  };

  const handleJoin = () => {
    if (!name.trim() || !joinId.trim()) return;
    connectAndJoin(server.trim() || DEFAULT_SERVER, name.trim(), joinId.trim());
  };

  return (
    <div className={styles.lobby}>
      <div className={styles.card}>
        <h1 className={styles.title}>Splendor Duel</h1>
        <div className={styles.subtitle}>
          Multiplayer or play vs the trained AI bot
        </div>

        <div className={styles.field}>
          <label>Your name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Player"
            maxLength={50}
          />
        </div>
        <div className={styles.field}>
          <label>Server URL</label>
          <input
            type="text"
            value={server}
            onChange={e => setServer(e.target.value)}
          />
        </div>

        {info.status === 'waiting_for_opponent' && info.sessionId ? (
          <>
            <div className={styles.status}>Waiting for opponent to join...</div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 4 }}>
                SESSION ID — share with your opponent
              </div>
              <div className={styles.sessionId}>{info.sessionId}</div>
            </div>
          </>
        ) : (
          <>
            <div className={styles.actions}>
              <button
                className="primary"
                onClick={handleCreate}
                disabled={!name.trim() || info.status === 'connecting'}
              >
                Create new game
              </button>
            </div>
            <div className={styles.divider} />
            <div className={styles.field}>
              <label>Join existing session</label>
              <div className={styles.joinRow}>
                <input
                  type="text"
                  value={joinId}
                  onChange={e => setJoinId(e.target.value)}
                  placeholder="4-digit session ID"
                  maxLength={4}
                />
                <button
                  onClick={handleJoin}
                  disabled={!name.trim() || !joinId.trim() || info.status === 'connecting'}
                >
                  Join
                </button>
              </div>
            </div>
            <div className={styles.aiHint}>
              <strong>Vs AI:</strong> in another terminal, run{' '}
              <code>play-vs-ai checkpoints/best.pt</code>. The bot prints a session ID — paste it above and click Join.
            </div>
          </>
        )}

        {info.errorMessage && (
          <div className={styles.error}>{info.errorMessage}</div>
        )}
        {info.status === 'connecting' && (
          <div className={styles.status}>Connecting...</div>
        )}
        {info.status === 'opponent_disconnected' && (
          <div className={styles.error}>Opponent disconnected.</div>
        )}
      </div>
    </div>
  );
}
