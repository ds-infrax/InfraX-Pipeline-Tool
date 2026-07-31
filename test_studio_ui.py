import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_SOURCE = (ROOT / "studio_web" / "app.js").read_text(encoding="utf-8")
STYLE_SOURCE = (ROOT / "studio_web" / "styles.css").read_text(encoding="utf-8")
HTML_SOURCE = (ROOT / "studio_web" / "index.html").read_text(encoding="utf-8")
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


class StudioPanelCollapseTest(unittest.TestCase):
    def test_panel_toggles_are_accessible_and_keep_the_rail_separate(self):
        self.assertIn('id="toggleSidebarBtn"', HTML_SOURCE)
        self.assertIn('aria-controls="workflowSidebar"', HTML_SOURCE)
        self.assertIn('id="toggleInspectorBtn"', HTML_SOURCE)
        self.assertIn('aria-controls="workflowInspector"', HTML_SOURCE)
        self.assertEqual(HTML_SOURCE.count('aria-expanded="true"'), 2)
        self.assertRegex(
            STYLE_SOURCE,
            r"\.studio-layout\.sidebar-collapsed\s*\{[^}]*"
            r"grid-template-columns:\s*var\(--rail-width\)\s+0",
        )

    def test_panel_state_is_persisted_with_safe_storage_access(self):
        self.assertIn('PANEL_STATE_STORAGE_KEY = "infrax.studio.panel-state.v1"', APP_SOURCE)
        read_state = APP_SOURCE[
            APP_SOURCE.index("function readPanelState()"):
            APP_SOURCE.index("function writePanelState(state)")
        ]
        write_state = APP_SOURCE[
            APP_SOURCE.index("function writePanelState(state)"):
            APP_SOURCE.index("function updatePanelToggle")
        ]
        self.assertIn("try {", read_state)
        self.assertIn("catch {", read_state)
        self.assertIn("try {", write_state)
        self.assertIn("catch {}", write_state)

    def test_edge_controls_remain_in_the_canvas_when_panels_are_collapsed(self):
        canvas_start = HTML_SOURCE.index('<main class="canvas-shell"')
        canvas_end = HTML_SOURCE.index("</main>", canvas_start)
        canvas_markup = HTML_SOURCE[canvas_start:canvas_end]
        self.assertIn('class="panel-edge-toggle panel-edge-toggle-left"', canvas_markup)
        self.assertIn('class="panel-edge-toggle panel-edge-toggle-right"', canvas_markup)
        self.assertRegex(
            STYLE_SOURCE,
            r"\.panel-edge-toggle\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*58;",
        )


