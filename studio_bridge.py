"""Secure loopback bridge for the InfraX browser workflow editor.

The browser cannot directly run Python or access the local filesystem.  This
module exposes only the fixed operations the editor needs:

* refresh and read ``catalog.json``;
* list, read, and atomically save JSON files under ``workflows/``;
* run a saved workflow through ``main.py``.

The server always binds to 127.0.0.1, checks browser origins against an exact
allowlist, requires a random bearer token, and invokes Python with
``shell=False``.  A paired user may select only a validated local tool root;
the API never accepts arbitrary file targets or commands.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit


BRIDGE_VERSION = "1"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_BODY_LIMIT = 5 * 1024 * 1024
DEFAULT_CATALOG_TIMEOUT = 30.0
DEFAULT_RUN_TIMEOUT = 600.0
MAX_RESPONSE_OUTPUT = 200_000
MAX_TOOL_CONTEXTS = 64

DEFAULT_ALLOWED_ORIGINS = frozenset(
    {
        "https://infrax.iptime.org:3004",
        "https://infrax.iptime.org",
        "https://106.254.226.206",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3004",
        "http://127.0.0.1:3004",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5178",
        "http://127.0.0.1:5178",
    }
)

_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class BridgeError(Exception):
    """An expected API error with an HTTP status and stable error code."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _safe_workflow_filename(value: str) -> str:
    """Return a safe basename ending in .json or raise BridgeError."""

    if not value or value in {".", ".."}:
        raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_filename", "파일명이 올바르지 않습니다.")
    if value != value.strip() or value.endswith((".", " ")):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_filename",
            "파일명 앞뒤에 공백이나 마침표를 사용할 수 없습니다.",
        )
    if _INVALID_FILENAME_CHARS.search(value):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_filename",
            "파일명에 경로 또는 사용할 수 없는 문자가 포함되어 있습니다.",
        )
    if Path(value).name != value or "/" in value or "\\" in value:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_filename",
            "workflows 폴더 안의 파일명만 사용할 수 있습니다.",
        )
    if Path(value).suffix.lower() != ".json":
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_filename",
            "워크플로우 파일은 .json 확장자여야 합니다.",
        )
    if value.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_filename",
            "운영체제 예약 파일명은 사용할 수 없습니다.",
        )
    return value


