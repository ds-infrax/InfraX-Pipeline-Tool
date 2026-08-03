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
import base64
import ctypes
import errno
import hashlib
import hmac
import html
import http.client
import json
import os
import queue
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import zipfile
from ctypes import wintypes
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit


BRIDGE_VERSION = "1"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
LOCAL_API_PREFIX = "local-api"
LOCAL_SESSION_COOKIE = "InfraXStudioSession"
DEFAULT_STUDIO_DIRECTORY = "studio_web"
DEFAULT_BODY_LIMIT = 5 * 1024 * 1024
DEFAULT_CATALOG_TIMEOUT = 30.0
DEFAULT_RUN_TIMEOUT = 600.0
RUN_EVENT_PREFIX = "INFRA_RUN_EVENT "
MAX_RESPONSE_OUTPUT = 200_000
MAX_TOOL_CONTEXTS = 64
DEFAULT_PACKAGE_ARCHIVE_LIMIT = 16 * 1024 * 1024 * 1024
MAX_PACKAGE_ENTRIES = 20_000
MAX_PACKAGE_UNCOMPRESSED_BYTES = 32 * 1024 * 1024 * 1024
MAX_PACKAGE_COMPRESSION_RATIO = 200
MAX_PACKAGE_METADATA_HEADER = 64 * 1024
MIN_PACKAGE_DISK_RESERVE = 512 * 1024 * 1024
PLATFORM_PROXY_TIMEOUT = 5.0
MAX_PLATFORM_EXCHANGE_RESPONSE = 1024 * 1024
PACKAGE_REGISTRY_FILENAME = "package-registry.json"
PACKAGE_MANIFEST_FILENAME = "infrax-package.json"
TOOL_CONFIG_FILENAME = "tool-config.json"
PLATFORM_CREDENTIAL_FILENAME = "marketplace-credentials.bin"

_SEMVER_PATTERN = re.compile(
    r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-(?:(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)
_SHA256_PATTERN = re.compile(r"[a-f0-9]{64}")
_PACKAGE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
_LOCAL_CONNECT_CODE_PATTERN = re.compile(r"ixc_[A-Za-z0-9_-]{43}")
_LOCAL_CONNECT_VERIFIER_PATTERN = re.compile(r"[A-Za-z0-9._~-]{43,128}")
_LOCAL_CONNECT_STATE_PATTERN = re.compile(r"[A-Za-z0-9_-]{22,128}")
_LOCAL_MARKETPLACE_TOKEN_PATTERN = re.compile(r"ixm_[A-Za-z0-9_-]{43}")
_LOCAL_REFRESH_TOKEN_PATTERN = re.compile(r"ixr_[A-Za-z0-9_-]{43,256}")
_LOCAL_SOURCE_EXCLUDED_DIRECTORIES = frozenset(
    {
        ".aws",
        ".git",
        ".hg",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".ssh",
        ".svn",
        ".tox",
        ".venv",
        "__pycache__",
        "build",
        "dist",
        "node_modules",
        "venv",
    }
)
def _load_tool_version(path: Path | None = None) -> str:
    """Load the packaged tool version from the single VERSION source."""

    version_path = path or Path(__file__).resolve().with_name("VERSION")
    try:
        version = version_path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise RuntimeError(f"Tool VERSION file is missing: {version_path}") from error
    if _SEMVER_PATTERN.fullmatch(version) is None:
        raise RuntimeError(f"Tool VERSION must contain semantic version text: {version_path}")
    return version


TOOL_VERSION = _load_tool_version()

STUDIO_STATIC_FILES = frozenset(
    {
        "index.html",
        "app.js",
        "styles.css",
        "ui-components.js",
    }
)
STUDIO_REQUIRED_ASSET_FILES = frozenset(
    {
        "assets/material-symbols-outlined.woff2",
    }
)
STUDIO_ASSET_EXTENSIONS = frozenset(
    {
        ".avif",
        ".gif",
        ".ico",
        ".jpeg",
        ".jpg",
        ".png",
        ".svg",
        ".webp",
        ".woff",
        ".woff2",
    }
)
STUDIO_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}

DEFAULT_ALLOWED_ORIGINS = frozenset(
    {
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


def _default_platform_credential_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local_app_data:
        return Path(local_app_data) / "InfraX" / "PipelineTool" / PLATFORM_CREDENTIAL_FILENAME
    return Path.home() / ".config" / "infrax-pipeline-tool" / PLATFORM_CREDENTIAL_FILENAME


def _windows_dpapi(data: bytes, *, decrypt: bool = False) -> bytes:
    """Protect credential bytes for the current Windows user."""

    if os.name != "nt":
        raise OSError("Windows DPAPI is unavailable")

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    source_buffer = ctypes.create_string_buffer(data)
    source = DATA_BLOB(
        len(data),
        ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)),
    )
    target = DATA_BLOB()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if decrypt:
        ok = crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
        )
    else:
        ok = crypt32.CryptProtectData(
            ctypes.byref(source),
            "InfraX Pipeline Tool Marketplace",
            None,
            None,
            None,
            0x1,  # CRYPTPROTECT_UI_FORBIDDEN
            ctypes.byref(target),
        )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel32.LocalFree(target.pbData)


class PlatformCredentialStore:
    """DPAPI-backed refresh credential storage.

    Other operating systems intentionally fall back to memory-only credentials
    instead of writing a reusable bearer secret as plaintext.
    """

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or _default_platform_credential_path()
        self._memory_refresh_token: str | None = None

    def load(self) -> str | None:
        if os.name != "nt":
            return self._memory_refresh_token
        try:
            encoded = self.path.read_bytes()
            payload = _windows_dpapi(base64.b64decode(encoded), decrypt=True)
            document = json.loads(payload.decode("utf-8"))
            token = document.get("refreshToken")
            return token if isinstance(token, str) else None
        except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return None

    def save(self, refresh_token: str) -> None:
        if _LOCAL_REFRESH_TOKEN_PATTERN.fullmatch(refresh_token) is None:
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace server returned an invalid refresh credential.",
            )
        self._memory_refresh_token = refresh_token
        if os.name != "nt":
            return
        payload = json.dumps(
            {"version": 1, "refreshToken": refresh_token},
            separators=(",", ":"),
        ).encode("utf-8")
        protected = _windows_dpapi(payload)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(base64.b64encode(protected))
        os.replace(temporary, self.path)

    def clear(self) -> None:
        self._memory_refresh_token = None
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


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


def _validate_platform_api_base(value: str) -> str:
    """Validate a fixed central HTTPS API base used by the local Studio."""

    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.path.startswith("/")
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError(
            "platform API base must be an absolute HTTPS URL, "
            "for example https://studio.example/pipeline/api"
        )
    normalized_path = parsed.path.rstrip("/")
    if not normalized_path:
        raise argparse.ArgumentTypeError("platform API base must include an API path")
    return f"https://{parsed.netloc}{normalized_path}"


def _load_tool_config(path: Path | None = None) -> dict[str, Any]:
    """Read the optional, non-secret local tool configuration."""

    config_path = path or Path(__file__).resolve().with_name(TOOL_CONFIG_FILENAME)
    if not config_path.exists():
        return {}
    try:
        if config_path.stat().st_size > 64 * 1024:
            raise ValueError(f"{TOOL_CONFIG_FILENAME} is too large")
        document = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{TOOL_CONFIG_FILENAME} must be valid UTF-8 JSON") from error
    if not isinstance(document, dict):
        raise ValueError(f"{TOOL_CONFIG_FILENAME} must contain a JSON object")
    value = document.get("platformApiBase")
    if value is not None and not isinstance(value, str):
        raise ValueError("tool-config platformApiBase must be a string or null")
    return document


def _resolve_platform_api_base(
    *,
    cli_value: str | None,
    offline: bool,
    environ: dict[str, str] | os._Environ[str] | None = None,
    config_path: Path | None = None,
) -> str | None:
    """Resolve central API configuration without making a network request."""

    if offline:
        return None
    environment = os.environ if environ is None else environ
    configured = cli_value
    if configured is None:
        configured = environment.get("INFRAX_PLATFORM_API_BASE") or None
    if configured is None:
        configured = _load_tool_config(config_path).get("platformApiBase")
    if configured is None or not str(configured).strip():
        return None
    return _validate_platform_api_base(str(configured))


def _validate_package_id(value: str) -> str:
    """Return a safe package id that can also be used as one directory name."""

    if (
        not isinstance(value, str)
        or _PACKAGE_ID_PATTERN.fullmatch(value) is None
        or value.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES
        or value.endswith((".", " "))
    ):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_id",
            "패키지 ID는 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.",
        )
    return value


def _safe_workflow_relative_path(value: str) -> Path:
    """Return a safe workflow path relative to workflows/.

    Normal workflow assets live under workflows/list/.  The active editing copy
    lives under workflows/current/, and replaced drafts are stashed under
    workflows/temp/.
    """

    normalized = str(value or "").replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if len(parts) == 1:
        return Path("list") / _safe_workflow_filename(parts[0])
    if len(parts) == 2 and parts[0] in {"list", "current", "temp"}:
        return Path(parts[0]) / _safe_workflow_filename(parts[1])
    raise BridgeError(
        HTTPStatus.BAD_REQUEST,
        "invalid_filename",
        "workflows/list, workflows/current, workflows/temp 폴더의 JSON 파일만 사용할 수 있습니다.",
    )


def _validate_package_metadata(value: Any, *, expected_id: str) -> dict[str, Any]:
    """Validate marketplace-supplied metadata without accepting paths or commands."""

    if not isinstance(value, dict):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 메타데이터는 JSON 객체여야 합니다.",
        )
    allowed_keys = {"id", "name", "version", "kind", "sha256", "nodeTypes"}
    if set(value) - allowed_keys:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 메타데이터에 허용되지 않은 항목이 있습니다.",
        )
    package_id = _validate_package_id(value.get("id"))
    if package_id != expected_id:
        raise BridgeError(
            HTTPStatus.CONFLICT,
            "package_id_mismatch",
            "URL과 패키지 메타데이터의 ID가 일치하지 않습니다.",
        )
    name = value.get("name")
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name.strip()) > 200
        or _CONTROL_CHARACTER_PATTERN.search(name)
    ):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 이름은 1자 이상 200자 이하여야 합니다.",
        )
    version = value.get("version")
    if not isinstance(version, str) or _SEMVER_PATTERN.fullmatch(version) is None:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 버전은 semantic version 형식이어야 합니다.",
        )
    kind = value.get("kind")
    if kind not in {"node-pack", "model-pack"}:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 kind는 node-pack 또는 model-pack이어야 합니다. Git 자동 설치는 지원하지 않습니다.",
        )
    digest = value.get("sha256")
    if not isinstance(digest, str) or _SHA256_PATTERN.fullmatch(digest) is None:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "패키지 sha256 값이 올바르지 않습니다.",
        )
    node_types = value.get("nodeTypes", [])
    if (
        not isinstance(node_types, list)
        or len(node_types) > 2_000
        or any(
            not isinstance(node_type, str)
            or not node_type.strip()
            or len(node_type.strip()) > 256
            or _CONTROL_CHARACTER_PATTERN.search(node_type)
            for node_type in node_types
        )
    ):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_package_metadata",
            "nodeTypes는 최대 2,000개의 유효한 노드 타입 문자열이어야 합니다.",
        )
    return {
        "id": package_id,
        "name": name.strip(),
        "version": version,
        "kind": kind,
        "sha256": digest,
        "nodeTypes": list(dict.fromkeys(node_type.strip() for node_type in node_types)),
    }


def _decode_proxy_segment(value: str) -> str:
    try:
        decoded = unquote(value, encoding="utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_platform_api_path",
            "중앙 API 경로의 URL 인코딩이 올바르지 않습니다.",
        ) from error
    if (
        not decoded
        or "/" in decoded
        or "\\" in decoded
        or _CONTROL_CHARACTER_PATTERN.search(decoded)
    ):
        raise BridgeError(
            HTTPStatus.BAD_REQUEST,
            "invalid_platform_api_path",
            "중앙 API 경로가 올바르지 않습니다.",
        )
    return decoded


def _platform_proxy_suffix(method: str, segments: list[str]) -> str | None:
    """Return an allowlisted path below the configured central API base."""

    if not segments or segments[0] != "api":
        return None
    decoded = [_decode_proxy_segment(segment) for segment in segments[1:]]
    if decoded in (["health"], ["session"]) and method == "GET":
        return "/" + decoded[0]
    if decoded == ["pipeline-tool", "releases", "latest"] and method == "GET":
        return "/pipeline-tool/releases/latest"
    if (
        len(decoded) == 4
        and decoded[:2] == ["pipeline-tool", "releases"]
        and decoded[3] == "download"
        and _SEMVER_PATTERN.fullmatch(decoded[2])
        and method in {"GET", "HEAD"}
    ):
        return (
            "/pipeline-tool/releases/"
            + quote(decoded[2], safe="")
            + "/download"
        )
    if decoded in (
        ["local-connect", "exchange"],
        ["local-connect", "logout"],
    ) and method == "POST":
        return "/" + "/".join(decoded)
    if (
        decoded in (["marketplace", "workflows"], ["marketplace", "modules"])
        and method == "GET"
    ):
        return "/" + "/".join(decoded)
    if (
        len(decoded) == 3
        and decoded[:2] in (
            ["marketplace", "workflows"],
            ["marketplace", "modules"],
        )
        and _PACKAGE_ID_PATTERN.fullmatch(decoded[2])
        and method in {"GET", "PUT"}
    ):
        return "/" + "/".join(
            [decoded[0], decoded[1], quote(decoded[2], safe="")]
        )
    if (
        len(decoded) == 4
        and decoded[:2] == ["marketplace", "modules"]
        and _PACKAGE_ID_PATTERN.fullmatch(decoded[2])
        and decoded[3] == "download"
        and method in {"GET", "HEAD"}
    ):
        return (
            "/marketplace/modules/"
            + quote(decoded[2], safe="")
            + "/download"
        )
    return None


def _resolve_studio_root(value: Path | str) -> Path:
    """Resolve and validate the immutable local Studio web bundle."""

    try:
        root = Path(value).resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError(f"Studio web directory does not exist: {value}") from error
    if not root.is_dir():
        raise ValueError(f"Studio web path is not a directory: {root}")
    missing = sorted(
        name
        for name in STUDIO_STATIC_FILES | STUDIO_REQUIRED_ASSET_FILES
        if not (root / name).is_file() or _path_is_linklike(root / name)
    )
    if missing:
        raise ValueError(
            "Studio web directory is incomplete; missing: " + ", ".join(missing)
        )
    index_source = (root / "index.html").read_text(encoding="utf-8")
    required_markers = (
        'data-api-base=""',
        'data-local-tool-base="http://127.0.0.1:8765/"',
        'data-local-tool-token=""',
        'data-local-studio="false"',
    )
    missing_markers = [marker for marker in required_markers if marker not in index_source]
    if missing_markers:
        raise ValueError(
            "Studio index.html is not a compatible local bundle; missing runtime markers"
        )
    return root


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


