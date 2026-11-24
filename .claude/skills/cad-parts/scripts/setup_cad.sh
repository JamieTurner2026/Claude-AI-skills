#!/usr/bin/env bash
# Make build123d (Python CAD, OpenCascade kernel) available in its own venv.
# Usage: bash setup_cad.sh        prints  python=<venv python>  (use it to run build_part.py)
# Venv location: $CAD_VENV, default ~/.venvs/build123d. About 900 MB, a few minutes, once.
set -e
VENV="${CAD_VENV:-$HOME/.venvs/build123d}"
PY="$VENV/bin/python"; [ -x "$PY" ] || PY="$VENV/Scripts/python.exe"
if [ -x "$PY" ] && "$PY" -c "import build123d" >/dev/null 2>&1; then
  echo "python=$PY"; "$PY" -c "import build123d;print('build123d', build123d.__version__)"; exit 0
fi
command -v python3 >/dev/null 2>&1 && SYS=python3 || SYS=python
"$SYS" -c "import sys; assert (3,11) <= sys.version_info[:2] < (3,15), 'build123d needs Python 3.11-3.14'" \
  || { echo "FAILED: need Python 3.11-3.14" >&2; exit 1; }
echo "Installing build123d into $VENV (large download, a few minutes)..." >&2
"$SYS" -m venv "$VENV"
PY="$VENV/bin/python"; [ -x "$PY" ] || PY="$VENV/Scripts/python.exe"
"$PY" -m pip install --quiet build123d >&2 || { echo "FAILED: pip install build123d" >&2; exit 1; }
echo "python=$PY"; "$PY" -c "import build123d;print('build123d', build123d.__version__)"
