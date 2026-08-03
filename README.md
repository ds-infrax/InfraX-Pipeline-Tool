# InfraX Pipeline Tool

Local workflow runtime for InfraX-style node graphs.

The intended workflow is simple:

```text
git clone InfraX-Pipeline-Tool
cd InfraX-Pipeline-Tool/custom_nodes
git clone <custom-node-repo>
cd ..
python-3.10.0-embed-amd64\python.exe main.py workflows/list/sample_custom.json
python-3.10.0-embed-amd64\python.exe catalog.py
```

This repo contains the runtime, built-in nodes, and a `custom_nodes/` folder where each project can live as its own git repo.

## Layout

```text
InfraX-Pipeline-Tool/
  app/
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

  workflows/
    list/                  # Saved/imported workflow assets
      sample_a+b=c.json
      sample_custom.json
    current/               # The one workflow currently being edited
    temp/                  # Volatile stash when current is replaced

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
python-3.10.0-embed-amd64\python.exe main.py workflows/list/sample_custom.json
python-3.10.0-embed-amd64\python.exe catalog.py
```

## Start the Local Workflow Studio

InfraX Studio uses the same basic structure as a portable ComfyUI installation:
the Python process on this PC serves both the browser GUI and the local
workflow API. It does not need a browser extension or a second local web
server.

The installed tool version is stored in the root `VERSION` file. The local
health API and the served HTML both expose that same semantic version so the
hosted Pipeline site can tell the user when a newer release is available.
Official builds are published at:

```text
https://github.com/ds-infrax/InfraX-Pipeline-Tool/releases/latest
```

On Windows, double-click:

```text
run_studio.bat
```

The launcher uses Python in this order:

1. `python-3.10.0-embed-amd64\python.exe` (portable bundle)
3. `python` available on `PATH`

You can also start it from PowerShell:

```powershell
python-3.10.0-embed-amd64\python.exe studio_bridge.py
```

The process listens only on `http://127.0.0.1:8765` and opens that address in
the default browser automatically. `127.0.0.1` means only the current PC can
connect to it; the Studio is not exposed to the LAN or Internet. Keep the
terminal window open while using the Studio, and press `Ctrl+C` to stop it.
Only one Studio process can use a port. Starting it twice reports that the
Studio is already running instead of sharing the port between processes.

### What happens while the Studio is running

1. The local Python process serves the packaged Workflow Studio screen.
2. The screen requests a catalog refresh. Python runs `catalog.py`, then reads
   the updated `catalog.json` and shows the discovered nodes.
3. Canvas edits automatically keep one current draft in browser local storage.
   This protects in-progress edits but does not create a workflow file.
4. **File Save** writes the current editing copy under `workflows/current/`
   and mirrors the saved asset to `workflows/list/`.
5. Opening another JSON file loads it from `workflows/list/`, moves the
   previous current copy to `workflows/temp/`, then edits the new current copy.
6. **Run** invokes `main.py workflows/current/<filename>.json` and returns the
   actual process output to the Studio.

The GUI and local API have the same loopback address, so local mode creates a
temporary `HttpOnly`, `SameSite=Strict` session cookie for `/local-api` and a
separate HttpOnly cookie scoped to `/api`. The secret is not exposed to page
JavaScript. There is no pairing-token field to copy and no browser extension
to install. The packaged GUI also serves its Material Symbols font locally;
opening and editing workflows does not depend on a font CDN.

### Startup options

Pass options after `run_studio.bat`, or after `python-3.10.0-embed-amd64\python.exe studio_bridge.py`:

```powershell
# Start without opening a browser tab
run_studio.bat --no-browser

# Use a different loopback port
run_studio.bat --port 8877

# Connect Marketplace/account requests to the hosted InfraX platform
run_studio.bat --platform-api-base https://106.254.226.206/pipeline/api

# Work locally without contacting the hosted platform
run_studio.bat --offline

# Run only the legacy local API, without serving the packaged GUI
run_studio.bat --api-only
```

The packaged `tool-config.json` supplies the default hosted API:

```json
{
  "platformApiBase": "https://106.254.226.206/pipeline/api"
}
```

The API address is selected in this order: `--platform-api-base`, the
`INFRAX_PLATFORM_API_BASE` environment variable, then `tool-config.json`.
Every configured address must use HTTPS and include an API path. `--offline`
ignores all three sources.

Catalog discovery, workflow file save, workflow selection, and execution
always stay on the local Python process. Starting the Studio never makes a
required network request. If the hosted server is unavailable—or when
`--offline` is used—the local catalog, canvas, workflow files, and `main.py`
execution continue to work. Account and Marketplace features are unavailable,
but the bundled GitHub Releases link remains visible; downloading a release
still requires an Internet connection.

### Hosted API proxy and account connection

