# InfraX Pipeline Tool

Local workflow runtime for InfraX-style node graphs.

The intended workflow is simple:

```text
git clone InfraX-Pipeline-Tool
cd InfraX-Pipeline-Tool/custom_nodes
git clone <custom-node-repo>
cd ..
python main.py workflows/sample_custom.json
python catalog.py
```

This repo contains the runtime, built-in nodes, and a `custom_nodes/` folder where each project can live as its own git repo.

## Layout

```text
InfraX-Pipeline-Tool/
  workflow/
    runner.py
    core/
      config.py
      loader.py
      registry.py
      protocol.py
      executor.py
      schema.py
    node/
      base.py              # Node
    nodes/
      basic/
        math.py            # NumberInput, Add, OutputValue

  custom_nodes/
    sample/
      nodes.py             # Example custom node package
      workflows/
        a+b=c_workflow.json
        scale_workflow.json

  main.py                  # Run a workflow JSON
  catalog.py               # Generate catalog.json for GUI server
  pyproject.toml
```

## Setup

Create a virtual environment and install this repo in editable mode:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -e .
```

Editable install is convenient while developing nodes and runtime code.

You can also run directly from the repo root without installing while developing:

```powershell
python main.py workflows/sample_custom.json
python catalog.py
```

## Connect the Browser Studio

Start the local bridge before opening the browser workflow editor:

```powershell
python studio_bridge.py
```

The bridge listens only on `http://127.0.0.1:8765`. It prints a new pairing
token every time it starts. Copy that token into the Studio's **local tool
pairing** field. The token is intentionally not saved to disk.

Set the Studio's **execution tool folder** to the absolute path of the
`InfraX-Pipeline-Tool` folder. Leaving it empty selects the folder containing
`studio_bridge.py`. After the bridge validates `catalog.py`, `main.py`, and the
`workflow` package, the Studio stores the canonical path in account-scoped
browser local storage. Every page load creates a new in-memory tool context
before catalog or workflow requests are sent. Context IDs are not persisted,
and separate tabs can safely use different tool folders.

After pairing, the Studio uses the bridge as follows:

1. It calls `POST /tool-contexts` with the saved execution tool path.
2. On first connection it calls `POST /catalog/refresh`. The bridge runs
   `catalog.py` in that tool context and returns the newly written
   `catalog.json`.
3. Browser edits continue to auto-save a single draft in browser local storage.
4. The explicit workflow save action writes UTF-8 JSON atomically under
   `workflows/`.
5. A saved workflow can be run through `main.py` from the Studio.

The bridge does not provide arbitrary command or filesystem access. Workflow
filenames must be plain `.json` basenames, request bodies are size-limited, and
catalog generation and workflow execution have timeouts. Browser requests must
come from an exact allowed Origin and include:

```http
Authorization: Bearer <pairing-token>
X-InfraX-Tool-Context: <temporary-context-id>
```

The built-in Origin list includes `https://106.254.226.206`,
`https://infrax.iptime.org`, and common local development ports. The Studio
path (for example `/pipeline`) is not part of the browser Origin. If a
different Studio Origin is needed, add that exact Origin when starting the
bridge:

```powershell
python studio_bridge.py --allow-origin https://studio.example
```

Available endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check whether the bridge is running; no token required |
| `POST` | `/tool-contexts` | Validate a tool folder and create a temporary context |
| `POST` | `/catalog/refresh` | Run `catalog.py` and return the updated catalog |
| `GET` | `/catalog` | Read the current `catalog.json` |
| `GET` | `/workflows` | List valid JSON files under `workflows/` |
| `GET` | `/workflows/{filename}` | Read one saved workflow |
| `PUT` | `/workflows/{filename}` | Atomically save one workflow |
| `POST` | `/workflows/{filename}/run` | Run the saved file with `main.py` |

Run the bridge tests with:

```powershell
python -m unittest -v test_studio_bridge
```

## Custom Nodes

Each project can live as its own git repo under `custom_nodes/`.

A project repo usually owns both its custom nodes and its workflows:

```text
custom_nodes/
  my_project/
    __init__.py
    nodes.py
    workflows/
      main_workflow.json
```

Example:

```powershell
cd custom_nodes
git clone https://github.com/your-org/infrx-vision-project.git vision
git clone https://github.com/your-org/infrx-calculator-project.git calculators
cd ..
```

Small local nodes can also be placed directly under `custom_nodes/`.

## Node Discovery

The runtime always scans these module roots:

```text
workflow.nodes
custom_nodes
```

Node keys are stable because the scan roots do not change. For example,
`custom_nodes/sample/nodes.py::Scale` has the key `sample.Scale`.

## Run A Workflow

```powershell
python main.py workflows/sample_a+b=c.json
```

`main.py` validates the workflow passed on the command line, executes it, and
prints the final output.

Current example:

```text
8 + 4 = 12
```

## Generate Catalog

```powershell
python catalog.py
```

This writes `catalog.json` and prints the same catalog to the terminal.

The GUI server can use this catalog to know which nodes exist, their display names, constructor values, inputs, and outputs.

`catalog.json` is generated output and is ignored by git.

## Writing Nodes

Nodes inherit from `workflow.node.Node`.

```python
from workflow.node import Node


class Multiply(Node):
    display_name = "Multiply"
    description = "Multiplies two numbers."

    def run(self, a: float, b: float, offset: float = 0) -> float:
        return float(a * b + offset)
```

Constructor arguments become `init_values` in workflow JSON. The `run()` signature becomes the input/output contract.

Required and optional inputs are inferred from Python defaults:

- `a: float` has no default, so it is required.
- `offset: float = 0` has a default, so it is optional.
- Optional inputs can be omitted from workflow JSON.

Dataclass inputs are supported for literal JSON values. If a constructor argument or `run()` argument is typed as a dataclass, a JSON object is converted into that dataclass before the node is called.

```python
from dataclasses import dataclass


@dataclass
class BBox:
    x: float
    y: float
    w: float
    h: float
```

```json
{
  "name": "bbox",
  "type": "BBox",
  "link": null,
  "value": {
    "x": 10,
    "y": 20,
    "w": 100,
    "h": 80
  }
}
```

If this class is in `custom_nodes/calculators/nodes.py`, its workflow type is:

```json
"calculators.Multiply"
```

Duplicate node keys are errors. If two packages expose the same key, catalog building fails instead of silently choosing one.

## Workflow Input Rules

Every provided input must include `link`.

Linked input:

```json
{ "name": "a", "type": "float", "link": 1 }
```

Literal value input:

```json
{ "name": "b", "type": "float", "link": null, "value": 10 }
```

Optional input using its Python default:

```json
{ "name": "offset", "type": "float", "link": null }
```

If `link` is not `null`, the linked output wins even if `value` is also present.
If `link` is `null` and `value` is omitted, an optional input uses its Python
default. The same shape is an error for a required input.

## Catalog Shape

Catalog nodes look like this:

```json
{
  "key": "basic.Add",
  "name": "Add",
  "display_name": "Add",
  "description": "Adds two numbers.",
  "module": "workflow.nodes.basic.math",
  "category": "basic",
  "init": {
    "inputs": []
  },
  "io": {
    "inputs": [
      {
        "name": "a",
        "type": "float",
        "required": true,
        "default": null
      }
    ],
    "outputs": [
      {
        "name": "output",
        "type": "float"
      }
    ]
  }
}
```
