import argparse
import os
from pathlib import Path

from app.runner import run_workflow


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow")
    args = parser.parse_args()

    workflow = Path(args.workflow)
    if not workflow.is_absolute():
        asset_root = os.environ.get("INFRAX_ASSET_ROOT")
        workflow = Path(asset_root) / workflow if asset_root else Path(__file__).parent / workflow

    if run_workflow(workflow) is None:
        raise SystemExit(1)
