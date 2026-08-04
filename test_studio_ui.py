import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_SOURCE = (ROOT / "studio_web" / "app.js").read_text(encoding="utf-8")
MARKETPLACE_NAVIGATION_SOURCE = (ROOT / "studio_web" / "marketplace-navigation.js").read_text(encoding="utf-8")
STYLE_SOURCE = (ROOT / "studio_web" / "styles.css").read_text(encoding="utf-8")
HTML_SOURCE = (ROOT / "studio_web" / "index.html").read_text(encoding="utf-8")
ORCHID_ASSET = ROOT / "studio_web" / "assets" / "ink-orchid-watermark.jpg"
INFRAX_LOGO_ASSET = ROOT / "studio_web" / "assets" / "infrax-logo-white.png"


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

    def test_topbar_workflow_actions_match_local_tool_flow(self):
        topbar_start = HTML_SOURCE.index('<div class="topbar-actions">')
        topbar_end = HTML_SOURCE.index("</div>", topbar_start)
        topbar_markup = HTML_SOURCE[topbar_start:topbar_end]
        self.assertIn('id="resetWorkflowBtn"', HTML_SOURCE)
        self.assertNotIn('id="cloneWorkflowBtn"', topbar_markup)
        self.assertNotIn('id="resetWorkflowBtn"', topbar_markup)
        self.assertIn('id="saveWorkflowBtn"', HTML_SOURCE)
        self.assertIn('id="exportWorkspaceBtn"', topbar_markup)
        self.assertIn('id="importWorkspaceBtn"', topbar_markup)
        self.assertIn('id="runWorkflowBtn"', HTML_SOURCE)
        self.assertNotIn('id="downloadBtn"', HTML_SOURCE)
        self.assertNotIn("JSON 내보내기", HTML_SOURCE)
        self.assertNotIn("파일 저장", HTML_SOURCE)
        self.assertIn(">저장", HTML_SOURCE)
        self.assertIn("function resetCurrentWorkflow()", APP_SOURCE)
        self.assertIn('document.getElementById("resetWorkflowBtn")?.addEventListener("click", resetCurrentWorkflow)', APP_SOURCE)
        self.assertIn('document.getElementById("cloneWorkflowBtn").addEventListener("click", cloneWorkflow)', APP_SOURCE)
        self.assertIn("workflows/${savedWorkflowDisplayName(currentWorkflowFileName)} 저장 완료", APP_SOURCE)

        workflow_start = HTML_SOURCE.index('id="workflowSection"')
        workflow_end = HTML_SOURCE.index('id="tempWorkflowPanel"', workflow_start)
        workflow_markup = HTML_SOURCE[workflow_start:workflow_end]
        self.assertIn('id="cloneWorkflowBtn"', workflow_markup)
        self.assertIn('id="resetWorkflowBtn"', workflow_markup)
        self.assertNotIn('id="exportWorkspaceBtn"', workflow_markup)
        self.assertNotIn('id="importWorkspaceBtn"', workflow_markup)

    def test_cloned_workflow_is_created_as_current_draft_file(self):
        self.assertIn("function cloneWorkflow()", APP_SOURCE)
        self.assertIn("async function submitCloneWorkflow(event)", APP_SOURCE)
        self.assertIn("const fileName = currentWorkflowFileNameForName(name);", APP_SOURCE)
        clone_start = APP_SOURCE.index("function cloneWorkflow()")
        clone_end = APP_SOURCE.index("async function submitCloneWorkflow", clone_start)
        self.assertNotIn("prompt(", APP_SOURCE[clone_start:clone_end])
        self.assertIn("await saveCurrentWorkflowAsFile(fileName, data, { resetWorkflow });", APP_SOURCE)
        self.assertIn("const resetWorkflow = currentWorkflowSourceFileName ? `list/${currentWorkflowSourceFileName}` : null;", APP_SOURCE)
        self.assertIn('localToolFetch("workflows/current/save-as"', APP_SOURCE)
        self.assertIn('\"X-InfraX-Current-Only\": \"true\"', APP_SOURCE)
        self.assertIn("currentWorkflowFileName = fileName;", APP_SOURCE)
        self.assertIn("저장을 누르면 workflows/list에 확정됩니다.", APP_SOURCE)
        self.assertIn('id="cloneWorkflowModal"', HTML_SOURCE)
        self.assertIn('id="cloneWorkflowName"', HTML_SOURCE)
        self.assertIn("if (cloneWorkflowSubmitting) return;", APP_SOURCE)
        self.assertIn('event.key === "Escape"', APP_SOURCE)
        self.assertIn("let currentWorkflowSourceFileName = null;", APP_SOURCE)
        self.assertIn("let currentWorkflowResetFileName = null;", APP_SOURCE)
        self.assertIn('localToolFetch("workflows/current/reset"', APP_SOURCE)
        self.assertIn("result.currentWorkflow?.workflow", APP_SOURCE)
        self.assertIn("result.sourceWorkflow?.replace", APP_SOURCE)
        new_start = APP_SOURCE.index("async function newWorkflow()")
        new_end = APP_SOURCE.index("async function resetCurrentWorkflow()", new_start)
        self.assertIn("await saveCurrentWorkflowAsFile(fileName, data);", APP_SOURCE[new_start:new_end])
        self.assertNotIn("clearCurrentWorkflowFolder", APP_SOURCE[new_start:new_end])

    def test_temp_workflow_archive_is_visible_and_actionable(self):
        self.assertIn('id="tempWorkflowPanel"', HTML_SOURCE)
        self.assertIn('id="tempWorkflowToggleBtn"', HTML_SOURCE)
        self.assertIn('id="tempWorkflowList"', HTML_SOURCE)
        self.assertIn("let tempWorkflowItems = []", APP_SOURCE)
        self.assertIn("function renderTempWorkflowList()", APP_SOURCE)
        self.assertIn("result.tempWorkflows", APP_SOURCE)
        self.assertIn("async function restoreTempWorkflow(fileName)", APP_SOURCE)
        self.assertIn("async function deleteTempWorkflow(fileName)", APP_SOURCE)
        self.assertIn("X-InfraX-Archive-Current", APP_SOURCE)
        self.assertIn("저장 안 된 작업본", APP_SOURCE)
        self.assertIn(".temp-workflow-panel", STYLE_SOURCE)

    def test_temp_archive_only_keeps_changed_non_empty_workflows(self):
        self.assertIn("function workflowShouldArchiveToTemp()", APP_SOURCE)
        self.assertIn("if (!workflowShouldArchiveToTemp()) {", APP_SOURCE)
        self.assertIn("await clearCurrentWorkflowFolder({ archive: false });", APP_SOURCE)
        self.assertIn("const hasGraphContent = Boolean(snapshot.nodes?.length || snapshot.links?.length);", APP_SOURCE)
        self.assertIn("if (!hasGraphContent) return false;", APP_SOURCE)
        self.assertIn("const savedHash = meta.lastFolderSavedHash || lastFolderSavedHash;", APP_SOURCE)
        self.assertIn("return !savedHash || currentHash !== savedHash;", APP_SOURCE)

    def test_real_run_stream_updates_canvas_node_status(self):
        self.assertIn("function applyWorkflowRunEvent(event)", APP_SOURCE)
        self.assertIn("async function readRunEventStream(response, onEvent)", APP_SOURCE)
        self.assertIn("markWorkflowRunQueued();", APP_SOURCE)
        self.assertIn('`workflows/${encodeURIComponent(requestFileName)}/run-stream`', APP_SOURCE)
        self.assertIn('node.run_status = status;', APP_SOURCE)
        self.assertIn(".node.error", STYLE_SOURCE)

    def test_external_clean_draft_update_does_not_force_reload_loop(self):
        clean_update_start = APP_SOURCE.index("if (!hasAnyDirtyWorkflow() && !hasUnsavedFormInput())")
        clean_update_end = APP_SOURCE.index("externalDraftConflict = true", clean_update_start)
        clean_update_block = APP_SOURCE[clean_update_start:clean_update_end]
        self.assertIn("const restored = restoreState();", clean_update_block)
        self.assertIn("renderAll();", clean_update_block)
        self.assertNotIn("window.location.reload()", clean_update_block)

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
        self.assertIn('title="등록된 Marketplace 목록 보기"', HTML_SOURCE)
        self.assertTrue(INFRAX_LOGO_ASSET.is_file())
        marketplace_header_start = HTML_SOURCE.index('<header class="marketplace-view-head">')
        marketplace_header_end = HTML_SOURCE.index('</header>', marketplace_header_start)
        marketplace_header = HTML_SOURCE[marketplace_header_start:marketplace_header_end]
        self.assertIn('src="./assets/infrax-logo-white.png"', marketplace_header)
        self.assertNotIn(">iX<", marketplace_header)
        self.assertIn('id="openMarketplaceShortcutBtn"', HTML_SOURCE)
        self.assertIn('title="Marketplace 바로가기"', HTML_SOURCE)
        self.assertIn('<script src="./marketplace-navigation.js"></script>', HTML_SOURCE)
        self.assertIn("return new URL(MARKETPLACE_SITE_URL);", APP_SOURCE)
        self.assertIn(
            'marketplaceMenuButton?.addEventListener("click", () => {\n'
            '    openSidebarSection("marketplaceSection");\n'
            '  });',
            MARKETPLACE_NAVIGATION_SOURCE,
        )
        self.assertIn(
            'hostedMarketplaceShortcut?.addEventListener("click", () => {\n'
            '    openMarketplaceSite();\n'
            '  });',
            MARKETPLACE_NAVIGATION_SOURCE,
        )
        self.assertIn('window.open(siteUrl.toString(), "_blank", "noopener,noreferrer")', APP_SOURCE)
    def test_workflow_marketplace_button_shows_account_status(self):
        self.assertIn('class="button-label">Marketplace 연결 정보</span>', HTML_SOURCE)
        self.assertIn('workflowMarketplaceButton.classList.toggle("is-progress", isCheckingAccount)', APP_SOURCE)
        self.assertIn('"Marketplace 계정 확인 중"', APP_SOURCE)
        self.assertIn('"verified_user"', APP_SOURCE)
        self.assertIn('"Marketplace 계정 연결"', APP_SOURCE)
        self.assertIn("Marketplace 연결됨:", APP_SOURCE)
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

    def test_canvas_object_list_marks_nodes_missing_from_local_catalog(self):
        self.assertIn("isNodeMissingFromCatalog(node)", APP_SOURCE)
        self.assertIn("현재 PC의 catalog.json에서 확인되지 않은 노드입니다.", APP_SOURCE)
        self.assertIn("로컬 없음", APP_SOURCE)
        self.assertIn("현재 PC에 설치된 노드 목록에 없음", APP_SOURCE)
        self.assertIn("object-missing-note", APP_SOURCE)
        self.assertRegex(
            STYLE_SOURCE,
            r"\.object-item\.missing-node\s*\{[^}]*border-color:[^}]*#e87325",
        )
        self.assertIn(".object-missing-note", STYLE_SOURCE)

    def test_canvas_object_controls_stay_on_one_row(self):
        self.assertRegex(
            STYLE_SOURCE,
            r"\.object-list-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(104px,\s*0\.82fr\)",
        )


if __name__ == "__main__":
    unittest.main()

