import argparse
import hashlib
import io
import json
import os
import socket
import stat
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from unittest import mock

from studio_bridge import (
    DEFAULT_ALLOWED_ORIGINS,
    TOOL_VERSION,
    BridgeError,
    _parse_args,
    _resolve_platform_api_base,
    _resolve_studio_root,
    _safe_workflow_filename,
    _validate_origin,
    _validate_platform_api_base,
    create_server,
)

_DEFAULT_TOOL_CONTEXT = object()


class FakePlatformResponse:
    def __init__(self, status=200, body=b"", headers=None):
        self.status = status
        self._body = io.BytesIO(body)
        self._headers = {
            str(key).lower(): str(value)
            for key, value in (headers or {}).items()
        }

    def read(self, size=-1):
        return self._body.read(size)

    def getheader(self, name, default=None):
        return self._headers.get(name.lower(), default)


class FakeHTTPSConnection:
    responses = []
    requests = []

    def __init__(self, host, port=None, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.method = None
        self.path = None
        self.headers = {}
        self.body = bytearray()

    @classmethod
    def reset(cls, *responses):
        cls.responses = list(responses)
        cls.requests = []

    def request(self, method, path, body=None, headers=None):
        self.method = method
        self.path = path
        self.headers = dict(headers or {})
        if body:
            self.body.extend(body)

    def putrequest(self, method, path, **_kwargs):
        self.method = method
        self.path = path

    def putheader(self, name, value):
        self.headers[name] = str(value)

    def endheaders(self):
        return None

    def send(self, data):
        self.body.extend(data)

    def getresponse(self):
        type(self).requests.append(self)
        if not type(self).responses:
            raise AssertionError("No fake platform response queued")
        response = type(self).responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def close(self):
        return None


class StudioBridgeTest(unittest.TestCase):
    origin = "https://studio.example"
    token = "test-token-" + ("x" * 40)

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        (self.root / "workflows").mkdir()
        (self.root / "workflow").mkdir()
        (self.root / "workflow" / "__init__.py").write_text("", encoding="utf-8")
        (self.root / "catalog.py").write_text(
            "\n".join(
                [
                    "import json",
                    "from pathlib import Path",
                    "catalog = {",
                    '    "schema": "workflow.catalog.v1",',
                    '    "runtime": {"id": "test"},',
                    '    "nodes": [{"key": "basic.NumberInput", "name": "NumberInput"}],',
                    "}",
                    'Path("catalog.json").write_text(json.dumps(catalog), encoding="utf-8")',
                    'print("catalog refreshed")',
                ]
            ),
            encoding="utf-8",
        )
        (self.root / "main.py").write_text(
            "\n".join(
                [
                    "import json",
                    "import sys",
                    "import time",
                    "from pathlib import Path",
                    "workflow_path = Path(sys.argv[1])",
                    'workflow = json.loads(workflow_path.read_text(encoding="utf-8"))',
                    'time.sleep(1) if workflow.get("sleep") else None',
                    'print(f"workflow={workflow_path.as_posix()}")',
                    'print(f"nodes={len(workflow.get(\'nodes\', []))}")',
                    'raise SystemExit(7 if workflow.get("fail") else 0)',
                ]
            ),
            encoding="utf-8",
        )
        self.studio_root = self.root / "studio_web"
        (self.studio_root / "assets").mkdir(parents=True)
        (self.studio_root / "index.html").write_text(
            "\n".join(
                [
                    "<!doctype html>",
                    '<html data-api-base="" '
                    'data-local-tool-base="http://127.0.0.1:8765/" '
                    'data-local-tool-token="" data-local-studio="false">',
                    "<body>InfraX Studio</body>",
                    "</html>",
                ]
            ),
            encoding="utf-8",
        )
        (self.studio_root / "app.js").write_text(
            'document.body.dataset.ready = "true";',
            encoding="utf-8",
        )
        (self.studio_root / "styles.css").write_text(
            "body { color: #111; }",
            encoding="utf-8",
        )
        (self.studio_root / "ui-components.js").write_text(
            'customElements.define("x-test", class extends HTMLElement {});',
            encoding="utf-8",
        )
        (self.studio_root / "assets" / "mark.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            encoding="utf-8",
        )
        (self.studio_root / "assets" / "material-symbols-outlined.woff2").write_bytes(
            b"test-woff2-font"
        )
        self.server = create_server(
            root=self.root,
            port=0,
            allowed_origins=DEFAULT_ALLOWED_ORIGINS | {self.origin},
            auth_token=self.token,
            catalog_timeout=5,
            run_timeout=5,
            studio_root=self.studio_root,
            platform_credential_path=self.root / "marketplace-credentials.bin",
        )
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop_server)
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.default_tool_context = self.server.create_tool_context(None)["contextId"]

    def _stop_server(self):
        self.server.shutdown()
        self.thread.join(timeout=5)

    def request(
        self,
        method,
        path,
        *,
        payload=None,
        raw_payload=None,
        origin=None,
        authorize=True,
        tool_context=_DEFAULT_TOOL_CONTEXT,
        extra_headers=None,
    ):
        headers = {"Origin": self.origin if origin is None else origin}
        if authorize:
            headers["Authorization"] = f"Bearer {self.token}"
        if tool_context is _DEFAULT_TOOL_CONTEXT:
            tool_context = self.default_tool_context
        if tool_context:
            headers["X-InfraX-Tool-Context"] = tool_context
        if payload is not None and raw_payload is not None:
            raise ValueError("payload and raw_payload are mutually exclusive")
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif raw_payload is not None:
            data = raw_payload
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        try:
            body = response.read()
            status = response.status
            response_headers = response.headers
        finally:
            response.close()
        decoded = json.loads(body.decode("utf-8")) if body else None
        return status, response_headers, decoded

    @staticmethod
    def package_zip(entries, *, compression=zipfile.ZIP_DEFLATED):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=compression) as archive:
            for name, contents in entries:
                archive.writestr(name, contents)
        return output.getvalue()

    def package_metadata(self, package_id, archive, **overrides):
        metadata = {
            "id": package_id,
            "name": "Test package",
            "version": "1.0.0",
            "kind": "node-pack",
            "sha256": hashlib.sha256(archive).hexdigest(),
            "nodeTypes": ["basic.NumberInput"],
        }
        metadata.update(overrides)
        return metadata

    def install_package(self, package_id, archive, metadata=None, *, path_prefix="/local-api"):
        document = metadata or self.package_metadata(package_id, archive)
        encoded_metadata = urllib.parse.quote(
            json.dumps(document, separators=(",", ":")),
            safe="",
        )
        return self.request(
            "PUT",
            f"{path_prefix}/packages/{urllib.parse.quote(package_id)}/install",
            raw_payload=archive,
            extra_headers={
                "Content-Type": "application/zip",
                "X-InfraX-Package-Metadata": encoded_metadata,
            },
        )

    def studio_cookie_header(self):
        status, headers, _ = self.raw_request("GET", "/")
        self.assertEqual(status, 200)
        cookies = [
            value.split(";", 1)[0]
            for value in headers.get_all("Set-Cookie", [])
        ]
        return "; ".join(cookies)

    def raw_request(
        self,
        method,
        path,
        *,
        origin=None,
        authorize=False,
        extra_headers=None,
    ):
        headers = {}
        if origin is not None:
            headers["Origin"] = origin
        if authorize:
            headers["Authorization"] = f"Bearer {self.token}"
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            headers=headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        try:
            body = response.read()
            status = response.status
            response_headers = response.headers
        finally:
            response.close()
        return status, response_headers, body

    def test_local_studio_serves_fixed_bundle_and_injects_runtime_configuration(self):
        status, headers, body = self.raw_request(
            "GET",
            "/",
            origin=self.base_url,
        )
        source = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertIn('data-api-base="/api"', source)
        self.assertIn('data-platform-api-base=""', source)
        self.assertIn('data-local-tool-base="/local-api/"', source)
        self.assertIn('data-local-tool-token=""', source)
        self.assertNotIn(self.token, source)
        self.assertIn('data-local-studio="true"', source)
        self.assertIn(f'data-pipeline-tool-version="{TOOL_VERSION}"', source)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        set_cookies = headers.get_all("Set-Cookie")
        self.assertEqual(len(set_cookies), 2)
        self.assertTrue(all("HttpOnly" in value for value in set_cookies))
        self.assertTrue(all("SameSite=Strict" in value for value in set_cookies))
        self.assertTrue(any("Path=/local-api" in value for value in set_cookies))
        self.assertTrue(any("Path=/api" in value for value in set_cookies))
        self.assertIn(
            f"InfraXStudioSession_{self.server.server_address[1]}=",
            set_cookies[0],
        )

        status, headers, body = self.raw_request("HEAD", "/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Content-Type"], "text/javascript; charset=utf-8")
        self.assertGreater(int(headers["Content-Length"]), 0)

        status, headers, body = self.raw_request("GET", "/assets/mark.svg")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/svg+xml")
        self.assertIn(b"<svg", body)

        status, headers, body = self.raw_request(
            "GET",
            "/assets/material-symbols-outlined.woff2",
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "font/woff2")
        self.assertEqual(body, b"test-woff2-font")

    def test_local_studio_bundle_requires_a_regular_bundled_font_file(self):
        invalid_root = self.root / "invalid-studio-font"
        (invalid_root / "assets").mkdir(parents=True)
        for filename in (
            "index.html",
            "app.js",
            "styles.css",
            "ui-components.js",
        ):
            (invalid_root / filename).write_text(
                (self.studio_root / filename).read_text(encoding="utf-8"),
                encoding="utf-8",
            )
        with self.assertRaisesRegex(ValueError, "material-symbols-outlined"):
            _resolve_studio_root(invalid_root)

        (
            invalid_root
            / "assets"
            / "material-symbols-outlined.woff2"
        ).mkdir()
        with self.assertRaisesRegex(ValueError, "material-symbols-outlined"):
            _resolve_studio_root(invalid_root)

    def test_local_studio_blocks_private_static_paths_and_untrusted_hosts(self):
        status, _, body = self.raw_request(
            "GET",
            "/assets/%2e%2e/studio_bridge.py",
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            json.loads(body.decode("utf-8"))["error"]["code"],
            "invalid_static_path",
        )

        status, _, body = self.raw_request(
            "GET",
            "/studio_bridge.py",
            authorize=True,
            extra_headers={"X-InfraX-Tool-Context": self.default_tool_context},
        )
        self.assertEqual(status, 404)
        self.assertNotIn(b"Secure loopback bridge", body)

        status, _, body = self.raw_request(
            "GET",
            "/",
            extra_headers={"Host": "evil.example"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            json.loads(body.decode("utf-8"))["error"]["code"],
            "host_not_allowed",
        )

    def test_same_origin_local_api_alias_runs_without_cors_or_manual_pairing(self):
        status, headers, body = self.request(
            "POST",
            "/local-api/tool-contexts",
            payload={"path": None},
            origin=self.base_url,
            tool_context=None,
        )
        self.assertEqual(status, 201)
        context_id = body["contextId"]
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.base_url)

        status, _, body = self.request(
            "POST",
            "/local-api/catalog/refresh",
            payload={},
            origin=self.base_url,
            tool_context=context_id,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["catalog"]["nodes"][0]["key"], "basic.NumberInput")

        status, _, body = self.request(
            "GET",
            "/local-api/workflows",
            origin=self.base_url,
            tool_context=context_id,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["workflows"], [])

    def test_local_studio_http_only_cookie_authorizes_only_prefixed_api(self):
        status, headers, _ = self.raw_request("GET", "/")
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"].split(";", 1)[0]

        status, _, body = self.raw_request(
            "GET",
            "/local-api/workflows",
            extra_headers={"Cookie": cookie},
        )
        self.assertEqual(status, 409)
        self.assertEqual(
            json.loads(body.decode("utf-8"))["error"]["code"],
            "tool_context_required",
        )

        status, _, body = self.raw_request(
            "GET",
            "/workflows",
            extra_headers={"Cookie": cookie},
        )
        self.assertEqual(status, 401)
        self.assertEqual(
            json.loads(body.decode("utf-8"))["error"]["code"],
            "pairing_required",
        )

    def test_local_platform_fallback_keeps_editor_available_without_marketplace(self):
        cookie = self.studio_cookie_header()
        status, _, body = self.request(
            "GET",
            "/api/session",
            authorize=False,
            tool_context=None,
            origin=self.base_url,
            extra_headers={"Cookie": cookie},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["authMode"], "required")
        self.assertIsNone(body["user"])
        self.assertTrue(body["localStudio"])

        for resource in ("workflows", "modules"):
            status, _, body = self.request(
                "GET",
                f"/api/marketplace/{resource}",
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
            self.assertEqual(status, 200)
            self.assertEqual(body["items"], [])
            self.assertFalse(body["marketplaceConnected"])

    def test_platform_proxy_keeps_marketplace_token_in_bridge_memory(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        status, _, source = self.raw_request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn('data-api-base="/api"', source.decode("utf-8"))
        self.assertIn(
            'data-platform-api-base="https://platform.example/pipeline/api"',
            source.decode("utf-8"),
        )
        cookie = self.studio_cookie_header()
        exchange_document = {
            "accessToken": "ixm_" + ("t" * 43),
            "refreshToken": "ixr_" + ("r" * 43),
            "tokenType": "Bearer",
            "expiresAt": "2026-07-30T12:00:00+00:00",
            "user": {
                "id": "user-1",
                "displayName": "Tester",
                "email": "tester@example.com",
                "role": "user",
            },
        }
        session_document = {
            "authMode": "required",
            "user": exchange_document["user"],
        }
        FakeHTTPSConnection.reset(
            FakePlatformResponse(
                200,
                json.dumps(exchange_document).encode("utf-8"),
                {"Content-Type": "application/json"},
            ),
            FakePlatformResponse(
                200,
                json.dumps(session_document).encode("utf-8"),
                {"Content-Type": "application/json"},
            ),
        )
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "POST",
                "/api/local-connect/exchange",
                payload={
                    "code": "ixc_" + ("c" * 43),
                    "verifier": "v" * 43,
                    "state": "s" * 22,
                    "returnOrigin": self.base_url,
                },
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
            self.assertEqual(status, 200)
            self.assertTrue(body["connected"])
            self.assertNotIn("accessToken", body)
            self.assertNotIn("ixm_", json.dumps(body))
            self.assertEqual(
                self.server.get_platform_access_token(),
                exchange_document["accessToken"],
            )
            status, _, refreshed_source = self.raw_request("GET", "/")
            self.assertEqual(status, 200)
            self.assertNotIn(
                exchange_document["accessToken"],
                refreshed_source.decode("utf-8"),
            )

            status, _, body = self.request(
                "GET",
                "/api/session",
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
            self.assertEqual(status, 200)
            self.assertEqual(body["user"]["id"], "user-1")

        exchange_request, session_request = FakeHTTPSConnection.requests
        self.assertEqual(
            exchange_request.path,
            "/pipeline/api/local-connect/exchange",
        )
        self.assertNotIn("Authorization", exchange_request.headers)
        self.assertEqual(
            session_request.headers["Authorization"],
            "Bearer " + exchange_document["accessToken"],
        )
        self.assertEqual(session_request.timeout, 5.0)

    def test_platform_proxy_refreshes_once_and_logout_clears_credentials(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        self.server.set_platform_access_token("ixm_" + ("a" * 43))
        self.server.set_platform_refresh_token("ixr_" + ("r" * 43))
        cookie = self.studio_cookie_header()
        refreshed_access = "ixm_" + ("b" * 43)
        rotated_refresh = "ixr_" + ("s" * 43)
        FakeHTTPSConnection.reset(
            FakePlatformResponse(401, b'{"error":"expired"}'),
            FakePlatformResponse(
                200,
                json.dumps(
                    {
                        "accessToken": refreshed_access,
                        "refreshToken": rotated_refresh,
                        "expiresAt": "2026-08-01T00:00:00Z",
                        "refreshExpiresAt": "2027-08-01T00:00:00Z",
                    }
                ).encode("utf-8"),
            ),
            FakePlatformResponse(
                200,
                b'{"authMode":"required","user":{"id":"user-1","displayName":"Tester"}}',
                {"Content-Type": "application/json"},
            ),
            FakePlatformResponse(200, b'{"revoked":true}'),
        )
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "GET",
                "/api/session",
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
            self.assertEqual(status, 200)
            self.assertEqual(body["user"]["id"], "user-1")
            self.assertEqual(
                self.server.get_platform_refresh_token(),
                rotated_refresh,
            )
            status, _, body = self.request(
                "POST",
                "/api/local-connect/logout",
                payload={},
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
            self.assertEqual(status, 200)
            self.assertFalse(body["connected"])

        paths = [request.path for request in FakeHTTPSConnection.requests]
        self.assertEqual(
            paths,
            [
                "/pipeline/api/session",
                "/pipeline/api/local-connect/refresh",
                "/pipeline/api/session",
                "/pipeline/api/local-connect/logout",
            ],
        )
        self.assertEqual(
            FakeHTTPSConnection.requests[2].headers["Authorization"],
            "Bearer " + refreshed_access,
        )
        logout_body = json.loads(
            bytes(FakeHTTPSConnection.requests[3].body).decode("utf-8")
        )
        self.assertEqual(logout_body, {"refreshToken": rotated_refresh})
        self.assertIsNone(self.server.get_platform_access_token())
        self.assertIsNone(self.server.get_platform_refresh_token())

    def test_platform_proxy_requires_api_cookie_and_rejects_non_allowlisted_routes(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        status, _, body = self.request(
            "GET",
            "/api/session",
            authorize=False,
            tool_context=None,
            origin=self.base_url,
        )
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "local_session_required")

        cookie = self.studio_cookie_header()
        FakeHTTPSConnection.reset()
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "GET",
                "/api/admin/secrets",
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
        self.assertEqual(status, 404)
        self.assertEqual(
            body["error"]["code"],
            "platform_proxy_route_not_allowed",
        )
        self.assertEqual(FakeHTTPSConnection.requests, [])

    def test_platform_timeout_affects_only_the_proxy_request(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        cookie = self.studio_cookie_header()
        FakeHTTPSConnection.reset(socket.timeout("upstream timeout"))
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "GET",
                "/api/session",
                authorize=False,
                tool_context=None,
                origin=self.base_url,
                extra_headers={"Cookie": cookie},
            )
        self.assertEqual(status, 504)
        self.assertEqual(body["error"]["code"], "platform_api_timeout")

        status, _, body = self.request(
            "GET",
            "/local-api/workflows",
            origin=self.base_url,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["workflows"], [])

    def test_platform_api_base_requires_https_and_an_api_path(self):
        self.assertEqual(
            _validate_platform_api_base("https://studio.example/pipeline/api/"),
            "https://studio.example/pipeline/api",
        )
        with self.assertRaises(argparse.ArgumentTypeError):
            _validate_platform_api_base("http://studio.example/api")
        with self.assertRaises(argparse.ArgumentTypeError):
            _validate_platform_api_base("https://studio.example")

    def test_tool_config_precedence_and_offline_mode_do_not_require_platform(self):
        config_path = self.root / "tool-config.json"
        config_path.write_text(
            json.dumps(
                {"platformApiBase": "https://config.example/pipeline/api"}
            ),
            encoding="utf-8",
        )
        self.assertEqual(
            _resolve_platform_api_base(
                cli_value=None,
                offline=False,
                environ={},
                config_path=config_path,
            ),
            "https://config.example/pipeline/api",
        )
        self.assertEqual(
            _resolve_platform_api_base(
                cli_value=None,
                offline=False,
                environ={
                    "INFRAX_PLATFORM_API_BASE": "https://env.example/api"
                },
                config_path=config_path,
            ),
            "https://env.example/api",
        )
        self.assertEqual(
            _resolve_platform_api_base(
                cli_value="https://cli.example/api/",
                offline=False,
                environ={
                    "INFRAX_PLATFORM_API_BASE": "https://env.example/api"
                },
                config_path=config_path,
            ),
            "https://cli.example/api",
        )
        config_path.write_text("{broken", encoding="utf-8")
        args = _parse_args(
            ["--offline", "--no-browser"],
            environ={"INFRAX_PLATFORM_API_BASE": "http://invalid.example/api"},
            config_path=config_path,
        )
        self.assertTrue(args.offline)
        self.assertIsNone(args.platform_api_base)

        offline_server = create_server(
            root=self.root,
            port=0,
            allowed_origins={self.origin},
            auth_token="offline-token-" + ("o" * 40),
            studio_root=self.studio_root,
            platform_api_base="https://configured.example/api",
            offline=True,
        )
        self.addCleanup(offline_server.server_close)
        self.assertTrue(offline_server.offline)
        self.assertIsNone(offline_server.platform_api_base)
        self.assertTrue(offline_server.state.refresh_catalog()["ok"])
        offline_server.state.save_workflow(
            "offline.json",
            {"nodes": [], "links": []},
        )
        self.assertTrue(offline_server.state.run_workflow("offline.json")["ok"])

    def test_second_server_cannot_reuse_the_same_port(self):
        with self.assertRaises(OSError):
            duplicate = create_server(
                root=self.root,
                port=self.server.server_address[1],
                allowed_origins=DEFAULT_ALLOWED_ORIGINS | {self.origin},
                auth_token="duplicate-token-" + ("y" * 40),
                studio_root=self.studio_root,
            )
            duplicate.server_close()

    def test_health_is_minimal_and_other_routes_require_pairing(self):
        status, headers, body = self.request("GET", "/health", authorize=False)
        self.assertEqual(status, 200)
        self.assertEqual(body["service"], "infrax-pipeline-tool")
        self.assertEqual(body["toolVersion"], TOOL_VERSION)
        self.assertTrue(body["pairingRequired"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.origin)
        self.assertNotIn("workflowCount", body)

        status, headers, body = self.request(
            "GET",
            "/workflows",
            authorize=False,
            tool_context=None,
        )
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "pairing_required")
        self.assertIn("Bearer", headers["WWW-Authenticate"])

        status, _, body = self.request(
            "GET",
            "/workflows",
            tool_context=None,
        )
        self.assertEqual(status, 409)
        self.assertEqual(body["error"]["code"], "tool_context_required")

    def test_preflight_uses_exact_cors_allowlist_and_private_network_header(self):
        status, headers, body = self.request(
            "OPTIONS",
            "/workflows",
            authorize=False,
            extra_headers={
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.origin)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])
        self.assertIn("If-None-Match", headers["Access-Control-Allow-Headers"])
        self.assertIn("X-InfraX-Tool-Context", headers["Access-Control-Allow-Headers"])
        self.assertIn(
            "X-InfraX-Package-Metadata",
            headers["Access-Control-Allow-Headers"],
        )

    def test_default_studio_origin_is_allowed(self):
        public_ip_origin = "https://106.254.226.206"
        self.assertIn(public_ip_origin, DEFAULT_ALLOWED_ORIGINS)
        self.assertNotIn("https://infrax.iptime.org", DEFAULT_ALLOWED_ORIGINS)
        self.assertNotIn("http://infrax.iptime.org:3004", DEFAULT_ALLOWED_ORIGINS)
        self.assertIn("http://127.0.0.1:5178", DEFAULT_ALLOWED_ORIGINS)
        self.assertIn("http://localhost:5178", DEFAULT_ALLOWED_ORIGINS)
        self.assertEqual(_validate_origin("http://127.0.0.1:5181"), "http://127.0.0.1:5181")
        self.assertEqual(_validate_origin("https://studio.example"), "https://studio.example")
        with self.assertRaises(argparse.ArgumentTypeError):
            _validate_origin("http://studio.example:3004")

        status, headers, body = self.request(
            "OPTIONS",
            "/workflows",
            origin=public_ip_origin,
            authorize=False,
            extra_headers={
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers["Access-Control-Allow-Origin"], public_ip_origin)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

        status, headers, body = self.request(
            "GET",
            "/health",
            origin="https://evil.example",
            authorize=False,
        )
        self.assertEqual(status, 403)
        self.assertEqual(body["error"]["code"], "origin_not_allowed")
        self.assertIsNone(headers["Access-Control-Allow-Origin"])

    def test_catalog_refresh_runs_catalog_script_and_catalog_can_be_read(self):
        status, _, body = self.request("POST", "/catalog/refresh", payload={})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["catalog"]["nodes"][0]["key"], "basic.NumberInput")
        self.assertIn("catalog refreshed", body["stdout"])

        status, _, body = self.request("GET", "/catalog")
        self.assertEqual(status, 200)
        self.assertEqual(body["catalog"]["schema"], "workflow.catalog.v1")

    def test_package_zip_install_writes_manifest_registry_and_catalog_reference(self):
        archive = self.package_zip(
            [
                ("__init__.py", ""),
                ("nodes.py", "class InstalledNode:\n    pass\n"),
            ]
        )
        metadata = self.package_metadata("vision-nodes", archive)
        status, _, body = self.install_package(
            "vision-nodes",
            archive,
            metadata,
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        package = body["package"]
        self.assertEqual(package["id"], "vision-nodes")
        self.assertEqual(package["installPath"], "custom_nodes/vision-nodes")
        self.assertEqual(package["sha256"], metadata["sha256"])
        self.assertEqual(
            body["catalog"]["nodes"][0]["package_ref"],
            {
                "package_id": "vision-nodes",
                "version": "1.0.0",
                "digest": metadata["sha256"],
            },
        )

        install_root = self.root / "custom_nodes" / "vision-nodes"
        self.assertTrue((install_root / "nodes.py").is_file())
        manifest = json.loads(
            (install_root / "infrax-package.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["schema"], "infrax.package.v1")
        self.assertEqual(manifest["sha256"], metadata["sha256"])
        registry = json.loads(
            (self.root / "package-registry.json").read_text(encoding="utf-8")
        )
        self.assertEqual(registry["schema"], "infrax.package-registry.v1")
        self.assertEqual(registry["packages"][0]["id"], "vision-nodes")

    def test_registered_package_can_be_safely_exported_as_zip(self):
        source_archive = self.package_zip(
            [
                ("__init__.py", ""),
                ("nodes.py", "value = 1\n"),
            ]
        )
        status, _, _ = self.install_package("export-node", source_archive)
        self.assertEqual(status, 200)

        status, headers, body = self.raw_request(
            "GET",
            "/local-api/packages/export-node/archive",
            authorize=True,
            extra_headers={
                "X-InfraX-Tool-Context": self.default_tool_context,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/zip")
        self.assertEqual(
            hashlib.sha256(body).hexdigest(),
            headers["X-InfraX-Archive-Sha256"],
        )
        metadata = json.loads(
            urllib.parse.unquote(headers["X-InfraX-Package-Metadata"])
        )
        self.assertEqual(metadata["id"], "export-node")
        self.assertEqual(metadata["sha256"], hashlib.sha256(body).hexdigest())
        with zipfile.ZipFile(io.BytesIO(body)) as exported:
            self.assertEqual(
                sorted(exported.namelist()),
                ["__init__.py", "infrax-package.json", "nodes.py"],
            )
        deadline = time.monotonic() + 1
        while (
            list(self.root.glob(".export-node.export-*.zip"))
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        self.assertEqual(list(self.root.glob(".export-node.export-*.zip")), [])

        status, _, body = self.request(
            "GET",
            "/packages/not-registered/archive",
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "installed_package_not_found")

    def test_package_installs_from_fixed_marketplace_stream_without_browser_zip(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        self.server.set_platform_access_token("ixm_" + ("m" * 43))
        archive = self.package_zip(
            [("nodes.py", "class MarketplaceNode:\n    pass\n")]
        )
        metadata = self.package_metadata("streamed-node", archive)
        FakeHTTPSConnection.reset(
            FakePlatformResponse(
                200,
                archive,
                {
                    "Content-Type": "application/zip",
                    "Content-Length": str(len(archive)),
                },
            )
        )
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "POST",
                "/local-api/packages/streamed-node/install-from-marketplace",
                payload=metadata,
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["package"]["id"], "streamed-node")
        self.assertTrue(
            (self.root / "custom_nodes" / "streamed-node" / "nodes.py").is_file()
        )
        upstream = FakeHTTPSConnection.requests[0]
        self.assertEqual(
            upstream.path,
            "/pipeline/api/marketplace/modules/streamed-node/download",
        )
        self.assertEqual(
            upstream.headers["Authorization"],
            "Bearer " + self.server.get_platform_access_token(),
        )
        self.assertEqual(
            list(self.root.glob(".infrax-marketplace-download-*.zip")),
            [],
        )

    def test_git_marketplace_item_is_not_followed_by_local_installer(self):
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        archive = self.package_zip([("nodes.py", "value = 1\n")])
        FakeHTTPSConnection.reset(
            FakePlatformResponse(
                302,
                b"",
                {"Location": "https://github.com/example/project"},
            )
        )
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "POST",
                "/local-api/packages/git-node/install-from-marketplace",
                payload=self.package_metadata("git-node", archive),
            )
        self.assertEqual(status, 422)
        self.assertEqual(
            body["error"]["code"],
            "marketplace_git_install_unsupported",
        )
        self.assertFalse((self.root / "custom_nodes" / "git-node").exists())

    def test_marketplace_installed_package_cannot_be_republished(self):
        source_archive = self.package_zip([("nodes.py", "value = 1\n")])
        metadata = self.package_metadata("publish-node", source_archive)
        status, _, _ = self.install_package(
            "publish-node",
            source_archive,
            metadata,
        )
        self.assertEqual(status, 200)
        self.server.platform_api_base = "https://platform.example/pipeline/api"
        self.server.set_platform_access_token("ixm_" + ("p" * 43))
        FakeHTTPSConnection.reset()
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "PUT",
                "/local-api/packages/publish-node/publish",
                payload={
                    "name": "Published node",
                    "version": "1.1.0",
                    "description": "Package uploaded directly by the local tool.",
                    "kind": "node-pack",
                    "nodeTypes": ["basic.NumberInput"],
                },
                extra_headers={"If-Match": '"revision-1"'},
            )
        self.assertEqual(status, 409)
        self.assertEqual(
            body["error"]["code"],
            "installed_package_republish_not_allowed",
        )
        self.assertEqual(FakeHTTPSConnection.requests, [])

    def test_installed_package_export_round_trips_into_a_fresh_root(self):
        source_archive = self.package_zip([("nodes.py", "value = 1\n")])
        metadata = self.package_metadata("roundtrip-node", source_archive)
        status, _, _ = self.install_package(
            "roundtrip-node",
            source_archive,
            metadata,
        )
        self.assertEqual(status, 200)
        installed_manifest = (
            self.root
            / "custom_nodes"
            / "roundtrip-node"
            / "infrax-package.json"
        )
        installed_manifest.write_text(
            '{"id":"tampered","secret":"must-not-survive-export"}',
            encoding="utf-8",
        )

        exported = self.server.state.build_package_archive("roundtrip-node")
        try:
            with zipfile.ZipFile(exported["path"]) as archive:
                self.assertEqual(
                    archive.namelist().count("infrax-package.json"),
                    1,
                )
                exported_manifest = json.loads(
                    archive.read("infrax-package.json").decode("utf-8")
                )
            self.assertEqual(exported_manifest["schema"], "infrax.package.v1")
            self.assertEqual(exported_manifest["id"], "roundtrip-node")
            self.assertEqual(exported_manifest["sha256"], metadata["sha256"])
            self.assertNotIn("secret", exported_manifest)

            with tempfile.TemporaryDirectory() as fresh_directory:
                fresh_root = Path(fresh_directory)
                (fresh_root / "workflow").mkdir()
                (fresh_root / "workflow" / "__init__.py").write_text(
                    "",
                    encoding="utf-8",
                )
                for filename in ("catalog.py", "main.py"):
                    (fresh_root / filename).write_text(
                        (self.root / filename).read_text(encoding="utf-8"),
                        encoding="utf-8",
                    )
                fresh_server = create_server(
                    root=fresh_root,
                    port=0,
                    allowed_origins=DEFAULT_ALLOWED_ORIGINS | {self.origin},
                    auth_token="fresh-root-token-" + ("f" * 40),
                )
                try:
                    fresh_metadata = {
                        "id": metadata["id"],
                        "name": metadata["name"],
                        "version": metadata["version"],
                        "kind": metadata["kind"],
                        "sha256": exported["sha256"],
                        "nodeTypes": metadata["nodeTypes"],
                    }
                    installed = fresh_server.state.install_package(
                        fresh_metadata,
                        exported["path"],
                        exported["sha256"],
                    )
                    self.assertTrue(installed["ok"])
                    self.assertEqual(
                        (
                            fresh_root
                            / "custom_nodes"
                            / "roundtrip-node"
                            / "nodes.py"
                        ).read_text(encoding="utf-8"),
                        "value = 1\n",
                    )
                    fresh_manifest = json.loads(
                        (
                            fresh_root
                            / "custom_nodes"
                            / "roundtrip-node"
                            / "infrax-package.json"
                        ).read_text(encoding="utf-8")
                    )
                    self.assertEqual(
                        fresh_manifest["sha256"],
                        exported["sha256"],
                    )
                finally:
                    fresh_server.server_close()
        finally:
            self.server.state._remove_local_path(exported["path"])

    def test_catalog_confirmed_custom_node_directory_publishes_safely(self):
        package_root = self.root / "custom_nodes" / "manual-node"
        (package_root / ".git").mkdir(parents=True)
        (package_root / "__pycache__").mkdir()
        (package_root / "assets").mkdir()
        (package_root / "__init__.py").write_text(
            "from .nodes import ManualNode\n",
            encoding="utf-8",
        )
        (package_root / "nodes.py").write_text(
            "class ManualNode:\n    pass\n",
            encoding="utf-8",
        )
        (package_root / "assets" / "label.txt").write_text(
            "manual node",
            encoding="utf-8",
        )
        (package_root / "README.md").write_text(
            "# Manual node\n",
            encoding="utf-8",
        )
        (package_root / "LICENSE.txt").write_text(
            "Test license\n",
            encoding="utf-8",
        )
        (package_root / "requirements-dev.txt").write_text(
            "pytest\n",
            encoding="utf-8",
        )
        (package_root / "pyproject.toml").write_text(
            "[project]\nname='manual-node'\n",
            encoding="utf-8",
        )
        (package_root / ".env").write_text(
            "MARKETPLACE_TOKEN=must-not-leak\n",
            encoding="utf-8",
        )
        (package_root / "config.json").write_text(
            '{"secret":"config-sentinel"}',
            encoding="utf-8",
        )
        (package_root / "token.txt").write_text(
            "token-sentinel",
            encoding="utf-8",
        )
        (package_root / ".git-credentials").write_text(
            "credential-sentinel",
            encoding="utf-8",
        )
        (package_root / "service-account.json").write_text(
            '{"secret":"service-account-sentinel"}',
            encoding="utf-8",
        )
        (package_root / "weights.bin").write_bytes(b"binary-sentinel")
        (package_root / ".git" / "config").write_text(
            "[remote]\nurl=https://secret.example/repo.git\n",
            encoding="utf-8",
        )
        (package_root / "__pycache__" / "nodes.pyc").write_bytes(b"cache")
        (self.root / "catalog.json").write_text(
            json.dumps(
                {
                    "schema": "workflow.catalog.v1",
                    "runtime": {"id": "test"},
                    "nodes": [
                        {
                            "key": "manual.Node",
                            "name": "Manual Node",
                            "module": "custom_nodes.manual-node.nodes",
                            "io": {"inputs": [], "outputs": []},
                            "init": {"inputs": []},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        status, _, body = self.request(
            "GET",
            "/local-api/custom-node-packages",
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["packages"]), 1)
        local_package = body["packages"][0]
        self.assertEqual(
            {
                key: local_package[key]
                for key in (
                    "id",
                    "name",
                    "kind",
                    "source",
                    "installPath",
                    "nodeTypes",
                )
            },
            {
                "id": "manual-node",
                "name": "manual-node",
                "kind": "node-pack",
                "source": "custom_nodes",
                "installPath": "custom_nodes/manual-node",
                "nodeTypes": ["manual.Node"],
            },
        )
        publishable_paths = (
            "__init__.py",
            "nodes.py",
            "README.md",
            "LICENSE.txt",
            "requirements-dev.txt",
            "pyproject.toml",
        )
        self.assertEqual(local_package["fileCount"], len(publishable_paths))
        self.assertEqual(
            local_package["size"],
            sum(
                (package_root / relative_path).stat().st_size
                for relative_path in publishable_paths
            ),
        )

        self.server.platform_api_base = "https://platform.example/pipeline/api"
        self.server.set_platform_access_token("ixm_" + ("m" * 43))
        FakeHTTPSConnection.reset(
            FakePlatformResponse(
                201,
                json.dumps(
                    {
                        "package": {
                            "id": "manual-node",
                            "name": "Manual node pack",
                            "version": "2.0.0",
                        }
                    }
                ).encode("utf-8"),
                {"Content-Type": "application/json"},
            )
        )
        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "PUT",
                "/local-api/packages/manual-node/publish",
                payload={
                    "name": "Manual node pack",
                    "version": "2.0.0",
                    "description": "Catalog-confirmed local custom node.",
                    "kind": "node-pack",
                    "nodeTypes": ["manual.Node"],
                    "author": "Local developer",
                },
            )
        self.assertEqual(status, 201)
        self.assertEqual(body["package"]["id"], "manual-node")
        upstream = FakeHTTPSConnection.requests[0]
        self.assertEqual(
            upstream.path,
            "/pipeline/api/marketplace/modules/manual-node",
        )
        with zipfile.ZipFile(io.BytesIO(bytes(upstream.body))) as uploaded:
            archived_names = set(uploaded.namelist())
            self.assertIn("__init__.py", archived_names)
            self.assertIn("nodes.py", archived_names)
            self.assertIn("README.md", archived_names)
            self.assertIn("LICENSE.txt", archived_names)
            self.assertIn("requirements-dev.txt", archived_names)
            self.assertIn("pyproject.toml", archived_names)
            self.assertIn("infrax-package.json", archived_names)
            self.assertNotIn("assets/label.txt", archived_names)
            self.assertNotIn(".env", archived_names)
            self.assertNotIn(".git/config", archived_names)
            self.assertNotIn(".git-credentials", archived_names)
            self.assertNotIn("__pycache__/nodes.pyc", archived_names)
            self.assertNotIn("config.json", archived_names)
            self.assertNotIn("token.txt", archived_names)
            self.assertNotIn("service-account.json", archived_names)
            self.assertNotIn("weights.bin", archived_names)
            manifest = json.loads(
                uploaded.read("infrax-package.json").decode("utf-8")
            )
        self.assertEqual(manifest["id"], "manual-node")
        self.assertEqual(manifest["source"], "local-custom-node")
        self.assertEqual(manifest["nodeTypes"], ["manual.Node"])

        with mock.patch(
            "studio_bridge.http.client.HTTPSConnection",
            FakeHTTPSConnection,
        ):
            status, _, body = self.request(
                "PUT",
                "/local-api/packages/manual-node/publish",
                payload={
                    "name": "Manual node pack",
                    "version": "2.0.0",
                    "description": "Catalog-confirmed local custom node.",
                    "kind": "node-pack",
                    "nodeTypes": ["unrelated.Node"],
                },
            )
        self.assertEqual(status, 409)
        self.assertEqual(
            body["error"]["code"],
            "publish_node_types_mismatch",
        )
        self.assertEqual(len(FakeHTTPSConnection.requests), 1)
        self.assertEqual(
            list(self.root.glob(".manual-node.local-source-*.zip")),
            [],
        )

    def test_package_list_alias_returns_only_installed_packages(self):
        archive = self.package_zip([("weights.bin", b"\x01\x02\x03\x04")])
        metadata = self.package_metadata(
            "detector-model",
            archive,
            kind="model-pack",
            nodeTypes=[],
        )
        status, _, installed_body = self.install_package(
            "detector-model",
            archive,
            metadata,
            path_prefix="",
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            installed_body["catalog"]["models"],
            [
                {
                    "id": "detector-model:weights.bin",
                    "name": "weights.bin",
                    "relative_path": "detector-model/weights.bin",
                    "path": "models/detector-model/weights.bin",
                    "size": 4,
                    "package_ref": {
                        "package_id": "detector-model",
                        "version": "1.0.0",
                        "digest": metadata["sha256"],
                    },
                }
            ],
        )
        status, _, body = self.request("GET", "/packages")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["packages"]), 1)
        self.assertEqual(body["packages"][0]["id"], "detector-model")
        self.assertEqual(
            body["packages"][0]["installPath"],
            "models/detector-model",
        )

    def test_package_digest_mismatch_is_rejected_without_installing(self):
        archive = self.package_zip([("nodes.py", "value = 1\n")])
        metadata = self.package_metadata(
            "wrong-digest",
            archive,
            sha256="0" * 64,
        )
        status, _, body = self.install_package(
            "wrong-digest",
            archive,
            metadata,
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "package_digest_mismatch")
        self.assertFalse((self.root / "custom_nodes" / "wrong-digest").exists())
        self.assertFalse((self.root / "package-registry.json").exists())

    def test_package_zip_traversal_is_rejected_without_writing_outside_target(self):
        archive = self.package_zip([("../escaped.py", "value = 1\n")])
        status, _, body = self.install_package("unsafe-path", archive)
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "package_zip_unsafe_path")
        self.assertFalse((self.root / "custom_nodes" / "escaped.py").exists())
        self.assertFalse((self.root / "escaped.py").exists())

    def test_package_zip_symlink_is_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive_file:
            link = zipfile.ZipInfo("link.py")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive_file.writestr(link, "target.py")
        archive = output.getvalue()
        status, _, body = self.install_package("link-package", archive)
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "package_zip_link_not_allowed")
        self.assertFalse((self.root / "custom_nodes" / "link-package").exists())

    def test_package_zip_encryption_size_entry_and_ratio_limits_are_enforced(self):
        encrypted = zipfile.ZipInfo("encrypted.py")
        encrypted.flag_bits |= 0x1
        with self.assertRaises(BridgeError) as raised:
            self.server.state._validate_zip_entry(encrypted)
        self.assertEqual(raised.exception.code, "package_zip_encrypted")

        small_archive = self.package_zip([("nodes.py", "value = 1\n")])
        self.server.state.package_archive_limit = len(small_archive) - 1
        status, _, body = self.install_package("too-large", small_archive)
        self.assertEqual(status, 413)
        self.assertEqual(body["error"]["code"], "package_archive_too_large")
        self.server.state.package_archive_limit = 1024 * 1024

        two_entry_archive = self.package_zip(
            [("one.py", "one = 1\n"), ("two.py", "two = 2\n")]
        )
        with mock.patch("studio_bridge.MAX_PACKAGE_ENTRIES", 1):
            status, _, body = self.install_package(
                "too-many-entries",
                two_entry_archive,
            )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "package_zip_invalid")

        ratio_archive = self.package_zip([("nodes.py", "A" * (1024 * 1024))])
        status, _, body = self.install_package(
            "compression-bomb",
            ratio_archive,
        )
        self.assertEqual(status, 422)
        self.assertEqual(
            body["error"]["code"],
            "package_compression_ratio_too_high",
        )
        self.assertEqual(
            list(self.root.glob(".infrax-package-upload-*.zip")),
            [],
        )

    def test_package_install_rolls_back_files_registry_and_catalog_on_refresh_failure(self):
        first_archive = self.package_zip([("nodes.py", "VERSION = 1\n")])
        first_metadata = self.package_metadata("rollback-node", first_archive)
        status, _, _ = self.install_package(
            "rollback-node",
            first_archive,
            first_metadata,
        )
        self.assertEqual(status, 200)
        catalog_before = self.server.state.catalog_path.read_bytes()
        registry_before = self.server.state.package_registry_path.read_bytes()

        (self.root / "catalog.py").write_text(
            "raise SystemExit(9)\n",
            encoding="utf-8",
        )
        second_archive = self.package_zip([("nodes.py", "VERSION = 2\n")])
        second_metadata = self.package_metadata(
            "rollback-node",
            second_archive,
            version="2.0.0",
        )
        status, _, body = self.install_package(
            "rollback-node",
            second_archive,
            second_metadata,
        )
        self.assertEqual(status, 500)
        self.assertEqual(body["error"]["code"], "catalog_refresh_failed")
        self.assertEqual(
            (self.root / "custom_nodes" / "rollback-node" / "nodes.py").read_text(
                encoding="utf-8"
            ),
            "VERSION = 1\n",
        )
        self.assertEqual(self.server.state.catalog_path.read_bytes(), catalog_before)
        self.assertEqual(
            self.server.state.package_registry_path.read_bytes(),
            registry_before,
        )
        self.assertEqual(
            list((self.root / "custom_nodes").glob(".rollback-node.*")),
            [],
        )

    def test_tool_context_selects_an_isolated_validated_root(self):
        status, _, default_context = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": None},
        )
        self.assertEqual(status, 201)
        self.assertEqual(Path(default_context["toolRoot"]), self.root.resolve())
        self.assertIs(
            self.server.state_for_context(default_context["contextId"]),
            self.server.state,
        )

        alternate_root = self.root / "alternate-tool"
        alternate_root.mkdir()
        (alternate_root / "workflow").mkdir()
        (alternate_root / "workflow" / "__init__.py").write_text("", encoding="utf-8")
        for filename in ("catalog.py", "main.py"):
            (alternate_root / filename).write_text(
                (self.root / filename).read_text(encoding="utf-8"),
                encoding="utf-8",
            )

        status, _, body = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": str(alternate_root)},
            authorize=False,
        )
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "pairing_required")

        status, _, body = self.request("POST", "/tool-contexts", payload={})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_tool_root")

        status, _, body = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": "relative/tool"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_tool_root")

        if os.name == "nt":
            status, _, body = self.request(
                "POST",
                "/tool-contexts",
                payload={"path": r"\\server\share\InfraX-Pipeline-Tool"},
            )
            self.assertEqual(status, 400)
            self.assertEqual(body["error"]["code"], "invalid_tool_root")

        missing_root = self.root / "missing-tool"
        status, _, body = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": str(missing_root)},
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "tool_root_not_found")

        incomplete_root = self.root / "incomplete-tool"
        incomplete_root.mkdir()
        status, _, body = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": str(incomplete_root)},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "tool_root_missing_files")
        self.assertFalse((incomplete_root / "workflows").exists())

        status, _, body = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": str(alternate_root)},
        )
        self.assertEqual(status, 201)
        self.assertEqual(Path(body["toolRoot"]), alternate_root.resolve())
        self.assertTrue((alternate_root / "workflows").is_dir())
        context_id = body["contextId"]

        status, _, second_context = self.request(
            "POST",
            "/tool-contexts",
            payload={"path": str(alternate_root)},
        )
        self.assertEqual(status, 201)
        self.assertIs(
            self.server.state_for_context(context_id),
            self.server.state_for_context(second_context["contextId"]),
        )

        status, _, body = self.request(
            "PUT",
            "/workflows/alternate.json",
            payload={"nodes": [], "links": []},
            tool_context=context_id,
        )
        self.assertEqual(status, 200)
        self.assertTrue((alternate_root / "workflows" / "alternate.json").is_file())
        self.assertFalse((self.root / "workflows" / "alternate.json").exists())

        status, _, body = self.request(
            "POST",
            "/catalog/refresh",
            payload={},
            tool_context=context_id,
        )
        self.assertEqual(status, 200)
        self.assertTrue((alternate_root / "catalog.json").is_file())
        self.assertFalse((self.root / "catalog.json").exists())

        status, _, body = self.request(
            "GET",
            "/workflows",
            tool_context="unknown-context",
        )
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "tool_context_not_found")

    def test_workflow_save_list_read_and_run(self):
        workflow = {
            "schema": "workflow.graph.v1",
            "name": "테스트 워크플로우",
            "nodes": [{"id": 1, "type": "basic.NumberInput"}],
            "links": [],
        }
        filename = "나의 워크플로우.json"
        encoded_name = urllib.parse.quote(filename)

        status, _, body = self.request(
            "PUT",
            f"/workflows/{encoded_name}",
            payload=workflow,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["fileName"], filename)
        self.assertTrue((self.root / "workflows" / filename).is_file())
        self.assertEqual(list((self.root / "workflows").glob("*.tmp")), [])

        status, _, body = self.request(
            "PUT",
            f"/workflows/{encoded_name}",
            payload={"nodes": [], "links": []},
            extra_headers={"If-None-Match": "*"},
        )
        self.assertEqual(status, 409)
        self.assertEqual(body["error"]["code"], "workflow_exists")

        status, _, body = self.request("GET", "/workflows")
        self.assertEqual(status, 200)
        self.assertEqual(body["workflows"][0]["fileName"], filename)
        self.assertEqual(body["workflows"][0]["name"], "테스트 워크플로우")

        status, _, body = self.request("GET", f"/workflows/{encoded_name}")
        self.assertEqual(status, 200)
        self.assertEqual(body["workflow"], workflow)

        status, _, body = self.request(
            "POST",
            f"/workflows/{encoded_name}/run",
            payload={},
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["returnCode"], 0)
        self.assertIn("nodes=1", body["stdout"])

    def test_run_returns_process_failure_without_hiding_output(self):
        workflow = {"nodes": [], "links": [], "fail": True}
        self.request("PUT", "/workflows/failure.json", payload=workflow)
        status, _, body = self.request(
            "POST",
            "/workflows/failure.json/run",
            payload={},
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["ok"])
        self.assertEqual(body["returnCode"], 7)
        self.assertIn("workflow=workflows/failure.json", body["stdout"])

    def test_run_timeout_stops_long_running_process(self):
        self.server.state.run_timeout = 0.05
        self.request(
            "PUT",
            "/workflows/slow.json",
            payload={"nodes": [], "links": [], "sleep": True},
        )
        status, _, body = self.request(
            "POST",
            "/workflows/slow.json/run",
            payload={},
        )
        self.assertEqual(status, 504)
        self.assertEqual(body["error"]["code"], "process_timeout")

    def test_filename_validation_blocks_traversal_and_non_json_files(self):
        for path in (
            "/workflows/%2e%2e%2Fevil.json",
            "/workflows/%5C%5Cserver%5Cshare.json",
            "/workflows/not-json.txt",
        ):
            status, _, body = self.request("PUT", path, payload={"nodes": [], "links": []})
            self.assertEqual(status, 400)
            self.assertEqual(body["error"]["code"], "invalid_filename")

        for name in ("CON.json", "NUL.txt.json", "..", "folder/file.json"):
            with self.subTest(name=name):
                with self.assertRaises(BridgeError):
                    _safe_workflow_filename(name)

    def test_request_body_limit_is_enforced_before_reading(self):
        self.server.state.body_limit = 64
        status, _, body = self.request(
            "PUT",
            "/workflows/large.json",
            payload={"nodes": [], "links": [], "padding": "x" * 100},
        )
        self.assertEqual(status, 413)
        self.assertEqual(body["error"]["code"], "body_too_large")
        self.assertFalse((self.root / "workflows" / "large.json").exists())

    def test_invalid_workflow_shape_is_rejected_but_unknown_nodes_are_allowed(self):
        status, _, body = self.request(
            "PUT",
            "/workflows/bad.json",
            payload={"nodes": []},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "workflow_invalid")

        status, _, body = self.request(
            "PUT",
            "/workflows/unknown-node.json",
            payload={
                "nodes": [{"id": 1, "type": "marketplace.NotInstalled"}],
                "links": [],
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])


if __name__ == "__main__":
    unittest.main()
