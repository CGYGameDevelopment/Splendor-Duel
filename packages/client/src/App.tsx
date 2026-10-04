import { lazy, Suspense } from 'react';
import { useGameSession } from './connection/useGameSession';
import { Lobby } from './components/Lobby/Lobby';
import { Game } from './components/Game/Game';

// Dev-only visual harness: renders the real Game against a seeded mid-game
// position with no server.
//
// The ternary is what keeps it out of the production bundle. `import.meta.env.DEV`
// is substituted at build time, so in a production build this whole branch is
// statically `null` and the dynamic import is eliminated — guarding only at the
// call site still emitted the chunk.
const DemoApp = import.meta.env.DEV ? lazy(() => import('./demo/DemoApp')) : null;

function wantsDemo(): boolean {
  return new URLSearchParams(window.location.search).has('demo');
}

export default function App() {
  const session = useGameSession();
  const { status } = session.info;

  // Show the game once a session is in progress, has finished, or the opponent disconnected
  // mid-game (so the user can see the final state). Otherwise stay in the lobby.
  const inGame =
    status === 'in_game' ||
    status === 'game_over' ||
    (status === 'opponent_disconnected' && session.info.state !== null);

  if (DemoApp && wantsDemo()) {
    return (
      <Suspense fallback={null}>
        <DemoApp />
      </Suspense>
    );
  }

  return inGame ? <Game session={session} /> : <Lobby session={session} />;
}
