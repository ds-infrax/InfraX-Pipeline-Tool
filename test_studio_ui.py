import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_SOURCE = (ROOT / "studio_web" / "app.js").read_text(encoding="utf-8")
STYLE_SOURCE = (ROOT / "studio_web" / "styles.css").read_text(encoding="utf-8")


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


if __name__ == "__main__":
    unittest.main()
