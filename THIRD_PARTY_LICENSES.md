# Third-party licenses and attribution

ORACLE's own source code is released under the MIT License (see [LICENSE](LICENSE)).

**Every file in this repository is MIT-licensed.** The components listed below are third-party
dependencies that ORACLE calls but does not redistribute; each remains under its own license, and
the attributions each one requires are reproduced here and shown in the application.

Last reviewed: 2026-08-25.

---

## 1. G4NN model — GPL-3.0, optional, not distributed here

| Item | Detail |
|---|---|
| Item | Pre-trained G4NN artificial neural network (`G4RNA_2016-11-07.pkl`) |
| Origin | **G4RNA screener** by Jean-Michel Garant, RNA Group, Université de Sherbrooke |
| Upstream | http://gitlabscottgroup.med.usherbrooke.ca/J-Michel/g4rna_screener |
| License | **GNU General Public License v3.0** |
| Distributed by ORACLE? | **No.** The model is not in this repository and is git-ignored. Deployers who want G4NN scores install it themselves under GPL-3.0 — see [scripts/fetch_g4nn_model.md](scripts/fetch_g4nn_model.md). When it is absent the service returns `g4NN: null` and G4 risk falls back to the cGcC and G4Hunter criteria. |
| Modifications | None. The model is loaded and used unmodified. |
| Citation | Garant JM, Perreault JP, Scott MS. Motif independent identification of potential RNA G-quadruplexes by G4RNA screener. *Bioinformatics* 33(22):3532–3537 (2017). doi:10.1093/bioinformatics/btx498 |

GPL-3.0 has no network clause: running the model on a server carries no source-distribution
obligation. The GPL-3.0 text is at https://www.gnu.org/licenses/gpl-3.0.txt.

**History.** Up to and including commit `25ddf3d` (2026-08-25), this repository contained
`backend/g4screener_service.py` — a Python-3 port of the G4RNA screener implementation — and tracked
the `.pkl` model file (introduced in `6b206dd`, tagged `v3.4`). Those two artefacts were GPL-3.0
derivative works and should not have been covered by the root MIT license. They have been removed.
The cGcC and G4Hunter scorers were rewritten from the published papers in `backend/g4_scorers.py`
(MIT) and verified to reproduce the previous numbers exactly (`backend/tests/test_g4_scorers.py`,
318-sequence fixture plus a 1,000-sequence end-to-end comparison against the old service).

Note that released tags `v3.4`–`v3.5.0` still contain the GPL-3.0 artefacts; anyone redistributing
those specific tags must comply with GPL-3.0 for `backend/g4screener_service.py` and
`g4rna_screener/G4RNA_2016-11-07.pkl`.

## 2. ViennaRNA Package — custom license, not redistributed here

| Item | Detail |
|---|---|
| Used by | `backend/rnafold_service.py` (via `import RNA`, the official RNAlib Python bindings) |
| Version in production | 2.7.2 |
| Redistribution | **None.** ViennaRNA is not vendored in this repository; it must be installed separately by the deployer. |
| Authors | R. Lorenz, S. H. Bernhart, C. Höner zu Siederdissen, H. Tafer, C. Flamm, P. F. Stadler, I. L. Hofacker — Institute for Theoretical Chemistry, University of Vienna |
| Upstream | https://www.tbi.univie.ac.at/RNA/ |

The ViennaRNA license (`COPYING` in the upstream distribution) grants permission for research,
educational and commercial use and modification provided that (1) the package and derived works are
not redistributed for any fee other than media costs, and (2) **proper credit is given to the authors
and the Institute for Theoretical Chemistry of the University of Vienna**. Inclusion in a commercial
product requires contacting the authors.

ORACLE complies as follows: ViennaRNA is not redistributed and ORACLE is provided free of charge;
credit is given in the README, in the site footer, and on every analysis page.

Citation: Lorenz R, Bernhart SH, Höner zu Siederdissen C, Tafer H, Flamm C, Stadler PF, Hofacker IL.
ViennaRNA Package 2.0. *Algorithms for Molecular Biology* 6:26 (2011). doi:10.1186/1748-7188-6-26

> If ORACLE is ever distributed as a container image or bundle that includes ViennaRNA, that becomes
> redistribution: it remains permitted free of charge with credit, but a paid distribution or a
> commercial product would require contacting the ViennaRNA authors first.

## 3. Published algorithms implemented in ORACLE

These are scientific methods, not licensed code. They are cited, not copied:

- **G4Hunter** — Bedrat A, Lacroix L, Mergny JL. *Nucleic Acids Res* 44(4):1746–1759 (2016). doi:10.1093/nar/gkw006
- **cGcC** — Beaudoin JD, Jodoin R, Perreault JP. *Nucleic Acids Res* 42(2):1209–1223 (2014). doi:10.1093/nar/gkt904

Note that the *implementations* currently shipped for these two scores live inside
`backend/g4screener_service.py` and therefore fall under section 1 above.

## 4. Python scientific stack

Installed as dependencies, not vendored:

| Package | License |
|---|---|
| NumPy | BSD-3-Clause |
| SciPy | BSD-3-Clause |
| scikit-learn | BSD-3-Clause |
| matplotlib | Matplotlib License (BSD-style, PSF-derived) |
| PyBrain3 (only needed for G4NN) | see upstream package metadata |

## 5. Frontend and backend npm dependencies

Managed by `pnpm`; each package carries its own license (predominantly MIT and ISC). To regenerate a
full machine-readable inventory:

```bash
cd backend  && pnpm licenses list
cd frontend && pnpm licenses list
```

---

## How to report a licensing problem

If you believe ORACLE misattributes or misuses your work, please contact
Fang Zhang — fang9.zhang@polyu.edu.hk — and it will be corrected promptly.
