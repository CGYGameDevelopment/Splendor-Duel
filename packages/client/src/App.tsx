import { useGameSession } from './connection/useGameSession';
import { Lobby } from './components/Lobby/Lobby';
import { Game } from './components/Game/Game';

export default function App() {
  const session = useGameSession();
  const { status } = session.info;

  // Show the game once a session is in progress, has finished, or the opponent disconnected
  // mid-game (so the user can see the final state). Otherwise stay in the lobby.
  const inGame =
    status === 'in_game' ||
    status === 'game_over' ||
    (status === 'opponent_disconnected' && session.info.state !== null);

  return inGame ? <Game session={session} /> : <Lobby session={session} />;
}
