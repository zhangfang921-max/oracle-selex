/**
 * OracleMark — the site's own identity mark.
 *
 * Original artwork produced for this project. It deliberately contains no
 * third-party assets, no institutional crests, and no font glyphs, so it carries
 * no licensing or trademark obligations of its own.
 *
 * Reading of the mark:
 *   four outer arcs  → diversity of the starting library / the four bases / a G4 tetrad
 *   one bright arc   → the lineage that survives SELEX enrichment
 *   solid centre dot → the converged candidate
 * The silhouette reads as the letter O.
 *
 * Geometry comes from scripts/logo_geom.py (R=21, four 76° arcs, 14° gaps placed on
 * the diagonals) and is kept identical to public/oracle-mark.svg so the favicon and
 * the in-app mark cannot drift apart.
 *
 * Colour follows `currentColor`, so the mark inherits its surrounding text colour —
 * white on the dark hero, primary indigo in page headers.
 */
export function OracleMark({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <g stroke="currentColor" strokeWidth={8} fill="none">
        <path d="M 48.548 19.071 A 21 21 0 0 1 48.548 44.929" strokeOpacity={0.55} />
        <path d="M 44.929 48.548 A 21 21 0 0 1 19.071 48.548" strokeOpacity={0.55} />
        <path d="M 15.452 44.929 A 21 21 0 0 1 15.452 19.071" strokeOpacity={0.55} />
        <path d="M 19.071 15.452 A 21 21 0 0 1 44.929 15.452" />
      </g>
      <circle cx={32} cy={32} r={6.5} fill="currentColor" />
    </svg>
  );
}

/**
 * OracleWordmark — mark plus the ORACLE lettering.
 *
 * The lettering is real text styled with CSS rather than converted outlines. That
 * keeps it accessible and searchable, and it means no font file is embedded or
 * redistributed, which sidesteps font-licensing questions entirely.
 */
export function OracleWordmark({
  markClassName = "w-6 h-6",
  className = "",
  subtitle,
}: {
  markClassName?: string;
  className?: string;
  subtitle?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <OracleMark className={markClassName} />
      <span className="inline-flex flex-col leading-none">
        <span
          className="font-bold uppercase"
          style={{ letterSpacing: "0.2em", fontSize: "var(--font-size-small)" }}
        >
          ORACLE
        </span>
        {subtitle ? (
          <span
            className="opacity-60 uppercase"
            style={{ letterSpacing: "0.08em", fontSize: "0.625rem", marginTop: "2px" }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