def _validate_origin(origin: str) -> str:
    """Validate and normalize an additional exact browser origin."""

    parsed = urlsplit(origin)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError(
            "origin must be an exact http(s) origin, for example http://localhost:3004"
        )
    if (
        parsed.scheme == "http"
        and (parsed.hostname or "").lower() not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise argparse.ArgumentTypeError(
            "non-loopback browser origins must use https"
        )
    return f"{parsed.scheme}://{parsed.netloc}"


def _iso_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def _limited_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    if len(value) <= MAX_RESPONSE_OUTPUT:
        return value
    omitted = len(value) - MAX_RESPONSE_OUTPUT
    return f"{value[:MAX_RESPONSE_OUTPUT]}\n... ({omitted} characters omitted)"


class BridgeState:
    """Filesystem and subprocess operations shared by request handlers."""

    def __init__(
        self,
        root: Path,
        *,
        allowed_origins: set[str] | frozenset[str],
        auth_token: str,
        body_limit: int = DEFAULT_BODY_LIMIT,
        catalog_timeout: float = DEFAULT_CATALOG_TIMEOUT,
        run_timeout: float = DEFAULT_RUN_TIMEOUT,
    ) -> None:
        self.allowed_origins = frozenset(allowed_origins)
        self.auth_token = auth_token
        self.body_limit = body_limit
        self.catalog_timeout = catalog_timeout
        self.run_timeout = run_timeout
        self.catalog_lock = threading.Lock()
        self.workflow_lock = threading.RLock()
        self.run_lock = threading.Lock()

        if not auth_token or len(auth_token) < 32:
            raise ValueError("auth_token must contain at least 32 characters")
        if body_limit <= 0:
            raise ValueError("body_limit must be positive")
        if catalog_timeout <= 0 or run_timeout <= 0:
            raise ValueError("subprocess timeouts must be positive")
        self._set_tool_root(root)

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "service": "infrax-pipeline-tool",
            "version": BRIDGE_VERSION,
            "pairingRequired": True,
        }

    def _set_tool_root(self, root: Path) -> None:
        raw_root = os.fspath(root)
        if "\x00" in raw_root or (
            os.name == "nt" and raw_root.replace("/", "\\").startswith("\\\\")
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_tool_root",
                "로컬 드라이브의 실행 도구 폴더만 사용할 수 있습니다.",
            )
        candidate = Path(raw_root).expanduser()
        if not candidate.is_absolute():
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_tool_root",
                "실행 도구 폴더는 절대 경로여야 합니다.",
            )
        try:
            resolved_root = candidate.resolve(strict=True)
        except (OSError, RuntimeError, ValueError) as error:
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "tool_root_not_found",
                "지정한 실행 도구 폴더를 찾을 수 없습니다.",
            ) from error
        if not resolved_root.is_dir():
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_tool_root",
                "지정한 실행 도구 경로가 폴더가 아닙니다.",
            )

        catalog_script = resolved_root / "catalog.py"
        main_script = resolved_root / "main.py"
        workflow_package = resolved_root / "workflow"
        workflow_init = workflow_package / "__init__.py"
        required_paths = (
            (catalog_script, resolved_root),
            (main_script, resolved_root),
            (workflow_init, workflow_package),
        )
        for required_path, required_parent in required_paths:
            try:
                resolved_required = required_path.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "실행 도구 폴더에는 catalog.py, main.py, workflow 패키지가 필요합니다.",
                ) from error
            try:
                resolved_parent = required_parent.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "실행 도구 폴더의 workflow 패키지를 확인할 수 없습니다.",
                ) from error
            if not resolved_required.is_file() or resolved_required.parent != resolved_parent:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "필수 실행 파일은 실행 도구 폴더 내부의 정해진 위치에 있어야 합니다.",
                )
        if workflow_package.resolve(strict=True).parent != resolved_root:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "tool_root_missing_files",
                "workflow 패키지는 실행 도구 폴더 바로 아래에 있어야 합니다.",
            )

        workflows_path = resolved_root / "workflows"
        try:
            workflows_path.mkdir(parents=True, exist_ok=True)
            resolved_workflows = workflows_path.resolve(strict=True)
        except (OSError, RuntimeError, ValueError) as error:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "tool_root_invalid_workflows",
                "실행 도구 폴더의 workflows 폴더를 준비할 수 없습니다.",
            ) from error
        if not resolved_workflows.is_dir() or resolved_workflows.parent != resolved_root:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "tool_root_invalid_workflows",
                "workflows는 실행 도구 폴더 바로 아래의 실제 폴더여야 합니다.",
            )

        self.root = resolved_root
        self.workflows_dir = resolved_workflows
        self.catalog_path = resolved_root / "catalog.json"
        self.catalog_script = catalog_script
        self.main_script = main_script

    def read_catalog(self) -> dict[str, Any]:
        with self.catalog_lock:
            return {"ok": True, "catalog": self._read_catalog_unlocked()}

    def refresh_catalog(self) -> dict[str, Any]:
        with self.catalog_lock:
            completed = self._run_python(self.catalog_script, timeout=self.catalog_timeout)
            if completed.returncode != 0:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "catalog_refresh_failed",
                    "catalog.py 실행에 실패했습니다.",
                    details={
                        "returnCode": completed.returncode,
                        "stdout": _limited_output(completed.stdout),
                        "stderr": _limited_output(completed.stderr),
                    },
                )
            catalog = self._read_catalog_unlocked()
            stat = self.catalog_path.stat()
            return {
                "ok": True,
                "catalog": catalog,
                "generatedAt": _iso_timestamp(stat.st_mtime),
                "stdout": _limited_output(completed.stdout),
                "stderr": _limited_output(completed.stderr),
            }

    def _read_catalog_unlocked(self) -> dict[str, Any]:
        if not self.catalog_path.is_file():
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "catalog_not_found",
                "catalog.json이 없습니다. 먼저 카탈로그를 다시 조회하세요.",
            )
        try:
            catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "catalog_invalid",
                "catalog.json을 읽을 수 없습니다.",
            ) from error
        if not isinstance(catalog, dict) or not isinstance(catalog.get("nodes"), list):
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "catalog_invalid",
                "catalog.json 형식이 올바르지 않습니다.",
            )
        return catalog

    def list_workflows(self) -> list[dict[str, Any]]:
        with self.workflow_lock:
            workflows: list[dict[str, Any]] = []
            for candidate in self.workflows_dir.iterdir():
                if not candidate.is_file() or candidate.suffix.lower() != ".json":
                    continue
                try:
                    safe_path = self._workflow_path(candidate.name)
                    stat = safe_path.stat()
                    data = json.loads(safe_path.read_text(encoding="utf-8"))
                except (BridgeError, OSError, UnicodeError, json.JSONDecodeError):
                    continue
                workflow_name = data.get("name") if isinstance(data, dict) else None
                workflows.append(
                    {
                        "fileName": candidate.name,
                        "name": workflow_name if isinstance(workflow_name, str) else candidate.stem,
                        "size": stat.st_size,
                        "modifiedAt": _iso_timestamp(stat.st_mtime),
                    }
                )
            return sorted(workflows, key=lambda item: item["fileName"].casefold())

    def read_workflow(self, filename: str) -> dict[str, Any]:
        with self.workflow_lock:
            path = self._workflow_path(filename)
            if not path.is_file():
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "workflow_not_found",
                    f"워크플로우 파일을 찾을 수 없습니다: {filename}",
                )
            try:
                workflow = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "workflow_invalid",
                    f"워크플로우 JSON을 읽을 수 없습니다: {filename}",
                ) from error
            self._validate_workflow_shape(workflow)
            stat = path.stat()
            return {
                "ok": True,
                "fileName": filename,
                "workflow": workflow,
                "size": stat.st_size,
                "modifiedAt": _iso_timestamp(stat.st_mtime),
            }

    def save_workflow(
        self,
        filename: str,
        workflow: Any,
        *,
        overwrite: bool = True,
    ) -> dict[str, Any]:
        self._validate_workflow_shape(workflow)
        payload = (json.dumps(workflow, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(payload) > self.body_limit:
            raise BridgeError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "body_too_large",
                f"저장할 JSON은 {self.body_limit}바이트를 넘을 수 없습니다.",
            )

        with self.workflow_lock:
            path = self._workflow_path(filename)
            if not overwrite and path.exists():
                raise BridgeError(
                    HTTPStatus.CONFLICT,
                    "workflow_exists",
                    f"같은 이름의 워크플로우 파일이 이미 있습니다: {filename}",
                )
            temp_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=f".{filename}.",
                    suffix=".tmp",
                    dir=self.workflows_dir,
                    delete=False,
                ) as temp_file:
                    temp_path = Path(temp_file.name)
                    temp_file.write(payload)
                    temp_file.flush()
                    os.fsync(temp_file.fileno())
                os.replace(temp_path, path)
                temp_path = None
                stat = path.stat()
            except OSError as error:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "workflow_save_failed",
                    f"워크플로우 파일을 저장하지 못했습니다: {filename}",
                ) from error
            finally:
                if temp_path is not None:
                    try:
                        temp_path.unlink(missing_ok=True)
                    except OSError:
                        pass

        return {
            "ok": True,
            "fileName": filename,
            "size": stat.st_size,
            "modifiedAt": _iso_timestamp(stat.st_mtime),
        }

    def run_workflow(self, filename: str) -> dict[str, Any]:
        with self.run_lock:
            with self.workflow_lock:
                path = self._workflow_path(filename)
                if not path.is_file():
                    raise BridgeError(
                        HTTPStatus.NOT_FOUND,
                        "workflow_not_found",
                        f"워크플로우 파일을 찾을 수 없습니다: {filename}",
                    )
                relative_path = path.relative_to(self.root)
                completed = self._run_python(
                    self.main_script,
                    str(relative_path),
                    timeout=self.run_timeout,
                )

        return {
            "ok": completed.returncode == 0,
            "fileName": filename,
            "returnCode": completed.returncode,
            "stdout": _limited_output(completed.stdout),
            "stderr": _limited_output(completed.stderr),
        }

    def _workflow_path(self, filename: str) -> Path:
        safe_name = _safe_workflow_filename(filename)
        candidate = self.workflows_dir / safe_name
        resolved = candidate.resolve(strict=False)
        if resolved.parent != self.workflows_dir:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_filename",
                "workflows 폴더 밖의 경로에는 접근할 수 없습니다.",
            )
        return resolved

    @staticmethod
    def _validate_workflow_shape(workflow: Any) -> None:
        if not isinstance(workflow, dict):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "workflow_invalid",
                "워크플로우 JSON 최상위 값은 객체여야 합니다.",
            )
        if not isinstance(workflow.get("nodes"), list) or not isinstance(workflow.get("links"), list):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "workflow_invalid",
                "워크플로우 JSON에는 nodes와 links 배열이 필요합니다.",
            )

    def _run_python(
        self,
        script: Path,
        *arguments: str,
        timeout: float,
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8"
        environment["PYTHONUTF8"] = "1"
        try:
            return subprocess.run(
                [sys.executable, "-B", str(script), *arguments],
                cwd=self.root,
                shell=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
                env=environment,
            )
        except subprocess.TimeoutExpired as error:
            raise BridgeError(
                HTTPStatus.GATEWAY_TIMEOUT,
                "process_timeout",
                f"로컬 Python 실행이 {timeout:g}초 제한 시간을 초과했습니다.",
                details={
                    "stdout": _limited_output(error.stdout),
                    "stderr": _limited_output(error.stderr),
                },
            ) from error
        except OSError as error:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "process_start_failed",
                "로컬 Python 프로세스를 시작하지 못했습니다.",
            ) from error


class StudioBridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], state: BridgeState) -> None:
        super().__init__(server_address, StudioBridgeHandler)
        self.state = state
        self.tool_contexts: dict[str, BridgeState] = {}
        self.tool_root_states: dict[str, BridgeState] = {
            os.path.normcase(str(state.root)): state
        }
        self.tool_context_lock = threading.Lock()

    def create_tool_context(self, path: Any) -> dict[str, Any]:
        if path is not None and not isinstance(path, str):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_tool_root",
                "실행 도구 폴더 경로를 입력하세요.",
            )
        requested_path = path.strip() if isinstance(path, str) else ""
        if requested_path:
            candidate_context = BridgeState(
                Path(requested_path),
                allowed_origins=self.state.allowed_origins,
                auth_token=self.state.auth_token,
                body_limit=self.state.body_limit,
                catalog_timeout=self.state.catalog_timeout,
                run_timeout=self.state.run_timeout,
            )
        else:
            candidate_context = self.state
        context_id = secrets.token_urlsafe(24)
        root_key = os.path.normcase(str(candidate_context.root))
        with self.tool_context_lock:
            context = self.tool_root_states.get(root_key)
            if context is None:
                context = candidate_context
                self.tool_root_states[root_key] = context
            while len(self.tool_contexts) >= MAX_TOOL_CONTEXTS:
                oldest_context_id = next(iter(self.tool_contexts))
                oldest_context = self.tool_contexts.pop(oldest_context_id, None)
                if (
                    oldest_context is not None
                    and oldest_context is not self.state
                    and oldest_context not in self.tool_contexts.values()
                ):
                    oldest_root_key = os.path.normcase(str(oldest_context.root))
                    self.tool_root_states.pop(oldest_root_key, None)
            self.tool_root_states[root_key] = context
            self.tool_contexts[context_id] = context
        return {
            "ok": True,
            "contextId": context_id,
            "toolRoot": str(context.root),
        }

    def state_for_context(self, context_id: str | None) -> BridgeState:
        if not context_id:
            raise BridgeError(
                HTTPStatus.CONFLICT,
                "tool_context_required",
                "실행 도구 경로를 먼저 연결해 주세요.",
            )
        if len(context_id) > 128 or not re.fullmatch(r"[A-Za-z0-9_-]+", context_id):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_tool_context",
                "실행 도구 컨텍스트 값이 올바르지 않습니다.",
            )
        with self.tool_context_lock:
            context = self.tool_contexts.get(context_id)
        if context is None:
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "tool_context_not_found",
                "실행 도구 컨텍스트가 만료되었습니다. 경로를 다시 연결하세요.",
            )
        return context


