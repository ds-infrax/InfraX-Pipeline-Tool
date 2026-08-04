async function downloadMarketplacePackage(packageId) {
  const pkg = [...registeredMarketplacePackages, ...marketplacePackages].find(item => item.id === packageId);
  if (!pkg || pkg.workflow) return;
  if (pkg.registrationOnly) {
    try {
      if (LOCAL_STUDIO_MODE) {
        const metadata = {
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          kind: pkg.kind === "model-pack" ? "model-pack" : "node-pack",
          sha256: pkg.source?.sha256 || "0".repeat(64),
          nodeTypes: marketplaceNodeTypes(pkg),
          sourceType: pkg.source?.type || "zip",
          sourcePath: pkg.source?.url || pkg.source?.path || "",
          installName: marketplaceInstallName(pkg),
        };
        const installResponse = await localToolFetch(
          `packages/${encodeURIComponent(pkg.id)}/install-from-marketplace`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metadata),
          }
        );
        const installResult = await installResponse.json().catch(() => ({}));
        if (!installResponse.ok || !installResult.package) {
          throw new Error(
            installResult.error?.message
            || installResult.error
            || `HTTP ${installResponse.status}`
          );
        }
        if (installResult.catalog) {
          registerCatalog(installResult.catalog, "catalog.json", { silent: true });
          catalogReady = true;
          explorerState.connected = true;
          explorerState.statusMessage = null;
        } else {
          await refreshLocalExplorer({ silent: true });
        }
        await syncInstalledLocalPackages();
        await syncLocalPublishablePackages();
        renderAll();
        renderSidebarMarketplace();
        showToast(`${pkg.name} 설치와 노드 목록 갱신을 완료했습니다.`);
      } else if (pkg.source?.type === "git") {
        const anchor = document.createElement("a");
        anchor.href = apiUrl(`/marketplace/modules/${encodeURIComponent(pkg.id)}/download`);
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
        showToast(`${pkg.name} Git 저장소를 엽니다.`);
      } else {
        const response = await apiFetch(`/marketplace/modules/${encodeURIComponent(pkg.id)}/download`);
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(responseErrorMessage(response, result));
        }
        const blob = await response.blob();
        const anchor = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        anchor.href = objectUrl;
        anchor.download = pkg.source?.fileName || `${safeId(pkg.name)}.zip`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        showToast(`${pkg.name} ZIP 다운로드를 시작했습니다.`);
      }
    } catch (error) {
      showToast(`${pkg.name} ${LOCAL_STUDIO_MODE ? "설치" : "ZIP 다운로드"} 실패: ${error.message || "서버 연결 오류"}`);
    }
    return;
  }
  const catalogBridge = {
    schema: CATALOG_SCHEMA,
    package: {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      author: pkg.author,
      description: pkg.description
    },
    nodes: (pkg.scripts || []).map(script => ({
      key: script.type,
      display_name: script.name,
      module: script.command || script.path || "",
      io: {
        inputs: structuredClone(script.inputs || []),
        outputs: structuredClone(script.outputs || [])
      },
      init: { inputs: structuredClone(script.initInputs || []) },
      implementation_ref: script.id
    })),
    note: "자동 탐색기 API가 연결되기 전의 다운로드용 catalog 브리지입니다."
  };
  downloadBlob(`${safeId(pkg.name)}-${pkg.version}.catalog.json`, JSON.stringify(catalogBridge, null, 2));
  if (!downloadedMarketplacePackageIds.includes(pkg.id)) downloadedMarketplacePackageIds.push(pkg.id);
  persistAuxiliaryState();
  renderMarketplace();
  showToast(`${pkg.name} catalog 다운로드를 시작했습니다. PC 자동 탐색기가 연결되면 다시 조회해 주세요.`);
}

function addRegisteredWorkflowToEditor(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId && item.workflow);
  if (!pkg) return;
  if (!confirmUnsavedBeforeSwitch()) return;
  const name = `${pkg.workflow.name || safeId(pkg.name)}_copy`;
  const id = `${safeId(name)}_${Date.now()}`;
  const data = structuredClone(pkg.workflow.data);
  normalizeWorkflowShape(data);
  rebuildImportedLinkRefs(data);
  workflowStore.push({
    id,
    name,
    projectId: currentProjectId,
    marketplacePackageId: pkg.id,
    data
  });
  switchWorkflow(id, { skipGuard: true, preserveDirty: true });
  closeMarketplaceView();
  showToast(`${pkg.name} 스냅샷을 편집 가능한 사본으로 추가했습니다.`);
}

