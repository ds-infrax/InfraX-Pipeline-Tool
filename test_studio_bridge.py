import argparse
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from studio_bridge import (
    DEFAULT_ALLOWED_ORIGINS,
    BridgeError,
    _safe_workflow_filename,
    _validate_origin,
    create_server,
)

_DEFAULT_TOOL_CONTEXT = object()


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
        self.server = create_server(
            root=self.root,
            port=0,
            allowed_origins=DEFAULT_ALLOWED_ORIGINS | {self.origin},
            auth_token=self.token,
            catalog_timeout=5,
            run_timeout=5,
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
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
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
        body = response.read()
        decoded = json.loads(body.decode("utf-8")) if body else None
        return response.status, response.headers, decoded

    def test_health_is_minimal_and_other_routes_require_pairing(self):
        status, headers, body = self.request("GET", "/health", authorize=False)
        self.assertEqual(status, 200)
        self.assertEqual(body["service"], "infrax-pipeline-tool")
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

    def test_default_studio_origin_is_allowed(self):
        public_ip_origin = "https://106.254.226.206"
        self.assertIn(public_ip_origin, DEFAULT_ALLOWED_ORIGINS)
        self.assertIn("https://infrax.iptime.org", DEFAULT_ALLOWED_ORIGINS)
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
