from workflow.core.schema import materialize_value


def validate_input(node_id, input_port, node_def):
    name = input_port.get("name", "<unknown>")
    if "link" not in input_port:
        return f"node {node_id}.{name}: missing link"
    if input_port["link"] is None and "value" not in input_port:
        input_def = next(
            item for item in node_def["io"]["inputs"] if item["name"] == name
        )
        if not input_def["required"]:
            return None
        return f"node {node_id}.{name}: missing value"
    return None


def resolve_input_value(input_port, links, outputs, expected_type=None):
    if input_port["link"] is None:
        return materialize_value(input_port["value"], expected_type)

    link = links[input_port["link"]]
    return outputs[link.from_node][link.from_output]