async function downloadRegisteredWorkflow(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId && item.workflow);
  if (!pkg) return;
  if (LOCAL_STUDIO_MODE) {
    try {
      const filename = workflowGitFileNameForPackage(pkg);
      const response = await localToolFetch("workflow-assets/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: filename,
          workflow: pkg.workflow.data,
          marketplaceId: pkg.id,
          marketplaceRevision: pkg.revision || "",
          overwrite: false,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error?.message || result.error || `HTTP ${response.status}`);
      }
      await syncServerWorkflows({ notify: false });
      renderSidebarMarketplace();
      showToast(`${pkg.name} 기준으로 Git pull을 완료하고 workflows/list를 새로고침했습니다.`);
      return;
    } catch (error) {
      showToast(`${pkg.name} Git 가져오기 실패: ${error.message || "git pull 오류"}`);
      return;
    }
  }
  downloadBlob(`${safeId(pkg.name)}-${safeId(pkg.version || "1.0.0")}.workflow.json`, JSON.stringify(pkg.workflow.data, null, 2));
  showToast(`${pkg.name} JSON 다운로드를 시작했습니다.`);
}

function workflowGitFileNameForPackage(pkg) {
  const base = safeId(pkg?.workflow?.name || pkg?.name || pkg?.id || "workflow");
  return `${base || "workflow"}.json`;
}

