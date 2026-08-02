class Node:
    display_name = None
    description = None
    output_names = None

    def ready(self):
        pass

    def run(self, *args, **kwargs):
        raise NotImplementedError(f"{type(self).__name__}.run() must be implemented")

    def stop(self):
        pass

    @classmethod
    def describe(cls):
        return {
            "display_name": cls.display_name or cls.__name__,
            "description": cls.description,
        }
