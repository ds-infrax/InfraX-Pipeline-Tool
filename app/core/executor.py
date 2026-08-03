from app.core.input import resolve_input_value
from app.core.loader import load_node
from app.core.protocol import parse_workflow, validate_workflow
from app.core.schema import run_input_types, validate_run_return


def execute_workflow(data, node_modules=None, on_node_event=None):
    errors = validate_workflow(data, node_modules=node_modules)
    if errors:
        raise ValueError(errors)

    graph = parse_workflow(data)
    links = {link.id: link for link in graph.links}
    pending = list(graph.nodes)
    outputs = {}

    while pending:
        ready = [spec for spec in pending if _is_ready(spec, links, outputs)]
        if not ready:
            waiting = ", ".join(str(spec.id) for spec in pending)
            raise ValueError(f"Workflow has unresolved dependencies or a cycle near nodes: {waiting}")

        for spec in ready:
            if on_node_event:
                on_node_event("running", spec)
            try:
                outputs[spec.id] = _execute_node(spec, links, outputs, node_modules)
            except Exception:
                if on_node_event:
                    on_node_event("error", spec)
                raise
            if on_node_event:
                on_node_event("success", spec)
            pending.remove(spec)

    return outputs


def _execute_node(spec, links, outputs, node_modules):
    node = load_node(spec.type, node_modules=node_modules, **spec.init_values)
    node.ready()
    input_types = run_input_types(node)
    kwargs = {
        input_port["name"]: resolve_input_value(
            input_port,
            links,
            outputs,
            expected_type=input_types.get(input_port["name"]),
        )
        for input_port in spec.inputs
        if input_port["link"] is not None or "value" in input_port
    }
    result = node.run(**kwargs)
    node.stop()
    validate_run_return(node, result)
    return _as_outputs(result)


def _is_ready(spec, links, outputs):
    for input_port in spec.inputs:
        link_id = input_port.get("link")
        if link_id is None:
            continue
        link = links[link_id]
        if link.from_node not in outputs:
            return False
    return True


def _as_outputs(result):
    if isinstance(result, tuple):
        return list(result)
    return [result]
