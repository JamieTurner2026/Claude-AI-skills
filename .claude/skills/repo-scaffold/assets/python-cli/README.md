# {{name}}

{{description}}

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
{{name}} --help
ruff check . && pytest
```
