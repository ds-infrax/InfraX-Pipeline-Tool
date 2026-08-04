import json
import os
from pathlib import Path
from pprint import pprint

from app import build_catalog, execute_workflow, parse_workflow, validate_workflow
from app.core.config import NODE_MODULES

RUN_EVENT_PREFIX = "INFRA_RUN_EVENT "


def run_workflow(workflow_path, runtime_id="local-dev"):
    workflow_path = Path(workflow_path)
    workflow_data = json.loads(workflow_path.read_text())
    catalog = build_catalog(runtime_id=runtime_id, node_modules=NODE_MODULES)
    errors = validate_workflow(workflow_data, catalog=catalog)

    print(f"workflow file: {workflow_path}")
    print("validation errors:")
    pprint(errors)

    if errors:
        return None

    graph = parse_workflow(workflow_data)
    outputs = execute_workflow(
        workflow_data,
        node_modules=NODE_MODULES,
        on_node_event=_emit_node_event,
    )
    final_node_id = _final_node_id(graph)

    print("execution outputs:")
    pprint(outputs)
    print(f"Result = {outputs[final_node_id][0]}")
    return outputs


def build_project_catalog(output_path=None, runtime_id="local-dev"):
    catalog = build_catalog(runtime_id=runtime_id, node_modules=NODE_MODULES)

    if output_path:
        Path(output_path).write_text(
            json.dumps(catalog, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    return catalog


def _emit_node_event(status, spec):
    if os.environ.get("INFRAX_RUN_PROGRESS") != "1":
        return
    print(
        RUN_EVENT_PREFIX
        + json.dumps(
            {
                "type": "node",
                "status": status,
                "nodeId": spec.id,
                "nodeType": spec.type,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        flush=True,
    )


def _final_node_id(graph):
    source_node_ids = {link.from_node for link in graph.links}
    terminal_nodes = [node for node in graph.nodes if node.id not in source_node_ids]
    if len(terminal_nodes) == 1:
        return terminal_nodes[0].id
    return graph.nodes[-1].id
