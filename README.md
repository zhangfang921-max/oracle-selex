# ORACLE — Oligonucleotide Read Analysis & Candidate Library Explorer

**A free, web-based platform for analyzing high-throughput sequencing data from SELEX experiments.**

ORACLE (Oligonucleotide Read Analysis & Candidate Library Explorer) takes your NGS reads and returns clustered aptamer candidates with statistical validation, structural annotation, and publication-ready figures. Accessible at **[oracle.oligocluster.com](https://oracle.oligocluster.com)**.

## Features

- **Four clustering modes**: Sequence Auto-Optimal ML, Structure Profile, Sequence Identity, Structure (dot-bracket)
- **Multi-algorithm evaluation**: KMeans, Hierarchical (Ward), GMM, Spectral, DBSCAN, HDBSCAN — optimal partition selected by silhouette/DB/CH criterion
- **Statistical validation**: Permutation testing (1000 iterations) for cluster significance
- **G4 screening**: G4Hunter, cGcC, and G4NN scoring with G4 risk classification
- **RNA structure**: ViennaRNA folding with MFE and dot-bracket structure prediction
- **Interactive visualization**: t-SNE, UMAP, PCA cluster maps, silhouette waterfall, force-directed network graph
- **Export**: Publication-quality PNG/SVG figures, CSV data tables

## Quick Start

1. Go to [oracle.oligocluster.com](https://oracle.oligocluster.com)
2. Click "New Analysis", enter a name
3. Upload your FASTA file (sequences with read counts in headers)
4. Choose **Sequence Auto-Optimal ML** (recommended for most users)
5. Click **Run Clustering**
6. Explore results across tabs and export figures

## Input Format

FASTA or FASTQ files. ORACLE parses read counts automatically from the last numeric value in each header (e.g., `>seq-1234` → count = 1234). Primer trimming and T→U conversion are handled automatically.

## Documentation

Full documentation with mode descriptions, result interpretation, and algorithm reference is available at the [User Guide](https://oracle.oligocluster.com/docs) on the platform.

## Citing

If you use ORACLE in your research, please cite:

> Wu, T.-Y., Wang, J., Santoso, R.J., Yarshova, M., Kang, J., Feng, Y., Xue, Y., Li, Y., Zhang, F.\* & Kwok, C.K.\* L-RNA Aptamer–Oligonucleotide Conjugates Enable Selective Targeting of Oncogenic RNA G-Quadruplexes. In preparation (2026).
> 
A Zenodo DOI will be available upon publication.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Contact

Fang Zhang — zhangfang921@gmail.com  
Department of Food Science and Nutrition, The Hong Kong Polytechnic University  
College of Biological Science and Engineering, Fuzhou University
