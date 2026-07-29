from typing import Any

from workflow.node import Node


class NumberInput(Node):
    display_name = "Number Input"
    description = "Returns a configured number."

    def __init__(self, value: float = 0):
        self.value = value

    def run(self) -> float:
        return float(self.value)


class Add(Node):
    description = "Adds two numbers."

    def run(self, a: float, b: float) -> float:
        return float(a + b)


class OutputValue(Node):
    display_name = "Output Value"
    description = "Returns the received value."

    def run(self, source: Any) -> Any:
        return source
