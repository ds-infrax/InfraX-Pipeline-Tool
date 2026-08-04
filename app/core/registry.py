import importlib
import importlib.util
import inspect
import pkgutil
import sys
import types
from pathlib import Path
from typing import Any, get_origin

from app.core.loader import get_node_modules
from app.core.schema import describe_init_inputs, describe_run_io
from app.node import Node

_MAX_MISSING_DEPENDENCY_STUBS = 20


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

    if root == "custom_nodes":
        yield from _iter_custom_node_classes(package, root)
        return

    for module_info in pkgutil.walk_packages(package.__path__, f"{root}."):
        try:
            module = importlib.import_module(module_info.name)
        except Exception:
            continue
        yield from _classes_in_module(module)


def _iter_custom_node_classes(package, root):
    for package_path in package.__path__:
        base_path = Path(package_path)
        if not base_path.is_dir():
            continue
        for module_path in sorted(base_path.rglob("*.py")):
            if module_path.name == "__init__.py" or _is_ignored_module_path(module_path, base_path):
                continue
            relative_parts = module_path.relative_to(base_path).with_suffix("").parts
            if not all(part.isidentifier() for part in relative_parts):
                continue
            module_name = ".".join((root, *relative_parts))
            try:
                module = _load_custom_node_module(module_name, module_path, root, base_path)
            except Exception:
                continue
            _publish_module_exports_to_parent_package(module, module_name)
            for node_cls in _classes_in_module(module):
                yield node_cls


def _is_ignored_module_path(module_path, base_path):
    relative_parts = module_path.relative_to(base_path).parts
    return any(
        part.startswith(".")
        or part == "__pycache__"
        or part in {"node_modules", ".venv", "venv"}
        for part in relative_parts
    )


def _load_custom_node_module(module_name, module_path, root, base_path):
    _ensure_synthetic_parent_packages(module_name, root, base_path)
    missing_dependency_stubs = []
    try:
        for _ in range(_MAX_MISSING_DEPENDENCY_STUBS):
            try:
                return _exec_module_from_path(module_name, module_path)
            except ModuleNotFoundError as error:
                missing_name = _missing_dependency_name(error)
                if (
                    not missing_name
                    or missing_name.startswith("app")
                    or missing_name.startswith("custom_nodes")
                    or missing_name in sys.modules
                ):
                    raise
                sys.modules[missing_name] = _MissingDependencyModule(missing_name)
                missing_dependency_stubs.append(missing_name)
        raise ImportError(f"Too many missing dependencies while loading {module_name}")
    finally:
        for missing_name in missing_dependency_stubs:
            if isinstance(sys.modules.get(missing_name), _MissingDependencyModule):
                sys.modules.pop(missing_name, None)


def _exec_module_from_path(module_name, module_path):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load {module_name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _missing_dependency_name(error):
    name = getattr(error, "name", None)
    if isinstance(name, str) and name:
        return name.split(".")[0]
    return None


class _MissingDependencyModule(types.ModuleType):
    def __getattr__(self, name):
        placeholder = type(name, (), {})
        setattr(self, name, placeholder)
        return placeholder


def _ensure_synthetic_parent_packages(module_name, root, base_path):
    parts = module_name.split(".")
    for index in range(1, len(parts)):
        package_name = ".".join(parts[:index])
        if package_name == root or package_name in sys.modules:
            continue
        relative_parts = parts[1:index]
        package_path = base_path.joinpath(*relative_parts)
        package = types.ModuleType(package_name)
        package.__path__ = [str(package_path)]
        package.__package__ = package_name
        package.__file__ = str(package_path / "__init__.py")
        sys.modules[package_name] = package


def _publish_module_exports_to_parent_package(module, module_name):
    parent_name = module_name.rpartition(".")[0]
    parent = sys.modules.get(parent_name)
    if parent is None:
        return

    public_names = getattr(module, "__all__", None)
    if public_names is None:
        public_names = [
            name
            for name, value in vars(module).items()
            if not name.startswith("_")
            and getattr(value, "__module__", None) == module.__name__
        ]

    for name in public_names:
        if not isinstance(name, str) or hasattr(parent, name) or not hasattr(module, name):
            continue
        setattr(parent, name, getattr(module, name))


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
