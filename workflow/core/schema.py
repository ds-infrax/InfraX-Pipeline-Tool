import inspect
from dataclasses import fields, is_dataclass
from types import UnionType
from typing import Any, Union, get_args, get_origin, get_type_hints


EMPTY = inspect.Signature.empty


def describe_run_io(op: Any):
    sig, hints = _run_signature(op)
    inputs = describe_callable_inputs(sig, hints)
    outputs = _output_ports(hints.get("return", sig.return_annotation))
    output_names = getattr(op, "output_names", None)

    if output_names:
        if len(output_names) != len(outputs):
            raise ValueError(
                f"{op.__name__}.output_names must contain {len(outputs)} names"
            )
        for port, name in zip(outputs, output_names):
            port["name"] = name

    return {"inputs": inputs, "outputs": outputs}


def describe_init_inputs(op_cls):
    sig = inspect.signature(op_cls.__init__)
    hints = get_type_hints(op_cls.__init__)
    return describe_callable_inputs(sig, hints)


def describe_callable_inputs(sig, hints):
    return [
        _port(
            name,
            hints.get(name, param.annotation),
            required=param.default is EMPTY,
            default=param.default,
        )
        for name, param in sig.parameters.items()
        if name != "self"
        and param.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    ]


def describe_value(value):
    values = value if isinstance(value, tuple) else (value,)
    return [_port(f"output_{i}" if isinstance(value, tuple) else "output", type(item)) for i, item in enumerate(values)]


def validate_run_return(op: Any, value):
    sig, hints = _run_signature(op)
    expected = hints.get("return", sig.return_annotation)
    if expected is EMPTY:
        raise TypeError(f"{type(op).__name__}.run must declare a return type")

    error = _type_error(value, expected)
    if error:
        raise TypeError(f"{type(op).__name__}.run return mismatch: {error}")


def run_input_types(op: Any):
    sig, hints = _run_signature(op)
    return _callable_input_types(sig, hints)


def init_input_types(op_cls):
    sig = inspect.signature(op_cls.__init__)
    hints = get_type_hints(op_cls.__init__)
    return _callable_input_types(sig, hints)


def _callable_input_types(sig, hints):
    return {
        name: hints.get(name, param.annotation)
        for name, param in sig.parameters.items()
        if name != "self"
        and param.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    }


def materialize_value(value, expected):
    if expected in (None, EMPTY, Any):
        return value

    origin, args = get_origin(expected), get_args(expected)
    if origin in (Union, UnionType):
        return _materialize_union(value, args)
    if origin in (list, tuple):
        return _materialize_sequence(value, origin, args)
    if is_dataclass(expected) and isinstance(value, dict):
        hints = get_type_hints(expected)
        return expected(
            **{
                field.name: materialize_value(value[field.name], hints.get(field.name, field.type))
                for field in fields(expected)
                if field.name in value
            }
        )

    return value


def _run_signature(op):
    run = getattr(op, "run")
    return inspect.signature(run), get_type_hints(run)


def _materialize_union(value, args):
    for arg in args:
        if arg is type(None) and value is None:
            return None
        if is_dataclass(arg) and isinstance(value, dict):
            return materialize_value(value, arg)
    return value


def _materialize_sequence(value, origin, args):
    if not args or not isinstance(value, (list, tuple)):
        return value

    item_type = args[0]
    items = [materialize_value(item, item_type) for item in value]
    return tuple(items) if origin is tuple else items


def _output_ports(return_type):
    if get_origin(return_type) is tuple:
        return [_port(f"output_{i}", arg) for i, arg in enumerate(get_args(return_type)) if arg is not Ellipsis]
    return [_port("output", return_type)]


def _port(name, data_type, required=None, default=EMPTY):
    port = {"name": name, "type": None if data_type is EMPTY else data_type, "fields": _fields(data_type)}
    if required is not None:
        port["required"] = required
        port["default"] = None if default is EMPTY else default
    return port


def _fields(data_type):
    if not is_dataclass(data_type):
        return None
    hints = get_type_hints(data_type)
    return [_port(field.name, hints.get(field.name, field.type)) for field in fields(data_type)]


def _type_error(value, expected, path="return"):
    if expected is Any:
        return None
    if expected in (None, type(None)):
        return None if value is None else f"{path} expected None, got {type(value).__name__}"

    origin, args = get_origin(expected), get_args(expected)
    if origin in (Union, UnionType):
        return None if any(_type_error(value, arg, path) is None for arg in args) else f"{path} expected {expected!r}"

    if origin is tuple:
        return _tuple_error(value, args, path)

    expected_type = origin or expected
    if inspect.isclass(expected_type) and not isinstance(value, expected_type):
        return f"{path} expected {expected_type.__name__}, got {type(value).__name__}"

    if is_dataclass(expected_type):
        hints = get_type_hints(expected_type)
        return _first_error(
            _type_error(getattr(value, field.name), hints.get(field.name, field.type), f"{path}.{field.name}")
            for field in fields(expected_type)
        )

    return None


def _tuple_error(value, args, path):
    if not isinstance(value, tuple):
        return f"{path} expected tuple, got {type(value).__name__}"
    if len(args) == 2 and args[1] is Ellipsis:
        return _first_error(_type_error(item, args[0], f"{path}[{i}]") for i, item in enumerate(value))
    if len(value) != len(args):
        return f"{path} expected {len(args)} items, got {len(value)}"
    return _first_error(_type_error(item, arg, f"{path}[{i}]") for i, (item, arg) in enumerate(zip(value, args)))


def _first_error(errors):
    return next((error for error in errors if error), None)