The local HTML always uses same-origin `/api` URLs. The Python process proxies
only this fixed allowlist to the configured HTTPS platform:

- health, session, and Pipeline Tool release metadata/legacy redirects;
- Marketplace workflow and module list/item reads and uploads;
- Marketplace module ZIP downloads;
- the local-connect PKCE exchange and local logout.

Arbitrary upstream paths, query strings, methods, hosts, and request headers
are rejected. The upstream connection has a five-second inactivity timeout
and runs in its own request thread, so a slow or unavailable platform does not
block catalog, workflow, or execution requests.
Marketplace deletion is intentionally not exposed through the local proxy;
delete shared items from the hosted site instead.

During `POST /api/local-connect/exchange`, the bridge forwards the one-time
code, PKCE verifier, state, and exact loopback return origin. It keeps the
returned `ixm_...` access token only in Python process memory. The required
`ixr_...` refresh credential is never returned to JavaScript. On Windows it is
encrypted for the current user with DPAPI and stored below
`%LOCALAPPDATA%\InfraX\PipelineTool`; platforms without an OS credential
protector use memory-only credentials rather than a plaintext fallback.
Subsequent allowlisted requests get the Authorization header inside the
bridge. On the first 401 the bridge refreshes once and retries the request.
`POST /api/local-connect/logout` asks the server to revoke the credential and
then removes the local copy, even if the server is temporarily unavailable.
No Marketplace credential is written to browser storage.

The central server contract is:

- exchange returns `accessToken`, `refreshToken`, `expiresAt`,
  `refreshExpiresAt`, and `user`;
- `POST /local-connect/refresh` accepts `{ "refreshToken": "ixr_..." }` and
  returns a new access token, rotated refresh token, `expiresAt`,
  `refreshExpiresAt`, and optional `user`;
- `POST /local-connect/logout` accepts `{ "refreshToken": "ixr_..." }`,
  invalidates the server-side session, and returns `{ "revoked": true }`.

API-only mode retains the earlier remote-browser integration. In that mode the
terminal prints a temporary pairing token, browser requests must come from an
allowed exact Origin, and a new tool context is created for the selected
execution folder. Add an Origin when needed:

```powershell
run_studio.bat --api-only --allow-origin https://studio.example
```

Local workflow endpoints are also available below `/local-api/` when the GUI
is served:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/local-api/health` | Check whether the local process is running |
| `POST` | `/local-api/tool-contexts` | Validate a tool folder and create a temporary context |
| `POST` | `/local-api/catalog/refresh` | Run `catalog.py` and return the updated catalog |
| `GET` | `/local-api/catalog` | Read the current `catalog.json` |
| `GET` | `/local-api/workflows` | List JSON files under `workflows/list/` |
| `GET` | `/local-api/workflows/{filename}` | Read one saved workflow asset from `workflows/list/` |
| `PUT` | `/local-api/workflows/{filename}` | Atomically save one workflow asset to `workflows/list/` |
| `POST` | `/local-api/workflows/{filename}/activate` | Copy one asset from `workflows/list/` into `workflows/current/` |
| `POST` | `/local-api/workflows/current/clear` | Move current editing files to `workflows/temp/` and clear current |
| `POST` | `/local-api/workflows/{filename}/run` | Run the saved file with `main.py` |
| `GET` | `/local-api/packages` | List Marketplace packages installed by the local tool |
| `GET` | `/local-api/custom-node-packages` | List catalog-confirmed local custom-node sources that may be published |
| `PUT` | `/local-api/packages/{id}/install` | Validate and install a downloaded Marketplace ZIP |
| `POST` | `/local-api/packages/{id}/install-from-marketplace` | Stream a fixed Marketplace ZIP directly to a temporary local file and install it |
| `GET` | `/local-api/packages/{id}/archive` | Rebuild one registry-owned installed package as a ZIP |
| `PUT` | `/local-api/packages/{id}/publish` | Publish one catalog-confirmed local custom-node source to Marketplace |

The local process does not provide arbitrary command or filesystem access.
Workflow filenames must be plain `.json` basenames, except the controlled
`current/{filename}` and `temp/{filename}` working paths. Request bodies are
size-limited, and catalog generation and workflow execution have timeouts.

### Marketplace package installation

Local mode normally uses `install-from-marketplace`, so large ZIP files travel
from the fixed configured platform directly into a temporary file owned by
the Python process. They do not become a browser `Blob`. The request contains
only package metadata:

```http
POST /local-api/packages/{id}/install-from-marketplace
Content-Type: application/json

{"id":"...","name":"...","version":"1.0.0","kind":"node-pack",
 "sha256":"...","nodeTypes":["package.Node"]}
