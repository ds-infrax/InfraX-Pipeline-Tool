import json
from pathlib import Path

from app.runner import build_project_catalog


if __name__ == "__main__":
    root = Path(__file__).parent
    catalog = build_project_catalog(root / "catalog.json")
    print(json.dumps(catalog, indent=2))
