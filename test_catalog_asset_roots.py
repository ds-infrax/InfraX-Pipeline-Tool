import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


class CatalogAssetRootTest(unittest.TestCase):
    def test_catalog_discovers_market_and_develop_custom_nodes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            asset_root = Path(temporary_directory)
            for lane, class_name in (
                ("market", "MarketNode"),
                ("develop", "DevelopNode"),
            ):
                package_root = asset_root / "custom_nodes" / lane / "demo_package"
                package_root.mkdir(parents=True)
                (package_root / "nodes.py").write_text(
                    textwrap.dedent(
                        f"""
                        from app.node import Node

                        class {class_name}(Node):
                            def run(self):
                                return None
                        """
                    ).strip()
                    + "\n",
                    encoding="utf-8",
                )

            environment = os.environ.copy()
            environment["INFRAX_ASSET_ROOT"] = str(asset_root)
            command = [
                sys.executable,
                "-B",
                "-c",
                (
                    "import json;"
                    "from app.runner import build_project_catalog;"
                    "print(json.dumps(build_project_catalog(output_path=None), ensure_ascii=False))"
                ),
            ]
            completed = subprocess.run(
                command,
                cwd=Path(__file__).resolve().parent,
                env=environment,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            catalog = json.loads(completed.stdout)
            keys = {node["key"] for node in catalog["nodes"]}
            self.assertIn("market.demo_package.MarketNode", keys)
            self.assertIn("develop.demo_package.DevelopNode", keys)


if __name__ == "__main__":
    unittest.main()
