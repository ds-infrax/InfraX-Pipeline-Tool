from app.node import Node


class Scale(Node):
    description = "Scales a value by a project-specific factor."

    def __init__(self, factor: float = 1):
        self.factor = factor

    def run(self, value: float, offset: float = 0) -> float:
        return float(value * self.factor + offset)
