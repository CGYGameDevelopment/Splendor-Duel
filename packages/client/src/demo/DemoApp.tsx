import { useDemoSession } from './demoSession';
import { Game } from '../components/Game/Game';

/**
 * Dev-only wrapper that renders the real Game against a fabricated session.
 *
 * Reachable at `?demo=1`, with `&seed=` and `&steps=` to move to a different
 * position — useful for checking a phase the default seed does not land in.
 */
export default function DemoApp() {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed')) || undefined;
  const steps = params.get('steps') !== null ? Number(params.get('steps')) : undefined;
  const viewer = params.get('viewer') === '1' ? 1 : 0;

  const session = useDemoSession({ seed, steps, viewer });
  return <Game session={session} />;
}
