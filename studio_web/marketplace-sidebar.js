function isNodePackageInCustomNodes(pkg) {
  if (!pkg || pkg.kind === "workflow-bundle" || pkg.workflow) return false;
  if (pkg.kind === "model-pack") return isMarketplacePackageInstalled(pkg);
  const id = String(pkg.id || "").trim();
  const nodeTypes = new Set(marketplaceNodeTypes(pkg));
  if (localPublishablePackages.some(item => (
    item.id === id
    || item.installPath === `custom_nodes/${id}`
    || item.installPath === `custom_nodes/market/${id}`
    || item.nodeTypes?.some(type => nodeTypes.has(type))
  ))) return true;
  return installedLocalPackages.some(item => (
    item?.id === id
    || item?.installPath === `custom_nodes/${id}`
    || item?.installPath === `custom_nodes/market/${id}`
    || item?.source === "custom_nodes"
    || item?.nodeTypes?.some(type => nodeTypes.has(type))
  ));
}

function marketplaceWorkflowPackages() {
  return [...registeredMarketplacePackages, ...marketplacePackages]
    .filter(pkg => pkg.workflow || pkg.kind === "workflow-bundle");
}

function normalizeComparableName(value) {
  return safeId(String(value || "").replace(/\.json$/i, "")).toLowerCase();
}

function marketplacePackageForWorkflowFile(fileName) {
  const workflowName = String(fileName || "").replace(/\.json$/i, "");
  const candidates = new Set([
    normalizeComparableName(workflowName),
    normalizeComparableName(`${workflowName}_current`),
    normalizeComparableName(fileName),
  ].filter(Boolean));
  return marketplaceWorkflowPackages().find(pkg => {
    const pkgCandidates = [
      pkg.id,
      pkg.name,
      pkg.workflow?.name,
      pkg.sourceWorkflowId,
    ].map(normalizeComparableName).filter(Boolean);
    return pkgCandidates.some(value => candidates.has(value));
  }) || null;
}

function isMarketplaceWorkflowInList(pkg) {
  if (!pkg) return false;
  return serverWorkflowItems.some(item => marketplacePackageForWorkflowFile(item.fileName)?.id === pkg.id);
}

function marketplaceVisiblePackagesForTab(tab = marketplaceTab) {
  const allMarketplacePackages = [...registeredMarketplacePackages, ...marketplacePackages];
  return allMarketplacePackages.filter(pkg => {
    const isWorkspace = pkg.kind === "workflow-bundle" || Boolean(pkg.workflow);
    if (tab === "workspace") return isWorkspace;
    return !isWorkspace && pkg.kind === marketplacePackageKindForTab(tab);
  });
}

function renderSidebarMarketplace() {
  const root = document.getElementById("sidebarMarketplaceList");
  if (!root) return;
  document.querySelectorAll("[data-marketplace-side-tab]").forEach(button => {
    const active = button.dataset.marketplaceSideTab === marketplaceTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const visiblePackages = marketplaceVisiblePackagesForTab();
  if (!visiblePackages.length) {
    root.innerHTML = `<div class="kv"><span>등록된 ${escapeHtml(marketplaceTargetLabel(marketplaceTab))} 항목이 없습니다.</span></div>`;
    return;
  }
  const renderPackageCard = pkg => {
    const isWorkspace = pkg.kind === "workflow-bundle" || Boolean(pkg.workflow);
    const isNodePack = pkg.kind === "node-pack" && !isWorkspace;
    const alreadyPresent = isWorkspace
      ? isMarketplaceWorkflowInList(pkg)
      : isNodePack
        ? isNodePackageInCustomNodes(pkg)
        : isMarketplacePackageInstalled(pkg);
    const kindLabel = pkg.kind === "model-pack" ? "모델" : isWorkspace ? "워크플로우" : "노드";
    const sourceLabel = isWorkspace
      ? `${pkg.workflow?.data?.nodes?.length || 0} nodes`
      : isNodePack
        ? `${pkg.id || "package"}`
        : pkg.source?.type === "git"
          ? "Git"
          : pkg.source?.type === "zip"
            ? "ZIP"
            : "등록";
    const action = isWorkspace
      ? `downloadRegisteredWorkflow(${inlineJson(pkg.id)})`
      : `downloadMarketplacePackage(${inlineJson(pkg.id)})`;
    const actionLabel = alreadyPresent ? "있음" : isWorkspace ? "목록에 추가" : "가져오기";
    const disabledAttr = alreadyPresent ? ' disabled aria-disabled="true"' : "";
    return `
      <button class="sidebar-market-card ${alreadyPresent ? "already-added" : ""}" type="button" title="${escapeHtml(isNodePack ? `custom_nodes/${pkg.id || "package"}` : sourceLabel)}" onclick="${action}"${disabledAttr}>
        <span>
          <b>${escapeHtml(pkg.name || "Untitled")}</b>
          <small>${escapeHtml(kindLabel)} · v${escapeHtml(pkg.version || "1.0.0")} · ${sourceLabel}</small>
        </span>
        <em>${escapeHtml(actionLabel)}</em>
      </button>
    `;
  };
  if (marketplaceTab !== "module") {
    root.innerHTML = visiblePackages.map(renderPackageCard).join("");
    return;
  }
  const groups = new Map();
  visiblePackages.forEach(pkg => {
    const key = `${pkg.id || "package"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pkg);
  });
  root.innerHTML = [...groups.entries()].map(([folder, packages]) => `
    <details class="node-tree-group sidebar-market-tree" open>
      <summary title="${escapeHtml(`custom_nodes/${folder}`)}">
        <span class="material-symbols-outlined" aria-hidden="true">folder</span>
        <b>${escapeHtml(folder)}</b>
        <small>${packages.length} items</small>
      </summary>
      <div class="node-tree-list">
        ${packages.map(renderPackageCard).join("")}
      </div>
    </details>
  `).join("");
}

function initMarketplaceSidebar() {
  document.querySelectorAll("[data-marketplace-side-tab]").forEach(button => {
    button.addEventListener("click", () => setMarketplaceTab(button.dataset.marketplaceSideTab));
  });
  document.getElementById("refreshSidebarMarketplaceBtn")?.addEventListener("click", async () => {
    await syncMarketplaceFromServer({ notify: true });
    if (LOCAL_STUDIO_MODE) {
      await Promise.allSettled([
        syncInstalledLocalPackages(),
        syncLocalPublishablePackages(),
      ]);
    }
    renderSidebarMarketplace();
  });
}

document.addEventListener("DOMContentLoaded", initMarketplaceSidebar);
