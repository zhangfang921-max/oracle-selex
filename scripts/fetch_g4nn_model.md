# Installing the optional G4NN model

ORACLE scores every sequence with **cGcC** and **G4Hunter**, both implemented from
their published definitions in `backend/g4_scorers.py` (MIT).

The third score, **G4NN**, is produced by a pre-trained artificial neural network
published with **G4RNA screener** by Jean-Michel Garant (RNA Group, Université de
Sherbrooke). That model file is the original authors' work and is licensed
**GPL-3.0**, so ORACLE does not redistribute it. G4NN is therefore optional: if the
model is not installed, the service returns `g4NN: null`, the G4 risk
classification falls back to the two remaining threshold criteria, and everything
else works unchanged.

## If you want G4NN scores

1. Obtain `G4RNA_2016-11-07.pkl` from the original project, under its GPL-3.0 terms:

   http://gitlabscottgroup.med.usherbrooke.ca/J-Michel/g4rna_screener

2. Place it at either of the paths ORACLE checks by default:

   ```
   <repo>/models/G4RNA_2016-11-07.pkl
   <repo>/g4rna_screener/G4RNA_2016-11-07.pkl
   ```

   or point `G4NN_MODEL_PATH` at it explicitly:

   ```bash
   export G4NN_MODEL_PATH=/opt/g4rna/G4RNA_2016-11-07.pkl
   ```

3. Install the runtime the pickled network needs:

   ```bash
   pip install pybrain3 numpy scipy
   ```

4. Confirm it loaded:

   ```bash
   curl -s http://localhost:3002/health
   # {"status": "ok", "engine": "ORACLE G4 scorers (cGcC, G4Hunter) + G4NN external model", "model_loaded": true}
   ```

## Licensing note

The model file remains under GPL-3.0 and is used here without modification.
Running GPL-3.0 software on your own server carries no source-distribution
obligation (GPL-3.0 has no network clause). Obligations would only arise if you
redistribute the model or a derivative of it; in that case comply with GPL-3.0.

Please cite the model's authors when you report G4NN scores:

> Garant JM, Perreault JP, Scott MS. Motif independent identification of potential
> RNA G-quadruplexes by G4RNA screener. *Bioinformatics* 33(22):3532–3537 (2017).
> doi:10.1093/bioinformatics/btx498