class StudioBridgeHandler(BaseHTTPRequestHandler):
    server: StudioBridgeServer
    server_version = "InfraXStudioBridge/1"
    sys_version = ""

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib handler API
        if not self._origin_allowed():
            self._send_error(
                BridgeError(HTTPStatus.FORBIDDEN, "origin_not_allowed", "허용되지 않은 Origin입니다.")
            )
            return
        requested_method = self.headers.get("Access-Control-Request-Method")
        if requested_method and requested_method.upper() not in {"GET", "POST", "PUT"}:
            self._send_error(
                BridgeError(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed", "허용되지 않은 요청 방식입니다.")
            )
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, If-None-Match, X-InfraX-Tool-Context",
        )
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("PUT")

    def _dispatch(self, method: str) -> None:
        try:
            if not self._origin_allowed():
                raise BridgeError(
                    HTTPStatus.FORBIDDEN,
                    "origin_not_allowed",
                    "허용되지 않은 Origin입니다.",
                )
            raw_path = urlsplit(self.path).path
            segments = raw_path.strip("/").split("/") if raw_path != "/" else []

            if method == "GET" and segments == ["health"]:
                self._send_json(HTTPStatus.OK, self.server.state.health())
                return
            self._require_authorized()

            if method == "POST" and segments == ["tool-contexts"]:
                payload = self._read_json_body()
                if not isinstance(payload, dict) or "path" not in payload:
                    raise BridgeError(
                        HTTPStatus.BAD_REQUEST,
                        "invalid_tool_root",
                        "요청 본문에는 실행 도구 폴더 path가 필요합니다.",
                    )
                self._send_json(
                    HTTPStatus.CREATED,
                    self.server.create_tool_context(payload["path"]),
                )
                return
            state = self.server.state_for_context(
                self.headers.get("X-InfraX-Tool-Context")
            )
            if method == "GET" and segments == ["catalog"]:
                self._send_json(HTTPStatus.OK, state.read_catalog())
                return
            if method == "POST" and segments == ["catalog", "refresh"]:
                self._ensure_empty_or_json_body()
                self._send_json(HTTPStatus.OK, state.refresh_catalog())
                return
            if method == "GET" and segments == ["workflows"]:
                self._send_json(
                    HTTPStatus.OK,
                    {"ok": True, "workflows": state.list_workflows()},
                )
                return
            if len(segments) == 2 and segments[0] == "workflows":
                filename = self._decode_filename(segments[1])
                if method == "GET":
                    self._send_json(HTTPStatus.OK, state.read_workflow(filename))
                    return
                if method == "PUT":
                    workflow = self._read_json_body()
                    self._send_json(
                        HTTPStatus.OK,
                        state.save_workflow(
                            filename,
                            workflow,
                            overwrite=self.headers.get("If-None-Match") != "*",
                        ),
                    )
                    return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "workflows"
                and segments[2] == "run"
            ):
                self._ensure_empty_or_json_body()
                filename = self._decode_filename(segments[1])
                self._send_json(
                    HTTPStatus.OK,
                    state.run_workflow(filename),
                )
                return
            raise BridgeError(HTTPStatus.NOT_FOUND, "not_found", "요청한 API 경로가 없습니다.")
        except BridgeError as error:
            self._send_error(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._send_error(
                BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "로컬 브리지 처리 중 예기치 않은 오류가 발생했습니다.",
                )
            )

    def _require_authorized(self) -> None:
        authorization = self.headers.get("Authorization", "")
        scheme, separator, candidate = authorization.partition(" ")
        if (
            not separator
            or scheme.lower() != "bearer"
            or not hmac.compare_digest(candidate, self.server.state.auth_token)
        ):
            raise BridgeError(
                HTTPStatus.UNAUTHORIZED,
                "pairing_required",
                "로컬 브리지 페어링 토큰이 필요합니다.",
            )

    def _decode_filename(self, segment: str) -> str:
        try:
            filename = unquote(segment, encoding="utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_filename",
                "파일명 URL 인코딩이 올바르지 않습니다.",
            ) from error
        return _safe_workflow_filename(filename)

    def _read_json_body(self) -> Any:
        content_type = self.headers.get_content_type()
        if content_type != "application/json":
            raise BridgeError(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "content_type_required",
                "Content-Type은 application/json이어야 합니다.",
            )
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise BridgeError(
                HTTPStatus.LENGTH_REQUIRED,
                "content_length_required",
                "Content-Length가 필요합니다.",
            )
        try:
            length = int(length_header)
        except ValueError as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_content_length",
                "Content-Length가 올바르지 않습니다.",
            ) from error
        if length < 0:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_content_length",
                "Content-Length가 올바르지 않습니다.",
            )
        if length > self.server.state.body_limit:
            raise BridgeError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "body_too_large",
                f"요청 본문은 {self.server.state.body_limit}바이트를 넘을 수 없습니다.",
            )
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_json",
                "요청 본문이 올바른 UTF-8 JSON이 아닙니다.",
            ) from error

    def _ensure_empty_or_json_body(self) -> None:
        length_header = self.headers.get("Content-Length")
        if length_header in {None, "", "0"}:
            return
        self._read_json_body()

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in self.server.state.allowed_origins

    def _send_error(self, error: BridgeError) -> None:
        error_body: dict[str, Any] = {
            "code": error.code,
            "message": error.message,
        }
        if error.details:
            error_body["details"] = error.details
        self._send_json(error.status, {"ok": False, "error": error_body})

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._send_common_headers()
        if status == HTTPStatus.UNAUTHORIZED:
            self.send_header("WWW-Authenticate", 'Bearer realm="InfraX Studio Bridge"')
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_common_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin in self.server.state.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")