def _parse_run_event_line(line: str) -> dict[str, Any] | None:
    if not line.startswith(RUN_EVENT_PREFIX):
        return None
    try:
        event = json.loads(line[len(RUN_EVENT_PREFIX):])
    except json.JSONDecodeError:
        return None
    return event if isinstance(event, dict) else None


def _path_is_linklike(path: Path) -> bool:
    """Return whether a local path redirects to another filesystem location."""

    return path.is_symlink() or (
        hasattr(path, "is_junction") and path.is_junction()
    )


def _local_source_name_excluded(name: str, *, directory: bool) -> bool:
    lowered = name.casefold()
    if directory:
        return (
            lowered.startswith(".")
            or lowered in _LOCAL_SOURCE_EXCLUDED_DIRECTORIES
        )
    if lowered.startswith(".") or lowered == PACKAGE_MANIFEST_FILENAME.casefold():
        return True
    document_suffix = Path(lowered).suffix
    return not (
        lowered.endswith((".py", ".pyi"))
        or (
            lowered.startswith(("readme", "license"))
            and document_suffix in {"", ".adoc", ".md", ".rst", ".txt"}
        )
        or (
            lowered.startswith("requirements")
            and lowered.endswith(".txt")
        )
        or lowered == "pyproject.toml"
    )


