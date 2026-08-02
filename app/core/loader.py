import importlib
import inspect

from app.core.config import NODE_MODULES
from app.core.schema import init_input_types, materialize_value
from app.node import Node


def load_node(node_type, *args, node_modules=None, **kwargs):
    node_cls = resolve_node_class(node_type, node_modules=node_modules)
    input_types = init_input_types(node_cls)
    kwargs = {
        name: materialize_value(value, input_types.get(name))
        for name, value in kwargs.items()
    }
    return node_cls(*args, **kwargs)


def resolve_node_class(node_type, node_modules=None):
    if inspect.isclass(node_type):
        return _ensure_node(node_type)
    if not isinstance(node_type, str):
        raise TypeError(f"node_type must be a class or string, got {type(node_type)!r}")

    matches = []
    for name in _class_paths(node_type, node_modules or get_node_modules()):
        module_name, class_name = name.rsplit(".", 1)
        target = _get_attr(module_name, class_name)
        if inspect.isclass(target) and issubclass(target, Node):
            matches.append(target)

    if len(matches) > 1:
        paths = ", ".join(f"{match.__module__}.{match.__name__}" for match in matches)
        raise ValueError(f"Duplicate node type {node_type!r}: {paths}")
    if matches:
        return matches[0]

    raise ValueError(f"Could not find node class: {node_type}")


def get_node_modules():
    return NODE_MODULES


def _ensure_node(node_cls):
    if not issubclass(node_cls, Node):
        raise TypeError(f"{node_cls.__name__} must inherit from Node")
    return node_cls


def _class_paths(node_type, modules):
    if "." in node_type:
        yield node_type
        for module in modules:
            yield f"{module}.{node_type}"
    else:
        for module in modules:
            yield f"{module}.{node_type}"


def _get_attr(module_name, class_name):
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError:
        return None
    return getattr(module, class_name, None)
