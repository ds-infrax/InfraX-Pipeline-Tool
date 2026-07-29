import importlib
import inspect
import pkgutil
from typing import Any, get_origin

from workflow.core.loader import get_node_modules
from workflow.core.schema import describe_init_inputs, describe_run_io
from workflow.node import Node


def list_nodes(node_modules=None, json_safe=True):
    modules = node_modules or get_node_modules()
    nodes = []

    for root in modules:
        for node_cls in _iter_node_classes(root):
            nodes.append(describe_node(node_cls, root, json_safe=json_safe))

    _raise_duplicate_keys(nodes)
    return sorted(nodes, key=lambda item: item["key"])


def describe_node(node_cls, root_module=None, json_safe=True):
    io = describe_run_io(node_cls)
    return {
        "key": _node_key(node_cls, root_module),
        "name": node_cls.__name__,
        **node_cls.describe(),
        "module": node_cls.__module__,
        "category": _category(node_cls, root_module),
        "init": _json_safe({"inputs": describe_init_inputs(node_cls)}) if json_safe else {"inputs": describe_init_inputs(node_cls)},
        "io": _json_safe(io) if json_safe else io,
    }


def _iter_node_classes(root):
    try:
        package = importlib.import_module(root)
    except ModuleNotFoundError:
        return

    yield from _classes_in_module(package)

    if not hasattr(package, "__path__"):
        return

    for module_info in pkgutil.walk_packages(package.__path__, f"{root}."):
        module = importlib.import_module(module_info.name)
        yield from _classes_in_module(module)


def _classes_in_module(module):
    for _, value in inspect.getmembers(module, inspect.isclass):
        if value.__module__ == module.__name__ and _is_node(value):
            yield value


def _is_node(value):
    return issubclass(value, Node) and value is not Node


def _node_key(node_cls, root_module):
    category = _category(node_cls, root_module)
    return f"{category}.{node_cls.__name__}" if category else node_cls.__name__


def _category(node_cls, root_module):
    if root_module is None:
        return node_cls.__module__

    prefix = f"{root_module}."
    module = node_cls.__module__
    if not module.startswith(prefix):
        return module

    parts = module[len(prefix) :].split(".")
    return ".".join(part for part in parts[:-1] if part)


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if value is Any:
        return "Any"
    if get_origin(value) is not None:
        return str(value).replace("typing.", "")
    if inspect.isclass(value):
        return _type_name(value)
    return value


def _type_name(value):
    if value.__module__ == "builtins":
        return value.__name__
    return f"{value.__module__}.{value.__name__}"


def _raise_duplicate_keys(nodes):
    by_key = {}
    for node in nodes:
        by_key.setdefault(node["key"], []).append(node)

    duplicates = {key: items for key, items in by_key.items() if len(items) > 1}
    if not duplicates:
        return

    messages = []
    for key, items in duplicates.items():
        paths = ", ".join(f"{item['module']}.{item['name']}" for item in items)
        messages.append(f"{key}: {paths}")

    raise ValueError("Duplicate node keys found: " + "; ".join(messages))
