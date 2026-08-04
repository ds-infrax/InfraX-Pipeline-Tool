function isPackageMarketplaceTab(tab) {
  return tab === "module" || tab === "model";
}

function marketplaceTargetLabel(tab) {
  if (tab === "workspace") return "워크플로우";
  if (tab === "model") return "모델";
  return "노드";
}

function marketplacePackageKindForTab(tab) {
  if (tab === "model") return "model-pack";
  if (tab === "module") return "node-pack";
  return "workflow-bundle";
}

function renderMarketplace() {
  const root = document.getElementById("marketplaceList");
  if (!root) return;
  const summary = document.getElementById("marketplaceSummary");
  const tabButtons = document.querySelectorAll("[data-marketplace-tab]");
  tabButtons.forEach(button => {
    const active = button.dataset.marketplaceTab === marketplaceTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const registerPanel = document.getElementById("marketplaceRegisterPanel");
  registerPanel?.classList.toggle("hidden", !isPackageMarketplaceTab(marketplaceTab) || !moduleRegisterOpen);
  if (registerPanel) registerPanel.open = isPackageMarketplaceTab(marketplaceTab) && moduleRegisterOpen;
  renderMarketplaceNodeSelection();
  const moduleRegisterButton = document.getElementById("openModuleRegisterBtn");
  moduleRegisterButton?.classList.toggle(
    "hidden",
    !isPackageMarketplaceTab(marketplaceTab) || !serverWritesEnabled()
  );
  if (moduleRegisterButton) {
    moduleRegisterButton.innerHTML = `<span class="material-symbols-outlined">add</span>${escapeHtml(marketplaceTargetLabel(marketplaceTab))} 등록`;
  }
  const sectionTitle = document.getElementById("marketplaceSectionTitle");
  if (sectionTitle) sectionTitle.textContent = marketplaceTab === "workspace" ? "등록된 워크플로우" : marketplaceTargetLabel(marketplaceTab);
  const visiblePackages = marketplaceVisiblePackagesForTab();
  if (summary) {
    summary.textContent = marketplaceTab === "workspace"
      ? "별도 실행기에서 테스트 완료한 JSON 스냅샷을 공유 Marketplace 서버에서 관리합니다."
      : marketplaceTab === "model"
        ? "PC에 다운로드한 모델 파일과 가중치를 워크플로우 실행에 사용할 수 있습니다."
        : "PC에 다운로드한 뒤 자동 탐색기가 발견해야 Editor의 내 PC 라이브러리에 표시됩니다.";
  }
  if (!visiblePackages.length) {
    root.innerHTML = `<div class="marketplace-empty">등록된 ${marketplaceTargetLabel(marketplaceTab)}이 없습니다.</div>`;
    return;
  }
  root.innerHTML = visiblePackages.map(pkg => {
    const recommendedForNode = Boolean(
      marketplaceFocusNodeType
      && marketplaceNodeTypes(pkg).includes(marketplaceFocusNodeType)
    );
    if (pkg.registrationOnly) {
      const isWorkflowPackage = pkg.kind === "workflow-bundle" || Boolean(pkg.workflow);
      const mayManage = serverWritesEnabled() && Boolean(pkg.canManage);
      const mayDelete = mayManage && !LOCAL_STUDIO_MODE;
      const packageInstalled = !isWorkflowPackage && isMarketplacePackageInstalled(pkg);
      const sourceLabel = isWorkflowPackage
        ? `${pkg.workflow?.data?.nodes?.length || 0} nodes · ${pkg.workflow?.data?.links?.length || 0} links`
        : (pkg.source?.type === "git"
          ? `Git · ${pkg.source.url || pkg.source.path || "경로 정보 없음"}`
          : `ZIP · ${pkg.source?.fileName || "파일 정보 없음"} · ${formatFileSize(pkg.source?.fileSize || 0)}`);
      return `
        <article class="marketplace-card registered-package ${packageInstalled ? "installed" : ""} ${recommendedForNode ? "recommended-for-node" : ""}">
          <div>
            <b>${escapeHtml(pkg.name)}</b>
            <span>${escapeHtml(pkg.author || "작성자 미설정")} · ${pkg.kind === "model-pack" ? "모델" : isWorkflowPackage ? "워크플로우" : "노드"} · v${escapeHtml(pkg.version || "1.0.0")} · ${escapeHtml(sourceLabel)}</span>
          </div>
          <small>${escapeHtml(pkg.description)}</small>
          ${recommendedForNode ? `<div class="marketplace-match-note">${escapeHtml(marketplaceFocusNodeType)} 노드를 제공하는 항목입니다.</div>` : ""}
          <div class="marketplace-registration-note">${
            isWorkflowPackage
              ? (pkg.authMode === "verified-account"
                  ? "Marketplace 서버 업로드 · 로그인 계정 소유권 확인"
                  : "기존 미인증 항목 · 읽기 전용")
              : `${pkg.source?.type === "zip" ? "Marketplace 서버에 ZIP 본문 저장" : "Marketplace 서버에 Git 주소 저장"}${packageInstalled ? " · 이 PC에 설치됨" : ""}`
          }</div>
          <div class="mini-actions">
            ${isWorkflowPackage
              ? `<button class="btn light" type="button" onclick="addRegisteredWorkflowToEditor(${inlineJson(pkg.id)})">편집기에 사본 추가</button>
                  <button class="btn light" type="button" onclick="downloadRegisteredWorkflow(${inlineJson(pkg.id)})">JSON 받기</button>
                  ${mayManage ? `<button class="btn light" type="button" onclick="editRegisteredWorkflow(${inlineJson(pkg.id)})">수정</button>` : ""}`
              : `<button class="btn light" type="button" onclick="downloadMarketplacePackage(${inlineJson(pkg.id)})">${pkg.source?.type === "git" ? "Git 열기" : LOCAL_STUDIO_MODE ? (packageInstalled ? "다시 설치" : "이 PC에 설치") : "ZIP 다운로드"}</button>
                 ${mayManage ? `<button class="btn light" type="button" onclick="editRegisteredPackage(${inlineJson(pkg.id)})">수정</button>` : ""}`}
            ${mayDelete
              ? `<button class="btn light" type="button" onclick="${isWorkflowPackage ? "deleteRegisteredWorkflow" : "deleteRegisteredPackage"}(${inlineJson(pkg.id)})">삭제</button>`
              : `<span class="marketplace-registration-note">${mayManage && LOCAL_STUDIO_MODE ? "삭제는 웹사이트에서 관리" : "읽기 전용"}</span>`}
          </div>
        </article>
      `;
    }
    const packagePresent = isMarketplacePackageInstalled(pkg);
    const downloadRequested = isPackageMarketplaceTab(marketplaceTab) && packagePresent;
    const installed = marketplaceTab === "workspace" && packagePresent;
    const scriptCount = pkg.scripts?.length || 0;
    const workflowLabel = pkg.workflow ? "workspace bundle" : "module package";
    const primaryLabel = isPackageMarketplaceTab(marketplaceTab)
      ? (LOCAL_STUDIO_MODE
          ? (downloadRequested ? "이 PC에 다시 설치" : "이 PC에 설치")
          : "ZIP 다운로드")
      : (installed ? "편집기에서 보기" : "편집기에 사본 추가");
    const openLabel = marketplaceTab === "workspace" ? "추가 후 열기" : "";
    return `
      <div class="marketplace-card ${installed ? "installed" : ""} ${downloadRequested ? "download-requested" : ""} ${recommendedForNode ? "recommended-for-node" : ""}">
        <div>
          <b>${escapeHtml(pkg.name)} · ${escapeHtml(pkg.version)}</b>
          <span>${escapeHtml(pkg.author)} / ${escapeHtml(pkg.kind)} / ${scriptCount} nodes / ${workflowLabel}</span>
        </div>
        <small>${escapeHtml(pkg.description)}</small>
        ${recommendedForNode ? `<div class="marketplace-match-note">${escapeHtml(marketplaceFocusNodeType)} 노드를 제공하는 항목입니다.</div>` : ""}
        ${isPackageMarketplaceTab(marketplaceTab) ? `<div class="marketplace-registration-note">${downloadRequested ? `이 PC에 설치됨 · ${marketplaceTargetLabel(marketplaceTab)} 목록에 자동 반영` : LOCAL_STUDIO_MODE ? "설치 후 catalog를 자동 갱신합니다." : "다운로드 후 로컬 Pipeline Tool에서 설치할 수 있습니다."}</div>` : ""}
        <div class="mini-actions">
          <button class="btn light" type="button" onclick="${isPackageMarketplaceTab(marketplaceTab) ? "downloadMarketplacePackage" : "installMarketplacePackage"}(${inlineJson(pkg.id)}${marketplaceTab === "workspace" && installed ? ", true" : ""})">${primaryLabel}</button>
          ${pkg.workflow && !installed ? `<button class="btn light" type="button" onclick="installMarketplacePackage(${inlineJson(pkg.id)}, true)">${openLabel}</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}
