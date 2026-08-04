import json
import os
import sys
from pathlib import Path


def _project_root():
    return Path(__file__).resolve().parents[2]


def _configured_asset_root():
    configured = os.environ.get("INFRAX_ASSET_ROOT")
    if configured:
        return Path(configured)

    config_path = _project_root() / "tool-config.json"
    try:
        document = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return _project_root()

    asset_git = document.get("assetGit")
    if isinstance(asset_git, dict) and isinstance(asset_git.get("root"), str):
        root = asset_git["root"].strip()
        if root:
            candidate = Path(root)
            return candidate if candidate.is_absolute() else _project_root() / candidate
    return _project_root()


ASSET_ROOT = _configured_asset_root().resolve()
if ASSET_ROOT.is_dir():
    asset_root_path = os.fspath(ASSET_ROOT)
    if asset_root_path not in sys.path:
        sys.path.insert(0, asset_root_path)


def _ensure_custom_node_package_markers():
    custom_nodes_root = ASSET_ROOT / "custom_nodes"
    if not custom_nodes_root.is_dir():
        return
    for directory in [custom_nodes_root, *custom_nodes_root.rglob("*")]:
        if (
            not directory.is_dir()
            or directory.name.startswith(".")
            or directory.name == "__pycache__"
            or any(part.startswith(".") or part == "__pycache__" for part in directory.parts)
        ):
            continue
        marker = directory / "__init__.py"
        if not marker.exists():
            try:
                marker.write_text("", encoding="utf-8")
            except OSError:
                pass


_ensure_custom_node_package_markers()


NODE_MODULES = ("app.nodes", "custom_nodes")
