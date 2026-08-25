# ORACLE — Oligonucleotide Read Analysis & Candidate Library Explorer

**A free, web-based platform for analyzing high-throughput sequencing data from SELEX experiments.**

ORACLE (Oligonucleotide Read Analysis & Candidate Library Explorer) takes your NGS reads and returns clustered aptamer candidates with statistical validation, structural annotation, and publication-ready figures. Accessible at **[oracle.oligocluster.com](https://oracle.oligocluster.com)**.

## Features

- **Two clustering modes**: Auto-Optimal ML (k-mer features, auto-selects best algorithm & K) and Sequence Identity (Levenshtein edit distance)
- **Multi-algorithm evaluation**: KMeans, Hierarchical, GMM, Spectral, DBSCAN, HDBSCAN — optimal partition selected by silhouette/DB/CH criterion
- **Statistical validation**: Permutation testing (1000 iterations) for cluster significance
- **G4 screening**: G4Hunter and cGcC scoring with G4 risk classification (plus optional G4NN, see [scripts/fetch_g4nn_model.md](scripts/fetch_g4nn_model.md))
- **RNA structure**: ViennaRNA folding with MFE and dot-bracket structure prediction
- **Interactive visualization**: t-SNE, UMAP, PCA cluster maps, silhouette waterfall, force-directed network graph
- **Export**: Publication-quality PNG/SVG figures, CSV data tables

## Quick Start

1. Go to [oracle.oligocluster.com](https://oracle.oligocluster.com)
2. Click "New Analysis", enter a name
3. Upload your FASTA file (sequences with read counts in headers)
4. Choose **Auto-Optimal ML** (recommended for most users)
5. Click **Run Clustering**
6. Explore results across tabs and export figures

## Input Format

FASTA files. ORACLE parses read counts automatically from the last numeric value in each header (e.g., `>seq-1234` → count = 1234). Primer trimming and T→U conversion are handled automatically.

## Documentation

Full documentation with mode descriptions, result interpretation, and algorithm reference is available at the [User Guide](https://oracle.oligocluster.com/docs) on the platform.

## Citing

If you use ORACLE in your research, please cite:

> Zhang, F. et al. ORACLE: A web platform for SELEX NGS data analysis with automated aptamer clustering and structural annotation. *In preparation* (2026).

A Zenodo DOI will be available upon publication.

## Acknowledgements

ORACLE is built on work by other groups. Please cite the underlying methods alongside ORACLE.

**RNA secondary structure** is computed with the **ViennaRNA Package** (RNAlib Python bindings),
developed by R. Lorenz, S. H. Bernhart, C. Höner zu Siederdissen, H. Tafer, C. Flamm, P. F. Stadler
and I. L. Hofacker at the **Institute for Theoretical Chemistry, University of Vienna**. We gratefully
acknowledge the authors and the Institute.

> Lorenz R, Bernhart SH, Höner zu Siederdissen C, Tafer H, Flamm C, Stadler PF, Hofacker IL.
> ViennaRNA Package 2.0. *Algorithms for Molecular Biology* 6:26 (2011).
> [doi:10.1186/1748-7188-6-26](https://doi.org/10.1186/1748-7188-6-26)

**G-quadruplex screening** uses three published scoring methods:

> Bedrat A, Lacroix L, Mergny JL. Re-evaluation of G-quadruplex propensity with G4Hunter.
> *Nucleic Acids Research* 44(4):1746–1759 (2016). [doi:10.1093/nar/gkw006](https://doi.org/10.1093/nar/gkw006)

> Beaudoin JD, Jodoin R, Perreault JP. New scoring system to identify RNA G-quadruplex folding.
> *Nucleic Acids Research* 42(2):1209–1223 (2014). [doi:10.1093/nar/gkt904](https://doi.org/10.1093/nar/gkt904)

> Garant JM, Perreault JP, Scott MS. Motif independent identification of potential RNA
> G-quadruplexes by G4RNA screener. *Bioinformatics* 33(22):3532–3537 (2017).
> [doi:10.1093/bioinformatics/btx498](https://doi.org/10.1093/bioinformatics/btx498)

cGcC and G4Hunter are implemented independently from the papers above in `backend/g4_scorers.py`
(MIT). G4NN is **optional** and requires the pre-trained neural network published with
**G4RNA screener** by Jean-Michel Garant (Université de Sherbrooke), which is licensed **GPL-3.0** and
is therefore not distributed with ORACLE — install it yourself if you want G4NN scores
([scripts/fetch_g4nn_model.md](scripts/fetch_g4nn_model.md)). Without it, ORACLE reports
`g4NN: null` and classifies G4 risk from the cGcC and G4Hunter criteria.

## License

MIT License — see [LICENSE](LICENSE) for details.

All source code in this repository is MIT-licensed. ORACLE calls third-party software that it does
not redistribute (ViennaRNA, and the optional GPL-3.0 G4NN model); the full inventory and required
attributions are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Contact

Fang Zhang — fang9.zhang@polyu.edu.hk  
Department of Food Science and Nutrition, The Hong Kong Polytechnic University  
College of Biological Science and Engineering, Fuzhou University
