import type { TokenColor } from '@splendor-duel/game-engine';
import styles from './Gem.module.css';

/**
 * Faceted gem artwork, drawn as inline SVG.
 *
 * Splendor Duel's own token art is Space Cowboys' copyright, so this is
 * original geometry rather than a trace of theirs. Drawing it rather than
 * shipping bitmaps also happens to be the better engineering choice: the whole
 * set is a few kB instead of megabytes, it stays crisp at any zoom or device
 * pixel ratio, and every colour is a CSS custom property, so re-theming is a
 * variable change rather than a new export.
 *
 * Three silhouettes, so the token types stay distinguishable at 22px and in
 * greyscale — colour alone is not enough:
 *   gems   a round brilliant cut seen from above, with a table and crown facets
 *   pearl  a smooth sphere, no facets, with a soft secondary highlight
 *   gold   a struck coin with a raised rim and an embossed star
 */

export type GemSize = 'xs' | 'sm' | 'md' | 'lg';

export interface GemProps {
  color: TokenColor;
  size?: GemSize;
  /** Rendered into the SVG as a title for assistive technology. */
  label?: string;
}

// ─── Facet geometry ──────────────────────────────────────────────────────────

const CENTER = 50;
const CROWN_RADIUS = 39;
const TABLE_RADIUS = 20;
const FACET_COUNT = 8;

/** Light arrives from the upper left, which is where the highlight sits. */
const LIGHT_ANGLE_DEG = -125;

interface Point {
  x: number;
  y: number;
}

function ringPoint(radius: number, index: number): Point {
  const angle = ((-90 + index * (360 / FACET_COUNT)) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

function polygonPoints(points: Point[]): string {
  return points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

/**
 * Shading for the facet between ring positions `index` and `index + 1`.
 *
 * A facet tilted towards the light catches it; one tilted away falls into
 * shadow. Taking the cosine of the angle between the facet's outward normal and
 * the light direction gives a smooth falloff around the stone, which is what
 * makes it read as a solid object rather than a flat disc.
 */
function facetShading(index: number): { fill: string; opacity: number } {
  const facetAngle = -90 + (index + 0.5) * (360 / FACET_COUNT);
  const delta = ((facetAngle - LIGHT_ANGLE_DEG) * Math.PI) / 180;
  const alignment = Math.cos(delta);

  return alignment >= 0
    ? { fill: '#ffffff', opacity: 0.06 + alignment * 0.30 }
    : { fill: '#000000', opacity: 0.04 + -alignment * 0.34 };
}

const CROWN = Array.from({ length: FACET_COUNT }, (_, index) => ringPoint(CROWN_RADIUS, index));
const TABLE = Array.from({ length: FACET_COUNT }, (_, index) => ringPoint(TABLE_RADIUS, index));

/** The trapezoid facets ringing the table, with their shading precomputed. */
const CROWN_FACETS = Array.from({ length: FACET_COUNT }, (_, index) => {
  const next = (index + 1) % FACET_COUNT;
  return {
    points: polygonPoints([CROWN[index], CROWN[next], TABLE[next], TABLE[index]]),
    ...facetShading(index),
  };
});

const TABLE_POINTS = polygonPoints(TABLE);
const CROWN_POINTS = polygonPoints(CROWN);

// ─── Component ───────────────────────────────────────────────────────────────

function FacetedGem({ color }: { color: TokenColor }) {
  return (
    <>
      {/* Body: the stone's own colour, darkening towards the lower right. */}
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.body} />
      {/* Girdle: the bright rim where the light wraps around the edge. */}
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.girdle} />

      <polygon points={CROWN_POINTS} className={styles.crown} />

      {CROWN_FACETS.map((facet, index) => (
        <polygon
          key={index}
          points={facet.points}
          fill={facet.fill}
          opacity={facet.opacity}
        />
      ))}

      {/* Table: the flat top, catching the most light. */}
      <polygon points={TABLE_POINTS} className={styles.table} />
      <polygon points={TABLE_POINTS} className={styles.tableSheen} />

      {/* Specular glint, offset towards the light. */}
      <ellipse cx={34} cy={30} rx={11} ry={7} className={styles.glint} transform="rotate(-35 34 30)" />
      {color === 'black' && (
        // Black gems lose their facets against a dark table without this.
        <circle cx={CENTER} cy={CENTER} r={46} className={styles.darkRescue} />
      )}
    </>
  );
}

function Pearl() {
  return (
    <>
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.pearlBody} />
      {/* Iridescence: two broad, low-opacity washes rather than facets. */}
      <ellipse cx={62} cy={64} rx={30} ry={24} className={styles.pearlWashA} />
      <ellipse cx={38} cy={62} rx={24} ry={20} className={styles.pearlWashB} />
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.pearlRim} />
      <ellipse cx={35} cy={31} rx={13} ry={9} className={styles.pearlGlint} transform="rotate(-30 35 31)" />
      {/* The faint second highlight is what separates a pearl from a plain ball. */}
      <ellipse cx={64} cy={70} rx={9} ry={5} className={styles.pearlGlintLow} />
    </>
  );
}

const STAR_POINTS = (() => {
  const points: Point[] = [];
  for (let index = 0; index < 10; index++) {
    const radius = index % 2 === 0 ? 21 : 9;
    const angle = ((-90 + index * 36) * Math.PI) / 180;
    points.push({ x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) });
  }
  return polygonPoints(points);
})();

function GoldCoin() {
  return (
    <>
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.coinBody} />
      <circle cx={CENTER} cy={CENTER} r={46} className={styles.coinRim} />
      {/* Inner step, which is what makes the rim look raised rather than drawn. */}
      <circle cx={CENTER} cy={CENTER} r={35} className={styles.coinInnerRim} />
      <circle cx={CENTER} cy={CENTER} r={33} className={styles.coinField} />
      {/* The star is embossed: a dark offset copy under a lit one. */}
      <polygon points={STAR_POINTS} className={styles.coinStarShadow} transform="translate(1.5 2)" />
      <polygon points={STAR_POINTS} className={styles.coinStar} />
      <ellipse cx={34} cy={30} rx={14} ry={8} className={styles.coinGlint} transform="rotate(-35 34 30)" />
    </>
  );
}

export function Gem({ color, size = 'md', label }: GemProps) {
  const className = [styles.gem, styles[`size-${size}`], styles[color]].join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={label ? 'img' : 'presentation'}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {color === 'pearl' ? <Pearl /> : color === 'gold' ? <GoldCoin /> : <FacetedGem color={color} />}
    </svg>
  );
}
