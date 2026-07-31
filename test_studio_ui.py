import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_SOURCE = (ROOT / "studio_web" / "app.js").read_text(encoding="utf-8")
STYLE_SOURCE = (ROOT / "studio_web" / "styles.css").read_text(encoding="utf-8")
ORCHID_ASSET = ROOT / "studio_web" / "assets" / "ink-orchid-watermark.jpg"


class StudioNodeWidgetRenderingTest(unittest.TestCase):
    def test_fallback_widget_names_are_marked_as_synthetic(self):
        fallback = re.search(
            r"widgets_values\.map\(\(value, index\) => \(\{(?P<body>.*?)\}\)\)",
            APP_SOURCE,
            re.DOTALL,
        )
        self.assertIsNotNone(fallback)
        self.assertIn("syntheticLabel: true", fallback.group("body"))

    def test_node_widget_values_do_not_use_bold_markup(self):
        render_widgets = APP_SOURCE[
            APP_SOURCE.index("function renderWidgets(node)"):
            APP_SOURCE.index("function renderWidgetEditors(node)")
        ]
        self.assertNotIn("<strong>", render_widgets)
        self.assertRegex(render_widgets, r"input\.syntheticLabel\s*\?\s*\"\"")
        self.assertIn('class="widget-value"', render_widgets)

    def test_widgets_and_ports_have_separate_layout_containers(self):
        self.assertIn('class="node-widgets"', APP_SOURCE)
        self.assertIn('class="node-inputs"', APP_SOURCE)
        self.assertIn('class="node-outputs"', APP_SOURCE)
        self.assertRegex(
            STYLE_SOURCE,
            r"\.node-widgets\s*\{[^}]*grid-column:\s*1\s*/\s*-1;",
        )
        self.assertRegex(
            STYLE_SOURCE,
            r"\.node-widgets\s*\{[^}]*grid-template-columns:\s*repeat\(2,",
        )

    def test_widget_value_uses_regular_inherited_font(self):
        value_style = re.search(
            r"\.widget-value\s*\{(?P<body>.*?)\}",
            STYLE_SOURCE,
            re.DOTALL,
        )
        self.assertIsNotNone(value_style)
        self.assertIn("font: inherit", value_style.group("body"))
        self.assertIn("font-weight: 400", value_style.group("body"))


class StudioCanvasArtworkTest(unittest.TestCase):
    def test_orchid_watermark_asset_is_packaged(self):
        self.assertTrue(ORCHID_ASSET.is_file())
        self.assertGreater(ORCHID_ASSET.stat().st_size, 10_000)

    def test_orchid_watermark_stays_below_interactive_world(self):
        artwork = re.search(
            r"\.canvas-shell::after\s*\{(?P<body>.*?)\}",
            STYLE_SOURCE,
            re.DOTALL,
        )
        world = re.search(r"\.world\s*\{(?P<body>.*?)\}", STYLE_SOURCE, re.DOTALL)
        self.assertIsNotNone(artwork)
        self.assertIsNotNone(world)
        self.assertIn('url("./assets/ink-orchid-watermark.jpg")', artwork.group("body"))
        self.assertIn("pointer-events: none", artwork.group("body"))
        self.assertIn("z-index: 1", artwork.group("body"))
        self.assertIn("z-index: 2", world.group("body"))

    def test_orchid_watermark_has_responsive_treatment(self):
        responsive = re.search(
            r"@media \(max-width: 1280px\)\s*\{(?P<body>.*?)"
            r"@media \(max-width: 1060px\)",
            STYLE_SOURCE,
            re.DOTALL,
        )
        self.assertIsNotNone(responsive)
        self.assertIn(".canvas-shell::after", responsive.group("body"))


if __name__ == "__main__":
    unittest.main()
