# ORACLE — Oligonucleotide Read Analysis & Candidate Library Explorer

**A free, web-based platform for analyzing high-throughput sequencing data from SELEX experiments.**

ORACLE (Oligonucleotide Read Analysis & Candidate Library Explorer) takes your NGS reads and returns clustered aptamer candidates with statistical validation, structural annotation, and publication-ready figures. Accessible at **[oracle.oligocluster.com](https://oracle.oligocluster.com)**.

## Features

- **Two clustering modes**: Auto-Optimal ML (k-mer features, auto-selects best algorithm & K) and Sequence Identity (Levenshtein edit distance)
- **Multi-algorithm evaluation**: KMeans, Hierarchical, GMM, Spectral, DBSCAN, HDBSCAN — optimal partition selected by silhouette/DB/CH criterion
- **Statistical validation**: Permutation testing (1,000 iterations, p < 0.05) for cluster significance (see [Analysis notes](#analysis-notes))
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

## Analysis notes

**Clustering methods and criterion.** Auto-Optimal ML screens five clustering methods across four
algorithmic families (agglomerative hierarchical with average- and Ward-linkage variants, k-means,
Gaussian mixture models, and spectral clustering) and selects the optimal partition by maximizing
the silhouette score. The Structure Profile mode additionally includes density-based clustering
(HDBSCAN) and defaults to the Davies-Bouldin criterion. Because SELEX sequence space is continuous
(aptamer families form gradients of related variants rather than discrete, well-separated groups),
the internal silhouette/Davies-Bouldin scores are used only to rank candidate partitions; cluster
significance is confirmed by permutation testing, which serves as the definitive statistical
criterion.

**Permutation iterations and large-input guardrails.** Permutation tests run 1,000 iterations by
default. To stay within server time limits on large inputs, ORACLE applies guardrails: above 2,000
sequences the permutation test is capped at 200 iterations, above 1,500 sequences spectral
clustering is skipped (O(n³) time), and above 2,500 sequences hierarchical (average-linkage)
clustering is skipped (O(n²) memory). The analyses in the associated publication used 500 sequences
per round, so all defaults apply (1,000 permutations, all algorithms evaluated).

**ViennaRNA version.** The RNAfold microservice reports ViennaRNA 2.7.2 at `GET /health`. The
citation to "ViennaRNA Package 2.0" in the Acknowledgements refers to the 2011 Lorenz et al.
publication title, not the installed software version; G-quadruplex folding (the `gquad` model
detail) requires ViennaRNA ≥ 2.1.

## Citing

If you use ORACLE in your research, please cite:

> Zhang, F. et al. ORACLE: A web platform for SELEX NGS data analysis with automated aptamer clustering and structural annotation. *In preparation* (2026).

A Zenodo DOI will be available upon publication.

## Deployment notes

ORACLE runs a Node/TypeScript backend that spawns three Python microservices:
`rnafold_service.py` (3001), `g4_service.py` (3002) and `tsne_service.py` (3003).

**The G4NN model is not in this repository.** It is GPL-3.0 and git-ignored (see
[scripts/fetch_g4nn_model.md](scripts/fetch_g4nn_model.md)), so a fresh clone or a
`git clean -xdf` will drop it and every sequence will then report `g4NN: null`. Two safeguards:

- On startup the backend queries `http://localhost:3002/health` and prints a loud warning when
  `model_loaded` is false.
- Check any time with `curl -s http://localhost:3002/health`.

A backup copy of the model, together with a deployment and licensing memo, is kept outside the
repository at:

```
OneDrive/研究组管理/_知识库/02_科研项目/ORACLE_SELEX平台_CityU合作/05_部署与许可/
```

After changing anything under `backend/src/`, rebuild before restarting so the compiled
`dist/index.js` picks up the new microservice paths:

```bash
cd backend && pnpm build
```

## Acknowledgements

ORACLE is built on work by other groups. Please cite the underlying methods alongside ORACLE.

ORACLE was developed at the Department of Food Science and Nutrition, The Hong Kong Polytechnic
University, in collaboration with Prof. Chun Kit Kwok, Department of Chemistry, City University of
Hong Kong. See the associated publication for author contributions.

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
