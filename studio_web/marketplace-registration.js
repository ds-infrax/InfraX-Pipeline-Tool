function renderMarketplaceNodeSelection() {
  const container = document.getElementById("marketplaceNodeSelection");
  const root = document.getElementById("marketplaceNodeOptions");
  const nodeTypesInput = document.getElementById("marketplacePackageNodeTypes");
  if (!container || !root || !nodeTypesInput) return;
  const packageKind = document.getElementById("marketplacePackageKind")?.value;
  const shouldHide = !LOCAL_STUDIO_MODE || packageKind === "model-pack";
  container.classList.toggle("hidden", shouldHide);
  if (shouldHide) {
    root.innerHTML = "";
    if (packageKind === "model-pack") nodeTypesInput.value = "";
    return;
  }
  const selected = new Set(
    String(nodeTypesInput.value || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
  const focusedPackage = marketplaceFocusPackageId
    ? localPublishablePackages.find(pkg => pkg.id === marketplaceFocusPackageId)
    : null;
  const allowedNodeTypes = focusedPackage
    ? new Set(focusedPackage.nodeTypes || [])
    : null;
  const nodes = [...new Map(
    scriptLibrary
      .filter(script => script?.type && (!allowedNodeTypes || allowedNodeTypes.has(script.type)))
      .map(script => [String(script.type), script])
  ).values()];
  if (!nodes.length) {
    root.innerHTML = `<span class="marketplace-registration-note">탐색된 노드가 없습니다.</span>`;
    return;
  }
  root.innerHTML = nodes.map(script => `
    <label class="marketplace-node-option">
      <input type="checkbox" value="${escapeHtml(script.type)}" ${selected.has(String(script.type)) ? "checked" : ""} />
      <span>${escapeHtml(script.name || script.type)} · ${escapeHtml(script.type)}</span>
    </label>
  `).join("");
  root.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener("change", () => {
      nodeTypesInput.value = [...root.querySelectorAll('input[type="checkbox"]:checked')]
        .map(item => item.value)
        .join(", ");
    });
  });
}

function normalizeLocalPublishablePackage(pkg, source) {
  if (!pkg || typeof pkg !== "object") return null;
  const id = String(pkg.id || "").trim();
  if (
    !id
    || !["node-pack", "model-pack"].includes(pkg.kind)
    || !["custom_nodes", "models"].includes(source)
  ) return null;
  const kind = pkg.kind === "model-pack" ? "model-pack" : "node-pack";
  return {
    id,
    name: String(pkg.name || id).trim() || id,
    version: typeof pkg.version === "string" ? pkg.version.trim() : "",
    description: typeof pkg.description === "string" ? pkg.description.trim() : "",
    author: typeof pkg.author === "string" ? pkg.author.trim() : "",
    kind,
    nodeTypes: [...new Set(
      (Array.isArray(pkg.nodeTypes) ? pkg.nodeTypes : [])
        .filter(value => typeof value === "string" && value.trim())
        .map(value => value.trim())
    )],
    installPath: typeof pkg.installPath === "string" ? pkg.installPath.trim() : "",
    fileCount: Number.isFinite(Number(pkg.fileCount)) ? Number(pkg.fileCount) : 0,
    size: Number.isFinite(Number(pkg.size)) ? Number(pkg.size) : 0,
    git: pkg.git && typeof pkg.git === "object"
      ? {
          enabled: Boolean(pkg.git.enabled),
          remoteUrl: typeof pkg.git.remoteUrl === "string" ? pkg.git.remoteUrl.trim() : "",
          revision: typeof pkg.git.revision === "string" ? pkg.git.revision.trim() : "",
          branch: typeof pkg.git.branch === "string" ? pkg.git.branch.trim() : "",
          dirty: Boolean(pkg.git.dirty),
        }
      : { enabled: false },
    source,
  };
}