class StudioSidebarNavigationTest(unittest.TestCase):
    def test_workflow_save_steps_are_removed(self):
        self.assertNotIn("persistence-guide", HTML_SOURCE)
        self.assertNotIn("브라우저 자동", HTML_SOURCE)
        self.assertNotIn("폴더 저장", HTML_SOURCE)
        self.assertNotIn("마켓 공유", HTML_SOURCE)

    def test_local_workflow_files_have_a_separate_sidebar_tab(self):
        self.assertIn('data-target="localFilesSection"', HTML_SOURCE)
        self.assertIn('id="localFilesSection"', HTML_SOURCE)
        self.assertIn('title="로컬 워크플로우 파일"', HTML_SOURCE)

        workflow_start = HTML_SOURCE.index('id="workflowSection"')
        workflow_end = HTML_SOURCE.index('id="localFilesSection"')
        workflow_markup = HTML_SOURCE[workflow_start:workflow_end]
        self.assertNotIn('id="serverWorkflowList"', workflow_markup)

        local_files_start = workflow_end
        local_files_end = HTML_SOURCE.index('id="paletteSection"')
        local_files_markup = HTML_SOURCE[local_files_start:local_files_end]
        self.assertIn('id="refreshServerWorkflowsBtn"', local_files_markup)
        self.assertIn('id="serverWorkflowList"', local_files_markup)

    def test_marketplace_entry_is_preserved(self):
        self.assertIn('id="marketplaceBtn"', HTML_SOURCE)
        self.assertIn('title="운영 Marketplace 열기"', HTML_SOURCE)
        self.assertIn("return new URL(MARKETPLACE_SITE_URL);", APP_SOURCE)
        self.assertIn(
            'document.getElementById("marketplaceBtn").addEventListener("click", openHostedMarketplace);',
            APP_SOURCE,
        )
        self.assertIn('window.open(siteUrl.toString(), "_blank", "noopener,noreferrer")', APP_SOURCE)

    def test_workflow_marketplace_button_connects_before_upload(self):
        self.assertIn('class="button-label">Marketplace 계정 연결</span>', HTML_SOURCE)
        self.assertIn('workflowMarketplaceButton.classList.toggle("is-progress", isCheckingAccount)', APP_SOURCE)
        self.assertIn('"Marketplace 계정 확인 중"', APP_SOURCE)
        self.assertIn('"Marketplace 업로드"', APP_SOURCE)
        self.assertIn('"Marketplace 계정 연결"', APP_SOURCE)
        self.assertIn("if (serverWritesEnabled())", APP_SOURCE)
        self.assertIn("void openPlatformAccountConnect();", APP_SOURCE)
        self.assertIn(
            'const MARKETPLACE_SITE_URL = "https://106.254.226.206/pipeline/";',
            APP_SOURCE,
        )
        self.assertIn("if (result.user) rememberAuthenticatedIdentity(result.user);", APP_SOURCE)
        self.assertIn("globalThis.location.reload();", APP_SOURCE)

    def test_disabled_buttons_only_show_wait_cursor_during_progress(self):
        disabled_style = re.search(r"\.btn:disabled\s*\{(?P<body>.*?)\}", STYLE_SOURCE, re.DOTALL)
        progress_style = re.search(
            r"\.btn\.is-progress:disabled\s*\{(?P<body>.*?)\}",
            STYLE_SOURCE,
            re.DOTALL,
        )
        self.assertIsNotNone(disabled_style)
        self.assertIsNotNone(progress_style)
        self.assertIn("cursor: not-allowed", disabled_style.group("body"))
        self.assertIn("cursor: wait", progress_style.group("body"))

    def test_canvas_object_list_has_search_and_sort_controls(self):
        self.assertIn('id="objectSearchInput"', HTML_SOURCE)
        self.assertIn('id="objectSortSelect"', HTML_SOURCE)
        self.assertIn('id="objectSortDirectionBtn"', HTML_SOURCE)
        self.assertIn('aria-label="캔버스 객체 검색 및 정렬"', HTML_SOURCE)
        self.assertIn('value="name"', HTML_SOURCE)
        self.assertIn('value="type"', HTML_SOURCE)
        self.assertIn('value="kind"', HTML_SOURCE)
        self.assertIn('value="id"', HTML_SOURCE)

    def test_canvas_object_search_and_sort_apply_to_nodes_and_links(self):
        self.assertIn("const objectListViewState =", APP_SOURCE)
        self.assertIn('document.getElementById("objectSearchInput")?.addEventListener("input"', APP_SOURCE)
        self.assertIn('document.getElementById("objectSortSelect")?.addEventListener("change"', APP_SOURCE)
        self.assertIn('document.getElementById("objectSortDirectionBtn")?.addEventListener("click"', APP_SOURCE)
        self.assertIn("...currentWorkflow.nodes.map", APP_SOURCE)
        self.assertIn("...currentWorkflow.links.map", APP_SOURCE)
        self.assertIn("검색 조건에 맞는 객체가 없습니다.", APP_SOURCE)

    def test_canvas_object_controls_stay_on_one_row(self):
        self.assertRegex(
            STYLE_SOURCE,
            r"\.object-list-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(104px,\s*0\.82fr\)",
        )


if __name__ == "__main__":
    unittest.main()