async function saveWorkflowPackageToGit(payload, { existing = null } = {}) {
  if (!LOCAL_STUDIO_MODE) return null;
  const filename = workflowGitFileNameForPackage(payload);
  const saveResponse = await localToolFetch(
    `workflows/${encodeURIComponent(filename)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.workflow.data),
    }
  );
  const saveResult = await saveResponse.json().catch(() => ({}));
  if (!saveResponse.ok) {
    throw new Error(saveResult.error?.message || saveResult.error || `HTTP ${saveResponse.status}`);
  }
  const commitResponse = await localToolFetch("workflow-git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: filename,
      message: `${existing ? "Update" : "Add"} workflow ${payload.name}`,
      push: true,
      marketplaceId: payload.id,
      expectedMarketplaceRevision: existing?.revision || "",
    }),
  });
  const commitResult = await commitResponse.json().catch(() => ({}));
  if (!commitResponse.ok || !commitResult.ok) {
    throw new Error(commitResult.error?.message || commitResult.error || `HTTP ${commitResponse.status}`);
  }
  await syncServerWorkflows({ notify: false });
  return {
    fileName: filename,
    path: `workflows/list/${filename}`,
    git: commitResult,
  };
}

async function deleteRegisteredWorkflow(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId && item.workflow);
  if (!pkg || !pkg.canManage || !requireServerWriteAccess()) return;
  if (!confirm(`"${pkg.name}" Marketplace 워크플로우를 삭제할까요?\n브라우저 초안과 workflows 로컬 파일은 삭제되지 않습니다.`)) return;
  marketplaceWorkflowRequestSequence += 1;
  const requestIdentityEpoch = authIdentityEpoch;
  const requestStorageScope = activeStorageScope;
  try {
    const headers = {};
    if (pkg.revision) headers["If-Match"] = pkg.revision;
    const response = await apiFetch(`/marketplace/workflows/${encodeURIComponent(pkg.id)}`, {
      method: "DELETE",
      headers,
    });
    const result = await response.json().catch(() => ({}));
    if (!requestContextIsCurrent(requestIdentityEpoch, requestStorageScope)) return;
    if (!response.ok) {
      const detail = result.currentRevision
        ? `${result.error || "revision conflict"} (${result.currentRevision})`
        : result.error?.message || responseErrorMessage(response, result);
      throw new Error(detail);
    }
    registeredMarketplacePackages = registeredMarketplacePackages.filter(item => item.id !== packageId);
    persistAuxiliaryState();
    renderMarketplace();
    await syncMarketplaceWorkflowsFromServer();
    showToast(`${pkg.name} Marketplace 항목을 삭제했습니다.`);
  } catch (error) {
    showToast(`${pkg.name} 삭제 실패: ${error.message || "서버 연결 오류"}`);
  }
}

async function deleteRegisteredPackage(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId);
  if (!pkg || pkg.workflow || !pkg.canManage || !requireServerWriteAccess()) return;
  if (!confirm(`"${pkg.name}" 등록 정보를 삭제할까요?\n편집 중인 워크플로우와 PC 파일은 삭제되지 않습니다.`)) return;
  marketplaceModuleRequestSequence += 1;
  const requestIdentityEpoch = authIdentityEpoch;
  const requestStorageScope = activeStorageScope;
  try {
    const headers = {};
    if (pkg.revision) headers["If-Match"] = pkg.revision;
    const response = await apiFetch(`/marketplace/modules/${encodeURIComponent(pkg.id)}`, {
      method: "DELETE",
      headers,
    });
    const result = await response.json().catch(() => ({}));
    if (!requestContextIsCurrent(requestIdentityEpoch, requestStorageScope)) return;
    if (!response.ok) {
      const detail = result.currentRevision
        ? `${result.error || "revision conflict"} (${result.currentRevision})`
        : responseErrorMessage(response, result);
      throw new Error(detail);
    }
    registeredMarketplacePackages = registeredMarketplacePackages.filter(item => item.id !== packageId);
    downloadedMarketplacePackageIds = downloadedMarketplacePackageIds.filter(id => id !== packageId);
    persistAuxiliaryState();
    renderMarketplace();
    await syncMarketplaceModulesFromServer();
    showToast(`${pkg.name} 서버 등록과 ZIP 보관본을 삭제했습니다.`);
  } catch (error) {
    showToast(`${pkg.name} 삭제 실패: ${error.message || "서버 연결 오류"}`);
  }
}

function editRegisteredPackage(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId && !item.workflow);
  if (!pkg || !pkg.canManage || !requireServerWriteAccess()) return;
  editingModulePackageId = pkg.id;
  moduleRegisterOpen = true;
  const form = document.getElementById("marketplaceRegisterForm");
  if (!form) return;
  form.reset();
  form.elements.name.value = pkg.name || "";
  form.elements.version.value = pkg.version || "1.0.0";
  form.elements.kind.value = pkg.kind === "model-pack" ? "model-pack" : "node-pack";
  form.elements.description.value = pkg.description || "";
  if (form.elements.nodeTypes) {
    form.elements.nodeTypes.value = marketplaceNodeTypes(pkg).join(", ");
  }
  form.elements.author.value = authState.user?.displayName || pkg.author || localAuthorProfile || "";
  const sourceType = pkg.source?.type === "zip" ? "zip" : "git";
  const sourceRadio = form.querySelector(`input[name="sourceType"][value="${sourceType}"]`);
  if (sourceRadio) sourceRadio.checked = true;
  form.elements.gitSourcePath.value = pkg.source?.url || pkg.source?.path || "";
  const error = document.getElementById("marketplaceRegisterError");
  if (error) error.textContent = "";
  syncMarketplaceSourceFields();
  renderMarketplace();
  const title = document.getElementById("marketplaceRegisterTitle");
  const submitLabel = document.getElementById("marketplaceRegisterSubmitLabel");
  if (title) title.textContent = `${pkg.kind === "model-pack" ? "모델" : "노드"} 수정`;
  if (submitLabel) submitLabel.textContent = "서버 등록 수정";
  requestAnimationFrame(() => form.elements.name.focus());
}

async function editRegisteredWorkflow(packageId) {
  const pkg = registeredMarketplacePackages.find(item => item.id === packageId && item.workflow);
  if (!pkg || !pkg.canManage || !requireServerWriteAccess()) return;
  if (LOCAL_STUDIO_MODE) {
    const filename = workflowGitFileNameForPackage(pkg);
    try {
      const response = await localToolFetch("workflow-assets/check-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: filename }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok && result.hasRemoteUpdate) {
        const useLatest = confirm(`${pkg.name} 워크플로우의 Git 최신본이 있습니다.\n\n확인: 최신본을 받은 뒤 수정\n취소: 현재 로컬 파일 기준으로 수정`);
        if (useLatest) {
          const installResponse = await localToolFetch("workflow-assets/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: filename,
              workflow: pkg.workflow.data,
              marketplaceId: pkg.id,
              marketplaceRevision: pkg.revision || "",
              overwrite: true,
            }),
          });
          const installResult = await installResponse.json().catch(() => ({}));
          if (!installResponse.ok || !installResult.ok) {
            throw new Error(installResult.error?.message || installResult.error || `HTTP ${installResponse.status}`);
          }
          await syncServerWorkflows({ notify: false });
        }
      }
    } catch (error) {
      const continueEdit = confirm(`${pkg.name} 최신본 확인에 실패했습니다: ${error.message || "확인 오류"}\n\n그래도 수정하시겠습니까?`);
      if (!continueEdit) return;
    }
  }
  editingWorkflowPackageId = pkg.id;
  openWorkflowRegisterModal(pkg);
}

async function openWorkflowFileMarketplaceAction(fileName) {
  if (!requireServerWriteAccess()) return;
  const pkg = marketplacePackageForWorkflowFile(fileName);
  const activeFileName = currentWorkflowFileName === fileName || currentWorkflowFileName === `current/${fileName}`;
  if (fileName && !activeFileName) {
    const loaded = await loadServerWorkflow(fileName, { activate: true });
    if (!loaded) return;
  }
  if (pkg?.canManage) {
    editRegisteredWorkflow(pkg.id);
    return;
  }
  if (pkg) {
    marketplaceTab = "workspace";
    openMarketplaceView();
    showToast("이미 Marketplace에 등록된 워크플로우입니다. 수정 권한은 작성자 또는 관리자에게만 있습니다.");
    return;
  }
  openWorkflowRegisterModal();
}

function prepareNodeTypeMarketplaceRegistration(nodeType) {
  if (!requireServerWriteAccess()) return;
  const script = scriptLibrary.find(item => item.type === nodeType);
  marketplaceTab = "module";
  marketplaceFocusNodeType = nodeType;
  moduleRegisterOpen = true;
  openMarketplaceView();
  resetMarketplaceRegisterForm();
  const form = document.getElementById("marketplaceRegisterForm");
  if (!form) return;
  form.elements.name.value = script?.name || nodeType;
  form.elements.description.value = script
    ? `${script.name || script.type} 노드를 제공하는 로컬 Pipeline Tool 항목입니다.`
    : `${nodeType} 노드를 제공하는 로컬 Pipeline Tool 항목입니다.`;
  if (form.elements.kind) form.elements.kind.value = "node-pack";
  if (form.elements.nodeTypes) form.elements.nodeTypes.value = nodeType;
  if (form.elements.author) form.elements.author.value = authState.user?.displayName || localAuthorProfile || "";
  syncMarketplaceSourceFields();
  renderMarketplace();
  requestAnimationFrame(() => document.getElementById("marketplacePackageName")?.focus());
}

async function openNodePackageMarketplaceAction(packageId) {
  if (!requireServerWriteAccess()) return;
  marketplaceTab = "module";
  marketplaceFocusPackageId = packageId;
  marketplaceFocusNodeType = null;
  moduleRegisterOpen = true;
  openMarketplaceView();
  const packages = await syncLocalPublishablePackages({ notify: true });
  const localPackage = packages.find(pkg => pkg.id === packageId);
  if (!localPackage) {
    showToast(`${packageId} 로컬 노드 패키지를 찾지 못했습니다. catalog를 다시 조회해 주세요.`);
    return;
  }
  const existing = registeredMarketplacePackages.find(item => (
    !item.workflow
    && item.kind === "node-pack"
    && (item.id === packageId || marketplaceNodeTypes(item).some(type => localPackage.nodeTypes.includes(type)))
  ));
  if (existing?.canManage) {
    const merge = confirm(`${localPackage.name}은 Marketplace에 이미 등록되어 있습니다.\n\n확인: 기존 등록을 수정/업데이트\n취소: 새 등록 폼에서 이름을 바꿔 준비`);
    if (merge) {
      editRegisteredPackage(existing.id);
      return;
    }
  }
  resetMarketplaceRegisterForm();
  const form = document.getElementById("marketplaceRegisterForm");
  if (!form) return;
  const localSource = form.querySelector('input[name="sourceType"][value="local-package"]');
  if (localSource) localSource.checked = true;
  if (form.elements.localPackageId) form.elements.localPackageId.value = localPackage.id;
  form.elements.name.value = existing ? `${localPackage.name}_copy` : localPackage.name;
  form.elements.version.value = localPackage.version && isSemanticVersion(localPackage.version)
    ? localPackage.version
    : "1.0.0";
  form.elements.description.value = localPackage.description || `${localPackage.name} 노드 패키지입니다.`;
  if (form.elements.kind) form.elements.kind.value = "node-pack";
  if (form.elements.nodeTypes) form.elements.nodeTypes.value = localPackage.nodeTypes.join(", ");
  if (form.elements.author) form.elements.author.value = authState.user?.displayName || localAuthorProfile || "";
  syncMarketplaceSourceFields();
  renderMarketplace();
  renderMarketplaceNodeSelection();
  requestAnimationFrame(() => document.getElementById("marketplacePackageName")?.focus());
}

function openNodeTypeMarketplaceAction(nodeType) {
  const pkg = marketplacePackageForNodeType(nodeType);
  if (pkg?.canManage) {
    editRegisteredPackage(pkg.id);
    return;
  }
  if (pkg) {
    marketplaceTab = "module";
    marketplaceFocusNodeType = nodeType;
    openMarketplaceView();
    showToast("이미 Marketplace에 등록된 노드입니다. 수정 권한은 작성자 또는 관리자에게만 있습니다.");
    return;
  }
  prepareNodeTypeMarketplaceRegistration(nodeType);
}

window.downloadMarketplacePackage = downloadMarketplacePackage;
window.addRegisteredWorkflowToEditor = addRegisteredWorkflowToEditor;
window.downloadRegisteredWorkflow = downloadRegisteredWorkflow;
window.deleteRegisteredWorkflow = deleteRegisteredWorkflow;
window.deleteRegisteredPackage = deleteRegisteredPackage;
window.editRegisteredPackage = editRegisteredPackage;
window.editRegisteredWorkflow = editRegisteredWorkflow;
window.openWorkflowFileMarketplaceAction = openWorkflowFileMarketplaceAction;
window.openNodeTypeMarketplaceAction = openNodeTypeMarketplaceAction;
window.openNodePackageMarketplaceAction = openNodePackageMarketplaceAction;

function installMarketplacePackage(packageId, openWorkflow = false) {
  const pkg = marketplacePackages.find(item => item.id === packageId);
  if (!pkg) return;
  if (!pkg.workflow) {
    downloadMarketplacePackage(packageId);
    return;
  }
  if (!confirmUnsavedBeforeSwitch()) return;
  const missingDependencies = (pkg.scripts || [])
    .filter(script => !scriptLibrary.some(item => item.id === script.id || item.type === script.type))
    .length;

  const name = pkg.workflow.name || safeId(pkg.name);
  const id = `${safeId(name)}_${Date.now()}`;
  const data = structuredClone(pkg.workflow.data);
  normalizeWorkflowShape(data);
  rebuildImportedLinkRefs(data);
  currentProjectId = "local_tool";
  projectStore = [{ id: currentProjectId, name: "Local Tool" }];
  workflowStore = [{
    id,
    name,
    projectId: currentProjectId,
    marketplacePackageId: pkg.id,
    data,
  }];
  currentWorkflowId = id;
  currentWorkflow = data;
  currentWorkflowFileName = null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  workflowSyncState = {};
  historyStack = [];
  redoStack = [];
  selectedNodeId = null;
  selectedLinkId = null;
  renderAll();
  markWorkflowDirty();
  if (openWorkflow) closeMarketplaceView();
  openSidebarSection("workflowSection");
  renderMarketplace();
  showToast(missingDependencies
    ? `${pkg.name} 사본을 추가했습니다. 종속 모델/노드 ${missingDependencies}개는 PC 다운로드 후 탐색기 조회가 필요합니다.`
    : `${pkg.name} 사본을 편집기에 추가했습니다.`);
}

window.installMarketplacePackage = installMarketplacePackage;

