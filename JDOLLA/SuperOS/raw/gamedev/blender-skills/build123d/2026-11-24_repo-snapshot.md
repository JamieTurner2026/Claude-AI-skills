# build123d: repo snapshot (source)

Source: `gumyr/build123d` (public), dev branch commit `ce60f32` dated 2026-11-22, read on 2026-11-24 from a shallow clone. Jay uploaded its `FUNDING.yml`, CI workflows (`action.yml`, `benchmark.yml`, `coverage.yml`, `lint.yml`) and example images; they are kept in `upload/`. Apache-2.0 licence, (c) Roger Maitland and contributors (`LICENSE.txt`, `NOTICE.txt`).
Read: `README.md`, `pyproject.toml`, the docs index, the cheat sheet (kept here as `cheat_sheet.rst`), the sheet-metal reference, the exporters, the example list. The library code, docs (35 MB) and examples were not copied: it installs from PyPI.
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- Not a Blender skill pack. It is a Python CAD library: parametric boundary-representation modelling on the OpenCascade kernel, for exact parts for 3D printing, CNC and laser cutting. No `SKILL.md` files.
- Two modelling styles: builder contexts (`BuildPart`, `BuildSketch`, `BuildLine`) and algebra (`part = a + b - c`, `Pos(...) * shape`).
- Exports STEP, STL, glTF/GLB, OBJ, BREP, SVG and DXF. Imports STEP and STL.
- Python 3.11 to 3.14. Main dependency `cadquery-ocp-novtk` 8.0.
- The dev branch has sheet metal (`BuildSheet`, `flange`, `bend`, `unfold`). The released PyPI version 0.13.0 does not (checked 2026-11-24).
- Install check 2026-11-24: `pip install build123d` gave 0.13.0, about 880 MB in a venv. A test bracket built, exported STEP/STL/GLB, and rendered in Blender 5.3 at true size.