class BridgeState:
    """Filesystem and subprocess operations shared by request handlers."""

    def __init__(
        self,
        root: Path,
        *,
        allowed_origins: set[str] | frozenset[str],
        auth_token: str,
        body_limit: int = DEFAULT_BODY_LIMIT,
        package_archive_limit: int = DEFAULT_PACKAGE_ARCHIVE_LIMIT,
        catalog_timeout: float = DEFAULT_CATALOG_TIMEOUT,
        run_timeout: float = DEFAULT_RUN_TIMEOUT,
    ) -> None:
        self.allowed_origins = frozenset(allowed_origins)
        self.auth_token = auth_token
        self.body_limit = body_limit
        self.package_archive_limit = package_archive_limit
        self.catalog_timeout = catalog_timeout
        self.run_timeout = run_timeout
        self.catalog_lock = threading.Lock()
        self.workflow_lock = threading.RLock()
        self.run_lock = threading.Lock()
        self.package_lock = threading.RLock()

        if not auth_token or len(auth_token) < 32:
            raise ValueError("auth_token must contain at least 32 characters")
        if body_limit <= 0:
            raise ValueError("body_limit must be positive")
        if package_archive_limit <= 0:
            raise ValueError("package_archive_limit must be positive")
        if catalog_timeout <= 0 or run_timeout <= 0:
            raise ValueError("subprocess timeouts must be positive")
        self._set_tool_root(root)

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "service": "infrax-pipeline-tool",
            "version": BRIDGE_VERSION,
            "toolVersion": TOOL_VERSION,
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
        app_package = resolved_root / "app"
        app_init = app_package / "__init__.py"
        required_paths = (
            (catalog_script, resolved_root),
            (main_script, resolved_root),
            (app_init, app_package),
        )
        for required_path, required_parent in required_paths:
            try:
                resolved_required = required_path.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "실행 도구 폴더에는 catalog.py, main.py, app 패키지가 필요합니다.",
                ) from error
            try:
                resolved_parent = required_parent.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "실행 도구 폴더의 app 패키지를 확인할 수 없습니다.",
                ) from error
            if not resolved_required.is_file() or resolved_required.parent != resolved_parent:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_missing_files",
                    "필수 실행 파일은 실행 도구 폴더 내부의 정해진 위치에 있어야 합니다.",
                )
        if app_package.resolve(strict=True).parent != resolved_root:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "tool_root_missing_files",
                "app 패키지는 실행 도구 폴더 바로 아래에 있어야 합니다.",
            )

        workflows_path = resolved_root / "workflows"
        try:
            workflows_path.mkdir(parents=True, exist_ok=True)
            for workflow_subdir in ("list", "current", "temp"):
                (workflows_path / workflow_subdir).mkdir(parents=True, exist_ok=True)
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
        self.package_registry_path = resolved_root / PACKAGE_REGISTRY_FILENAME
        self.package_roots: dict[str, Path] = {}
        for kind, directory_name in (
            ("node-pack", "custom_nodes"),
            ("model-pack", "models"),
        ):
            package_root = resolved_root / directory_name
            try:
                if _path_is_linklike(package_root):
                    raise OSError("symbolic-link package root")
                package_root.mkdir(parents=True, exist_ok=True)
                resolved_package_root = package_root.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_invalid_package_directory",
                    f"{directory_name} 패키지 폴더를 준비할 수 없습니다.",
                ) from error
            if (
                not resolved_package_root.is_dir()
                or resolved_package_root.parent != resolved_root
            ):
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "tool_root_invalid_package_directory",
                    f"{directory_name}는 실행 도구 폴더 바로 아래의 실제 폴더여야 합니다.",
                )
            self.package_roots[kind] = resolved_package_root

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
        return self._annotate_catalog_packages(catalog)

    def list_packages(self) -> list[dict[str, Any]]:
        """List packages installed by the fixed local package installer."""

        with self.package_lock:
            packages = self._read_package_registry_unlocked()
            return [
                package
                for package in packages
                if self._registered_package_path(package).is_dir()
                and not _path_is_linklike(self._registered_package_path(package))
            ]

    def _collect_local_custom_node_files(
        self,
        package_root: Path,
    ) -> tuple[list[tuple[Path, str, int]], int]:
        """Collect only the conservative source allowlist used for publishing."""

        files: list[tuple[Path, str, int]] = []
        total_size = 0
        for current_root, directory_names, file_names in os.walk(
            package_root,
            topdown=True,
            followlinks=False,
        ):
            current_path = Path(current_root)
            directory_names[:] = [
                directory_name
                for directory_name in directory_names
                if not _local_source_name_excluded(
                    directory_name,
                    directory=True,
                )
                and not _path_is_linklike(current_path / directory_name)
            ]
            for file_name in file_names:
                candidate = current_path / file_name
                if (
                    _local_source_name_excluded(file_name, directory=False)
                    or _path_is_linklike(candidate)
                    or not candidate.is_file()
                ):
                    continue
                try:
                    relative_path = candidate.relative_to(
                        package_root
                    ).as_posix()
                    file_size = candidate.stat().st_size
                except (OSError, ValueError):
                    continue
                files.append((candidate, relative_path, file_size))
                total_size += file_size
                if (
                    len(files) > MAX_PACKAGE_ENTRIES - 1
                    or total_size > MAX_PACKAGE_UNCOMPRESSED_BYTES
                ):
                    raise BridgeError(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        "package_archive_too_large",
                        "로컬 노드 패키지가 게시 안전 한도를 넘습니다.",
                    )
        return (
            sorted(files, key=lambda item: item[1].casefold()),
            total_size,
        )

    def list_local_custom_node_packages(self) -> list[dict[str, Any]]:
        """List publishable top-level custom_nodes directories from catalog."""

        with self.catalog_lock:
            catalog = self._read_catalog_unlocked()
        registry_ids = {
            package["id"]
            for package in self.list_packages()
            if package["kind"] == "node-pack"
        }
        node_types_by_package: dict[str, list[str]] = {}
        for node in catalog.get("nodes", []):
            if not isinstance(node, dict):
                continue
            module_name = node.get("module")
            node_type = node.get("key")
            if not isinstance(module_name, str) or not isinstance(node_type, str):
                continue
            module_parts = module_name.split(".")
            if len(module_parts) < 2 or module_parts[0] != "custom_nodes":
                continue
            package_id = module_parts[1]
            try:
                _validate_package_id(package_id)
            except BridgeError:
                continue
            node_types_by_package.setdefault(package_id, []).append(node_type)

        package_root = self.package_roots["node-pack"]
        packages: list[dict[str, Any]] = []
        for package_id, node_types in node_types_by_package.items():
            if package_id in registry_ids:
                continue
            candidate = package_root / package_id
            if (
                not candidate.is_dir()
                or _path_is_linklike(candidate)
                or candidate.parent != package_root
            ):
                continue
            files, total_size = self._collect_local_custom_node_files(candidate)
            if not any(
                relative_path.lower().endswith((".py", ".pyi"))
                for _, relative_path, _ in files
            ):
                continue
            packages.append(
                {
                    "id": package_id,
                    "name": package_id,
                    "kind": "node-pack",
                    "source": "custom_nodes",
                    "installPath": f"custom_nodes/{package_id}",
                    "nodeTypes": sorted(set(node_types), key=str.casefold),
                    "fileCount": len(files),
                    "size": total_size,
                }
            )
        return sorted(packages, key=lambda package: package["id"].casefold())

    def local_custom_node_package(self, package_id: str) -> dict[str, Any]:
        safe_id = _validate_package_id(package_id)
        for package in self.list_local_custom_node_packages():
            if package["id"] == safe_id:
                return package
        raise BridgeError(
            HTTPStatus.NOT_FOUND,
            "local_custom_node_package_not_found",
            "catalog에서 확인된 최상위 custom_nodes 패키지가 없습니다.",
        )

    def build_local_custom_node_archive(
        self,
        package_id: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Archive one catalog-confirmed top-level custom_nodes package."""

        local_package = self.local_custom_node_package(package_id)
        package_root = self.package_roots["node-pack"] / local_package["id"]
        with self.package_lock:
            if (
                not package_root.is_dir()
                or _path_is_linklike(package_root)
                or package_root.parent != self.package_roots["node-pack"]
            ):
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "local_custom_node_package_not_found",
                    "선택한 custom_nodes 패키지를 찾을 수 없습니다.",
                )
            files, total_size = self._collect_local_custom_node_files(
                package_root
            )
            if not files or not any(
                relative_path.lower().endswith((".py", ".pyi"))
                for _, relative_path, _ in files
            ):
                raise BridgeError(
                    HTTPStatus.CONFLICT,
                    "local_custom_node_package_empty",
                    "게시할 Python 노드 소스가 없습니다.",
                )
            if total_size + MIN_PACKAGE_DISK_RESERVE > shutil.disk_usage(self.root).free:
                raise BridgeError(
                    HTTPStatus.INSUFFICIENT_STORAGE,
                    "package_disk_space_insufficient",
                    "로컬 노드 ZIP을 만들 디스크 여유 공간이 부족합니다.",
                )

            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{package_id}.local-source-",
                suffix=".zip",
                dir=self.root,
            )
            os.close(descriptor)
            archive_path = Path(temporary_name)
            manifest = {
                "schema": "infrax.package.v1",
                "id": package_id,
                "name": metadata["name"],
                "version": metadata["version"],
                "kind": "node-pack",
                "nodeTypes": metadata["nodeTypes"],
                "source": "local-custom-node",
            }
            try:
                with zipfile.ZipFile(
                    archive_path,
                    mode="w",
                    compression=zipfile.ZIP_STORED,
                    allowZip64=True,
                ) as archive:
                    for source, relative_path, _ in files:
                        archive.write(source, arcname=relative_path)
                    archive.writestr(
                        PACKAGE_MANIFEST_FILENAME,
                        json.dumps(
                            manifest,
                            ensure_ascii=False,
                            indent=2,
                        )
                        + "\n",
                    )
                archive_size = archive_path.stat().st_size
                if archive_size > self.package_archive_limit:
                    raise BridgeError(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        "package_archive_too_large",
                        "생성된 로컬 노드 ZIP이 허용 크기를 넘습니다.",
                    )
            except Exception:
                self._remove_local_path(archive_path)
                raise
            return {
                "path": archive_path,
                "size": archive_size,
                "fileName": f"{package_id}-{metadata['version']}.zip",
                "package": local_package,
            }

    def build_package_archive(self, package_id: str) -> dict[str, Any]:
        """Create a temporary ZIP from one registry-owned install directory."""

        safe_id = _validate_package_id(package_id)
        with self.package_lock:
            package = self._package_by_id_unlocked(safe_id)
            package_root = self._registered_package_path(package)
            if not package_root.is_dir() or _path_is_linklike(package_root):
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "installed_package_not_found",
                    "등록된 로컬 패키지 폴더를 찾을 수 없습니다.",
                )

            files: list[tuple[Path, str, int]] = []
            total_size = 0
            for current_root, directory_names, file_names in os.walk(
                package_root,
                topdown=True,
                followlinks=False,
            ):
                current_path = Path(current_root)
                for directory_name in directory_names:
                    candidate = current_path / directory_name
                    if _path_is_linklike(candidate):
                        raise BridgeError(
                            HTTPStatus.CONFLICT,
                            "package_archive_link_not_allowed",
                            "링크가 포함된 설치 패키지는 내보낼 수 없습니다.",
                        )
                for file_name in file_names:
                    candidate = current_path / file_name
                    is_root_manifest = (
                        current_path == package_root
                        and file_name.casefold()
                        == PACKAGE_MANIFEST_FILENAME.casefold()
                    )
                    if _path_is_linklike(candidate) or not candidate.is_file():
                        raise BridgeError(
                            HTTPStatus.CONFLICT,
                            "package_archive_link_not_allowed",
                            "링크나 특수 파일이 포함된 설치 패키지는 내보낼 수 없습니다.",
                        )
                    if is_root_manifest:
                        # The installed copy is local provenance, not trusted
                        # archive input. Emit a canonical registry-derived
                        # manifest below instead.
                        continue
                    try:
                        relative_path = candidate.relative_to(
                            package_root
                        ).as_posix()
                        file_size = candidate.stat().st_size
                    except (OSError, ValueError) as error:
                        raise BridgeError(
                            HTTPStatus.CONFLICT,
                            "package_archive_invalid",
                            "설치 패키지 파일을 안전하게 확인할 수 없습니다.",
                        ) from error
                    files.append((candidate, relative_path, file_size))
                    total_size += file_size
                    if (
                        len(files) > MAX_PACKAGE_ENTRIES - 1
                        or total_size > MAX_PACKAGE_UNCOMPRESSED_BYTES
                    ):
                        raise BridgeError(
                            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                            "package_archive_too_large",
                            "설치 패키지가 내보내기 안전 한도를 넘습니다.",
                        )
            manifest_body = (
                json.dumps(
                    {
                        "schema": "infrax.package.v1",
                        **package,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n"
            ).encode("utf-8")
            if (
                total_size + len(manifest_body)
                > MAX_PACKAGE_UNCOMPRESSED_BYTES
            ):
                raise BridgeError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    "package_archive_too_large",
                    "설치 패키지가 보관하기 안전한 크기 제한을 넘습니다.",
                )
            if not files:
                raise BridgeError(
                    HTTPStatus.CONFLICT,
                    "package_archive_empty",
                    "내보낼 패키지 파일이 없습니다.",
                )
            if (
                total_size
                + len(manifest_body)
                + MIN_PACKAGE_DISK_RESERVE
                > shutil.disk_usage(self.root).free
            ):
                raise BridgeError(
                    HTTPStatus.INSUFFICIENT_STORAGE,
                    "package_disk_space_insufficient",
                    "패키지 ZIP을 만들 디스크 여유 공간이 부족합니다.",
                )

            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{safe_id}.export-",
                suffix=".zip",
                dir=self.root,
            )
            os.close(descriptor)
            archive_path = Path(temporary_name)
            try:
                with zipfile.ZipFile(
                    archive_path,
                    mode="w",
                    compression=zipfile.ZIP_STORED,
                    allowZip64=True,
                ) as archive:
                    for source, relative_path, _ in sorted(
                        files,
                        key=lambda item: item[1].casefold(),
                    ):
                        archive.write(source, arcname=relative_path)
                    archive.writestr(
                        PACKAGE_MANIFEST_FILENAME,
                        manifest_body,
                    )
                archive_size = archive_path.stat().st_size
                if archive_size > self.package_archive_limit:
                    raise BridgeError(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        "package_archive_too_large",
                        "생성된 패키지 ZIP이 허용 크기를 넘습니다.",
                    )
                digest = hashlib.sha256()
                with archive_path.open("rb") as archive_file:
                    for chunk in iter(
                        lambda: archive_file.read(1024 * 1024),
                        b"",
                    ):
                        digest.update(chunk)
            except Exception:
                self._remove_local_path(archive_path)
                raise
            return {
                "path": archive_path,
                "size": archive_size,
                "sha256": digest.hexdigest(),
                "package": package,
                "fileName": f"{safe_id}-{package['version']}.zip",
            }

    def _package_by_id_unlocked(self, package_id: str) -> dict[str, Any]:
        for package in self._read_package_registry_unlocked():
            if package["id"] == package_id:
                return package
        raise BridgeError(
            HTTPStatus.NOT_FOUND,
            "installed_package_not_found",
            "로컬 레지스트리에 등록된 패키지가 없습니다.",
        )

    def install_package(
        self,
        metadata: dict[str, Any],
        archive_path: Path,
        archive_digest: str,
    ) -> dict[str, Any]:
        """Validate and atomically install one Marketplace ZIP package."""

        expected_digest = metadata["sha256"]
        if not hmac.compare_digest(expected_digest, archive_digest):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_digest_mismatch",
                "다운로드한 ZIP의 SHA-256이 Marketplace 메타데이터와 일치하지 않습니다.",
            )

        package_root = self.package_roots[metadata["kind"]]
        target = package_root / metadata["id"]

        with self.package_lock:
            if _path_is_linklike(target) or (target.exists() and not target.is_dir()):
                raise BridgeError(
                    HTTPStatus.CONFLICT,
                    "package_target_invalid",
                    "패키지 설치 대상은 실제 폴더여야 합니다.",
                )
            staging = Path(
                tempfile.mkdtemp(
                    prefix=f".{metadata['id']}.install-",
                    dir=package_root,
                )
            )
            backup = package_root / (
                f".{metadata['id']}.backup-{secrets.token_hex(12)}"
            )
            target_was_moved = False
            new_target_installed = False
            try:
                previous_catalog = (
                    self.catalog_path.read_bytes()
                    if self.catalog_path.is_file()
                    else None
                )
            except OSError as error:
                self._remove_local_path(staging)
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "catalog_backup_failed",
                    "패키지 설치 전 기존 catalog.json을 백업하지 못했습니다.",
                ) from error
            try:
                self._extract_package_archive(
                    archive_path,
                    staging,
                    kind=metadata["kind"],
                )
                installed_at = datetime.now(timezone.utc).isoformat()
                package = {
                    **metadata,
                    "installPath": target.relative_to(self.root).as_posix(),
                    "installedAt": installed_at,
                }
                (staging / PACKAGE_MANIFEST_FILENAME).write_text(
                    json.dumps(
                        {
                            "schema": "infrax.package.v1",
                            **package,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )

                if target.exists():
                    os.replace(target, backup)
                    target_was_moved = True
                os.replace(staging, target)
                new_target_installed = True

                refreshed = self.refresh_catalog()
                discovered_node_types = {
                    str(node.get("key"))
                    for node in refreshed["catalog"].get("nodes", [])
                    if isinstance(node, dict) and node.get("key")
                }
                missing_node_types = sorted(
                    set(package["nodeTypes"]) - discovered_node_types
                )
                if package["kind"] == "node-pack" and missing_node_types:
                    raise BridgeError(
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                        "package_catalog_mismatch",
                        "설치한 노드 패키지의 선언된 노드를 catalog.py에서 찾지 못했습니다.",
                        details={"missingNodeTypes": missing_node_types[:100]},
                    )
                catalog = self._annotate_catalog_packages(
                    refreshed["catalog"],
                    extra_package=package,
                )
                packages = [
                    current
                    for current in self._read_package_registry_unlocked()
                    if current["id"] != package["id"]
                ]
                packages.append(package)
                self._write_package_registry_unlocked(packages)
            except BridgeError as error:
                try:
                    self._rollback_package_install(
                        target=target,
                        backup=backup,
                        target_was_moved=target_was_moved,
                        new_target_installed=new_target_installed,
                        previous_catalog=previous_catalog,
                    )
                except BridgeError as rollback_error:
                    raise rollback_error from error
                raise
            except (OSError, RuntimeError, zipfile.BadZipFile) as error:
                try:
                    self._rollback_package_install(
                        target=target,
                        backup=backup,
                        target_was_moved=target_was_moved,
                        new_target_installed=new_target_installed,
                        previous_catalog=previous_catalog,
                    )
                except BridgeError as rollback_error:
                    raise rollback_error from error
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "package_install_failed",
                    "패키지를 안전하게 설치하지 못했습니다.",
                ) from error
            finally:
                self._remove_local_path(staging)

            self._remove_local_path(backup)
            return {
                "ok": True,
                "package": package,
                "catalog": catalog,
            }

    def _extract_package_archive(
        self,
        archive_path: Path,
        staging: Path,
        *,
        kind: str,
    ) -> None:
        """Extract a validated ZIP without trusting archive paths or attributes."""

        try:
            archive = zipfile.ZipFile(archive_path, mode="r")
        except (OSError, zipfile.BadZipFile) as error:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_invalid",
                "패키지 파일이 올바른 ZIP 형식이 아닙니다.",
            ) from error

        with archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_PACKAGE_ENTRIES:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "package_zip_invalid",
                    f"ZIP 항목 수는 1개 이상 {MAX_PACKAGE_ENTRIES:,}개 이하여야 합니다.",
                )
            total_uncompressed = 0
            seen_paths: set[str] = set()
            contains_python = False
            extracted_files = 0
            validated: list[tuple[zipfile.ZipInfo, tuple[str, ...]]] = []
            for entry in entries:
                parts = self._validate_zip_entry(entry)
                normalized = "/".join(parts).casefold()
                if normalized in seen_paths:
                    raise BridgeError(
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                        "package_zip_duplicate_path",
                        "ZIP에 대소문자만 다른 중복 경로가 있습니다.",
                    )
                seen_paths.add(normalized)
                if (
                    len(parts) == 1
                    and parts[0].casefold() == PACKAGE_MANIFEST_FILENAME.casefold()
                ):
                    if entry.is_dir():
                        raise BridgeError(
                            HTTPStatus.UNPROCESSABLE_ENTITY,
                            "package_zip_reserved_path",
                            f"{PACKAGE_MANIFEST_FILENAME}은 파일이어야 합니다.",
                        )
                    # Exported packages contain a provenance manifest. Never
                    # trust or extract it; a canonical manifest is written
                    # after all checks complete.
                    continue
                if not entry.is_dir():
                    extracted_files += 1
                    total_uncompressed += entry.file_size
                    if total_uncompressed > MAX_PACKAGE_UNCOMPRESSED_BYTES:
                        raise BridgeError(
                            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                            "package_uncompressed_too_large",
                            "ZIP을 푼 전체 크기가 허용 한도를 넘습니다.",
                        )
                    ratio = entry.file_size / max(entry.compress_size, 1)
                    if ratio > MAX_PACKAGE_COMPRESSION_RATIO:
                        raise BridgeError(
                            HTTPStatus.UNPROCESSABLE_ENTITY,
                            "package_compression_ratio_too_high",
                            "비정상적으로 압축률이 높은 ZIP 항목은 설치할 수 없습니다.",
                        )
                    contains_python = contains_python or parts[-1].lower().endswith(".py")
                validated.append((entry, parts))
            if extracted_files == 0:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "package_zip_invalid",
                    "ZIP에는 설치할 파일이 하나 이상 있어야 합니다.",
                )
            if kind == "node-pack" and not contains_python:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "node_package_has_no_python",
                    "노드 패키지 ZIP에는 Python 파일이 하나 이상 있어야 합니다.",
                )
            free_space = shutil.disk_usage(staging).free
            if (
                total_uncompressed + MIN_PACKAGE_DISK_RESERVE
                > free_space
            ):
                raise BridgeError(
                    HTTPStatus.INSUFFICIENT_STORAGE,
                    "package_disk_space_insufficient",
                    "ZIP을 안전하게 설치할 디스크 여유 공간이 부족합니다.",
                )

            copied_total = 0
            for entry, parts in validated:
                destination = staging.joinpath(*parts)
                if entry.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with archive.open(entry, mode="r") as source, destination.open("xb") as output:
                        copied_for_entry = 0
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            copied_for_entry += len(chunk)
                            copied_total += len(chunk)
                            if (
                                copied_for_entry > entry.file_size
                                or copied_total > MAX_PACKAGE_UNCOMPRESSED_BYTES
                            ):
                                raise BridgeError(
                                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                                    "package_uncompressed_too_large",
                                    "ZIP을 푼 크기가 선언된 안전 한도를 넘습니다.",
                                )
                            output.write(chunk)
                    if copied_for_entry != entry.file_size:
                        raise BridgeError(
                            HTTPStatus.UNPROCESSABLE_ENTITY,
                            "package_zip_invalid",
                            "ZIP 항목의 실제 크기가 메타데이터와 일치하지 않습니다.",
                        )
                except (OSError, RuntimeError, zipfile.BadZipFile) as error:
                    raise BridgeError(
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                        "package_zip_invalid",
                        "ZIP 항목을 안전하게 풀 수 없습니다.",
                    ) from error

    @staticmethod
    def _validate_zip_entry(entry: zipfile.ZipInfo) -> tuple[str, ...]:
        name = entry.filename
        if (
            not name
            or "\x00" in name
            or "\\" in name
            or name.startswith("/")
            or len(name) > 1_024
        ):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_unsafe_path",
                "ZIP에 안전하지 않은 경로가 있습니다.",
            )
        raw_parts = name.rstrip("/").split("/")
        if (
            not raw_parts
            or any(
                not part
                or part in {".", ".."}
                or len(part) > 240
                or _INVALID_FILENAME_CHARS.search(part)
                or part.endswith((".", " "))
                or part.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES
                for part in raw_parts
            )
        ):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_unsafe_path",
                "ZIP에 안전하지 않은 경로가 있습니다.",
            )
        if entry.flag_bits & 0x1:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_encrypted",
                "암호화된 ZIP 항목은 설치할 수 없습니다.",
            )
        if entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_compression_unsupported",
                "지원하지 않는 ZIP 압축 방식입니다.",
            )
        unix_mode = entry.external_attr >> 16
        file_type = stat.S_IFMT(unix_mode)
        if stat.S_ISLNK(unix_mode) or (
            file_type
            and not stat.S_ISREG(unix_mode)
            and not stat.S_ISDIR(unix_mode)
        ):
            raise BridgeError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "package_zip_link_not_allowed",
                "ZIP의 심볼릭 링크나 특수 파일은 설치할 수 없습니다.",
            )
        return tuple(raw_parts)

    def _annotate_catalog_packages(
        self,
        catalog: dict[str, Any],
        *,
        extra_package: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            packages = self._read_package_registry_unlocked()
        except BridgeError:
            packages = []
        packages = [
            package
            for package in packages
            if self._registered_package_path(package).is_dir()
            and not _path_is_linklike(self._registered_package_path(package))
        ]
        if extra_package is not None:
            packages = [
                package
                for package in packages
                if package["id"] != extra_package["id"]
            ]
            packages.append(extra_package)
        by_node_type: dict[str, dict[str, Any]] = {}
        for package in packages:
            for node_type in package.get("nodeTypes", []):
                by_node_type[node_type] = package
        for node in catalog.get("nodes", []):
            if not isinstance(node, dict):
                continue
            package = by_node_type.get(str(node.get("key", "")))
            if package is None:
                continue
            package_ref = {
                "package_id": package["id"],
                "version": package["version"],
                "digest": package["sha256"],
            }
            node["package_ref"] = package_ref
            node["package_id"] = package["id"]
            node["version"] = package["version"]
            node["digest"] = package["sha256"]
        model_package_ids = {
            package["id"]
            for package in packages
            if package["kind"] == "model-pack"
        }
        existing_models = [
            model
            for model in catalog.get("models", [])
            if isinstance(model, dict)
            and (
                not isinstance(model.get("package_ref"), dict)
                or model["package_ref"].get("package_id")
                not in model_package_ids
            )
        ] if isinstance(catalog.get("models", []), list) else []
        catalog["models"] = existing_models + self._catalog_package_models(packages)
        return catalog

    def _catalog_package_models(
        self,
        packages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        models: list[dict[str, Any]] = []
        for package in packages:
            if package["kind"] != "model-pack":
                continue
            package_root = self._registered_package_path(package)
            if not package_root.is_dir() or _path_is_linklike(package_root):
                continue
            package_ref = {
                "package_id": package["id"],
                "version": package["version"],
                "digest": package["sha256"],
            }
            discovered = 0
            for current_root, directory_names, file_names in os.walk(
                package_root,
                topdown=True,
                followlinks=False,
            ):
                current_path = Path(current_root)
                safe_directories: list[str] = []
                for directory_name in directory_names:
                    candidate = current_path / directory_name
                    if not _path_is_linklike(candidate):
                        safe_directories.append(directory_name)
                directory_names[:] = safe_directories
                for file_name in file_names:
                    candidate = current_path / file_name
                    if (
                        _path_is_linklike(candidate)
                        or not candidate.is_file()
                        or (
                            candidate.parent == package_root
                            and candidate.name.casefold()
                            == PACKAGE_MANIFEST_FILENAME.casefold()
                        )
                    ):
                        continue
                    try:
                        relative_inside_package = candidate.relative_to(
                            package_root
                        ).as_posix()
                        file_stat = candidate.stat()
                    except (OSError, ValueError):
                        continue
                    discovered += 1
                    if discovered > MAX_PACKAGE_ENTRIES:
                        break
                    relative_path = (
                        package["id"] + "/" + relative_inside_package
                    )
                    models.append(
                        {
                            "id": package["id"] + ":" + relative_inside_package,
                            "name": candidate.name,
                            "relative_path": relative_path,
                            "path": "models/" + relative_path,
                            "size": file_stat.st_size,
                            "package_ref": package_ref,
                        }
                    )
                if discovered > MAX_PACKAGE_ENTRIES:
                    break
        return sorted(
            models,
            key=lambda model: (
                model["package_ref"]["package_id"].casefold(),
                model["relative_path"].casefold(),
            ),
        )

    def _read_package_registry_unlocked(self) -> list[dict[str, Any]]:
        if not self.package_registry_path.exists():
            return []
        try:
            if self.package_registry_path.stat().st_size > 10 * 1024 * 1024:
                raise ValueError("registry too large")
            document = json.loads(
                self.package_registry_path.read_text(encoding="utf-8")
            )
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "package_registry_invalid",
                "로컬 패키지 레지스트리를 읽을 수 없습니다.",
            ) from error
        if (
            not isinstance(document, dict)
            or document.get("schema") != "infrax.package-registry.v1"
            or not isinstance(document.get("packages"), list)
        ):
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "package_registry_invalid",
                "로컬 패키지 레지스트리 형식이 올바르지 않습니다.",
            )
        packages: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for package in document["packages"]:
            try:
                validated = self._validate_registered_package(package)
            except (BridgeError, ValueError) as error:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "package_registry_invalid",
                    "로컬 패키지 레지스트리에 잘못된 항목이 있습니다.",
                ) from error
            if validated["id"] in seen_ids:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "package_registry_invalid",
                    "로컬 패키지 레지스트리에 중복된 패키지 ID가 있습니다.",
                )
            seen_ids.add(validated["id"])
            packages.append(validated)
        return packages

    def _validate_registered_package(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("package must be an object")
        metadata = _validate_package_metadata(
            {
                key: value.get(key)
                for key in ("id", "name", "version", "kind", "sha256", "nodeTypes")
            },
            expected_id=value.get("id"),
        )
        install_path = value.get("installPath")
        expected_path = (
            self.package_roots[metadata["kind"]] / metadata["id"]
        ).relative_to(self.root).as_posix()
        if install_path != expected_path:
            raise ValueError("invalid install path")
        installed_at = value.get("installedAt")
        if not isinstance(installed_at, str) or len(installed_at) > 64:
            raise ValueError("invalid installed time")
        try:
            datetime.fromisoformat(installed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("invalid installed time") from error
        return {
            **metadata,
            "installPath": install_path,
            "installedAt": installed_at,
        }

    def _registered_package_path(self, package: dict[str, Any]) -> Path:
        return self.package_roots[package["kind"]] / package["id"]

    def _write_package_registry_unlocked(
        self,
        packages: list[dict[str, Any]],
    ) -> None:
        payload = (
            json.dumps(
                {
                    "schema": "infrax.package-registry.v1",
                    "toolVersion": TOOL_VERSION,
                    "packages": packages,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{PACKAGE_REGISTRY_FILENAME}.",
                suffix=".tmp",
                dir=self.root,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(payload)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.package_registry_path)
            temporary_path = None
        except OSError as error:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "package_registry_write_failed",
                "로컬 패키지 레지스트리를 안전하게 저장하지 못했습니다.",
            ) from error
        finally:
            if temporary_path is not None:
                self._remove_local_path(temporary_path)

    def _rollback_package_install(
        self,
        *,
        target: Path,
        backup: Path,
        target_was_moved: bool,
        new_target_installed: bool,
        previous_catalog: bytes | None,
    ) -> None:
        rollback_failed = False
        if new_target_installed:
            self._remove_local_path(target)
            rollback_failed = target.exists() or target.is_symlink()
        if target_was_moved and backup.exists():
            try:
                os.replace(backup, target)
            except OSError:
                rollback_failed = True
        if not self._restore_catalog(previous_catalog):
            rollback_failed = True
        if rollback_failed:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "package_rollback_failed",
                "패키지 설치 실패 후 이전 상태를 완전히 복원하지 못했습니다. 백업 폴더를 보존했습니다.",
            )

    def _restore_catalog(self, previous_catalog: bytes | None) -> bool:
        temporary_path: Path | None = None
        try:
            if previous_catalog is None:
                self.catalog_path.unlink(missing_ok=True)
                return True
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=".catalog.",
                suffix=".tmp",
                dir=self.root,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(previous_catalog)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.catalog_path)
            temporary_path = None
            return True
        except OSError:
            return False
        finally:
            if temporary_path is not None:
                self._remove_local_path(temporary_path)

    @staticmethod
    def _remove_local_path(path: Path) -> None:
        try:
            if _path_is_linklike(path) or path.is_file():
                path.unlink(missing_ok=True)
            elif path.exists():
                shutil.rmtree(path)
        except OSError:
            pass

    def clear_current_workflows(self, *, archive: bool = True) -> dict[str, Any]:
        with self.workflow_lock:
            current_dir = self._current_workflow_dir()
            archived, cleanup_pending = self._clear_current_workflows(current_dir, archive=archive)
            current_dir.mkdir(parents=True, exist_ok=True)
        return {
            "ok": True,
            "directory": "workflows/current",
            "archived": archived,
            "stagingCleanupPending": cleanup_pending,
        }

    def current_workflow_state(self) -> dict[str, Any] | None:
        with self.workflow_lock:
            current_dir = self._current_workflow_dir()
            current_dir.mkdir(parents=True, exist_ok=True)
            candidates = sorted(
                path for path in current_dir.iterdir()
                if path.is_file() and path.suffix.lower() == ".json"
            )
            if not candidates:
                return None
            path = candidates[0]
            try:
                workflow = json.loads(path.read_text(encoding="utf-8"))
                self._validate_workflow_shape(workflow)
            except (OSError, UnicodeError, json.JSONDecodeError, BridgeError):
                return None
            return {
                "fileName": f"current/{path.name}",
                "workflow": workflow,
                "sourceWorkflow": self._workflow_source(workflow),
                "resetWorkflow": self._workflow_reset_source(workflow),
            }

    def list_workflows(self) -> list[dict[str, Any]]:
        with self.workflow_lock:
            workflows: list[dict[str, Any]] = []
            list_dir = self._list_workflow_dir()
            list_dir.mkdir(parents=True, exist_ok=True)
            for candidate in list_dir.iterdir():
                if not candidate.is_file() or candidate.suffix.lower() != ".json":
                    continue
                try:
                    safe_path = self._workflow_path(f"list/{candidate.name}")
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

    def list_temp_workflows(self) -> list[dict[str, Any]]:
        with self.workflow_lock:
            workflows: list[dict[str, Any]] = []
            temp_dir = self._temp_workflow_dir()
            temp_dir.mkdir(parents=True, exist_ok=True)
            for candidate in temp_dir.iterdir():
                if not candidate.is_file() or candidate.suffix.lower() != ".json":
                    continue
                try:
                    safe_path = self._workflow_path(f"temp/{candidate.name}")
                    stat = safe_path.stat()
                    data = json.loads(safe_path.read_text(encoding="utf-8"))
                except (BridgeError, OSError, UnicodeError, json.JSONDecodeError):
                    continue
                workflow_name = data.get("name") if isinstance(data, dict) else None
                node_count = len(data.get("nodes", [])) if isinstance(data, dict) and isinstance(data.get("nodes"), list) else 0
                workflows.append(
                    {
                        "fileName": f"temp/{candidate.name}",
                        "name": workflow_name if isinstance(workflow_name, str) else candidate.stem,
                        "size": stat.st_size,
                        "nodeCount": node_count,
                        "modifiedAt": _iso_timestamp(stat.st_mtime),
                    }
                )
            return sorted(workflows, key=lambda item: item["modifiedAt"], reverse=True)

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
                "fileName": self._workflow_response_filename(path),
                "workflow": workflow,
                "size": stat.st_size,
                "modifiedAt": _iso_timestamp(stat.st_mtime),
            }

    def activate_workflow(self, filename: str, *, archive_current: bool = False) -> dict[str, Any]:
        with self.workflow_lock:
            source_path = self._workflow_path(filename)
            if source_path.parent != self._list_workflow_dir():
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_filename",
                    "자산 워크플로우는 workflows 폴더의 원본 JSON 파일에서만 열 수 있습니다.",
                )
            if not source_path.is_file():
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "workflow_not_found",
                    f"워크플로우 파일을 찾을 수 없습니다: {filename}",
                )
            try:
                workflow = json.loads(source_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "workflow_invalid",
                    f"워크플로우 JSON을 읽을 수 없습니다: {filename}",
                ) from error
            self._validate_workflow_shape(workflow)

            current_dir = self._current_workflow_dir()
            result = self.save_current_workflow_as(
                f"current/{source_path.name}", workflow,
                source_workflow=f"list/{source_path.name}", archive_current=archive_current,
            )
            return {**result, "sourceFileName": source_path.name, "workflow": result["workflow"]}

    def restore_temp_workflow(self, filename: str) -> dict[str, Any]:
        with self.workflow_lock:
            source_path = self._workflow_path(filename)
            if source_path.parent != self._temp_workflow_dir():
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_filename",
                    "임시 보관함의 워크플로우만 복원할 수 있습니다.",
                )
            if not source_path.is_file():
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "workflow_not_found",
                    f"임시 워크플로우 파일을 찾을 수 없습니다: {filename}",
                )
            try:
                workflow = json.loads(source_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "workflow_invalid",
                    f"임시 워크플로우 JSON을 읽을 수 없습니다: {filename}",
                ) from error
            self._validate_workflow_shape(workflow)

            base_name = source_path.name
            for prefix in ("draft-",):
                if base_name.startswith(prefix):
                    base_name = base_name[len(prefix):]
            result = self.save_current_workflow_as(f"current/{base_name}", workflow)
            cleanup_pending = False
            try:
                source_path.unlink()
            except OSError:
                cleanup_pending = True
            return {
                **result,
                "sourceFileName": f"temp/{source_path.name}",
                "workflow": result["workflow"],
                "sourceCleanupPending": cleanup_pending,
            }

    def delete_temp_workflow(self, filename: str) -> dict[str, Any]:
        with self.workflow_lock:
            path = self._workflow_path(filename)
            if path.parent != self._temp_workflow_dir():
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_filename",
                    "임시 보관함의 워크플로우만 삭제할 수 있습니다.",
                )
            if not path.is_file():
                raise BridgeError(
                    HTTPStatus.NOT_FOUND,
                    "workflow_not_found",
                    f"임시 워크플로우 파일을 찾을 수 없습니다: {filename}",
                )
            path.unlink()
        return {"ok": True, "fileName": filename}

    def save_workflow(
        self,
        filename: str,
        workflow: Any,
        *,
        overwrite: bool = True,
        mirror_current_to_list: bool = True,
    ) -> dict[str, Any]:
        self._validate_workflow_shape(workflow)
        with self.workflow_lock:
            path = self._workflow_path(filename)
            path.parent.mkdir(parents=True, exist_ok=True)
            stored_workflow = workflow
            if path.parent == self._current_workflow_dir():
                if mirror_current_to_list:
                    stored_workflow = self._workflow_with_source(workflow, f"list/{path.name}")
                elif path.is_file():
                    try:
                        existing = json.loads(path.read_text(encoding="utf-8"))
                        stored_workflow = self._workflow_with_source(workflow, self._workflow_source(existing))
                    except (OSError, UnicodeError, json.JSONDecodeError):
                        stored_workflow = self._workflow_with_source(workflow, None)
            elif path.parent == self._list_workflow_dir():
                stored_workflow = self._workflow_with_source(workflow, None)
            payload = (json.dumps(stored_workflow, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            if len(payload) > self.body_limit:
                raise BridgeError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    "body_too_large",
                    f"저장할 JSON은 {self.body_limit}바이트를 넘을 수 없습니다.",
                )
            if not overwrite and path.exists():
                raise BridgeError(
                    HTTPStatus.CONFLICT,
                    "workflow_exists",
                    f"같은 이름의 워크플로우 파일이 이미 있습니다: {filename}",
                )
            temp_path: Path | None = None
            list_temp_path: Path | None = None
            list_path: Path | None = None
            path_backup = path.read_bytes() if path.exists() else None
            list_backup: bytes | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=f".{path.name}.",
                    suffix=".tmp",
                    dir=path.parent,
                    delete=False,
                ) as temp_file:
                    temp_path = Path(temp_file.name)
                    temp_file.write(payload)
                    temp_file.flush()
                    os.fsync(temp_file.fileno())
                if mirror_current_to_list and path.parent == self._current_workflow_dir():
                    list_path = self._list_workflow_dir() / path.name
                    list_path.parent.mkdir(parents=True, exist_ok=True)
                    list_backup = list_path.read_bytes() if list_path.exists() else None
                    list_workflow = self._workflow_with_source(workflow, None)
                    list_payload = (json.dumps(list_workflow, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                    with tempfile.NamedTemporaryFile(mode="wb", prefix=f".{list_path.name}.", suffix=".tmp", dir=list_path.parent, delete=False) as list_temp:
                        list_temp_path = Path(list_temp.name)
                        list_temp.write(list_payload)
                        list_temp.flush()
                        os.fsync(list_temp.fileno())
                os.replace(temp_path, path)
                temp_path = None
                if list_path is not None and list_temp_path is not None:
                    os.replace(list_temp_path, list_path)
                    list_temp_path = None
                stat = path.stat()
            except OSError as error:
                try:
                    if path_backup is None:
                        path.unlink(missing_ok=True)
                    else:
                        path.write_bytes(path_backup)
                    if list_path is not None:
                        if list_backup is None:
                            list_path.unlink(missing_ok=True)
                        else:
                            list_path.write_bytes(list_backup)
                except OSError:
                    pass
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
                if list_temp_path is not None:
                    try:
                        list_temp_path.unlink(missing_ok=True)
                    except OSError:
                        pass

        return {
            "ok": True,
            "fileName": self._workflow_response_filename(path),
            "size": stat.st_size,
            "modifiedAt": _iso_timestamp(stat.st_mtime),
            **({"sourceWorkflow": f"list/{path.name}"} if mirror_current_to_list and path.parent == self._current_workflow_dir() else {}),
        }

    def save_current_workflow_as(
        self,
        filename: str,
        workflow: Any,
        *,
        source_workflow: str | None = None,
        reset_workflow: str | None = None,
        archive_current: bool = True,
    ) -> dict[str, Any]:
        """Atomically replace the current draft while preserving previous drafts in temp."""
        self._validate_workflow_shape(workflow)
        if reset_workflow and self._workflow_source({"_infrax": {"sourceWorkflow": reset_workflow}}) != reset_workflow:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_filename", "resetWorkflow은 workflows/list의 JSON 파일이어야 합니다.")
        current_workflow = self._workflow_with_source(workflow, source_workflow, reset_workflow=reset_workflow)
        payload = (json.dumps(current_workflow, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(payload) > self.body_limit:
            raise BridgeError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "body_too_large",
                f"저장할 JSON은 {self.body_limit}바이트를 넘을 수 없습니다.",
            )

        relative_name = filename if filename.startswith("current/") else f"current/{filename}"
        target_path = self._workflow_path(relative_name)
        current_dir = self._current_workflow_dir()
        if target_path.parent != current_dir:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_filename",
                "새이름 작업본은 workflows/current에만 저장할 수 있습니다.",
            )

        with self.workflow_lock:
            current_dir.mkdir(parents=True, exist_ok=True)
            temp_dir = self._temp_workflow_dir()
            temp_dir.mkdir(parents=True, exist_ok=True)
            replacement_dir = Path(tempfile.mkdtemp(prefix=".current-replace-", dir=temp_dir)) if not archive_current else None
            prepared_path: Path | None = None
            archived_moves: list[tuple[Path, Path]] = []
            workflow_committed = False
            staging_cleanup_pending: str | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=f".{target_path.name}.",
                    suffix=".tmp",
                    dir=current_dir,
                    delete=False,
                ) as prepared_file:
                    prepared_path = Path(prepared_file.name)
                    prepared_file.write(payload)
                    prepared_file.flush()
                    os.fsync(prepared_file.fileno())

                for child in current_dir.iterdir():
                    if (
                        not child.is_file()
                        or child == prepared_path
                        or child.suffix.lower() != ".json"
                    ):
                        continue
                    archive_path = (
                        temp_dir / self._unique_temp_filename(child.name)
                        if archive_current else replacement_dir / child.name
                    )
                    shutil.move(str(child), str(archive_path))
                    archived_moves.append((child, archive_path))

                os.replace(prepared_path, target_path)
                prepared_path = None
                workflow_committed = True
                stat = target_path.stat()
                if replacement_dir is not None:
                    try:
                        shutil.rmtree(replacement_dir)
                    except OSError:
                        staging_cleanup_pending = replacement_dir.relative_to(self.workflows_dir).as_posix()
                    replacement_dir = None
            except OSError as error:
                if workflow_committed:
                    self._remove_local_path(target_path)
                for original_path, archive_path in reversed(archived_moves):
                    try:
                        if archive_path.exists() and not original_path.exists():
                            shutil.move(str(archive_path), str(original_path))
                    except OSError:
                        pass
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "workflow_save_as_failed",
                    f"새이름 작업본을 저장하지 못했습니다: {target_path.name}",
                ) from error
            finally:
                if prepared_path is not None:
                    try:
                        prepared_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                if replacement_dir is not None and replacement_dir.exists():
                    try:
                        shutil.rmtree(replacement_dir)
                    except OSError:
                        pass

        return {
            "ok": True,
            "fileName": self._workflow_response_filename(target_path),
            "archived": [f"temp/{archive_path.name}" for _, archive_path in archived_moves] if archive_current else [],
            "size": stat.st_size,
            "modifiedAt": _iso_timestamp(stat.st_mtime),
            "sourceWorkflow": source_workflow,
            "resetWorkflow": reset_workflow,
            "workflow": current_workflow,
            "stagingCleanupPending": staging_cleanup_pending,
        }

    def reset_current_workflow(self) -> dict[str, Any]:
        with self.workflow_lock:
            current = self.current_workflow_state()
            if current is None:
                raise BridgeError(HTTPStatus.NOT_FOUND, "workflow_not_found", "current 작업본이 없습니다.")
            source_reference = current.get("sourceWorkflow")
            reset_reference = self._workflow_reset_source(current.get("workflow"))
            current_path = self._workflow_path(current["fileName"])
            restore_reference = source_reference or reset_reference
            if restore_reference:
                source_path = self._workflow_path(restore_reference)
                if not source_path.is_file():
                    raise BridgeError(HTTPStatus.NOT_FOUND, "workflow_not_found", f"연결된 원본을 찾을 수 없습니다: {restore_reference}")
                workflow = json.loads(source_path.read_text(encoding="utf-8"))
                self._validate_workflow_shape(workflow)
                source_reference = restore_reference
                return self.save_current_workflow_as(
                    f"current/{Path(restore_reference).name}",
                    workflow,
                    source_workflow=restore_reference,
                    archive_current=False,
                )
            else:
                workflow = {
                    "name": current_path.stem,
                    "last_node_id": 0,
                    "last_link_id": 0,
                    "nodes": [],
                    "links": [],
                }
            payload = (json.dumps(workflow, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            prepared_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(mode="wb", prefix=f".{current_path.name}.", suffix=".tmp", dir=current_path.parent, delete=False) as prepared:
                    prepared_path = Path(prepared.name)
                    prepared.write(payload)
                    prepared.flush()
                    os.fsync(prepared.fileno())
                os.replace(prepared_path, current_path)
                prepared_path = None
            except OSError as error:
                raise BridgeError(HTTPStatus.INTERNAL_SERVER_ERROR, "workflow_reset_failed", "current 작업본을 초기화하지 못했습니다.") from error
            finally:
                if prepared_path is not None:
                    prepared_path.unlink(missing_ok=True)
            return {
                "ok": True,
                "fileName": self._workflow_response_filename(current_path),
                "workflow": workflow,
                "sourceWorkflow": source_reference,
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

    def stream_workflow_run(self, filename: str):
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
            yield {"type": "run", "status": "started", "fileName": filename}
            yield from self._run_python_stream(
                self.main_script,
                str(relative_path),
                timeout=self.run_timeout,
            )

    def _workflow_path(self, filename: str) -> Path:
        relative_path = _safe_workflow_relative_path(filename)
        candidate = self.workflows_dir / relative_path
        resolved = candidate.resolve(strict=False)
        try:
            relative_resolved = resolved.relative_to(self.workflows_dir)
        except ValueError as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_filename",
                "workflows 폴더 밖의 경로에는 접근할 수 없습니다.",
            ) from error
        workflow_area = relative_resolved.parts[:1]
        if workflow_area == ("current",):
            allowed_parent = self._current_workflow_dir()
        elif workflow_area == ("temp",):
            allowed_parent = self._temp_workflow_dir()
        else:
            allowed_parent = self._list_workflow_dir()
        if resolved.parent != allowed_parent:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_filename",
                "workflows 폴더 밖의 경로에는 접근할 수 없습니다.",
            )
        return resolved

    def _current_workflow_dir(self) -> Path:
        return (self.workflows_dir / "current").resolve(strict=False)

    @staticmethod
    def _workflow_source(workflow: Any) -> str | None:
        metadata = workflow.get("_infrax") if isinstance(workflow, dict) else None
        source = metadata.get("sourceWorkflow") if isinstance(metadata, dict) else None
        if not isinstance(source, str) or not source.startswith("list/"):
            return None
        name = source.removeprefix("list/")
        return source if Path(name).name == name and name.lower().endswith(".json") else None

    @staticmethod
    def _workflow_reset_source(workflow: Any) -> str | None:
        metadata = workflow.get("_infrax") if isinstance(workflow, dict) else None
        source = metadata.get("resetWorkflow") if isinstance(metadata, dict) else None
        if not isinstance(source, str) or not source.startswith("list/"):
            return None
        name = source.removeprefix("list/")
        return source if Path(name).name == name and name.lower().endswith(".json") else None

    @staticmethod
    def _workflow_with_source(workflow: Any, source_workflow: str | None, *, reset_workflow: str | None = None) -> dict[str, Any]:
        result = json.loads(json.dumps(workflow, ensure_ascii=False))
        metadata = result.get("_infrax")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.pop("sourceWorkflow", None)
        metadata.pop("resetWorkflow", None)
        if source_workflow:
            metadata["sourceWorkflow"] = source_workflow
        if reset_workflow:
            metadata["resetWorkflow"] = reset_workflow
        if metadata:
            result["_infrax"] = metadata
        else:
            result.pop("_infrax", None)
        return result

    def _list_workflow_dir(self) -> Path:
        return (self.workflows_dir / "list").resolve(strict=False)

    def _temp_workflow_dir(self) -> Path:
        return (self.workflows_dir / "temp").resolve(strict=False)

    def _workflow_response_filename(self, path: Path) -> str:
        if path.parent == self._current_workflow_dir():
            return f"current/{path.name}"
        if path.parent == self._temp_workflow_dir():
            return f"temp/{path.name}"
        return path.name

    def _unique_temp_filename(self, name: str) -> str:
        stem = Path(name).stem or "workflow"
        suffix = Path(name).suffix or ".json"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        candidate = f"{stem}__{timestamp}{suffix}"
        temp_dir = self._temp_workflow_dir()
        index = 2
        while (temp_dir / candidate).exists():
            candidate = f"{stem}__{timestamp}-{index}{suffix}"
            index += 1
        return candidate

    def _clear_current_workflows(
        self, current_dir: Path | None = None, *, archive: bool = True
    ) -> tuple[list[str], str | None]:
        target = current_dir or self._current_workflow_dir()
        if target.name != "current" or target.parent != self.workflows_dir:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "current_workflow_path_invalid",
                "current 워크플로우 폴더 경로가 안전하지 않습니다.",
            )
        if not target.exists():
            return [], None
        temp_dir = self._temp_workflow_dir()
        if temp_dir.name != "temp" or temp_dir.parent != self.workflows_dir:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "temp_workflow_path_invalid",
                "temp 워크플로우 폴더 경로가 안전하지 않습니다.",
            )
        archived: list[str] = []
        archived_moves: list[tuple[Path, Path]] = []
        if archive:
            temp_dir.mkdir(parents=True, exist_ok=True)
        else:
            temp_dir.mkdir(parents=True, exist_ok=True)
            staging_dir = Path(tempfile.mkdtemp(prefix=".current-clear-", dir=temp_dir))
            try:
                for child in list(target.iterdir()):
                    staged_path = staging_dir / child.name
                    shutil.move(str(child), str(staged_path))
                    archived_moves.append((child, staged_path))
                try:
                    shutil.rmtree(staging_dir)
                    cleanup_pending = None
                except OSError:
                    cleanup_pending = staging_dir.relative_to(self.workflows_dir).as_posix()
                return [], cleanup_pending
            except OSError as error:
                for original_path, staged_path in reversed(archived_moves):
                    try:
                        if staged_path.exists() and not original_path.exists():
                            shutil.move(str(staged_path), str(original_path))
                    except OSError:
                        pass
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "current_clear_failed",
                    "current 작업본을 안전하게 비우지 못했습니다.",
                ) from error
        for child in target.iterdir():
            if archive and child.is_file() and child.suffix.lower() == ".json":
                target_name = self._unique_temp_filename(child.name)
                try:
                    archived_path = temp_dir / target_name
                    shutil.move(str(child), str(archived_path))
                    archived_moves.append((child, archived_path))
                    archived.append(f"temp/{target_name}")
                    continue
                except OSError as error:
                    for original_path, archived_path in reversed(archived_moves):
                        try:
                            if archived_path.exists() and not original_path.exists():
                                shutil.move(str(archived_path), str(original_path))
                        except OSError:
                            pass
                    raise BridgeError(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "current_archive_failed",
                        "current 작업본을 임시 보관하지 못했습니다.",
                    ) from error
            self._remove_local_path(child)
        return archived, None

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

    def _run_python_stream(
        self,
        script: Path,
        *arguments: str,
        timeout: float,
    ):
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8"
        environment["PYTHONUTF8"] = "1"
        environment["INFRAX_RUN_PROGRESS"] = "1"
        try:
            process = subprocess.Popen(
                [sys.executable, "-B", str(script), *arguments],
                cwd=self.root,
                shell=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=environment,
            )
        except OSError as error:
            raise BridgeError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "process_start_failed",
                "로컬 Python 프로세스를 시작하지 못했습니다.",
            ) from error

        lines: queue.Queue[tuple[str, str | None]] = queue.Queue()

        def read_stream(name: str, stream: Any) -> None:
            try:
                for line in iter(stream.readline, ""):
                    lines.put((name, line.rstrip("\r\n")))
            finally:
                try:
                    stream.close()
                except OSError:
                    pass
                lines.put((name, None))

        threading.Thread(target=read_stream, args=("stdout", process.stdout), daemon=True).start()
        threading.Thread(target=read_stream, args=("stderr", process.stderr), daemon=True).start()
        started_at = time.monotonic()
        stdout_closed = False
        stderr_closed = False
        stdout_lines: list[str] = []
        stderr_lines: list[str] = []
        return_code = None

        try:
            while not (stdout_closed and stderr_closed and process.poll() is not None):
                if time.monotonic() - started_at > timeout:
                    process.kill()
                    yield {
                        "type": "run",
                        "status": "timeout",
                        "message": f"로컬 Python 실행이 {timeout:g}초 제한 시간을 초과했습니다.",
                    }
                    break
                try:
                    stream_name, line = lines.get(timeout=0.1)
                except queue.Empty:
                    continue
                if line is None:
                    if stream_name == "stdout":
                        stdout_closed = True
                    else:
                        stderr_closed = True
                    continue
                if stream_name == "stdout":
                    event = _parse_run_event_line(line)
                    if event:
                        yield event
                        continue
                    stdout_lines.append(line)
                else:
                    stderr_lines.append(line)
                yield {"type": "output", "stream": stream_name, "text": line}
            return_code = process.wait(timeout=1)
        except Exception:
            process.kill()
            raise

        yield {
            "type": "run",
            "status": "completed" if return_code == 0 else "failed",
            "returnCode": return_code,
            "stdout": _limited_output("\n".join(stdout_lines)),
            "stderr": _limited_output("\n".join(stderr_lines)),
        }


class StudioBridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    allow_reuse_port = False

    def __init__(
        self,
        server_address: tuple[str, int],
        state: BridgeState,
        *,
        studio_root: Path | str | None = None,
        platform_api_base: str | None = None,
        offline: bool = False,
        platform_credential_path: Path | None = None,
    ) -> None:
        self.state = state
        self.studio_root = (
            _resolve_studio_root(studio_root) if studio_root is not None else None
        )
        self.offline = bool(offline)
        self.platform_api_base = (
            _validate_platform_api_base(platform_api_base)
            if platform_api_base and not self.offline
            else None
        )
        self.platform_token_lock = threading.Lock()
        self._platform_access_token: str | None = None
        self.platform_credential_store = PlatformCredentialStore(
            platform_credential_path
        )
        self._platform_refresh_token = self.platform_credential_store.load()
        super().__init__(server_address, StudioBridgeHandler)
        self.tool_contexts: dict[str, BridgeState] = {}
        self.tool_root_states: dict[str, BridgeState] = {
            os.path.normcase(str(state.root)): state
        }
        self.tool_context_lock = threading.Lock()

    def platform_connection(self) -> tuple[http.client.HTTPSConnection, str]:
        if self.platform_api_base is None:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_not_configured",
                "Marketplace 서버가 오프라인이거나 설정되지 않았습니다.",
            )
        parsed = urlsplit(self.platform_api_base)
        connection = http.client.HTTPSConnection(
            parsed.hostname,
            parsed.port or 443,
            timeout=PLATFORM_PROXY_TIMEOUT,
        )
        return connection, parsed.path.rstrip("/")

    def get_platform_access_token(self) -> str | None:
        with self.platform_token_lock:
            return self._platform_access_token

    def set_platform_access_token(self, token: str) -> None:
        if _LOCAL_MARKETPLACE_TOKEN_PATTERN.fullmatch(token) is None:
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace 서버가 올바른 로컬 연결 토큰을 반환하지 않았습니다.",
            )
        with self.platform_token_lock:
            self._platform_access_token = token

    def get_platform_refresh_token(self) -> str | None:
        with self.platform_token_lock:
            return self._platform_refresh_token

    def set_platform_refresh_token(self, token: str) -> None:
        self.platform_credential_store.save(token)
        with self.platform_token_lock:
            self._platform_refresh_token = token

    def clear_platform_credentials(self) -> None:
        with self.platform_token_lock:
            self._platform_access_token = None
            self._platform_refresh_token = None
        self.platform_credential_store.clear()

    def clear_platform_access_token(self, expected: str | None = None) -> None:
        with self.platform_token_lock:
            if expected is None or hmac.compare_digest(
                self._platform_access_token or "",
                expected,
            ):
                self._platform_access_token = None

    def server_close(self) -> None:
        # The access token is process-local. The DPAPI-protected refresh
        # credential intentionally survives normal shutdown until logout.
        self.clear_platform_access_token()
        super().server_close()

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(
                socket.SOL_SOCKET,
                socket.SO_EXCLUSIVEADDRUSE,
                1,
            )
        super().server_bind()

    @property
    def local_origins(self) -> frozenset[str]:
        port = int(self.server_address[1])
        return frozenset(
            {
                f"http://127.0.0.1:{port}",
                f"http://localhost:{port}",
            }
        )

    @property
    def allowed_hosts(self) -> frozenset[str]:
        port = int(self.server_address[1])
        return frozenset(
            {
                f"127.0.0.1:{port}",
                f"localhost:{port}",
            }
        )

    @property
    def session_cookie_name(self) -> str:
        return f"{LOCAL_SESSION_COOKIE}_{int(self.server_address[1])}"

    @property
    def api_session_cookie_name(self) -> str:
        return f"{self.session_cookie_name}_api"

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
                package_archive_limit=self.state.package_archive_limit,
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
        if not self._host_allowed():
            self._send_error(
                BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "host_not_allowed",
                    "로컬 Studio 주소로만 접속할 수 있습니다.",
                )
            )
            return
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
            "Authorization, Content-Type, If-None-Match, "
            "X-InfraX-Tool-Context, X-InfraX-Package-Metadata, "
            "X-InfraX-Current-Only, X-InfraX-Archive-Current",
        )
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("GET")

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("HEAD")

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802 - stdlib handler API
        self._dispatch("PUT")

    def _dispatch(self, method: str) -> None:
        try:
            if not self._host_allowed():
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "host_not_allowed",
                    "로컬 Studio 주소로만 접속할 수 있습니다.",
                )
            if not self._origin_allowed():
                raise BridgeError(
                    HTTPStatus.FORBIDDEN,
                    "origin_not_allowed",
                    "허용되지 않은 Origin입니다.",
                )
            raw_path = urlsplit(self.path).path
            segments = raw_path.strip("/").split("/") if raw_path != "/" else []

            if method in {"GET", "HEAD"} and self._serve_static(raw_path, head=method == "HEAD"):
                return
            if self._serve_local_platform_api(method, segments):
                return

            if segments and segments[0] == LOCAL_API_PREFIX:
                segments = segments[1:]

            if method == "GET" and segments == ["health"]:
                health = self.server.state.health()
                health["offline"] = self.server.offline
                health["marketplaceConnected"] = (
                    self.server.platform_api_base is not None
                )
                self._send_json(HTTPStatus.OK, health)
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
            if method == "GET" and segments == ["packages"]:
                self._send_json(
                    HTTPStatus.OK,
                    {"ok": True, "packages": state.list_packages()},
                )
                return
            if method == "GET" and segments == ["custom-node-packages"]:
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "packages": state.list_local_custom_node_packages(),
                    },
                )
                return
            if (
                method == "GET"
                and len(segments) == 3
                and segments[0] == "packages"
                and segments[2] == "archive"
            ):
                package_id = self._decode_package_id(segments[1])
                archive = state.build_package_archive(package_id)
                try:
                    self._send_package_archive(archive)
                finally:
                    state._remove_local_path(archive["path"])
                return
            if (
                method == "PUT"
                and len(segments) == 3
                and segments[0] == "packages"
                and segments[2] == "install"
            ):
                package_id = self._decode_package_id(segments[1])
                metadata = self._read_package_metadata(package_id)
                archive_path, archive_digest = self._read_package_archive(state)
                try:
                    result = state.install_package(
                        metadata,
                        archive_path,
                        archive_digest,
                    )
                finally:
                    state._remove_local_path(archive_path)
                self._send_json(HTTPStatus.OK, result)
                return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "packages"
                and segments[2] == "install-from-marketplace"
            ):
                package_id = self._decode_package_id(segments[1])
                metadata = _validate_package_metadata(
                    self._read_json_body(),
                    expected_id=package_id,
                )
                archive_path, archive_digest = (
                    self._download_marketplace_package_archive(
                        state,
                        package_id,
                    )
                )
                try:
                    result = state.install_package(
                        metadata,
                        archive_path,
                        archive_digest,
                    )
                finally:
                    state._remove_local_path(archive_path)
                self._send_json(HTTPStatus.OK, result)
                return
            if (
                method == "PUT"
                and len(segments) == 3
                and segments[0] == "packages"
                and segments[2] == "publish"
            ):
                package_id = self._decode_package_id(segments[1])
                publish_metadata = self._read_json_body()
                self._publish_installed_package(
                    state,
                    package_id,
                    publish_metadata,
                )
                return
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
                    {
                        "ok": True,
                        "workflows": state.list_workflows(),
                        "tempWorkflows": state.list_temp_workflows(),
                        "currentWorkflow": state.current_workflow_state(),
                    },
                )
                return
            if method == "POST" and segments == ["workflows", "current", "reset"]:
                self._ensure_empty_or_json_body()
                self._send_json(HTTPStatus.OK, state.reset_current_workflow())
                return
            if method == "POST" and segments == ["workflows", "current", "clear"]:
                self._ensure_empty_or_json_body()
                self._send_json(
                    HTTPStatus.OK,
                    state.clear_current_workflows(
                        archive=self.headers.get("X-InfraX-Archive-Current") == "true",
                    ),
                )
                return
            if method == "POST" and segments == ["workflows", "current", "save-as"]:
                request = self._read_json_body()
                if not isinstance(request, dict):
                    raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_request", "요청 본문은 객체여야 합니다.")
                self._send_json(
                    HTTPStatus.OK,
                    state.save_current_workflow_as(
                        str(request.get("fileName") or ""),
                        request.get("workflow"),
                        reset_workflow=str(request.get("resetWorkflow") or "") or None,
                    ),
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
                            mirror_current_to_list=self.headers.get("X-InfraX-Current-Only") != "true",
                        ),
                    )
                    return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "workflows"
                and segments[2] == "activate"
            ):
                self._ensure_empty_or_json_body()
                filename = self._decode_filename(segments[1])
                self._send_json(
                    HTTPStatus.OK,
                    state.activate_workflow(
                        filename,
                        archive_current=self.headers.get("X-InfraX-Archive-Current") == "true",
                    ),
                )
                return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "workflows"
                and segments[2] == "restore"
            ):
                self._ensure_empty_or_json_body()
                filename = self._decode_filename(segments[1])
                self._send_json(
                    HTTPStatus.OK,
                    state.restore_temp_workflow(filename),
                )
                return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "workflows"
                and segments[2] == "delete"
            ):
                self._ensure_empty_or_json_body()
                filename = self._decode_filename(segments[1])
                self._send_json(
                    HTTPStatus.OK,
                    state.delete_temp_workflow(filename),
                )
                return
            if (
                method == "POST"
                and len(segments) == 3
                and segments[0] == "workflows"
                and segments[2] == "run-stream"
            ):
                self._ensure_empty_or_json_body()
                filename = self._decode_filename(segments[1])
                self._send_ndjson_stream(state.stream_workflow_run(filename))
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

    def _serve_static(self, raw_path: str, *, head: bool) -> bool:
        studio_root = self.server.studio_root
        if studio_root is None:
            return False

        if raw_path == "/":
            relative_path = "index.html"
        else:
            try:
                relative_path = unquote(
                    raw_path.lstrip("/"),
                    encoding="utf-8",
                    errors="strict",
                )
            except UnicodeDecodeError as error:
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_static_path",
                    "정적 파일 경로 인코딩이 올바르지 않습니다.",
                ) from error

        if (
            not relative_path
            or "\x00" in relative_path
            or "\\" in relative_path
            or relative_path.startswith("/")
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_static_path",
                "정적 파일 경로가 올바르지 않습니다.",
            )

        parts = relative_path.split("/")
        if any(part in {"", ".", ".."} for part in parts):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_static_path",
                "정적 파일 경로가 올바르지 않습니다.",
            )

        is_root_file = len(parts) == 1 and relative_path in STUDIO_STATIC_FILES
        is_asset = (
            len(parts) >= 2
            and parts[0] == "assets"
            and Path(parts[-1]).suffix.lower() in STUDIO_ASSET_EXTENSIONS
        )
        if not is_root_file and not is_asset:
            return False

        candidate = studio_root.joinpath(*parts)
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(studio_root)
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "static_file_not_found",
                "요청한 Studio 파일이 없습니다.",
            )
        if not resolved.is_file():
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "static_file_not_found",
                "요청한 Studio 파일이 없습니다.",
            )

        if relative_path == "index.html":
            source = resolved.read_text(encoding="utf-8")
            replacements = {
                'data-api-base=""': 'data-api-base="/api"',
                'data-local-tool-base="http://127.0.0.1:8765/"': (
                    f'data-local-tool-base="/{LOCAL_API_PREFIX}/"'
                ),
                'data-local-tool-token=""': 'data-local-tool-token=""',
                'data-local-studio="false"': 'data-local-studio="true"',
            }
            for marker, replacement in replacements.items():
                if source.count(marker) != 1:
                    raise BridgeError(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "studio_bundle_incompatible",
                        "로컬 Studio 화면 파일이 실행기와 호환되지 않습니다.",
                    )
                source = source.replace(marker, replacement, 1)
            platform_attribute = (
                'data-platform-api-base="'
                + html.escape(self.server.platform_api_base or "", quote=True)
                + '"'
            )
            if re.search(r"\sdata-platform-api-base=(['\"]).*?\1", source):
                source = re.sub(
                    r"\sdata-platform-api-base=(['\"]).*?\1",
                    " " + platform_attribute,
                    source,
                    count=1,
                )
            elif "<html" in source:
                source = source.replace("<html", f"<html {platform_attribute}", 1)
            else:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "studio_bundle_incompatible",
                    "로컬 Studio 화면에 HTML 루트 요소가 없습니다.",
                )
            version_attribute = (
                'data-pipeline-tool-version="'
                + html.escape(TOOL_VERSION, quote=True)
                + '"'
            )
            if re.search(r"\sdata-pipeline-tool-version=(['\"]).*?\1", source):
                source = re.sub(
                    r"\sdata-pipeline-tool-version=(['\"]).*?\1",
                    " " + version_attribute,
                    source,
                    count=1,
                )
            elif "<html" in source:
                source = source.replace("<html", f"<html {version_attribute}", 1)
            else:
                raise BridgeError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "studio_bundle_incompatible",
                    "로컬 Studio 화면에 HTML 루트 요소가 없습니다.",
                )
            body = source.encode("utf-8")
        else:
            body = resolved.read_bytes()

        content_type = STUDIO_CONTENT_TYPES.get(
            resolved.suffix.lower(),
            "application/octet-stream",
        )
        self.send_response(HTTPStatus.OK)
        self._send_common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if relative_path == "index.html":
            self.send_header(
                "Set-Cookie",
                f"{self.server.session_cookie_name}={self.server.state.auth_token}; "
                f"HttpOnly; SameSite=Strict; Path=/{LOCAL_API_PREFIX}",
            )
            self.send_header(
                "Set-Cookie",
                f"{self.server.api_session_cookie_name}={self.server.state.auth_token}; "
                "HttpOnly; SameSite=Strict; Path=/api",
            )
        self.send_header(
            "Content-Security-Policy",
            "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
        )
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head:
            self.wfile.write(body)
        return True

    def _serve_local_platform_api(self, method: str, segments: list[str]) -> bool:
        if (
            self.server.studio_root is None
            or not segments
            or segments[0] != "api"
        ):
            return False
        self._require_api_session()
        if urlsplit(self.path).query:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "platform_api_query_not_allowed",
                "중앙 API 프록시는 쿼리 문자열을 허용하지 않습니다.",
            )

        if self.server.platform_api_base is None:
            return self._serve_offline_platform_api(method, segments)

        suffix = _platform_proxy_suffix(method, segments)
        if suffix is None:
            raise BridgeError(
                HTTPStatus.NOT_FOUND,
                "platform_proxy_route_not_allowed",
                "허용되지 않은 중앙 API 경로 또는 메서드입니다.",
            )
        if suffix == "/local-connect/exchange":
            self._proxy_local_connect_exchange(suffix)
        elif suffix == "/local-connect/logout":
            self._logout_platform_account()
        else:
            self._proxy_platform_request(method, suffix)
        return True

    def _send_package_archive(self, archive: dict[str, Any]) -> None:
        package_metadata = {
            **archive["package"],
            "sha256": archive["sha256"],
        }
        encoded_metadata = quote(
            json.dumps(
                package_metadata,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            safe="",
        )
        if len(encoded_metadata) > MAX_PACKAGE_METADATA_HEADER:
            raise BridgeError(
                HTTPStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                "package_metadata_too_large",
                "내보낼 패키지 메타데이터가 헤더 안전 한도를 넘습니다.",
            )
        ascii_name = re.sub(
            r'[^\x20-\x7e]|["\\/\r\n]',
            "_",
            archive["fileName"],
        )
        self.send_response(HTTPStatus.OK)
        self._send_common_headers()
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(archive["size"]))
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{ascii_name}"',
        )
        self.send_header("X-InfraX-Archive-Sha256", archive["sha256"])
        self.send_header("X-InfraX-Package-Metadata", encoded_metadata)
        self.end_headers()
        try:
            with archive["path"].open("rb") as archive_file:
                for chunk in iter(
                    lambda: archive_file.read(1024 * 1024),
                    b"",
                ):
                    self.wfile.write(chunk)
        except (OSError, BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _download_marketplace_package_archive(
        self,
        state: BridgeState,
        package_id: str,
    ) -> tuple[Path, str]:
        connection: http.client.HTTPSConnection | None = None
        temporary_path: Path | None = None
        token = self.server.get_platform_access_token()
        try:
            connection, base_path = self.server.platform_connection()
            headers = {
                "Accept": "application/zip",
                "User-Agent": f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
                "Connection": "close",
            }
            if token:
                headers["Authorization"] = f"Bearer {token}"
            connection.request(
                "GET",
                base_path
                + "/marketplace/modules/"
                + quote(package_id, safe="")
                + "/download",
                headers=headers,
            )
            response = connection.getresponse()
            if response.status in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
                self.server.clear_platform_access_token()
            if response.status in {
                HTTPStatus.MOVED_PERMANENTLY,
                HTTPStatus.FOUND,
                HTTPStatus.SEE_OTHER,
                HTTPStatus.TEMPORARY_REDIRECT,
                HTTPStatus.PERMANENT_REDIRECT,
            }:
                raise BridgeError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "marketplace_git_install_unsupported",
                    "Git Marketplace 항목은 자동 설치할 수 없습니다. ZIP 패키지만 지원합니다.",
                )
            if response.status != HTTPStatus.OK:
                error_body = response.read(MAX_PLATFORM_EXCHANGE_RESPONSE + 1)
                message = "Marketplace 패키지를 다운로드하지 못했습니다."
                if len(error_body) <= MAX_PLATFORM_EXCHANGE_RESPONSE:
                    try:
                        error_document = json.loads(error_body.decode("utf-8"))
                        if isinstance(error_document, dict):
                            candidate = error_document.get("error")
                            if isinstance(candidate, str) and candidate.strip():
                                message = candidate[:500]
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        pass
                status = (
                    response.status
                    if 400 <= response.status <= 599
                    else HTTPStatus.BAD_GATEWAY
                )
                raise BridgeError(
                    status,
                    "marketplace_download_failed",
                    message,
                )
            content_type = response.getheader("Content-Type", "").split(
                ";",
                1,
            )[0].strip().lower()
            if content_type not in {
                "application/zip",
                "application/x-zip-compressed",
                "application/octet-stream",
            }:
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "marketplace_download_invalid",
                    "Marketplace 다운로드가 ZIP 형식이 아닙니다.",
                )
            declared_length = response.getheader("Content-Length")
            expected_length: int | None = None
            if declared_length is not None:
                try:
                    expected_length = int(declared_length)
                except ValueError as error:
                    raise BridgeError(
                        HTTPStatus.BAD_GATEWAY,
                        "marketplace_download_invalid",
                        "Marketplace ZIP 크기 헤더가 올바르지 않습니다.",
                    ) from error
                if expected_length <= 0:
                    raise BridgeError(
                        HTTPStatus.BAD_GATEWAY,
                        "marketplace_download_invalid",
                        "Marketplace ZIP이 비어 있습니다.",
                    )
                if expected_length > state.package_archive_limit:
                    raise BridgeError(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        "package_archive_too_large",
                        "Marketplace ZIP이 로컬 설치 한도를 넘습니다.",
                    )
                if (
                    expected_length + MIN_PACKAGE_DISK_RESERVE
                    > shutil.disk_usage(state.root).free
                ):
                    raise BridgeError(
                        HTTPStatus.INSUFFICIENT_STORAGE,
                        "package_disk_space_insufficient",
                        "Marketplace ZIP을 받을 디스크 여유 공간이 부족합니다.",
                    )

            descriptor, temporary_name = tempfile.mkstemp(
                prefix=".infrax-marketplace-download-",
                suffix=".zip",
                dir=state.root,
            )
            temporary_path = Path(temporary_name)
            digest = hashlib.sha256()
            received = 0
            with os.fdopen(descriptor, "wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > state.package_archive_limit:
                        raise BridgeError(
                            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                            "package_archive_too_large",
                            "Marketplace ZIP이 로컬 설치 한도를 넘습니다.",
                        )
                    output.write(chunk)
                    digest.update(chunk)
                output.flush()
                os.fsync(output.fileno())
            if received == 0 or (
                expected_length is not None and received != expected_length
            ):
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "marketplace_download_incomplete",
                    "Marketplace ZIP 다운로드가 완료되지 않았습니다.",
                )
            result = (temporary_path, digest.hexdigest())
            temporary_path = None
            return result
        except BridgeError:
            raise
        except (TimeoutError, socket.timeout) as error:
            raise BridgeError(
                HTTPStatus.GATEWAY_TIMEOUT,
                "platform_api_timeout",
                "Marketplace ZIP 다운로드 시간이 초과되었습니다.",
            ) from error
        except (OSError, http.client.HTTPException) as error:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_unavailable",
                "Marketplace ZIP을 받을 수 없습니다. 로컬 기능은 계속 사용할 수 있습니다.",
            ) from error
        finally:
            if connection is not None:
                connection.close()
            if temporary_path is not None:
                state._remove_local_path(temporary_path)

    def _publish_installed_package(
        self,
        state: BridgeState,
        package_id: str,
        value: Any,
    ) -> None:
        if self.server.platform_api_base is None:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_not_configured",
                "오프라인 모드에서는 Marketplace에 업로드할 수 없습니다.",
            )
        try:
            with state.package_lock:
                state._package_by_id_unlocked(package_id)
        except BridgeError as error:
            if error.code != "installed_package_not_found":
                raise
        else:
            raise BridgeError(
                HTTPStatus.CONFLICT,
                "installed_package_republish_not_allowed",
                "Marketplace에서 설치한 패키지는 자동으로 다시 게시할 수 없습니다.",
            )
        installed = state.local_custom_node_package(package_id)
        metadata = self._validate_publish_metadata(value, installed)
        archive = state.build_local_custom_node_archive(
            package_id,
            metadata,
        )
        connection: http.client.HTTPSConnection | None = None
        token = self.server.get_platform_access_token()
        try:
            upstream_metadata = {
                "id": package_id,
                "name": metadata["name"],
                "version": metadata["version"],
                "description": metadata["description"],
                "kind": installed["kind"],
                "nodeTypes": metadata["nodeTypes"],
                "source": {
                    "type": "zip",
                    "fileName": archive["fileName"],
                },
            }
            if metadata.get("author"):
                upstream_metadata["author"] = metadata["author"]
            encoded_metadata = quote(
                json.dumps(
                    upstream_metadata,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                safe="",
            )
            if len(encoded_metadata) > MAX_PACKAGE_METADATA_HEADER:
                raise BridgeError(
                    HTTPStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                    "package_metadata_too_large",
                    "Marketplace 업로드 메타데이터가 너무 큽니다.",
                )
            connection, base_path = self.server.platform_connection()
            connection.putrequest(
                "PUT",
                base_path
                + "/marketplace/modules/"
                + quote(package_id, safe=""),
                skip_accept_encoding=True,
            )
            connection.putheader("Content-Type", "application/zip")
            connection.putheader("Content-Length", str(archive["size"]))
            connection.putheader(
                "X-InfraX-Package-Metadata",
                encoded_metadata,
            )
            connection.putheader(
                "User-Agent",
                f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
            )
            connection.putheader("Accept", "application/json")
            connection.putheader("Connection", "close")
            if token:
                connection.putheader("Authorization", f"Bearer {token}")
            revision = self.headers.get("If-Match")
            if revision is not None:
                if (
                    not revision
                    or len(revision) > 256
                    or _CONTROL_CHARACTER_PATTERN.search(revision)
                ):
                    raise BridgeError(
                        HTTPStatus.BAD_REQUEST,
                        "invalid_revision",
                        "If-Match revision 값이 올바르지 않습니다.",
                    )
                connection.putheader("If-Match", revision)
            connection.endheaders()
            with archive["path"].open("rb") as archive_file:
                for chunk in iter(
                    lambda: archive_file.read(1024 * 1024),
                    b"",
                ):
                    connection.send(chunk)
            response = connection.getresponse()
            if response.status in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
                self.server.clear_platform_access_token()
            self._relay_platform_response("PUT", response)
        except BridgeError:
            raise
        except (TimeoutError, socket.timeout) as error:
            raise BridgeError(
                HTTPStatus.GATEWAY_TIMEOUT,
                "platform_api_timeout",
                "Marketplace 업로드 시간이 초과되었습니다.",
            ) from error
        except (OSError, http.client.HTTPException) as error:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_unavailable",
                "Marketplace에 업로드할 수 없습니다. 로컬 패키지는 변경되지 않았습니다.",
            ) from error
        finally:
            if connection is not None:
                connection.close()
            state._remove_local_path(archive["path"])

    @staticmethod
    def _validate_publish_metadata(
        value: Any,
        installed: dict[str, Any],
    ) -> dict[str, Any]:
        allowed_keys = {
            "name",
            "version",
            "description",
            "kind",
            "nodeTypes",
            "author",
        }
        if not isinstance(value, dict) or set(value) - allowed_keys:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_publish_metadata",
                "Marketplace 업로드 메타데이터가 올바르지 않습니다.",
            )
        name = value.get("name")
        version = value.get("version")
        description = value.get("description")
        kind = value.get("kind")
        author = value.get("author")
        node_types = value.get("nodeTypes", installed.get("nodeTypes", []))
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 80
            or _CONTROL_CHARACTER_PATTERN.search(name)
            or not isinstance(version, str)
            or len(version) > 30
            or _SEMVER_PATTERN.fullmatch(version.strip()) is None
            or not isinstance(description, str)
            or not description.strip()
            or len(description.strip()) > 500
            or _CONTROL_CHARACTER_PATTERN.search(description)
            or kind != installed["kind"]
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_publish_metadata",
                "이름, 버전, 설명 또는 패키지 종류가 올바르지 않습니다.",
            )
        if (
            author is not None
            and (
                not isinstance(author, str)
                or not author.strip()
                or len(author.strip()) > 60
                or _CONTROL_CHARACTER_PATTERN.search(author)
            )
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_publish_metadata",
                "작성자 정보가 올바르지 않습니다.",
            )
        if (
            not isinstance(node_types, list)
            or len(node_types) > 2_000
            or any(
                not isinstance(node_type, str)
                or not node_type.strip()
                or len(node_type.strip()) > 256
                or _CONTROL_CHARACTER_PATTERN.search(node_type)
                for node_type in node_types
            )
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_publish_metadata",
                "nodeTypes 정보가 올바르지 않습니다.",
            )
        normalized_node_types = list(
            dict.fromkeys(node_type.strip() for node_type in node_types)
        )
        if not set(normalized_node_types).issubset(
            set(installed.get("nodeTypes", []))
        ):
            raise BridgeError(
                HTTPStatus.CONFLICT,
                "publish_node_types_mismatch",
                "설치된 패키지에 없는 노드 타입은 업로드할 수 없습니다.",
            )
        return {
            "name": name.strip(),
            "version": version.strip(),
            "description": description.strip(),
            "kind": kind,
            "nodeTypes": normalized_node_types,
            **({"author": author.strip()} if isinstance(author, str) else {}),
        }

    def _serve_offline_platform_api(
        self,
        method: str,
        segments: list[str],
    ) -> bool:
        if method == "GET" and segments == ["api", "health"]:
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "infrax-local-studio",
                    "localOnly": True,
                    "toolVersion": TOOL_VERSION,
                    "offline": self.server.offline,
                },
            )
            return True
        if method == "GET" and segments == ["api", "session"]:
            self._send_json(
                HTTPStatus.OK,
                {
                    "authMode": "required",
                    "user": None,
                    "localStudio": True,
                    "marketplaceConnected": False,
                },
            )
            return True
        if method == "GET" and segments in (
            ["api", "marketplace", "workflows"],
            ["api", "marketplace", "modules"],
        ):
            self._send_json(
                HTTPStatus.OK,
                {
                    "items": [],
                    "localStudio": True,
                    "marketplaceConnected": False,
                },
            )
            return True
        if segments[:2] == ["api", "marketplace"]:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_not_configured",
                "Marketplace 서버 주소가 설정되지 않았습니다.",
            )
        if segments[:2] in (
            ["api", "local-connect"],
            ["api", "pipeline-tool"],
        ):
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_not_configured",
                "오프라인 모드에서는 중앙 서버 기능을 사용할 수 없습니다.",
            )
        raise BridgeError(
            HTTPStatus.NOT_FOUND,
            "not_found",
            "요청한 로컬 플랫폼 API 경로가 없습니다.",
        )

    def _proxy_local_connect_exchange(self, suffix: str) -> None:
        body = self._read_json_body()
        if not isinstance(body, dict) or set(body) - {
            "code",
            "verifier",
            "codeVerifier",
            "state",
            "returnOrigin",
        }:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "local_connect_exchange_invalid",
                "로컬 연결 교환 요청 형식이 올바르지 않습니다.",
            )
        verifier = body.get("verifier", body.get("codeVerifier"))
        code = body.get("code")
        state = body.get("state")
        return_origin = body.get("returnOrigin")
        if (
            not isinstance(code, str)
            or _LOCAL_CONNECT_CODE_PATTERN.fullmatch(code) is None
            or not isinstance(verifier, str)
            or _LOCAL_CONNECT_VERIFIER_PATTERN.fullmatch(verifier) is None
            or not isinstance(state, str)
            or _LOCAL_CONNECT_STATE_PATTERN.fullmatch(state) is None
            or not isinstance(return_origin, str)
            or return_origin not in self.server.local_origins
        ):
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "local_connect_exchange_invalid",
                "code, PKCE verifier, state 또는 returnOrigin이 올바르지 않습니다.",
            )
        upstream_body = json.dumps(
            {
                "code": code,
                "verifier": verifier,
                "state": state,
                "returnOrigin": return_origin,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        connection: http.client.HTTPSConnection | None = None
        try:
            connection, base_path = self.server.platform_connection()
            connection.request(
                "POST",
                base_path + suffix,
                body=upstream_body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(upstream_body)),
                    "Accept": "application/json",
                    "User-Agent": f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            response_body = response.read(MAX_PLATFORM_EXCHANGE_RESPONSE + 1)
            if len(response_body) > MAX_PLATFORM_EXCHANGE_RESPONSE:
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "platform_response_too_large",
                    "Marketplace 연결 응답이 허용 크기를 넘습니다.",
                )
        except BridgeError:
            raise
        except (TimeoutError, socket.timeout) as error:
            raise BridgeError(
                HTTPStatus.GATEWAY_TIMEOUT,
                "platform_api_timeout",
                "Marketplace 서버 응답 시간이 초과되었습니다.",
            ) from error
        except (OSError, http.client.HTTPException) as error:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_unavailable",
                "Marketplace 서버에 연결할 수 없습니다. 로컬 기능은 계속 사용할 수 있습니다.",
            ) from error
        finally:
            if connection is not None:
                connection.close()

        try:
            result = json.loads(response_body.decode("utf-8")) if response_body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace 서버가 올바른 JSON 응답을 반환하지 않았습니다.",
            ) from error
        if not isinstance(result, dict):
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace 서버의 연결 응답 형식이 올바르지 않습니다.",
            )
        if not 200 <= response.status < 300:
            sanitized = {
                key: value
                for key, value in result.items()
                if key.lower() not in {"accesstoken", "token", "authorization"}
            }
            self._send_json(response.status, sanitized or {"ok": False})
            return
        access_token = result.get("accessToken")
        refresh_token = result.get("refreshToken")
        if not isinstance(access_token, str):
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace 서버가 연결 토큰을 반환하지 않았습니다.",
            )
        if not isinstance(refresh_token, str):
            raise BridgeError(
                HTTPStatus.BAD_GATEWAY,
                "platform_exchange_invalid",
                "Marketplace server did not return a refresh credential.",
            )
        self.server.set_platform_refresh_token(refresh_token)
        self.server.set_platform_access_token(access_token)
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "connected": True,
                "tokenType": result.get("tokenType", "Bearer"),
                "expiresAt": result.get("expiresAt"),
                "user": result.get("user"),
            },
        )

    def _refresh_platform_access_token(self) -> bool:
        refresh_token = self.server.get_platform_refresh_token()
        if not refresh_token:
            return False
        body = json.dumps(
            {"refreshToken": refresh_token},
            separators=(",", ":"),
        ).encode("utf-8")
        connection: http.client.HTTPSConnection | None = None
        try:
            connection, base_path = self.server.platform_connection()
            connection.request(
                "POST",
                base_path + "/local-connect/refresh",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Accept": "application/json",
                    "User-Agent": f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            response_body = response.read(MAX_PLATFORM_EXCHANGE_RESPONSE + 1)
            if not 200 <= response.status < 300:
                if response.status in {
                    HTTPStatus.BAD_REQUEST,
                    HTTPStatus.UNAUTHORIZED,
                    HTTPStatus.FORBIDDEN,
                }:
                    self.server.clear_platform_credentials()
                return False
            result = json.loads(response_body.decode("utf-8")) if response_body else {}
            access_token = result.get("accessToken")
            rotated_refresh = result.get("refreshToken")
            if not isinstance(access_token, str) or not isinstance(rotated_refresh, str):
                return False
            self.server.set_platform_access_token(access_token)
            self.server.set_platform_refresh_token(rotated_refresh)
            return True
        except (
            OSError,
            http.client.HTTPException,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ):
            # A temporary outage must not erase a valid long-lived credential.
            return False
        finally:
            if connection is not None:
                connection.close()

    def _logout_platform_account(self) -> None:
        refresh_token = self.server.get_platform_refresh_token()
        access_token = self.server.get_platform_access_token()
        if refresh_token:
            body = json.dumps(
                {"refreshToken": refresh_token},
                separators=(",", ":"),
            ).encode("utf-8")
            connection: http.client.HTTPSConnection | None = None
            try:
                connection, base_path = self.server.platform_connection()
                headers = {
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Accept": "application/json",
                    "User-Agent": f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
                    "Connection": "close",
                }
                if access_token:
                    headers["Authorization"] = f"Bearer {access_token}"
                connection.request(
                    "POST",
                    base_path + "/local-connect/logout",
                    body=body,
                    headers=headers,
                )
                response = connection.getresponse()
                response.read(MAX_PLATFORM_EXCHANGE_RESPONSE + 1)
            except (OSError, http.client.HTTPException):
                # Logout remains effective locally even if remote revocation is
                # temporarily unavailable.
                pass
            finally:
                if connection is not None:
                    connection.close()
        self.server.clear_platform_credentials()
        self._send_json(HTTPStatus.OK, {"ok": True, "connected": False})

    def _proxy_platform_request(self, method: str, suffix: str) -> None:
        content_length = self._proxy_request_content_length(method)
        connection: http.client.HTTPSConnection | None = None
        token = self.server.get_platform_access_token()
        try:
            connection, base_path = self.server.platform_connection()
            connection.putrequest(
                method,
                base_path + suffix,
                skip_accept_encoding=True,
            )
            connection.putheader("Accept", self.headers.get("Accept", "*/*"))
            connection.putheader(
                "User-Agent",
                f"InfraX-Pipeline-Tool/{TOOL_VERSION}",
            )
            connection.putheader("Connection", "close")
            if token:
                connection.putheader("Authorization", f"Bearer {token}")
            if content_length:
                connection.putheader("Content-Length", str(content_length))
            for header_name in (
                "Content-Type",
                "If-Match",
                "X-InfraX-Package-Metadata",
            ):
                value = self.headers.get(header_name)
                if value is not None:
                    if (
                        header_name == "X-InfraX-Package-Metadata"
                        and len(value) > MAX_PACKAGE_METADATA_HEADER
                    ):
                        raise BridgeError(
                            HTTPStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                            "package_metadata_too_large",
                            "패키지 메타데이터 헤더가 너무 큽니다.",
                        )
                    connection.putheader(header_name, value)
            connection.endheaders()
            remaining = content_length
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise BridgeError(
                        HTTPStatus.BAD_REQUEST,
                        "incomplete_proxy_request",
                        "중앙 API로 보낼 요청 본문이 완료되지 않았습니다.",
                    )
                connection.send(chunk)
                remaining -= len(chunk)
            response = connection.getresponse()
            if response.status == HTTPStatus.UNAUTHORIZED and content_length == 0:
                response.read()
                connection.close()
                connection = None
                if self._refresh_platform_access_token():
                    connection, base_path = self.server.platform_connection()
                    connection.putrequest(method, base_path + suffix, skip_accept_encoding=True)
                    connection.putheader("Accept", self.headers.get("Accept", "*/*"))
                    connection.putheader("User-Agent", f"InfraX-Pipeline-Tool/{TOOL_VERSION}")
                    connection.putheader("Connection", "close")
                    refreshed_token = self.server.get_platform_access_token()
                    if refreshed_token:
                        connection.putheader("Authorization", f"Bearer {refreshed_token}")
                    connection.endheaders()
                    response = connection.getresponse()
            if response.status in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
                self.server.clear_platform_access_token()
            self._relay_platform_response(method, response)
        except BridgeError:
            raise
        except (TimeoutError, socket.timeout) as error:
            raise BridgeError(
                HTTPStatus.GATEWAY_TIMEOUT,
                "platform_api_timeout",
                "Marketplace 서버 응답 시간이 초과되었습니다.",
            ) from error
        except (OSError, http.client.HTTPException) as error:
            raise BridgeError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "platform_api_unavailable",
                "Marketplace 서버에 연결할 수 없습니다. 로컬 기능은 계속 사용할 수 있습니다.",
            ) from error
        finally:
            if connection is not None:
                connection.close()

    def _proxy_request_content_length(self, method: str) -> int:
        length_header = self.headers.get("Content-Length")
        if length_header in {None, ""}:
            return 0
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
        if method in {"GET", "HEAD", "DELETE"} and length:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "proxy_body_not_allowed",
                "이 중앙 API 요청에는 본문을 보낼 수 없습니다.",
            )
        content_type = self.headers.get_content_type()
        limit = (
            self.server.state.package_archive_limit
            if content_type in {
                "application/zip",
                "application/x-zip-compressed",
                "application/octet-stream",
            }
            else self.server.state.body_limit
        )
        if length > limit:
            raise BridgeError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "proxy_body_too_large",
                "중앙 API 요청 본문이 허용 크기를 넘습니다.",
            )
        return length

    def _relay_platform_response(
        self,
        method: str,
        response: http.client.HTTPResponse,
    ) -> None:
        self.send_response(response.status)
        self._send_common_headers()
        for header_name in (
            "Content-Type",
            "Content-Length",
            "Content-Disposition",
            "ETag",
            "Allow",
        ):
            value = response.getheader(header_name)
            if value is not None:
                self.send_header(header_name, value)
        location = response.getheader("Location")
        if location is not None:
            parsed_location = urlsplit(location)
            if (
                parsed_location.scheme == "https"
                and parsed_location.netloc
                and parsed_location.username is None
                and parsed_location.password is None
            ):
                self.send_header("Location", location)
        self.end_headers()
        if method == "HEAD":
            return
        try:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (
            TimeoutError,
            socket.timeout,
            BrokenPipeError,
            ConnectionResetError,
        ):
            self.close_connection = True

    def _require_authorized(self) -> None:
        authorization = self.headers.get("Authorization", "")
        scheme, separator, candidate = authorization.partition(" ")
        if (
            separator
            and scheme.lower() == "bearer"
            and hmac.compare_digest(candidate, self.server.state.auth_token)
        ):
            return

        request_path = urlsplit(self.path).path
        if request_path.startswith(f"/{LOCAL_API_PREFIX}/"):
            if self._session_cookie_matches(self.server.session_cookie_name):
                return

        raise BridgeError(
            HTTPStatus.UNAUTHORIZED,
            "pairing_required",
            "로컬 브리지 페어링 토큰이 필요합니다.",
        )

    def _require_api_session(self) -> None:
        origin = self.headers.get("Origin")
        if origin is not None and origin not in self.server.local_origins:
            raise BridgeError(
                HTTPStatus.FORBIDDEN,
                "local_session_origin_required",
                "중앙 API 프록시는 로컬 Studio 화면에서만 사용할 수 있습니다.",
            )
        if self._session_cookie_matches(self.server.api_session_cookie_name):
            return
        raise BridgeError(
            HTTPStatus.UNAUTHORIZED,
            "local_session_required",
            "로컬 Studio 세션 쿠키가 필요합니다.",
        )

    def _session_cookie_matches(self, cookie_name: str) -> bool:
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return False
        session = cookie.get(cookie_name)
        return (
            session is not None
            and hmac.compare_digest(
                session.value,
                self.server.state.auth_token,
            )
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
        return _safe_workflow_relative_path(filename).as_posix()

    def _decode_package_id(self, segment: str) -> str:
        try:
            package_id = unquote(segment, encoding="utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_package_id",
                "패키지 ID의 URL 인코딩이 올바르지 않습니다.",
            ) from error
        return _validate_package_id(package_id)

    def _read_package_metadata(self, expected_id: str) -> dict[str, Any]:
        encoded = self.headers.get("X-InfraX-Package-Metadata")
        if encoded is None:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "package_metadata_required",
                "X-InfraX-Package-Metadata 헤더가 필요합니다.",
            )
        if len(encoded) > MAX_PACKAGE_METADATA_HEADER:
            raise BridgeError(
                HTTPStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
                "package_metadata_too_large",
                "패키지 메타데이터 헤더가 너무 큽니다.",
            )
        try:
            decoded = unquote(encoded, encoding="utf-8", errors="strict")
            metadata = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_package_metadata",
                "패키지 메타데이터 헤더가 올바른 encodeURIComponent JSON이 아닙니다.",
            ) from error
        return _validate_package_metadata(metadata, expected_id=expected_id)

    def _read_package_archive(self, state: BridgeState) -> tuple[Path, str]:
        content_type = self.headers.get_content_type()
        if content_type not in {"application/zip", "application/octet-stream"}:
            raise BridgeError(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "package_content_type_required",
                "패키지는 application/zip 형식으로 전송해야 합니다.",
            )
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise BridgeError(
                HTTPStatus.LENGTH_REQUIRED,
                "content_length_required",
                "패키지 ZIP의 Content-Length가 필요합니다.",
            )
        try:
            length = int(length_header)
        except ValueError as error:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_content_length",
                "Content-Length가 올바르지 않습니다.",
            ) from error
        if length <= 0:
            raise BridgeError(
                HTTPStatus.BAD_REQUEST,
                "invalid_content_length",
                "패키지 ZIP은 비어 있을 수 없습니다.",
            )
        if length > state.package_archive_limit:
            raise BridgeError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "package_archive_too_large",
                f"패키지 ZIP은 {state.package_archive_limit:,}바이트를 넘을 수 없습니다.",
            )

        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".infrax-package-upload-",
            suffix=".zip",
            dir=state.root,
        )
        archive_path = Path(temporary_name)
        digest = hashlib.sha256()
        remaining = length
        try:
            with os.fdopen(descriptor, "wb") as output:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise BridgeError(
                            HTTPStatus.BAD_REQUEST,
                            "incomplete_package_archive",
                            "패키지 ZIP 전송이 완료되지 않았습니다.",
                        )
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())
        except Exception:
            state._remove_local_path(archive_path)
            raise
        return archive_path, digest.hexdigest()

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
        return (
            origin is None
            or origin in self.server.local_origins
            or origin in self.server.state.allowed_origins
        )

    def _host_allowed(self) -> bool:
        host = self.headers.get("Host", "").strip().lower()
        return host in self.server.allowed_hosts

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

    def _send_ndjson_stream(self, events) -> None:
        self.send_response(HTTPStatus.OK)
        self._send_common_headers()
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.end_headers()
        for event in events:
            body = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            try:
                self.wfile.write(body)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                break

    def _send_common_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin and (
            origin in self.server.local_origins
            or origin in self.server.state.allowed_origins
        ):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")


def create_server(
    *,
    root: Path | None = None,
    port: int = DEFAULT_PORT,
    allowed_origins: set[str] | frozenset[str] = DEFAULT_ALLOWED_ORIGINS,
    auth_token: str | None = None,
    body_limit: int = DEFAULT_BODY_LIMIT,
    package_archive_limit: int = DEFAULT_PACKAGE_ARCHIVE_LIMIT,
    catalog_timeout: float = DEFAULT_CATALOG_TIMEOUT,
    run_timeout: float = DEFAULT_RUN_TIMEOUT,
    studio_root: Path | str | None = None,
    platform_api_base: str | None = None,
    offline: bool = False,
    platform_credential_path: Path | None = None,
) -> StudioBridgeServer:
    """Create a loopback-only server. ``port=0`` is useful for tests."""

    project_root = Path(root) if root is not None else Path(__file__).resolve().parent
    state = BridgeState(
        project_root,
        allowed_origins=allowed_origins,
        auth_token=auth_token or secrets.token_urlsafe(32),
        body_limit=body_limit,
        package_archive_limit=package_archive_limit,
        catalog_timeout=catalog_timeout,
        run_timeout=run_timeout,
    )
    return StudioBridgeServer(
        (DEFAULT_HOST, port),
        state,
        studio_root=studio_root,
        platform_api_base=platform_api_base,
        offline=offline,
        platform_credential_path=platform_credential_path,
    )


def _parse_args(
    argv: list[str] | None = None,
    *,
    environ: dict[str, str] | os._Environ[str] | None = None,
    config_path: Path | None = None,
) -> argparse.Namespace:
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
    parser.add_argument(
        "--studio-dir",
        type=Path,
        default=Path(__file__).resolve().parent / DEFAULT_STUDIO_DIRECTORY,
        help=f"local Studio web bundle (default: ./{DEFAULT_STUDIO_DIRECTORY})",
    )
    parser.add_argument(
        "--platform-api-base",
        type=_validate_platform_api_base,
        default=None,
        help=(
            "optional central Marketplace API base (HTTPS only); overrides "
            "INFRAX_PLATFORM_API_BASE and tool-config.json"
        ),
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="disable the central Marketplace API while keeping all local features",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="do not open the local Studio in the default browser",
    )
    parser.add_argument(
        "--api-only",
        action="store_true",
        help="run only the legacy local API without serving the Studio GUI",
    )
    args = parser.parse_args(argv)
    try:
        args.platform_api_base = _resolve_platform_api_base(
            cli_value=args.platform_api_base,
            offline=args.offline,
            environ=environ,
            config_path=config_path,
        )
    except (argparse.ArgumentTypeError, ValueError) as error:
        parser.error(str(error))
    return args


def main() -> None:
    args = _parse_args()
    if not 0 <= args.port <= 65535:
        raise SystemExit("--port must be between 0 and 65535")
    allowed_origins = set(DEFAULT_ALLOWED_ORIGINS if args.api_only else ())
    allowed_origins.update(args.allow_origin)
    try:
        server = create_server(
            port=args.port,
            allowed_origins=allowed_origins,
            catalog_timeout=args.catalog_timeout,
            run_timeout=args.run_timeout,
            studio_root=None if args.api_only else args.studio_dir,
            platform_api_base=args.platform_api_base,
            offline=args.offline,
        )
    except OSError as error:
        if (
            error.errno == errno.EADDRINUSE
            or getattr(error, "winerror", None) == 10048
        ):
            raise SystemExit(
                f"InfraX Workflow Studio is already running on "
                f"http://{DEFAULT_HOST}:{args.port}/"
            ) from error
        raise
    host, port = server.server_address
    studio_url = f"http://{host}:{port}/"
    if server.studio_root is not None:
        print(f"InfraX Workflow Studio: {studio_url}", flush=True)
        if server.platform_api_base:
            print(f"Marketplace API: {server.platform_api_base}", flush=True)
    else:
        print(f"InfraX Studio API bridge: {studio_url}", flush=True)
        print(f"Pairing token: {server.state.auth_token}", flush=True)
        print("Allowed browser origins:", flush=True)
        for origin in sorted(allowed_origins):
            print(f"  - {origin}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if server.studio_root is not None and not args.no_browser:
        browser_timer = threading.Timer(0.35, webbrowser.open_new_tab, args=(studio_url,))
        browser_timer.daemon = True
        browser_timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping InfraX Studio bridge.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
