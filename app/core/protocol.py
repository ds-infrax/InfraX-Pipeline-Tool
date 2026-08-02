from dataclasses import dataclass

from app.core.input import validate_input
from app.core.loader import get_node_modules
from app.core.registry import list_nodes


CATALOG_SCHEMA = "workflow.catalog.v1"
WORKFLOW_SCHEMA = "workflow.graph.v1"


@dataclass
class WorkflowLink:
    id: int
    from_node: int
    from_output: int
    to_node: int
    to_input: int
    type: str


@dataclass
class WorkflowNode:
    id: int
    type: str
    init_values: dict
    inputs: list
    outputs: list
    pos: list
    size: list


@dataclass
class WorkflowGraph:
    schema: str
    nodes: list[WorkflowNode]
    links: list[WorkflowLink]
    raw: dict


def build_catalog(runtime_id="local", node_modules=None):
    modules = node_modules or get_node_modules()
    return {
        "schema": CATALOG_SCHEMA,
        "runtime": {
            "id": runtime_id,
            "node_modules": list(modules),
        },
        "nodes": list_nodes(modules),
    }


def parse_workflow(data):
    return WorkflowGraph(
        schema=data.get("schema", WORKFLOW_SCHEMA),
        nodes=[_parse_node(node) for node in data.get("nodes", [])],
        links=[_parse_link(link) for link in data.get("links", [])],
        raw=data,
    )


def validate_workflow(data, catalog=None, node_modules=None):
    graph = parse_workflow(data)
    catalog = catalog or build_catalog(node_modules=node_modules)
    node_defs = {node["key"]: node for node in catalog["nodes"]}
    errors = []

    for node in graph.nodes:
        node_def = node_defs.get(node.type)
        if node_def is None:
            errors.append(f"node {node.id}: unknown node type {node.type!r}")
            continue

        errors.extend(_validate_init_values(node, node_def))
        errors.extend(_validate_inputs(node, node_def))

    return errors


def _parse_node(node):
    return WorkflowNode(
        id=node["id"],
        type=node["type"],
        init_values=node.get("init_values", {}),
        inputs=node.get("inputs", []),
        outputs=node.get("outputs", []),
        pos=node.get("pos", []),
        size=node.get("size", []),
    )


def _parse_link(link):
    if isinstance(link, dict):
        return WorkflowLink(
            id=link["id"],
            from_node=link["from_node"],
            from_output=link["from_output"],
            to_node=link["to_node"],
            to_input=link["to_input"],
            type=link.get("type", "*"),
        )

    link_id, from_node, from_output, to_node, to_input, link_type = link
    return WorkflowLink(
        id=link_id,
        from_node=from_node,
        from_output=from_output,
        to_node=to_node,
        to_input=to_input,
        type=link_type,
    )


def _validate_init_values(node, node_def):
    init_inputs = node_def.get("init", {}).get("inputs", [])
    known = {item["name"]: item for item in init_inputs}
    errors = []

    for name, item in known.items():
        if item.get("required") and name not in node.init_values:
            errors.append(f"node {node.id}: missing init value {name!r}")

    for name in node.init_values:
        if name not in known:
            errors.append(f"node {node.id}: unknown init value {name!r}")

    return errors


def _validate_inputs(node, node_def):
    io_inputs = node_def.get("io", {}).get("inputs", [])
    known = {item["name"]: item for item in io_inputs}
    provided = {item.get("name"): item for item in node.inputs}
    errors = []

    for name, item in known.items():
        if item.get("required") and name not in provided:
            errors.append(f"node {node.id}: missing input {name!r}")

    for name, input_port in provided.items():
        if name not in known:
            errors.append(f"node {node.id}: unknown input {name!r}")
            continue

        error = validate_input(node.id, input_port, node_def)
        if error:
            errors.append(error)

    return errors
