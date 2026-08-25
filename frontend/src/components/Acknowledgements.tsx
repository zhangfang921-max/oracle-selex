/**
 * Third-party software credits.
 *
 * Displayed site-wide. Required by the licenses of the packages ORACLE builds on:
 * the ViennaRNA Package license requires that "proper credit is given to the authors
 * and the Institute for Theoretical Chemistry of the University of Vienna", and the
 * G4RNA screener components are distributed under GPL-3.0 by their original author.
 */

type Props = {
  /** Compact single-paragraph variant for the home-page footer. */
  compact?: boolean
}

const VIENNA_DOI = 'https://doi.org/10.1186/1748-7188-6-26'
const G4HUNTER_DOI = 'https://doi.org/10.1093/nar/gkw006'
const CGCC_DOI = 'https://doi.org/10.1093/nar/gkt904'
const G4RNA_DOI = 'https://doi.org/10.1093/bioinformatics/btx498'

export function Acknowledgements({ compact = false }: Props) {
  if (compact) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        RNA secondary structures are computed with the{' '}
        <strong className="font-medium">ViennaRNA Package</strong> (Lorenz et al.), developed at the
        Institute for Theoretical Chemistry, University of Vienna. G-quadruplex scores use{' '}
        <strong className="font-medium">G4Hunter</strong> (Bedrat et al.),{' '}
        <strong className="font-medium">cGcC</strong> (Beaudoin et al.), with optional{' '}
        <strong className="font-medium">G4NN</strong> from the model published with G4RNA screener
        (Garant et al., GPL-3.0).{' '}
        <a
          href="https://github.com/zhangfang921-max/oracle-selex/blob/main/THIRD_PARTY_LICENSES.md"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          Third-party licenses
        </a>
      </p>
    )
  }

  return (
    <section
      className="border-t border-border text-xs text-muted-foreground"
      style={{ marginTop: 'var(--spacing-xl)', paddingTop: 'var(--spacing-lg)' }}
    >
      <h2 className="font-semibold text-foreground" style={{ marginBottom: 'var(--spacing-sm)' }}>
        Acknowledgements
      </h2>

      <p className="leading-relaxed" style={{ marginBottom: 'var(--spacing-sm)' }}>
        <strong className="font-medium text-foreground">RNA secondary structure.</strong> Folding,
        minimum free energy and dot-bracket structures are computed with the{' '}
        <strong className="font-medium text-foreground">ViennaRNA Package</strong> (RNAlib Python
        bindings), developed by R. Lorenz, S. H. Bernhart, C. Höner zu Siederdissen, H. Tafer, C.
        Flamm, P. F. Stadler and I. L. Hofacker at the{' '}
        <strong className="font-medium text-foreground">
          Institute for Theoretical Chemistry, University of Vienna
        </strong>
        . Please cite: Lorenz R, Bernhart SH, Höner zu Siederdissen C, Tafer H, Flamm C, Stadler PF,
        Hofacker IL. ViennaRNA Package 2.0. <em>Algorithms Mol Biol</em>. 2011;6:26.{' '}
        <a href={VIENNA_DOI} target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
          doi:10.1186/1748-7188-6-26
        </a>
      </p>

      <p className="leading-relaxed" style={{ marginBottom: 'var(--spacing-sm)' }}>
        <strong className="font-medium text-foreground">G-quadruplex screening.</strong> G4 risk is
        scored with three published methods: <strong className="font-medium text-foreground">G4Hunter</strong>{' '}
        (Bedrat A, Lacroix L, Mergny JL. <em>Nucleic Acids Res</em>. 2016;44(4):1746–59.{' '}
        <a href={G4HUNTER_DOI} target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
          doi:10.1093/nar/gkw006
        </a>
        ), <strong className="font-medium text-foreground">cGcC</strong> (Beaudoin JD, Jodoin R,
        Perreault JP. <em>Nucleic Acids Res</em>. 2014;42(2):1209–23.{' '}
        <a href={CGCC_DOI} target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
          doi:10.1093/nar/gkt904
        </a>
        ). cGcC and G4Hunter are implemented independently from those papers. The optional{' '}
        <strong className="font-medium text-foreground">G4NN</strong> score uses the pre-trained
        artificial neural network published with{' '}
        <strong className="font-medium text-foreground">G4RNA screener</strong> by Jean-Michel Garant
        (Université de Sherbrooke), licensed GPL-3.0 and installed separately (Garant JM,
        Perreault JP, Scott MS.{' '}
        <em>Bioinformatics</em>. 2017;33(22):3532–7.{' '}
        <a href={G4RNA_DOI} target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
          doi:10.1093/bioinformatics/btx498
        </a>
        ).
      </p>

      <p className="leading-relaxed">
        Clustering, dimensionality reduction and figures are built on NumPy, SciPy, scikit-learn and
        matplotlib. Full license inventory:{' '}
        <a
          href="https://github.com/zhangfang921-max/oracle-selex/blob/main/THIRD_PARTY_LICENSES.md"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          THIRD_PARTY_LICENSES.md
        </a>
      </p>
    </section>
  )
}

export default Acknowledgements