function renderLocalPublishablePackages() {
  const select = document.getElementById("marketplaceLocalPackageSelect");
  if (!select) return;
  const previous = select.value;
  const expectedKind = marketplacePackageKindForTab(marketplaceTab);
  const packages = localPublishablePackages.filter(pkg => pkg.kind === expectedKind);
  if (localPublishablePackageStatus === "loading") {
    select.innerHTML = `<option value="">로컬 패키지 목록을 불러오는 중...</option>`;
    select.disabled = true;
    return;
  }
  if (!packages.length) {
    select.innerHTML = `<option value="">게시 가능한 로컬 패키지가 없습니다.</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = [
    `<option value="">catalog 확인 노드 패키지를 선택하세요</option>`,
    ...packages.map(pkg => {
      const kindLabel = pkg.kind === "model-pack" ? "모델" : "노드";
      return `<option value="${escapeHtml(pkg.id)}">${escapeHtml(pkg.name)} · ${kindLabel} · ${escapeHtml(pkg.installPath || "custom_nodes")}</option>`;
    }),
  ].join("");
  if (packages.some(pkg => pkg.id === previous)) {
    select.value = previous;
  }
}

async function syncLocalPublishablePackages(options = {}) {
  if (!LOCAL_STUDIO_MODE) return [];
  localPublishablePackageStatus = "loading";
  renderLocalPublishablePackages();
  try {
    const response = await localToolFetch("custom-node-packages");
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.packages)) {
      throw new Error(result.error?.message || result.error || `HTTP ${response.status}`);
    }
    const byId = new Map();
    result.packages.forEach(pkg => {
      const normalized = normalizeLocalPublishablePackage(pkg, pkg?.source || "custom_nodes");
      if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
    });
    localPublishablePackages = [...byId.values()].sort((left, right) => (
      left.name.localeCompare(right.name, "ko")
    ));
    localPublishablePackageStatus = "ready";
    renderLocalPublishablePackages();
    return localPublishablePackages;
  } catch (error) {
    localPublishablePackages = [];
    localPublishablePackageStatus = "error";
    renderLocalPublishablePackages();
    if (options.notify) {
      showToast(`이 PC 노드 패키지 조회 실패: ${error.message || "조회 오류"}`);
    }
    return [];
  }
}

function applyLocalPublishablePackageSelection() {
  const form = document.getElementById("marketplaceRegisterForm");
  const packageId = String(form?.elements.localPackageId?.value || "");
  const pkg = localPublishablePackages.find(item => item.id === packageId);
  if (!form || !pkg) return;
  marketplaceFocusPackageId = pkg.id;
  form.elements.name.value = pkg.name;
  if (pkg.version && isSemanticVersion(pkg.version)) {
    form.elements.version.value = pkg.version;
  }
  if (pkg.description) form.elements.description.value = pkg.description;
  form.elements.kind.value = pkg.kind;
  form.elements.nodeTypes.value = pkg.nodeTypes.join(", ");
  if (pkg.author && !authState.user) form.elements.author.value = pkg.author;
  const gitSource = form.querySelector('input[name="sourceType"][value="git"]');
  const localSource = form.querySelector('input[name="sourceType"][value="local-package"]');
  if (pkg.git?.enabled && pkg.git.remoteUrl && gitSource) {
    gitSource.checked = true;
    if (form.elements.gitSourcePath) form.elements.gitSourcePath.value = pkg.git.remoteUrl;
  } else if (localSource) {
    localSource.checked = true;
  }
  renderMarketplaceNodeSelection();
}

async function prepareDefaultLocalPackageRegistration() {
  if (!LOCAL_STUDIO_MODE || !["module", "model"].includes(marketplaceTab)) return false;
  const packages = await syncLocalPublishablePackages({ notify: false });
  const form = document.getElementById("marketplaceRegisterForm");
  if (!form || !packages.length) return false;
  const expectedKind = marketplacePackageKindForTab(marketplaceTab);
  const eligiblePackages = packages.filter(pkg => pkg.kind === expectedKind);
  if (!eligiblePackages.length) return false;
  const select = form.elements.localPackageId;
  if (select && !select.value) {
    select.value = marketplaceFocusPackageId && eligiblePackages.some(pkg => pkg.id === marketplaceFocusPackageId)
      ? marketplaceFocusPackageId
      : eligiblePackages[0].id;
  }
  applyLocalPublishablePackageSelection();
  syncMarketplaceSourceFields();
  return true;
}

function resetMarketplaceRegisterForm() {
  editingModulePackageId = null;
  marketplaceFocusPackageId = null;
  const form = document.getElementById("marketplaceRegisterForm");
  form?.reset();
  if (form?.elements.version) form.elements.version.value = "1.0.0";
  if (form?.elements.author) {
    form.elements.author.value = authState.user?.displayName || localAuthorProfile || "";
  }
  const title = document.getElementById("marketplaceRegisterTitle");
  const submitLabel = document.getElementById("marketplaceRegisterSubmitLabel");
  const error = document.getElementById("marketplaceRegisterError");
  if (form?.elements.kind) form.elements.kind.value = marketplacePackageKindForTab(marketplaceTab) === "model-pack" ? "model-pack" : "node-pack";
  if (title) title.textContent = `${marketplaceTargetLabel(marketplaceTab)} 등록`;
  if (submitLabel) submitLabel.textContent = "Marketplace 서버에 등록";
  if (error) error.textContent = "";
  syncMarketplaceSourceFields();
}

function toggleModuleRegisterPanel() {
  const willOpen = !moduleRegisterOpen;
  moduleRegisterOpen = willOpen;
  if (willOpen) {
    resetMarketplaceRegisterForm();
  } else {
    editingModulePackageId = null;
  }
  const authorInput = document.getElementById("marketplacePackageAuthor");
  if (authorInput && !authorInput.value) {
    authorInput.value = authState.user?.displayName || localAuthorProfile;
  }
  syncMarketplaceSourceFields();
  renderMarketplace();
  if (moduleRegisterOpen) {
    requestAnimationFrame(() => document.getElementById("marketplacePackageName")?.focus());
  }
}

function initMarketplaceRegistration() {
  document.getElementById("openModuleRegisterBtn")?.addEventListener("click", async () => {
    toggleModuleRegisterPanel();
    if (moduleRegisterOpen) {
      const prepared = await prepareDefaultLocalPackageRegistration();
      if (prepared) renderMarketplace();
    }
  });

  document.getElementById("marketplaceRegisterForm")?.addEventListener("submit", registerMarketplacePackage);
  document.getElementById("resetMarketplaceRegisterBtn")?.addEventListener("click", resetMarketplaceRegisterForm);

  document.querySelectorAll('input[name="sourceType"]').forEach(input => {
    input.addEventListener("change", syncMarketplaceSourceFields);
  });

  document.getElementById("marketplacePackageKind")?.addEventListener("change", () => {
    renderLocalPublishablePackages();
    renderMarketplaceNodeSelection();
  });

  document.getElementById("marketplaceLocalPackageSelect")?.addEventListener(
    "change",
    applyLocalPublishablePackageSelection
  );

  syncMarketplaceSourceFields();
}

document.addEventListener("DOMContentLoaded", initMarketplaceRegistration);