def create_server(
    *,
    root: Path | None = None,
    port: int = DEFAULT_PORT,
    allowed_origins: set[str] | frozenset[str] = DEFAULT_ALLOWED_ORIGINS,
    auth_token: str | None = None,
    body_limit: int = DEFAULT_BODY_LIMIT,
    catalog_timeout: float = DEFAULT_CATALOG_TIMEOUT,
    run_timeout: float = DEFAULT_RUN_TIMEOUT,
) -> StudioBridgeServer:
    """Create a loopback-only server. ``port=0`` is useful for tests."""

    project_root = Path(root) if root is not None else Path(__file__).resolve().parent
    state = BridgeState(
        project_root,
        allowed_origins=allowed_origins,
        auth_token=auth_token or secrets.token_urlsafe(32),
        body_limit=body_limit,
        catalog_timeout=catalog_timeout,
        run_timeout=run_timeout,
    )
    return StudioBridgeServer((DEFAULT_HOST, port), state)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="InfraX Studio local workflow bridge")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"loopback port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        type=_validate_origin,
        help="additional exact browser origin; may be repeated",
    )
    parser.add_argument(
        "--catalog-timeout",
        type=float,
        default=DEFAULT_CATALOG_TIMEOUT,
        help=f"catalog.py timeout in seconds (default: {DEFAULT_CATALOG_TIMEOUT:g})",
    )
    parser.add_argument(
        "--run-timeout",
        type=float,
        default=DEFAULT_RUN_TIMEOUT,
        help=f"main.py timeout in seconds (default: {DEFAULT_RUN_TIMEOUT:g})",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if not 0 <= args.port <= 65535:
        raise SystemExit("--port must be between 0 and 65535")
    allowed_origins = set(DEFAULT_ALLOWED_ORIGINS)
    allowed_origins.update(args.allow_origin)
    server = create_server(
        port=args.port,
        allowed_origins=allowed_origins,
        catalog_timeout=args.catalog_timeout,
        run_timeout=args.run_timeout,
    )
    host, port = server.server_address
    print(f"InfraX Studio bridge: http://{host}:{port}", flush=True)
    print(f"Pairing token: {server.state.auth_token}", flush=True)
    print("Allowed browser origins:", flush=True)
    for origin in sorted(allowed_origins):
        print(f"  - {origin}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping InfraX Studio bridge.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
