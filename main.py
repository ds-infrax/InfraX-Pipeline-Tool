import argparse
from pathlib import Path

from workflow.runner import run_workflow


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow")
    args = parser.parse_args()

    workflow = Path(args.workflow)
    if not workflow.is_absolute():
        workflow = Path(__file__).parent / workflow

    run_workflow(workflow)