```

The local tool constructs the one allowed central download path itself. It
does **not** accept a download URL, filesystem path, Git URL, or command.
Redirected Git Marketplace items are rejected; automatic Git cloning is
intentionally unsupported.

The raw ZIP endpoint remains available for API-only and test integrations:

The install request contract is:

```http
PUT /local-api/packages/{id}/install
Content-Type: application/zip
X-InfraX-Package-Metadata: encodeURIComponent(JSON)
```

Metadata JSON contains `id`, `name`, semantic `version`, `kind`, `sha256`, and
`nodeTypes`. `kind` is either `node-pack` or `model-pack`. Node packages are
installed into `custom_nodes/{id}` and model packages into `models/{id}`.

Before changing an installed package, the tool verifies the SHA-256 and checks
for path traversal, symbolic links and special files, encryption, unsupported
compression, duplicate paths, excessive entry count, expanded size,
compression ratio, and available disk space. It extracts into a staging
folder, atomically swaps the package, runs `catalog.py`, and rolls back if any
step fails. A successful package contains `infrax-package.json`; the root
`package-registry.json` records installed packages. Catalog nodes declared in
`nodeTypes` receive a `package_ref` containing the package ID, version, and
digest.

For a model package, catalog responses also contain a relative-path model
list:

```json
{
  "models": [
    {
      "id": "detector-model:weights/model.bin",
      "name": "model.bin",
      "relative_path": "detector-model/weights/model.bin",
      "path": "models/detector-model/weights/model.bin",
      "size": 1234,
      "package_ref": {
        "package_id": "detector-model",
        "version": "1.0.0",
        "digest": "..."
      }
    }
  ]
}
```

`GET /local-api/packages/{id}/archive` accepts only an ID present in
`package-registry.json`, rejects links and special files, and returns a ZIP
with `X-InfraX-Archive-Sha256` and URL-encoded
`X-InfraX-Package-Metadata` headers. The exporter ignores the installed
`infrax-package.json` copy and regenerates one from the registry record, so an
exported archive can be installed into a fresh Pipeline Tool safely without
trusting a modified local manifest.

`GET /local-api/custom-node-packages` is the source for the local publish
picker. It returns only top-level `custom_nodes/{id}` folders that are present
in the current catalog and are not Marketplace-installed registry packages:

```json
{
  "ok": true,
  "packages": [
    {
      "id": "my-nodes",
      "name": "my-nodes",
      "kind": "node-pack",
      "source": "custom_nodes",
      "installPath": "custom_nodes/my-nodes",
      "nodeTypes": ["my_nodes.Example"],
      "fileCount": 6,
      "size": 18432
    }
  ]
}
```

`PUT /local-api/packages/{id}/publish` accepts JSON containing `name`,
`version`, `description`, `kind`, `nodeTypes`, and optional `author`.
`nodeTypes` must be a subset of the types that catalog discovery associated
with that local folder. The bridge builds that folder only, streams the ZIP
to the fixed central `/marketplace/modules/{id}` path with its memory-only
token, and forwards optional `If-Match`. No ZIP is materialized in browser
memory.

Automatic local-source publishing uses a deliberately narrow file allowlist:
Python source (`.py`, `.pyi`), documentation named `README*` or `LICENSE*`
with a text/document extension, `requirements*.txt`, and the exact
`pyproject.toml` file. Hidden files and folders, caches, JSON/YAML/config
files, credentials, arbitrary text files, model weights, and other binaries
are omitted. Review `fileCount` and `size` in the picker before uploading.
Marketplace-installed packages cannot be republished or resold through this
endpoint; that request returns
`409 installed_package_republish_not_allowed`.

The digest proves that the bytes match the Marketplace metadata; it does not
sandbox or make third-party Python code trustworthy. `catalog.py` imports node
packages during discovery, and `main.py` executes their nodes. Install only
packages from a publisher you trust.

The unprefixed `/packages` and `/packages/{id}/install` aliases expose the
same operations for the legacy bearer-token API. Browser local mode should
normally use `/local-api/...`, which is protected by the temporary HttpOnly
session cookie.

Run its tests with:

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
app.nodes
custom_nodes
```

Node keys are stable because the scan roots do not change. For example,
`custom_nodes/sample/nodes.py::Scale` has the key `sample.Scale`.

## Run A Workflow

```powershell
python-3.10.0-embed-amd64\python.exe main.py workflows/list/sample_a+b=c.json
```

`main.py` validates the workflow passed on the command line, executes it, and
prints the final output.

Current example:

```text
8 + 4 = 12
```

## Generate Catalog

```powershell
python-3.10.0-embed-amd64\python.exe catalog.py
```

This writes `catalog.json` and prints the same catalog to the terminal.

The GUI server can use this catalog to know which nodes exist, their display names, constructor values, inputs, and outputs.

`catalog.json` is generated output and is ignored by git.

## Writing Nodes

Nodes inherit from `app.node.Node`.

```python
from app.node import Node


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
  "module": "app.nodes.basic.math",
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
