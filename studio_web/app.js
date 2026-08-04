const workflow = {
  last_node_id: 6,
  last_link_id: 5,
  nodes: [
    {
      id: 5,
      type: "InputInt",
      pos: [32.46671719021232, 554.3333307902022],
      size: [270, 82],
      inputs: [],
      outputs: [{ name: "INT", type: "INT", links: [4] }],
      widgets_values: [2, "fixed"]
    },
    {
      id: 4,
      type: "InputInt",
      pos: [27.088834974500465, 405.7110638088648],
      size: [270, 82],
      inputs: [],
      outputs: [{ name: "INT", type: "INT", links: [2] }],
      widgets_values: [5, "fixed"]
    },
    {
      id: 1,
      type: "Add",
      pos: [380.5553673638237, 433.08879682752854],
      size: [270, 82],
      inputs: [
        { name: "a", type: "INT", widget: { name: "a" }, link: 2 },
        { name: "b", type: "INT", widget: { name: "b" }, link: 4 }
      ],
      outputs: [{ name: "INT", type: "INT", links: [5] }],
      widgets_values: [1, 1]
    },
    {
      id: 6,
      type: "OutputPrint",
      pos: [710.6276537770128, 436.86393603686713],
      size: [140, 26],
      inputs: [{ name: "source", type: "*", link: 5 }],
      outputs: []
    }
  ],
  links: [
    [2, 4, 0, 1, 0, "INT"],
    [4, 5, 0, 1, 1, "INT"],
    [5, 1, 0, 6, 0, "INT"]
  ],
  extra: {
    ds: { scale: 1.0826609978431456, offset: [428.78698749852975, -177.50295520357693] },
    frontendVersion: "1.45.19"
  },
  version: 0.4
};

const CATALOG_SCHEMA = "workflow.catalog.v1";
const GRAPH_SCHEMA = "workflow.graph.v1";

const scriptLibrary = [
  {
    id: "input_int_default_v1",
    type: "InputInt",
    name: "Input Integer",
    developer: "system",
    version: "1.0",
    status: "stable",
    command: "python-3.10.0-embed-amd64\\python.exe scripts/input/input_int.py",
    path: "scripts/input/input_int.py",
    inputs: [],
    outputs: [{ name: "INT", type: "INT" }]
  },
  {
    id: "add_basic_v1",
    type: "Add",
    name: "Add a+b",
    developer: "kim",
    version: "1.0",
    status: "stable",
    command: "python-3.10.0-embed-amd64\\python.exe scripts/math/add.py",
    path: "scripts/math/add.py",
    inputs: [{ name: "a", type: "INT" }, { name: "b", type: "INT" }],
    outputs: [{ name: "INT", type: "INT" }]
  },
  {
    id: "add_fast_v2",
    type: "Add",
    name: "Add Fast",
    developer: "park",
    version: "2.0",
    status: "experimental",
    command: "python-3.10.0-embed-amd64\\python.exe scripts/math/add_fast.py",
    path: "scripts/math/add_fast.py",
    inputs: [{ name: "a", type: "INT" }, { name: "b", type: "INT" }],
    outputs: [{ name: "INT", type: "INT" }]
  },
  {
    id: "add_three_v1",
    type: "Add",
    name: "Add a+b+c",
    developer: "lee",
    version: "1.0",
    status: "warning",
    command: "python-3.10.0-embed-amd64\\python.exe scripts/math/add_three.py",
    path: "scripts/math/add_three.py",
    inputs: [{ name: "a", type: "INT" }, { name: "b", type: "INT" }, { name: "c", type: "INT" }],
    outputs: [{ name: "INT", type: "INT" }]
  },
  {
    id: "output_print_v1",
    type: "OutputPrint",
    name: "Print Output",
    developer: "system",
    version: "1.0",
    status: "stable",
    command: "python-3.10.0-embed-amd64\\python.exe scripts/output/print.py",
    path: "scripts/output/print.py",
    inputs: [{ name: "source", type: "*" }],
    outputs: []
  }
];

const marketplacePackages = [];
let registeredMarketplacePackages = [];
let downloadedMarketplacePackageIds = [];
let localAuthorProfile = "";
let editingWorkflowPackageId = null;
let editingModulePackageId = null;
let moduleRegisterOpen = false;
const explorerState = {
  connected: false,
  mode: "local-tool",
  lastScannedAt: null,
  statusMessage: null,
};
const WORKFLOW_STORAGE_KEY = "workflow-gui-prototype";
const CURRENT_DRAFT_STORAGE_KEY = `${WORKFLOW_STORAGE_KEY}:current`;
const AUXILIARY_STORAGE_KEY = "workflow-gui-prototype-aux";
const configuredApiBase = document.documentElement.dataset.apiBase?.trim();
const configuredPlatformApiBase = document.documentElement.dataset.platformApiBase?.trim();
const runtimeScriptUrl = document.currentScript?.src || document.baseURI;
const LOCAL_STUDIO_MODE = String(
  document.documentElement.dataset.localStudio || ""
).trim().toLowerCase() === "true";
const API_BASE_URL = LOCAL_STUDIO_MODE
  ? new URL("./api/", runtimeScriptUrl)
  : configuredApiBase
  ? new URL(`${configuredApiBase.replace(/\/+$/, "")}/`, runtimeScriptUrl)
  : new URL("./api/", runtimeScriptUrl);
const PLATFORM_API_BASE_URL = configuredPlatformApiBase
  ? new URL(`${configuredPlatformApiBase.replace(/\/+$/, "")}/`, runtimeScriptUrl)
  : API_BASE_URL;
const MARKETPLACE_SITE_URL = "https://106.254.226.206/pipeline/";
const configuredLocalToolBase = document.documentElement.dataset.localToolBase?.trim();
const LOCAL_TOOL_BASE_URL = new URL(
  configuredLocalToolBase || "http://127.0.0.1:8765/",
  runtimeScriptUrl
);
const LOCAL_TOOL_TOKEN_SESSION_KEY = "infrax-local-tool-token";
const LOCAL_TOOL_ROOT_STORAGE_KEY = "infrax-local-tool-root:v1";
const LOCAL_STUDIO_ROOT_CACHE_KEY = "infrax-local-studio-root-cache:v1";
const PIPELINE_TOOL_VERSION = String(
  document.documentElement.dataset.pipelineToolVersion || ""
).trim();
const PIPELINE_TOOL_GIT_URL = "https://github.com/ds-infrax/InfraX-Pipeline-Tool";
const PIPELINE_TOOL_RELEASES_URL = `${PIPELINE_TOOL_GIT_URL}/releases/latest`;
const INJECTED_LOCAL_TOOL_TOKEN = String(
  document.documentElement.dataset.localToolToken || ""
).trim();
const ACCESS_TOKEN_STORAGE_KEY = "infrax_v2_access";
const AUTH_IDENTITY_CACHE_KEY = "infrax_marketplace_identity:v1";
const LOCAL_CONNECT_HASH_PARAMETER = "infrax_connect_code";
const LOCAL_CONNECT_STATE_PARAMETER = "infrax_connect_state";
const LOCAL_CONNECT_CHALLENGE_PARAMETER = "connectChallenge";
const LOCAL_CONNECT_ATTEMPT_SESSION_KEY = "infrax_local_connect_attempt:v1";
const PLATFORM_REQUEST_TIMEOUT_MS = 4_000;
const authState = {
  status: "loading",
  mode: "required",
  user: null,
};
let activeStorageScope = null;
let appInitialized = false;
let authGeneration = 0;
let authIdentityEpoch = 0;
let serverWorkflowRequestSequence = 0;
let marketplaceWorkflowRequestSequence = 0;
let marketplaceModuleRequestSequence = 0;
let pipelineToolReleaseRequestSequence = 0;
const TAB_INSTANCE_ID = globalThis.crypto?.randomUUID?.()
  || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let localDraftStorageRevision = 0;
let auxiliaryStorageRevision = 0;
let externalDraftConflict = false;
let externalAuxiliaryConflict = false;
let auxiliaryPersistFailed = false;
let localDraftWriteBlockedReason = null;
let storageScopeTransitionPending = false;
let authRevalidationPromise = null;
const MAX_MARKETPLACE_ZIP_BYTES = 100 * 1024 * 1024;
let isWorkflowDirty = false;
let workflowSyncState = {};
let localDraftTimer = null;
const LOCAL_DRAFT_DEBOUNCE_MS = 500;
let serverWorkflowItems = [];
let tempWorkflowItems = [];
let serverWorkflowListStatus = "idle";
let currentWorkflowFileName = null;
let currentWorkflowSourceFileName = null;
let currentWorkflowResetFileName = null;
let lastFolderSavedAt = null;
let lastFolderSavedHash = null;
let catalogReady = false;
let catalogModels = [];
let localToolRunActive = false;
let localToolSavePromise = null;
let localToolContextId = null;
let localToolContextEpoch = 0;
let localToolContextRequestSequence = 0;
let localToolContextRequestCount = 0;
let localToolCatalogRequestSequence = 0;
let localToolWorkflowLoadSequence = 0;
let localToolRootPreference = "";
let activeLocalToolRoot = "";
let installedLocalPackages = [];
let localPublishablePackages = [];
let localPublishablePackageStatus = "idle";
let marketplaceFocusPackageId = null;
let pipelineToolRelease = null;
let pipelineToolReleaseStatus = "loading";
let pipelineToolReleaseError = "";
let hostedLocalConnectRequest = null;

function initializeLocalStudioMode() {
  document.documentElement.classList.toggle("local-studio-mode", LOCAL_STUDIO_MODE);
  document.documentElement.classList.toggle("hosted-platform-mode", !LOCAL_STUDIO_MODE);
  if (LOCAL_STUDIO_MODE) {
    globalThis.name = "infrax_studio";
  }
  document.querySelectorAll("[data-local-studio-only]").forEach(element => {
    element.hidden = !LOCAL_STUDIO_MODE;
  });
  if (!LOCAL_STUDIO_MODE) return;
  if (INJECTED_LOCAL_TOOL_TOKEN) {
    sessionStorage.setItem(LOCAL_TOOL_TOKEN_SESSION_KEY, INJECTED_LOCAL_TOOL_TOKEN);
  } else {
    sessionStorage.removeItem(LOCAL_TOOL_TOKEN_SESSION_KEY);
  }
  document.documentElement.dataset.localToolToken = "";
  document.querySelectorAll("[data-local-studio-setup]").forEach(element => {
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
  });
  const tokenInput = document.getElementById("localToolTokenInput");
  if (tokenInput) tokenInput.value = "";
}

initializeLocalStudioMode();

function apiUrl(pathname = "") {
  return new URL(String(pathname).replace(/^\/+/, ""), API_BASE_URL).toString();
}

function localToolUrl(pathname = "") {
  return new URL(String(pathname).replace(/^\/+/, ""), LOCAL_TOOL_BASE_URL).toString();
}

async function localToolFetch(pathname, options = {}) {
  const {
    includeToolContext = true,
    ...fetchOptions
  } = options;
  if (includeToolContext && localToolContextRequestCount > 0) {
    throw new Error("실행 도구 경로를 전환하는 중입니다. 잠시 후 다시 시도해 주세요.");
  }
  if (includeToolContext && !localToolContextId) {
    const error = new Error("실행 도구 경로 연결이 필요합니다.");
    error.code = "tool_context_required";
    throw error;
  }
  const headers = new Headers(fetchOptions.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const token = sessionStorage.getItem(LOCAL_TOOL_TOKEN_SESSION_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (includeToolContext) {
    headers.set("X-InfraX-Tool-Context", localToolContextId);
  }
  return fetch(localToolUrl(pathname), {
    ...fetchOptions,
    headers,
    cache: "no-store",
  });
}

function localToolRootStorageKey() {
  return scopedStorageKey(
    LOCAL_STUDIO_MODE ? LOCAL_STUDIO_ROOT_CACHE_KEY : LOCAL_TOOL_ROOT_STORAGE_KEY
  );
}

function normalizeToolRootForComparison(value) {
  const normalized = String(value || "").trim().replace(/[\\/]+$/, "");
  return /^[a-z]:[\\/]/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function sameToolRoot(left, right) {
  return normalizeToolRootForComparison(left) === normalizeToolRootForComparison(right);
}

function captureLocalToolContext() {
  return {
    contextId: localToolContextId,
    epoch: localToolContextEpoch,
    toolRoot: activeLocalToolRoot,
  };
}

function isCurrentLocalToolContext(snapshot) {
  return Boolean(
    snapshot
    && snapshot.contextId === localToolContextId
    && snapshot.epoch === localToolContextEpoch
    && sameToolRoot(snapshot.toolRoot, activeLocalToolRoot)
  );
}

function renderLocalToolRootStatus(message = "") {
  const status = document.getElementById("localToolRootStatus");
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  status.textContent = activeLocalToolRoot
    ? `사용 중 · ${activeLocalToolRoot}`
    : localToolRootPreference
      ? `저장됨 · ${localToolRootPreference}`
      : "비워 두면 studio_bridge.py가 있는 폴더를 사용합니다.";
}

function restoreLocalToolRootPreference() {
  const input = document.getElementById("localToolRootInput");
  try {
    localToolRootPreference = localStorage.getItem(localToolRootStorageKey()) || "";
    if (LOCAL_STUDIO_MODE && !localToolRootPreference) {
      // Preserve an existing workflow-file link during the one-time
      // transition from the former user-selected root key. The local Studio
      // still sends `path: null`, so this value is comparison-only.
      localToolRootPreference = localStorage.getItem(
        scopedStorageKey(LOCAL_TOOL_ROOT_STORAGE_KEY)
      ) || "";
    }
  } catch {
    localToolRootPreference = "";
  }
  if (input) input.value = LOCAL_STUDIO_MODE ? "" : localToolRootPreference;
  renderLocalToolRootStatus();
  return localToolRootPreference;
}

function detachWorkflowFileAssociationForToolRootChange() {
  if (!currentWorkflowFileName && !lastFolderSavedAt && !lastFolderSavedHash) return;
  currentWorkflowFileName = null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  isWorkflowDirty = true;
  const syncMeta = currentWorkflowSyncMeta();
  syncMeta.dirty = true;
  syncMeta.fileName = null;
  syncMeta.lastFolderSavedAt = null;
  syncMeta.lastFolderSavedHash = null;
  persistLocalDraft({ immediate: true, silent: true });
  renderWorkflowList();
  applyCurrentWorkflowSaveState();
}

async function configureLocalToolContext(options = {}) {
  const requestId = ++localToolContextRequestSequence;
  localToolContextRequestCount += 1;
  const input = document.getElementById("localToolRootInput");
  const requestedPath = LOCAL_STUDIO_MODE
    ? ""
    : String(options.path ?? input?.value ?? localToolRootPreference ?? "").trim();
  const button = document.getElementById("saveLocalToolRootBtn");
  if (button) button.disabled = true;
  try {
    const response = await localToolFetch("tool-contexts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: requestedPath || null }),
      includeToolContext: false,
    });
    const result = await response.json().catch(() => ({}));
    if (requestId !== localToolContextRequestSequence) return false;
    if (!response.ok || !result.contextId || !result.toolRoot) {
      const error = new Error(
        response.status === 401
          ? "연결 토큰이 필요합니다"
          : result.error?.message || `HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    const previousRoot = activeLocalToolRoot || localToolRootPreference;
    const canonicalToolRoot = String(result.toolRoot);
    const toolRootChanged = Boolean(
      previousRoot && !sameToolRoot(previousRoot, canonicalToolRoot)
    );
    localStorage.setItem(localToolRootStorageKey(), canonicalToolRoot);
    localToolContextId = result.contextId;
    localToolContextEpoch += 1;
    localToolCatalogRequestSequence += 1;
    localToolWorkflowLoadSequence += 1;
    serverWorkflowRequestSequence += 1;
    activeLocalToolRoot = canonicalToolRoot;
    localToolRootPreference = activeLocalToolRoot;
    if (input) input.value = LOCAL_STUDIO_MODE ? "" : localToolRootPreference;
    if (toolRootChanged) {
      catalogReady = false;
      catalogModels = [];
      localPublishablePackages = [];
      localPublishablePackageStatus = "idle";
      explorerState.connected = false;
      explorerState.statusMessage = "새 실행 도구 catalog 조회 대기";
      serverWorkflowItems = [];
      serverWorkflowListStatus = "loading";
      renderAll();
    }
    renderLocalToolRootStatus();
    if (
      (LOCAL_STUDIO_MODE || options.resetFileAssociation !== false)
      && toolRootChanged
    ) {
      detachWorkflowFileAssociationForToolRootChange();
      if (!options.silent) {
        showToast(
          LOCAL_STUDIO_MODE
            ? "실행기 위치가 변경되어 현재 워크플로우를 새 파일로 저장해야 합니다."
            : "실행 도구 경로가 변경되어 현재 워크플로우를 새 파일로 저장해야 합니다."
        );
      }
    }
    return true;
  } catch (error) {
    if (requestId !== localToolContextRequestSequence) return false;
    if (error.status === 401) {
      explorerState.statusMessage = "연결 토큰 입력 필요";
    } else if (error instanceof TypeError || /failed to fetch|networkerror/i.test(String(error.message))) {
      explorerState.statusMessage = "로컬 브리지 실행 필요";
    } else {
      explorerState.statusMessage = "실행 도구 경로 확인 필요";
    }
    explorerState.connected = false;
    renderExplorerStatus();
    renderLocalToolRootStatus(
      error.status === 401
        ? "저장된 경로를 사용하려면 연결 토큰이 필요합니다."
        : `경로 적용 실패 · ${error.message || "연결 오류"}`
    );
    if (!options.silent) {
      showToast(`실행 도구 경로 적용 실패: ${error.message || "연결 오류"}`);
    }
    return false;
  } finally {
    localToolContextRequestCount = Math.max(0, localToolContextRequestCount - 1);
    if (button) button.disabled = localToolContextRequestCount > 0;
  }
}

async function saveLocalToolRoot() {
  const tokenInput = document.getElementById("localToolTokenInput");
  const typedToken = String(tokenInput?.value || "").trim();
  if (typedToken) sessionStorage.setItem(LOCAL_TOOL_TOKEN_SESSION_KEY, typedToken);
  if (
    !LOCAL_STUDIO_MODE
    && !sessionStorage.getItem(LOCAL_TOOL_TOKEN_SESSION_KEY)
  ) {
    showToast("실행 도구 경로를 확인하려면 먼저 Pairing token을 입력해 주세요.");
    tokenInput?.focus();
    return false;
  }
  const configured = await configureLocalToolContext();
  if (!configured) return false;
  if (tokenInput) tokenInput.value = "";
  await Promise.allSettled([
    refreshLocalExplorer({ silent: true }),
    syncServerWorkflows(),
  ]);
  showToast(`실행 도구 경로 저장 완료: ${activeLocalToolRoot}`);
  return true;
}

async function pairLocalTool() {
  const tokenInput = document.getElementById("localToolTokenInput");
  const token = String(
    tokenInput?.value || sessionStorage.getItem(LOCAL_TOOL_TOKEN_SESSION_KEY) || ""
  ).trim();
  if (!token) {
    showToast("studio_bridge.py 실행 화면의 Pairing token을 입력해 주세요.");
    tokenInput?.focus();
    return false;
  }
  sessionStorage.setItem(LOCAL_TOOL_TOKEN_SESSION_KEY, token);
  const contextReady = await configureLocalToolContext();
  if (!contextReady) {
    return false;
  }
  const [catalogResult, fileResult] = await Promise.all([
    refreshLocalExplorer(),
    syncServerWorkflows({ notify: true }),
  ]);
  if (!catalogResult && !fileResult) {
    return false;
  }
  if (tokenInput) tokenInput.value = "";
  return true;
}

function getAccessToken() {
  try {
    return LOCAL_STUDIO_MODE ? null : localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function restoreCachedAuthIdentity() {
  if (!LOCAL_STUDIO_MODE) return false;
  try {
    const cached = JSON.parse(localStorage.getItem(AUTH_IDENTITY_CACHE_KEY) || "null");
    if (
      !cached
      || typeof cached.id !== "string"
      || !cached.id
      || typeof cached.displayName !== "string"
      || !cached.displayName
    ) return false;
    Object.assign(authState, {
      status: "offline",
      mode: "required",
      user: {
        id: cached.id,
        displayName: cached.displayName,
        email: typeof cached.email === "string" ? cached.email : "",
        role: typeof cached.role === "string" ? cached.role : "worker",
      },
    });
    return true;
  } catch {
    return false;
  }
}

function rememberAuthenticatedIdentity(user) {
  if (!LOCAL_STUDIO_MODE || !user?.id || !user?.displayName) return;
  try {
    localStorage.setItem(AUTH_IDENTITY_CACHE_KEY, JSON.stringify({
      id: String(user.id),
      displayName: String(user.displayName),
      email: typeof user.email === "string" ? user.email : "",
      role: typeof user.role === "string" ? user.role : "worker",
    }));
  } catch {
    // Account display caching is optional; local editing must continue.
  }
}

function clearLocalMarketplaceSession() {
  if (!LOCAL_STUDIO_MODE) return;
  try {
    // Remove credentials written by pre-session-storage local Studio builds.
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_IDENTITY_CACHE_KEY);
  } catch {
    // Storage cleanup failure must not affect the local editor.
  }
}

function requestContextIsCurrent(requestIdentityEpoch, requestStorageScope) {
  return requestIdentityEpoch === authIdentityEpoch
    && requestStorageScope === activeStorageScope
    && !storageScopeTransitionPending;
}

async function apiFetch(pathname, options = {}) {
  const {
    authentication = "auto",
    timeoutMs = 0,
    ...fetchOptions
  } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const accessToken = getAccessToken();
  const mayAttachToken = authentication === "include"
    || (
      authentication !== "omit"
      && (authState.status === "authenticated" || authState.status === "loading")
  );
  if (accessToken && mayAttachToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const timeoutController = timeoutMs > 0 ? new AbortController() : null;
  const upstreamSignal = fetchOptions.signal;
  const abortFromUpstream = () => timeoutController?.abort(upstreamSignal?.reason);
  if (timeoutController && upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const timeoutHandle = timeoutController
    ? setTimeout(() => timeoutController.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs)
    : null;
  let response;
  try {
    response = await fetch(apiUrl(pathname), {
      ...fetchOptions,
      headers,
      signal: timeoutController?.signal || upstreamSignal,
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
  if (
    response.status === 401
    && authentication !== "omit"
    && String(pathname).replace(/^\/+/, "") !== "session"
    && authState.mode !== "disabled"
  ) {
    scheduleAuthRevalidation();
  }
  return response;
}

function setStudioInteractionLocked(locked) {
  document.querySelectorAll(
    "#editorView, #historyPane, #drawerScrim, #marketplaceView, .modal-backdrop"
  ).forEach(element => {
    if (locked) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  });
}

setStudioInteractionLocked(true);

function storageScopeForAuth(state = authState) {
  if (state.user?.id) return `account:${encodeURIComponent(String(state.user.id))}`;
  if (state.mode === "disabled") return "local-development";
  return "anonymous";
}

function scopedStorageKey(baseKey) {
  return `${baseKey}:${activeStorageScope || "pre-auth"}`;
}

function establishStorageScope(nextAuthState = authState) {
  const nextScope = storageScopeForAuth(nextAuthState);
  if (activeStorageScope && activeStorageScope !== nextScope) return false;
  activeStorageScope = nextScope;
  return true;
}

function lockForStorageScopeChange(previousAuthState, nextAuthState = previousAuthState) {
  const draftSaved = !hasAnyDirtyWorkflow()
    || persistLocalDraft({ immediate: true, silent: true });
  activeStorageScope = storageScopeForAuth(nextAuthState);
  Object.assign(authState, nextAuthState);
  authIdentityEpoch += 1;
  storageScopeTransitionPending = false;
  if (!draftSaved) externalDraftConflict = true;
  registeredMarketplacePackages = registeredMarketplacePackages.map(item => ({
    ...item,
    canManage: false,
  }));
  renderStudioContext();
  renderServerWorkflowList();
  renderMarketplace();
  applyCurrentWorkflowSaveState();
  showToast("Marketplace 계정 상태가 바뀌었습니다. 로컬 편집은 유지하고 계정 정보만 다시 반영했습니다.");
}

function scheduleAuthRevalidation() {
  if (authState.mode === "disabled" || authRevalidationPromise) return;
  authState.status = "loading";
  registeredMarketplacePackages = registeredMarketplacePackages.map(item => ({
    ...item,
    canManage: false,
  }));
  renderStudioContext();
  renderServerWorkflowList();
  renderMarketplace();
  authRevalidationPromise = Promise.resolve()
    .then(() => refreshAuthenticatedData({ notify: true }))
    .finally(() => {
      authRevalidationPromise = null;
    });
}

function readScopedLocalStorage(baseKey) {
  if (baseKey === WORKFLOW_STORAGE_KEY) {
    const currentValue = localStorage.getItem(CURRENT_DRAFT_STORAGE_KEY);
    if (currentValue != null) return currentValue;
    const legacyScopedValue = localStorage.getItem(scopedStorageKey(baseKey));
    if (legacyScopedValue != null) return legacyScopedValue;
    return localStorage.getItem(baseKey);
  }
  const scopedKey = scopedStorageKey(baseKey);
  const scopedValue = localStorage.getItem(scopedKey);
  if (scopedValue != null) return scopedValue;
  if (authState.mode !== "disabled") return null;

  // Only the explicitly unauthenticated local-development mode may inherit
  // data written before account-scoped browser storage was introduced.
  const legacyValue = localStorage.getItem(baseKey);
  if (legacyValue == null) return null;
  const migratedValue = legacyValue;
  localStorage.setItem(scopedKey, migratedValue);
  return migratedValue;
}

function recoverableLegacyStorageKeys() {
  if (authState.mode === "disabled" || !activeStorageScope) return [];
  try {
    return [AUXILIARY_STORAGE_KEY].filter(baseKey => (
      localStorage.getItem(scopedStorageKey(baseKey)) == null
      && localStorage.getItem(baseKey) != null
    ));
  } catch {
    return [];
  }
}

function hasRecoverableLegacyDraft() {
  return recoverableLegacyStorageKeys().length > 0;
}

function recoverLegacyDraft() {
  const keysToRecover = recoverableLegacyStorageKeys();
  if (!keysToRecover.length) {
    showToast("현재 계정으로 가져올 이전 로컬 초안이 없습니다.");
    return;
  }
  const accountName = authState.user?.displayName
    ? `${authState.user.displayName} 계정`
    : "현재 브라우저의 익명 로컬 영역";
  if (!confirm(
    `계정 분리 이전에 이 브라우저에 저장된 초안을 ${accountName}으로 가져올까요?\n`
    + "공용 PC이거나 다른 사람이 사용하던 브라우저라면 취소하세요."
  )) return;
  try {
    for (const baseKey of keysToRecover) {
      const legacyValue = localStorage.getItem(baseKey);
      if (legacyValue == null) continue;
      const recoveredValue = legacyValue;
      localStorage.setItem(scopedStorageKey(baseKey), recoveredValue);
    }
    window.location.reload();
  } catch (error) {
    showToast(`이전 초안 복구 실패: ${error.message || "브라우저 저장소 오류"}`);
  }
}

function responseErrorMessage(response, result = {}) {
  if (response.status === 401) return "로그인이 필요하거나 세션이 만료되었습니다. 로컬 초안은 유지됩니다.";
  if (response.status === 403) return "이 항목을 변경할 권한이 없습니다.";
  if (response.status === 503) return "인증 서버에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  if (typeof result.error === "string") return result.error;
  if (typeof result.error?.message === "string") return result.error.message;
  if (typeof result.message === "string") return result.message;
  return `HTTP ${response.status}`;
}

function errorMessage(error, fallback = "오류") {
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (typeof error?.error?.message === "string") return error.error.message;
  return fallback;
}

async function loadAuthSession(options = {}) {
  const requestGeneration = ++authGeneration;
  marketplaceWorkflowRequestSequence += 1;
  marketplaceModuleRequestSequence += 1;
  const previousAuthState = {
    status: authState.status,
    mode: authState.mode,
    user: authState.user,
  };
  const previousUser = previousAuthState.user;
  authState.status = "loading";
  renderStudioContext();
  renderServerWorkflowList();
  renderMarketplace();
  try {
    const response = await apiFetch("/session", {
      headers: { "Accept": "application/json" },
      authentication: "include",
      timeoutMs: Number(options.timeoutMs || 0),
    });
    const result = await response.json().catch(() => ({}));
    if (requestGeneration !== authGeneration) return false;
    if (!response.ok) {
      const error = new Error(responseErrorMessage(response, result));
      error.status = response.status;
      throw error;
    }
    const nextAuthState = {
      mode: result.authMode || "required",
      user: result.user || null,
      status: result.user ? "authenticated" : "anonymous",
    };
    if (nextAuthState.user) rememberAuthenticatedIdentity(nextAuthState.user);
    else if (LOCAL_STUDIO_MODE && nextAuthState.mode !== "disabled") clearLocalMarketplaceSession();
    if (!establishStorageScope(nextAuthState)) {
      lockForStorageScopeChange(previousAuthState, nextAuthState);
      return false;
    }
    Object.assign(authState, nextAuthState);
    if (authState.user?.displayName) localAuthorProfile = authState.user.displayName;
    if (!authState.user && authState.mode !== "disabled") {
      registeredMarketplacePackages = registeredMarketplacePackages.map(item => ({
        ...item,
        canManage: false,
      }));
      renderServerWorkflowList();
    }
    renderStudioContext();
    renderMarketplace();
    return Boolean(authState.user) || authState.mode === "disabled";
  } catch (error) {
    if (requestGeneration !== authGeneration) return false;
    const sessionWasRejected = error.status === 401 || error.status === 403;
    if (sessionWasRejected) clearLocalMarketplaceSession();
    const nextAuthState = {
      mode: previousAuthState.mode,
      user: sessionWasRejected ? null : previousUser,
      status: sessionWasRejected ? "anonymous" : "error",
    };
    if (!sessionWasRejected && !previousUser) {
      Object.assign(authState, nextAuthState);
      renderStudioContext();
      renderMarketplace();
      if (options.notify) showToast(`로그인 상태 확인 실패: ${error.message || "연결 오류"}`);
      return false;
    }
    if (!establishStorageScope(nextAuthState)) {
      lockForStorageScopeChange(previousAuthState, nextAuthState);
      return false;
    }
    Object.assign(authState, nextAuthState);
    if (sessionWasRejected) {
      registeredMarketplacePackages = registeredMarketplacePackages.map(item => ({
        ...item,
        canManage: false,
      }));
      renderServerWorkflowList();
    }
    renderStudioContext();
    renderMarketplace();
    if (options.notify) showToast(`로그인 상태 확인 실패: ${error.message || "연결 오류"}`);
    return false;
  }
}

let selectedNodeId = null;
let selectedLinkId = null;
const objectListViewState = {
  query: "",
  sortBy: "name",
  descending: false,
};
let dragState = null;
let pendingLinkPort = null;
let pendingLinkReconnect = null;
let assetSidebarTab = "workflow";
let lastRegisteredScriptId = null;
const DEFAULT_NODE_TYPES = ["InputInt", "Add", "OutputPrint"];
let nodeTypes = [...DEFAULT_NODE_TYPES];
const DEFAULT_PORT_TYPES = ["INT", "FLOAT", "STRING", "BOOL", "FILE", "CSV", "JSON", "IMAGE", "MODEL", "*"];
const DEFAULT_TYPE_PATTERNS = {
  INT: "^-?\\d+$",
  FLOAT: "^-?\\d+(\\.\\d+)?$",
  STRING: "^.*$",
  BOOL: "^(true|false|0|1)$",
  FILE: "^.+$",
  CSV: "^.+\\.csv$",
  JSON: "^.+\\.json$",
  IMAGE: "^.+\\.(png|jpg|jpeg|gif|webp)$",
  MODEL: "^.+\\.(pkl|pt|pth|onnx|joblib)$",
  "*": "^.*$"
};
let portTypes = [...DEFAULT_PORT_TYPES];
let portTypePatterns = { ...DEFAULT_TYPE_PATTERNS };
let modalPorts = { inputs: [], outputs: [] };
let currentProjectId = "example_project";
let projectStore = [
  { id: "example_project", name: "Example Workflow Project" }
];
let currentWorkflowId = "example_simple";
let workflowStore = [
  { id: "example_simple", name: "example_simple", projectId: "example_project", data: structuredClone(workflow) }
];
let currentWorkflow = workflowStore[0].data;
let historyStack = [];
let redoStack = [];
const HISTORY_LIMIT = 60;
let worldTransform = { x: 0, y: 0, scale: 1 };
let runTimers = [];
let workflowListCollapsed = false;
let marketplaceTab = "workspace";
let marketplaceFocusNodeType = null;

const world = document.getElementById("world");
const nodeLayer = document.getElementById("nodeLayer");
const linksSvg = document.getElementById("linksSvg");
const linkControlLayer = document.getElementById("linkControlLayer");
const nodeDetails = document.getElementById("nodeDetails");
const inspectorTitle = document.getElementById("inspectorTitle");
const inspectorSubtitle = document.getElementById("inspectorSubtitle");
const selectedInfo = document.getElementById("selectedInfo");
const jsonInput = document.getElementById("jsonInput");
const jsonHint = document.getElementById("jsonHint");
const canvasShell = document.getElementById("canvasShell");
const studioLayout = document.getElementById("studioLayout");
const workflowSidebar = document.getElementById("workflowSidebar");
const workflowInspector = document.getElementById("workflowInspector");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const toggleInspectorBtn = document.getElementById("toggleInspectorBtn");
const PANEL_STATE_STORAGE_KEY = "infrax.studio.panel-state.v1";

function readPanelState() {
  try {
    const state = JSON.parse(localStorage.getItem(PANEL_STATE_STORAGE_KEY) || "{}");
    return {
      sidebarCollapsed: state.sidebarCollapsed === true,
      inspectorCollapsed: state.inspectorCollapsed === true,
    };
  } catch {
    return { sidebarCollapsed: false, inspectorCollapsed: false };
  }
}

function writePanelState(state) {
  try {
    localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function updatePanelToggle(button, panel, collapsed, side) {
  if (!button || !panel) return;
  const panelName = side === "left" ? "워크플로우" : "인스펙터";
  const action = collapsed ? "펼치기" : "접기";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${panelName} 패널 ${action}`);
  button.title = `${panelName} 패널 ${action}`;
  const icon = button.querySelector(".material-symbols-outlined");
  if (icon) {
    icon.textContent = side === "left"
      ? (collapsed ? "left_panel_open" : "left_panel_close")
      : (collapsed ? "right_panel_open" : "right_panel_close");
  }
  panel.setAttribute("aria-hidden", String(collapsed));
}

function applyPanelState(state, { persist = false } = {}) {
  if (!studioLayout) return;
  studioLayout.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  studioLayout.classList.toggle("inspector-collapsed", state.inspectorCollapsed);
  updatePanelToggle(toggleSidebarBtn, workflowSidebar, state.sidebarCollapsed, "left");
  updatePanelToggle(toggleInspectorBtn, workflowInspector, state.inspectorCollapsed, "right");
  if (persist) writePanelState(state);
  requestAnimationFrame(() => {
    renderLinks();
    window.dispatchEvent(new Event("resize"));
  });
}

function currentPanelState() {
  return {
    sidebarCollapsed: studioLayout?.classList.contains("sidebar-collapsed") || false,
    inspectorCollapsed: studioLayout?.classList.contains("inspector-collapsed") || false,
  };
}

applyPanelState(readPanelState());

toggleSidebarBtn?.addEventListener("click", () => {
  const state = currentPanelState();
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applyPanelState(state, { persist: true });
});

toggleInspectorBtn?.addEventListener("click", () => {
  const state = currentPanelState();
  state.inspectorCollapsed = !state.inspectorCollapsed;
  applyPanelState(state, { persist: true });
});

function renderAll() {
  normalizeWorkflowShape(currentWorkflow);
  const missingNodeCount = currentWorkflow.nodes.filter(isNodeMissingFromCatalog).length;
  document.getElementById("nodeCount").textContent = missingNodeCount
    ? `${currentWorkflow.nodes.length} nodes · ${missingNodeCount} missing`
    : `${currentWorkflow.nodes.length} nodes`;
  document.getElementById("linkCount").textContent = `${currentWorkflow.links.length} links`;
  ensureProjectShape();
  renderProjectList();
  renderStudioContext();
  renderAddNodeTypeSelect();
  renderObjectList();
  renderWorkflowList();
  renderServerWorkflowList();
  renderNodePalette();
  renderModelPalette();
  renderScriptLibrary();
  renderMarketplace();
  renderNodes();
  requestAnimationFrame(renderLinks);
  renderInspector();
  renderValidation();
  renderHistoryPanel();
  jsonInput.value = JSON.stringify(currentWorkflow, null, 2);
}

function serverWritesEnabled() {
  if (storageScopeTransitionPending) return false;
  return (authState.mode === "disabled" && authState.status !== "error")
    || (authState.status === "authenticated" && Boolean(authState.user));
}

function requireServerWriteAccess() {
  if (serverWritesEnabled()) return true;
  showToast("로그인 확인이 끝난 뒤 Marketplace 관리를 다시 시도해 주세요.");
  return false;
}

function renderStudioContext() {
  const workflowItem = workflowStore.find(item => item.id === currentWorkflowId);
  const workflowName = workflowItem?.name || currentWorkflowId || "Untitled workflow";
  const currentWorkflowName = document.getElementById("currentWorkflowName");
  if (currentWorkflowName) currentWorkflowName.textContent = workflowName;
  const verifiedAuthor = authState.user?.displayName || "";
  const authorLabel = verifiedAuthor
    || (authState.status === "loading" ? "로그인 확인 중" : localAuthorProfile || "로그인 필요");
  const authorDisplay = document.getElementById("marketplaceAuthorDisplay");
  if (authorDisplay) authorDisplay.textContent = authorLabel;
  const initial = document.getElementById("localProfileInitial");
  if (initial) initial.textContent = (authorLabel.trim().charAt(0) || "L").toUpperCase();
  const profile = document.getElementById("localProfile");
  const authorChip = document.getElementById("marketplaceAuthorChip");
  const authorStatus = document.getElementById("marketplaceAuthorStatus");
  const verified = Boolean(authState.user);
  document.getElementById("logoutPlatformAccountBtn")?.classList.toggle(
    "hidden",
    !LOCAL_STUDIO_MODE || !verified
  );
  const statusLabel = authState.status === "scope-change"
    ? "계정 변경 감지"
    : authState.status === "offline"
    ? "서버 오프라인"
    : authState.status === "error"
    ? "계정 재확인 실패"
    : verified
    ? "로그인 계정"
    : authState.mode === "disabled"
      ? "로컬 개발 모드"
      : "로그인 필요";
  if (authorStatus) authorStatus.textContent = statusLabel;
  const profileTitle = authState.status === "scope-change"
    ? "로그인 계정이 변경되어 Marketplace 계정 정보를 다시 확인하고 있습니다. 로컬 초안은 유지됩니다."
    : authState.status === "offline"
    ? "마지막 계정 정보는 로컬 저장 구분에만 사용합니다. 서버 연결 전에는 Marketplace 쓰기 기능이 잠깁니다."
    : authState.status === "error"
    ? "마지막 계정 정보는 유지하지만 재확인이 실패해 Marketplace 쓰기 기능을 잠갔습니다."
    : verified
    ? `${authState.user.displayName} 계정으로 Marketplace 소유권을 관리합니다.`
    : "로그인하지 않아도 로컬 자동저장과 저장 기능은 사용할 수 있습니다.";
  if (profile) profile.title = profileTitle;
  if (authorChip) authorChip.title = profileTitle;
  ["marketplacePackageAuthor", "workflowPackageAuthor"].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    if (verified) input.value = verifiedAuthor;
    input.readOnly = verified;
    input.placeholder = verified ? "로그인 계정에서 자동 설정" : "작성자 이름 (미인증)";
  });
  const mayWriteServer = serverWritesEnabled();
  const workflowMarketplaceButton = document.getElementById("registerWorkflowBtn");
  if (workflowMarketplaceButton) {
    const icon = workflowMarketplaceButton.querySelector(".material-symbols-outlined");
    const label = workflowMarketplaceButton.querySelector(".button-label");
    const isCheckingAccount = authState.status === "loading" || authState.status === "scope-change";
    const connectTitle = authState.status === "offline"
      ? "Marketplace 서버가 오프라인입니다. 클릭하여 계정 연결을 다시 시도합니다."
      : authState.status === "error"
        ? "Marketplace 계정 확인에 실패했습니다. 클릭하여 다시 연결합니다."
        : "운영 Marketplace에서 로그인하고 이 로컬 Studio의 계정 연결을 승인합니다.";
    workflowMarketplaceButton.disabled = isCheckingAccount;
    workflowMarketplaceButton.classList.toggle("is-progress", isCheckingAccount);
    workflowMarketplaceButton.setAttribute("aria-busy", String(isCheckingAccount));
    if (icon) icon.textContent = isCheckingAccount
      ? "progress_activity"
      : mayWriteServer
        ? "verified_user"
        : "link";
    if (label) label.textContent = isCheckingAccount
      ? "Marketplace 계정 확인 중"
      : mayWriteServer
        ? `${authState.user?.displayName || "Marketplace"} 연결됨`
        : "Marketplace 계정 연결";
    workflowMarketplaceButton.title = isCheckingAccount
      ? "저장된 Marketplace 계정 정보를 확인하고 있습니다."
      : mayWriteServer
        ? `Marketplace 연결 계정: ${authState.user?.displayName || ""}${authState.user?.email ? ` · ${authState.user.email}` : ""}${authState.user?.role ? ` · ${authState.user.role}` : ""}`
        : connectTitle;
  }
  const loginRequiredTitle = "로그인 후 Marketplace 등록을 사용할 수 있습니다.";
  ["openModuleRegisterBtn"].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = !mayWriteServer;
    if (!mayWriteServer) button.title = loginRequiredTitle;
  });
  const saveButton = document.getElementById("saveWorkflowBtn");
  if (saveButton) saveButton.disabled = false;
  const refreshFilesButton = document.getElementById("refreshServerWorkflowsBtn");
  if (refreshFilesButton) refreshFilesButton.disabled = serverWorkflowListStatus === "loading";
  ["marketplaceRegisterForm", "workflowRegisterForm"].forEach(id => {
    const submit = document.getElementById(id)?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !mayWriteServer;
  });
  document.getElementById("recoverLegacyDraftBtn")?.classList.toggle(
    "hidden",
    !hasRecoverableLegacyDraft()
  );
}

function stripPortValues() {
  // Kept as a compatibility no-op. workflow.graph.v1 may carry input.value.
}

function normalizeType(type) {
  if (type == null || type === "") return "*";
  return String(type) === "Any" ? "*" : String(type);
}

function normalizeCatalogPort(port = {}) {
  return {
    name: String(port.name || "value"),
    type: normalizeType(port.type),
    fields: port.fields ?? null,
    required: Boolean(port.required),
    default: port.default ?? null
  };
}

function normalizeCatalogModel(model = {}) {
  if (!model || typeof model !== "object") return null;
  const path = String(model.path || "").trim();
  if (!path) return null;
  const rawPackageRef = model.package_ref;
  const packageRef = typeof rawPackageRef === "string"
    ? rawPackageRef.trim()
    : rawPackageRef && typeof rawPackageRef === "object"
      ? {
          package_id: String(rawPackageRef.package_id || rawPackageRef.id || "").trim(),
          version: String(rawPackageRef.version || "").trim(),
          digest: String(rawPackageRef.digest || "").trim(),
        }
      : null;
  const size = Number(model.size);
  return {
    id: String(model.id || path),
    name: String(model.name || model.relative_path || path),
    relative_path: String(model.relative_path || ""),
    path,
    size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    package_ref: packageRef,
  };
}

function normalizeCatalogModels(models) {
  const byPath = new Map();
  (Array.isArray(models) ? models : []).forEach(model => {
    const normalized = normalizeCatalogModel(model);
    if (normalized && !byPath.has(normalized.path)) {
      byPath.set(normalized.path, normalized);
    }
  });
  return [...byPath.values()];
}

function catalogModelPackageLabel(model) {
  const packageRef = model?.package_ref;
  if (typeof packageRef === "string") return packageRef;
  return String(packageRef?.package_id || "").trim();
}

function catalogModelSelectOptions(currentValue) {
  const currentPath = String(currentValue ?? "");
  const options = catalogModels.map(model => {
    const packageLabel = catalogModelPackageLabel(model);
    return {
      value: model.path,
      label: packageLabel ? `${model.name} · ${packageLabel}` : model.name,
    };
  });
  if (currentPath && !catalogModels.some(model => model.path === currentPath)) {
    options.unshift({
      value: currentPath,
      label: `${currentPath} · catalog 미확인`,
    });
  }
  return options;
}

function isModelCatalogInput(input) {
  const type = String(input?.type || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return type === "MODEL"
    || /(?:^|_)(?:MODEL|CHECKPOINT)(?:_|$).*(?:PATH|FILE)(?:_|$)/.test(type)
    || /(?:^|_)(?:PATH|FILE)(?:_|$).*(?:MODEL|CHECKPOINT)(?:_|$)/.test(type);
}

function safeId(value) {
  return String(value || "item").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
}

function marketplaceInstallName(pkg) {
  const id = String(pkg?.id || "").trim();
  const withoutGeneratedPrefix = id.replace(/^module_\d+_+/i, "");
  return safeId(withoutGeneratedPrefix || pkg?.name || id || "node");
}

function ensureProjectShape() {
  projectStore = Array.isArray(projectStore) && projectStore.length
    ? projectStore
    : [{ id: "example_project", name: "Example Workflow Project" }];
  if (!projectStore.some(project => project.id === currentProjectId)) currentProjectId = projectStore[0].id;
  workflowStore.forEach(item => {
    if (!item.projectId || !projectStore.some(project => project.id === item.projectId)) item.projectId = currentProjectId;
  });
}

function currentProject() {
  ensureProjectShape();
  return projectStore.find(project => project.id === currentProjectId) || projectStore[0];
}

function workflowsForCurrentProject() {
  ensureProjectShape();
  return workflowStore.filter(item => item.projectId === currentProjectId);
}

function scriptFromCatalogNode(node, catalog) {
  const key = String(node.key || node.type || node.name || `node_${Date.now()}`);
  const initInputs = Array.isArray(node.init?.inputs) ? node.init.inputs.map(normalizeCatalogPort) : [];
  const packageRef = node.package_ref && typeof node.package_ref === "object"
    ? node.package_ref
    : null;
  return {
    id: `catalog_${safeId(key)}`,
    definitionId: packageRef?.definition_id || key,
    type: key,
    name: node.display_name || node.name || key,
    packageId: packageRef?.package_id || catalog?.package?.id || catalog?.runtime?.id || "local-catalog",
    digest: packageRef?.digest || node.digest || catalog?.package?.digest || null,
    developer: packageRef?.author || catalog?.runtime?.id || "catalog",
    version: packageRef?.version || node.version || catalog?.schema || CATALOG_SCHEMA,
    status: "catalog",
    command: node.module || "",
    path: node.module || "",
    description: node.description || "",
    category: node.category || "",
    initInputs,
    inputs: Array.isArray(node.io?.inputs) ? node.io.inputs.map(normalizeCatalogPort) : [],
    outputs: Array.isArray(node.io?.outputs) ? node.io.outputs.map(normalizeCatalogPort) : []
  };
}

function getScriptForNode(node) {
  return scriptLibrary.find(script => script.id === node?.script_id)
    || scriptLibrary.find(script => script.type === node?.type);
}

function isNodeMissingFromCatalog(node) {
  return Boolean(catalogReady && node?.type && !scriptLibrary.some(script => script.type === node.type));
}

function marketplaceNodeTypes(pkg) {
  return [...new Set([
    ...(Array.isArray(pkg?.nodeTypes) ? pkg.nodeTypes : []),
    ...(Array.isArray(pkg?.provides) ? pkg.provides : []),
    ...(Array.isArray(pkg?.scripts) ? pkg.scripts.map(script => script?.type) : []),
  ].filter(Boolean).map(String))];
}

function marketplacePackageForNode(node) {
  const packages = [...registeredMarketplacePackages, ...marketplacePackages]
    .filter(pkg => !pkg.workflow && pkg.kind !== "workflow-bundle");
  const packageId = node?.node_ref?.package_id || node?.implementation_ref?.package_id;
  return packages.find(pkg => packageId && pkg.id === packageId)
    || packages.find(pkg => marketplaceNodeTypes(pkg).includes(String(node?.type || "")))
    || null;
}

function marketplacePackageForNodeType(nodeType) {
  const type = String(nodeType || "");
  if (!type) return null;
  return [...registeredMarketplacePackages, ...marketplacePackages]
    .filter(pkg => !pkg.workflow && pkg.kind !== "workflow-bundle")
    .find(pkg => marketplaceNodeTypes(pkg).includes(type)) || null;
}

function nodePackagePathFromModule(moduleName) {
  const parts = String(moduleName || "").split(".").filter(Boolean);
  if (parts[0] === "custom_nodes" && parts[1]) {
    const base = parts[1];
    const repo = parts[2] || "";
    return {
      root: "custom_nodes",
      base,
      repo,
      packageId: repo || base,
      path: parts.slice(0, Math.max(repo ? 3 : 2, parts.length - 1)).join("/"),
      label: repo ? `custom_nodes/${base}/${repo}` : `custom_nodes/${base}`,
      baseLabel: `custom_nodes/${base}`,
      repoLabel: repo || base,
    };
  }
  if (parts[0] === "app") {
    return {
      root: "app",
      packageId: parts[1] || "nodes",
      path: parts.slice(0, Math.max(2, parts.length - 1)).join("/"),
      label: parts.slice(0, Math.max(2, parts.length - 1)).join("/") || "app/nodes",
    };
  }
  return {
    root: "catalog",
    packageId: "catalog",
    path: parts.slice(0, Math.max(1, parts.length - 1)).join("/") || "catalog",
    label: parts.slice(0, Math.max(1, parts.length - 1)).join("/") || "catalog",
  };
}

function nodePackagePathForScript(script) {
  return nodePackagePathFromModule(script?.path || script?.command || script?.module || "");
}

function customNodeTreeInfo(script) {
  const moduleTree = nodePackagePathForScript(script);
  const typeParts = String(script?.type || "").split(".").filter(Boolean);
  if (moduleTree.root === "custom_nodes" && moduleTree.base) {
    const base = moduleTree.base;
    const repo = moduleTree.repo || typeParts[1] || moduleTree.packageId;
    const nodeType = typeParts[0] === base && typeParts[1] === repo
      ? typeParts.slice(2).join(".")
      : typeParts.slice(Math.max(0, typeParts.length - 2)).join(".");
    return {
      root: "custom_nodes",
      base,
      repo,
      baseLabel: `custom_nodes/${base}`,
      repoLabel: repo,
      packageId: repo,
      nodeTypeLabel: nodeType || script?.name || script?.type || "",
    };
  }
  return {
    root: moduleTree.root,
    base: moduleTree.label,
    repo: "",
    baseLabel: moduleTree.label,
    repoLabel: moduleTree.root === "app" ? "built-in" : moduleTree.label,
    packageId: moduleTree.packageId,
    nodeTypeLabel: script?.type || script?.name || "",
  };
}

function marketplacePackageForNodeScripts(scripts) {
  return scripts
    .map(script => marketplacePackageForNodeType(script.type))
    .find(Boolean) || null;
}

function customNodePackageId(base, repo) {
  return safeId(repo || base || "package");
}

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

function marketplaceActionButton(label, action, extraClass = "") {
  if (!serverWritesEnabled()) return "";
  return `<button class="market-mini-action ${extraClass}" type="button" onclick="event.stopPropagation(); ${action}">${escapeHtml(label)}</button>`;
}

function openMarketplaceForMissingNode(nodeId) {
  const node = currentWorkflow.nodes.find(item => item.id === nodeId);
  if (!node) return;
  const candidate = marketplacePackageForNode(node);
  marketplaceFocusNodeType = node.type;
  marketplaceTab = "module";
  openMarketplaceView();
  renderMarketplace();
  requestAnimationFrame(() => {
    document.querySelector(".marketplace-card.recommended-for-node")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
  showToast(candidate
    ? `${node.type}을 제공하는 ${candidate.name} 다운로드 항목으로 이동했습니다.`
    : `${node.type} 제공 정보가 등록된 항목은 없습니다. Node 목록에서 확인해 주세요.`);
}

window.openMarketplaceForMissingNode = openMarketplaceForMissingNode;

function getInitInputsForNode(node) {
  const script = getScriptForNode(node);
  if (script?.initInputs?.length) return script.initInputs;
  if (node?.init_values && typeof node.init_values === "object") {
    return Object.keys(node.init_values).map(name => ({ name, type: typeof node.init_values[name], default: node.init_values[name] }));
  }
  if (Array.isArray(node?.widgets_values)) {
    return node.widgets_values.map((value, index) => ({
      name: `value_${index + 1}`,
      type: typeof value,
      default: value,
      syntheticLabel: true,
    }));
  }
  return [];
}

function initValuesForScript(script) {
  const values = {};
  (script?.initInputs || []).forEach(input => {
    values[input.name] = input.default ?? (input.type === "float" || input.type === "int" || input.type === "INT" ? 0 : "");
  });
  return values;
}

function syncWidgetValuesFromInit(node) {
  const initInputs = getInitInputsForNode(node);
  if (!initInputs.length) return;
  node.init_values = node.init_values && typeof node.init_values === "object" ? node.init_values : {};
  initInputs.forEach(input => {
    if (!Object.prototype.hasOwnProperty.call(node.init_values, input.name)) {
      node.init_values[input.name] = input.default ?? "";
    }
  });
  node.widgets_values = initInputs.map(input => node.init_values[input.name]);
}

function normalizeWorkflowShape(workflowData) {
  if (!workflowData || typeof workflowData !== "object") return;
  workflowData.schema = workflowData.schema || GRAPH_SCHEMA;
  workflowData.nodes = Array.isArray(workflowData.nodes) ? workflowData.nodes : [];
  workflowData.links = Array.isArray(workflowData.links) ? workflowData.links : [];
  workflowData.nodes.forEach(node => {
    node.pos = Array.isArray(node.pos) ? node.pos : [120, 120];
    node.size = Array.isArray(node.size) ? node.size : [270, 82];
    node.inputs = Array.isArray(node.inputs) ? node.inputs : [];
    node.outputs = Array.isArray(node.outputs) ? node.outputs : [];
    node.inputs.forEach(input => {
      input.type = normalizeType(input.type);
      if (!Object.prototype.hasOwnProperty.call(input, "link")) input.link = null;
    });
    node.outputs.forEach(output => {
      output.type = normalizeType(output.type);
      output.links = Array.isArray(output.links) ? output.links : [];
    });
    syncWidgetValuesFromInit(node);
  });
  workflowData.last_node_id = Math.max(workflowData.last_node_id || 0, ...workflowData.nodes.map(node => Number(node.id) || 0), 0);
  workflowData.last_link_id = Math.max(workflowData.last_link_id || 0, ...workflowData.links.map(link => Number(link[0]) || 0), 0);
}

function renderWorkflowList() {
  const root = document.getElementById("workflowList");
  root.innerHTML = "";
  const item = workflowStore.find(workflowItem => workflowItem.id === currentWorkflowId)
    || workflowStore[0];
  if (item) {
    const el = document.createElement("div");
    el.className = "nav-item active";
    const fileLabel = currentWorkflowFileName
      ? `workflows/${currentWorkflowFileName}`
      : "브라우저 초안 · 아직 파일 없음";
    el.innerHTML = `<b>${escapeHtml(item.name)}</b><span>${escapeHtml(fileLabel)} · ${item.data.nodes.length} nodes</span>`;
    root.appendChild(el);
  }
  if (!root.children.length) root.innerHTML = `<div class="kv"><span>브라우저 초안을 준비하는 중입니다.</span></div>`;
  const toggle = document.getElementById("toggleWorkflowListBtn");
  if (toggle) toggle.classList.add("hidden");
  renderTempWorkflowList();
}

function formatTempWorkflowTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 미상";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderTempWorkflowList() {
  const panel = document.getElementById("tempWorkflowPanel");
  const count = document.getElementById("tempWorkflowCount");
  const toggle = document.getElementById("tempWorkflowToggleBtn");
  const list = document.getElementById("tempWorkflowList");
  if (!panel || !count || !toggle || !list) return;
  const items = Array.isArray(tempWorkflowItems) ? tempWorkflowItems : [];
  count.textContent = String(items.length);
  panel.classList.toggle("has-items", items.length > 0);
  if (!items.length) {
    toggle.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    list.innerHTML = `<div class="kv"><span>임시 보관된 작업본이 없습니다.</span></div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const fileName = item.fileName || "";
    const displayName = String(item.name || fileName.split("/").pop() || "임시 작업본").replace(/\.json$/i, "");
    const nodeCount = Number.isFinite(item.nodeCount) ? item.nodeCount : 0;
    return `
      <div class="temp-workflow-item">
        <button class="nav-item temp-restore-main" type="button" onclick="restoreTempWorkflow(${inlineJson(fileName)})">
          <b>${escapeHtml(displayName)}</b>
          <span>저장 안 된 작업본 · ${nodeCount} nodes · ${escapeHtml(formatTempWorkflowTime(item.modifiedAt))}</span>
        </button>
        <button class="temp-delete-btn" type="button" title="임시 작업본 삭제" aria-label="임시 작업본 삭제" onclick="deleteTempWorkflow(${inlineJson(fileName)})">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    `;
  }).join("");
}

function renderServerWorkflowList() {
  const root = document.getElementById("serverWorkflowList");
  if (!root) return;
  if (serverWorkflowListStatus === "loading") {
    root.innerHTML = `<div class="kv"><span>workflows 폴더를 조회하는 중입니다.</span></div>`;
    return;
  }
  if (serverWorkflowListStatus === "error") {
    root.innerHTML = LOCAL_STUDIO_MODE
      ? `<div class="kv"><span>workflows 폴더를 읽지 못했습니다. 다시 조회해 주세요.</span></div>`
      : `<div class="kv"><span>로컬 툴에 연결하지 못했습니다. <code>python-3.10.0-embed-amd64\\python.exe studio_bridge.py</code> 실행 후 다시 조회하세요.</span></div>`;
    return;
  }
  if (!serverWorkflowItems.length) {
    root.innerHTML = `<div class="kv"><span>workflows 폴더에 JSON 파일이 없습니다.</span></div>`;
    return;
  }
  root.innerHTML = "";
  serverWorkflowItems.forEach(item => {
    const fileName = item.fileName || item.name || String(item);
    const pkg = marketplacePackageForWorkflowFile(fileName);
    const isCurrentAsset = currentWorkflowSourceFileName === fileName;
    const savedAt = item.modifiedAt ? new Date(item.modifiedAt) : null;
    const savedLabel = savedAt && !Number.isNaN(savedAt.getTime())
      ? savedAt.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "수정 시각 미상";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = `nav-item server-workflow-item ${isCurrentAsset ? "active" : ""}`;
    openButton.innerHTML = `<b>${escapeHtml(fileName.replace(/\.json$/i, ""))}</b><span>${escapeHtml(fileName)} · ${escapeHtml(savedLabel)}</span>`;
    openButton.title = "이 파일을 현재 브라우저 초안으로 열기";
    openButton.addEventListener("click", () => loadServerWorkflow(fileName, { activate: true }));
    if (serverWritesEnabled()) {
      const row = document.createElement("div");
      row.className = "asset-market-row";
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = `market-mini-action ${pkg ? "" : "new"} ${pkg && !pkg.canManage ? "readonly" : ""}`;
      actionButton.textContent = pkg ? (pkg.canManage ? "수정" : "등록됨") : "등록";
      actionButton.addEventListener("click", event => {
        event.stopPropagation();
        openWorkflowFileMarketplaceAction(fileName);
      });
      row.appendChild(openButton);
      row.appendChild(actionButton);
      root.appendChild(row);
    } else {
      root.appendChild(openButton);
    }
  });
}

function toggleWorkflowListMode() {
  workflowListCollapsed = !workflowListCollapsed;
  renderWorkflowList();
}

function renderProjectList() {
  const projectSelect = document.getElementById("projectSelect");
  if (projectSelect) {
    const previous = projectSelect.value;
    projectSelect.innerHTML = projectStore
      .map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`)
      .join("");
    projectSelect.value = projectStore.some(project => project.id === previous) ? previous : currentProjectId;
  }

  const projectNameInput = document.getElementById("projectNameInput");
  if (projectNameInput && document.activeElement !== projectNameInput) projectNameInput.value = currentProject().name;

  const root = document.getElementById("projectList");
  if (root) {
    root.innerHTML = projectStore.map(project => {
      const count = workflowStore.filter(workflow => workflow.projectId === project.id).length;
      return `
        <div class="nav-item ${project.id === currentProjectId ? "active" : ""}" onclick="switchProject(${inlineJson(project.id)})">
          <b>${escapeHtml(project.name)}</b>
          <span>${count} workflows</span>
        </div>
      `;
    }).join("");
  }

  const workflowRoot = document.getElementById("projectWorkflowList");
  if (workflowRoot) {
    workflowRoot.innerHTML = workflowsForCurrentProject().map(item => `
      <div class="nav-item ${item.id === currentWorkflowId ? "active" : ""}" onclick="switchWorkflow(${inlineJson(item.id)})">
        <b>${escapeHtml(item.name)}</b>
        <span>${item.data.nodes.length} nodes · ${item.data.links.length} links</span>
      </div>
    `).join("") || `<div class="kv"><span>새 워크플로우를 만들어 시작하세요.</span></div>`;
  }
}

function renderObjectList() {
  const root = document.getElementById("objectList");
  if (!root) return;
  const query = objectListViewState.query.trim().toLocaleLowerCase();
  const items = [
    ...currentWorkflow.nodes.map(node => ({
      kind: "node",
      id: node.id,
      name: displayNodeTitle(node),
      type: node.type,
      searchText: `${displayNodeTitle(node)} ${node.type} ${node.id}`,
      value: node,
    })),
    ...currentWorkflow.links.map(link => ({
      kind: "link",
      id: link[0],
      name: describeLink(link),
      type: link[5] || "",
      searchText: `${describeLink(link)} ${link[5] || ""} ${link[0]}`,
      value: link,
    })),
  ]
    .filter(item => !query || item.searchText.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const sortBy = objectListViewState.sortBy;
      const leftValue = sortBy === "kind" ? left.kind : left[sortBy];
      const rightValue = sortBy === "kind" ? right.kind : right[sortBy];
      const result = sortBy === "id"
        ? String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true })
        : String(leftValue).localeCompare(String(rightValue), undefined, {
            numeric: true,
            sensitivity: "base",
          });
      if (result !== 0) return objectListViewState.descending ? -result : result;
      return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    });

  root.innerHTML = items.map(item => {
    if (item.kind === "link") {
      const link = item.value;
      return `
        <button class="object-item ${link[0] === selectedLinkId ? "active" : ""}" type="button" onclick="selectLinkFromList(${inlineJson(link[0])})">
          <span class="object-kind">Link</span>
          <b>${escapeHtml(item.name)}</b>
          <small>link #${link[0]}</small>
        </button>
      `;
    }
    const node = item.value;
    const missing = isNodeMissingFromCatalog(node);
    const missingTitle = missing
      ? "현재 PC의 catalog.json에서 확인되지 않은 노드입니다."
      : "";
    return `
      <button class="object-item ${node.id === selectedNodeId ? "active" : ""} ${missing ? "missing-node" : ""}" type="button" title="${escapeHtml(missingTitle)}" onclick="selectNodeFromList(${inlineJson(node.id)})">
        <span class="object-kind">${missing ? "로컬 없음" : "Node"}</span>
        <b>${escapeHtml(displayNodeTitle(node))}</b>
        <small>${escapeHtml(node.type)} #${node.id}</small>
        ${missing ? `<em class="object-missing-note">현재 PC에 설치된 노드 목록에 없음</em>` : ""}
      </button>
    `;
  }).join("") || `<div class="kv"><span>${
    query
      ? "검색 조건에 맞는 객체가 없습니다."
      : "아직 배치된 객체가 없습니다. Node 탭에서 노드를 추가하세요."
  }</span></div>`;
}

function selectNodeFromList(nodeId) {
  selectedNodeId = nodeId;
  selectedLinkId = null;
  clearPendingLinkPort();
  clearPendingLinkReconnect();
  renderAll();
}

window.selectNodeFromList = selectNodeFromList;

function selectLinkFromList(linkId) {
  selectedLinkId = linkId;
  selectedNodeId = null;
  clearPendingLinkPort();
  clearPendingLinkReconnect();
  renderAll();
}

window.selectLinkFromList = selectLinkFromList;

function renderNodePaletteLegacy() {
  const root = document.getElementById("nodePalette");
  if (!root) return;
  if (!catalogReady) {
    root.innerHTML = LOCAL_STUDIO_MODE
      ? `<div class="kv"><span>${explorerState.statusMessage ? "노드 목록을 불러오지 못했습니다. 다시 조회해 주세요." : "노드 목록을 준비하는 중입니다."}</span></div>`
      : `<div class="kv"><span>로컬 툴 연결 후 catalog.json에서 확인된 노드가 여기에 표시됩니다.</span></div>`;
    renderExplorerStatus();
    return;
  }
  const query = document.getElementById("nodeSearchInput")?.value.trim().toLowerCase() || "";
  const types = [...new Map(scriptLibrary.map(script => [script.type, script])).values()]
    .filter(script => !query
      || String(script.name || "").toLowerCase().includes(query)
      || String(script.type || "").toLowerCase().includes(query));
  root.innerHTML = "";
  const groups = new Map();
  types.forEach(script => {
    const tree = nodePackagePathForScript(script);
    const key = tree.label;
    if (!groups.has(key)) groups.set(key, { tree, scripts: [] });
    groups.get(key).scripts.push(script);
  });
  [...groups.values()]
    .sort((left, right) => left.tree.label.localeCompare(right.tree.label, "ko"))
    .forEach(group => {
      const details = document.createElement("details");
      details.className = "node-tree-group";
      details.open = true;
      details.innerHTML = `
        <summary>
          <span class="material-symbols-outlined" aria-hidden="true">folder</span>
          <b>${escapeHtml(group.tree.label)}</b>
          <small>${group.scripts.length} nodes</small>
        </summary>
      `;
      const list = document.createElement("div");
      list.className = "node-tree-list";
      group.scripts
        .sort((left, right) => String(left.name || left.type).localeCompare(String(right.name || right.type), "ko"))
        .forEach(script => {
          const el = document.createElement("div");
          el.className = "nav-item palette-item node-tree-item";
          el.draggable = true;
          const pkg = marketplacePackageForNodeType(script.type);
          const action = !serverWritesEnabled()
            ? ""
            : pkg
              ? marketplaceActionButton(pkg.canManage ? "수정" : "등록됨", `openNodeTypeMarketplaceAction(${inlineJson(script.type)})`, pkg.canManage ? "" : "readonly")
              : marketplaceActionButton("등록", `openNodeTypeMarketplaceAction(${inlineJson(script.type)})`, "new");
          el.innerHTML = `
            <div class="asset-card-row">
              <b>${escapeHtml(script.name || script.type)}</b>
              ${packageAction}
            </div>
            <span>${escapeHtml(script.type)} · ${script.outputs?.length || 0} outputs</span>
          `;
          el.addEventListener("click", () => addNode(script.type));
          el.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", script.type));
          list.appendChild(el);
        });
      details.appendChild(list);
      root.appendChild(details);
    });
  if (!types.length) {
    root.innerHTML = `<div class="kv"><span>검색 조건에 맞는 로컬 노드가 없습니다.</span></div>`;
  }
  renderExplorerStatus();
}

function renderNodePalette() {
  const root = document.getElementById("nodePalette");
  if (!root) return;
  if (!catalogReady) {
    root.innerHTML = LOCAL_STUDIO_MODE
      ? `<div class="kv"><span>${explorerState.statusMessage ? "노드 목록을 불러오지 못했습니다. 다시 조회해 주세요." : "노드 목록을 준비하는 중입니다."}</span></div>`
      : `<div class="kv"><span>로컬 툴 연결 후 catalog.json에서 확인된 노드가 여기에 표시됩니다.</span></div>`;
    renderExplorerStatus();
    return;
  }

  const query = document.getElementById("nodeSearchInput")?.value.trim().toLowerCase() || "";
  const types = [...new Map(scriptLibrary.map(script => [script.type, script])).values()]
    .filter(script => !query
      || String(script.name || "").toLowerCase().includes(query)
      || String(script.type || "").toLowerCase().includes(query));

  root.innerHTML = "";
  const baseGroups = new Map();
  types.forEach(script => {
    const tree = customNodeTreeInfo(script);
    const baseKey = tree.baseLabel;
    if (!baseGroups.has(baseKey)) {
      baseGroups.set(baseKey, { tree, repos: new Map(), scripts: [] });
    }
    const baseGroup = baseGroups.get(baseKey);
    baseGroup.scripts.push(script);
    const repoKey = tree.repoLabel || tree.baseLabel;
    if (!baseGroup.repos.has(repoKey)) {
      baseGroup.repos.set(repoKey, { tree, scripts: [] });
    }
    baseGroup.repos.get(repoKey).scripts.push(script);
  });

  [...baseGroups.values()]
    .sort((left, right) => left.tree.baseLabel.localeCompare(right.tree.baseLabel, "ko"))
    .forEach(baseGroup => {
      const details = document.createElement("details");
      details.className = "node-tree-group";
      details.open = true;
      details.innerHTML = `
        <summary>
          <span class="material-symbols-outlined" aria-hidden="true">folder</span>
          <b>${escapeHtml(baseGroup.tree.baseLabel)}</b>
          <small>${baseGroup.scripts.length} nodes</small>
        </summary>
      `;

      const repoList = document.createElement("div");
      repoList.className = "node-tree-list node-tree-repo-list";
      [...baseGroup.repos.values()]
        .sort((left, right) => left.tree.repoLabel.localeCompare(right.tree.repoLabel, "ko"))
        .forEach(repoGroup => {
          const repoDetails = document.createElement("details");
          repoDetails.className = "node-tree-group node-tree-repo-group";
          repoDetails.open = true;
          const pkg = marketplacePackageForNodeScripts(repoGroup.scripts);
          const localPackageId = customNodePackageId(repoGroup.tree.base, repoGroup.tree.repo);
          const action = !serverWritesEnabled()
            ? ""
            : pkg
              ? marketplaceActionButton(pkg.canManage ? "수정" : "등록됨", `openNodeTypeMarketplaceAction(${inlineJson(repoGroup.scripts[0]?.type || "")})`, pkg.canManage ? "" : "readonly")
              : marketplaceActionButton("등록", `openNodeTypeMarketplaceAction(${inlineJson(repoGroup.scripts[0]?.type || "")})`, "new");

          const packageAction = !serverWritesEnabled()
            ? ""
            : pkg
              ? marketplaceActionButton(pkg.canManage ? "수정" : "등록됨", `openNodePackageMarketplaceAction(${inlineJson(localPackageId)})`, pkg.canManage ? "" : "readonly")
              : marketplaceActionButton("등록", `openNodePackageMarketplaceAction(${inlineJson(localPackageId)})`, "new");
          repoDetails.innerHTML = `
            <summary class="node-tree-repo-summary">
              <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
              <b>${escapeHtml(repoGroup.tree.repoLabel)}</b>
              <small>${repoGroup.scripts.length} nodes</small>
              ${action}
            </summary>
          `;

          const nodeList = document.createElement("div");
          nodeList.className = "node-tree-list node-tree-node-list";
          repoGroup.scripts
            .sort((left, right) => customNodeTreeInfo(left).nodeTypeLabel.localeCompare(customNodeTreeInfo(right).nodeTypeLabel, "ko"))
            .forEach(script => {
              const itemTree = customNodeTreeInfo(script);
              const el = document.createElement("div");
              el.className = "nav-item palette-item node-tree-item";
              el.draggable = true;
              el.innerHTML = `
                <div class="asset-card-row">
                  <b>${escapeHtml(itemTree.nodeTypeLabel)}</b>
                </div>
                <span>${escapeHtml(script.type)} · ${script.outputs?.length || 0} outputs</span>
              `;
              el.addEventListener("click", () => addNode(script.type));
              el.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", script.type));
              nodeList.appendChild(el);
            });

          repoDetails.appendChild(nodeList);
          repoList.appendChild(repoDetails);
        });

      details.appendChild(repoList);
      root.appendChild(details);
    });

  if (!types.length) {
    root.innerHTML = `<div class="kv"><span>검색 조건에 맞는 로컬 노드가 없습니다.</span></div>`;
  }
  renderExplorerStatus();
}

function modelTreeInfo(model) {
  const path = String(model?.path || model?.relative_path || model?.name || "").replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  const modelIndex = parts[0] === "models" ? 1 : 0;
  const base = parts[modelIndex] || "models";
  const repo = parts[modelIndex + 1] || catalogModelPackageLabel(model) || "local";
  const fileParts = parts.slice(modelIndex + 2);
  const fileLabel = fileParts.join("/") || String(model?.name || model?.path || "model");
  return {
    base,
    repo,
    baseLabel: `models/${base}`,
    repoLabel: repo,
    fileLabel,
  };
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = size;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function renderModelPalette() {
  const root = document.getElementById("modelPalette");
  if (!root) return;
  const query = document.getElementById("modelSearchInput")?.value.trim().toLowerCase() || "";
  const models = catalogModels.filter(model => !query
    || String(model.name || "").toLowerCase().includes(query)
    || String(model.path || "").toLowerCase().includes(query)
    || catalogModelPackageLabel(model).toLowerCase().includes(query));
  root.innerHTML = "";
  if (!models.length) {
    root.innerHTML = `<div class="kv"><span>${query ? "검색 조건에 맞는 모델이 없습니다." : "catalog.json에서 확인된 모델이 없습니다."}</span></div>`;
    return;
  }

  const baseGroups = new Map();
  models.forEach(model => {
    const tree = modelTreeInfo(model);
    if (!baseGroups.has(tree.baseLabel)) {
      baseGroups.set(tree.baseLabel, { tree, repos: new Map(), models: [] });
    }
    const baseGroup = baseGroups.get(tree.baseLabel);
    baseGroup.models.push(model);
    if (!baseGroup.repos.has(tree.repoLabel)) {
      baseGroup.repos.set(tree.repoLabel, { tree, models: [] });
    }
    baseGroup.repos.get(tree.repoLabel).models.push(model);
  });

  [...baseGroups.values()]
    .sort((left, right) => left.tree.baseLabel.localeCompare(right.tree.baseLabel, "ko"))
    .forEach(baseGroup => {
      const details = document.createElement("details");
      details.className = "node-tree-group model-tree-group";
      details.open = true;
      details.innerHTML = `
        <summary>
          <span class="material-symbols-outlined" aria-hidden="true">folder</span>
          <b>${escapeHtml(baseGroup.tree.baseLabel)}</b>
          <small>${baseGroup.models.length} models</small>
        </summary>
      `;
      const repoList = document.createElement("div");
      repoList.className = "node-tree-list node-tree-repo-list";
      [...baseGroup.repos.values()]
        .sort((left, right) => left.tree.repoLabel.localeCompare(right.tree.repoLabel, "ko"))
        .forEach(repoGroup => {
          const repoDetails = document.createElement("details");
          repoDetails.className = "node-tree-group node-tree-repo-group";
          repoDetails.open = true;
          repoDetails.innerHTML = `
            <summary class="node-tree-repo-summary">
              <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
              <b>${escapeHtml(repoGroup.tree.repoLabel)}</b>
              <small>${repoGroup.models.length} models</small>
            </summary>
          `;
          const fileList = document.createElement("div");
          fileList.className = "node-tree-list node-tree-node-list";
          repoGroup.models
            .sort((left, right) => modelTreeInfo(left).fileLabel.localeCompare(modelTreeInfo(right).fileLabel, "ko"))
            .forEach(model => {
              const tree = modelTreeInfo(model);
              const packageLabel = catalogModelPackageLabel(model);
              const sizeLabel = formatBytes(model.size);
              const el = document.createElement("div");
              el.className = "nav-item palette-item node-tree-item model-tree-item";
              el.innerHTML = `
                <div class="asset-card-row">
                  <b>${escapeHtml(tree.fileLabel)}</b>
                </div>
                <span>${escapeHtml(model.path || model.name)}${packageLabel ? ` · ${escapeHtml(packageLabel)}` : ""}${sizeLabel ? ` · ${escapeHtml(sizeLabel)}` : ""}</span>
              `;
              fileList.appendChild(el);
            });
          repoDetails.appendChild(fileList);
          repoList.appendChild(repoDetails);
        });
      details.appendChild(repoList);
      root.appendChild(details);
    });
}

function renderExplorerStatus() {
  const status = document.getElementById("explorerStatus");
  const dot = document.getElementById("explorerStatusDot");
  const label = document.getElementById("explorerStatusLabel");
  const scanned = document.getElementById("explorerLastScanned");
  if (!status || !dot || !label || !scanned) return;
  status.classList.toggle("is-connected", explorerState.connected);
  status.classList.toggle("is-mock", !explorerState.connected);
  dot.classList.toggle("muted", !explorerState.connected);
  label.textContent = explorerState.connected
    ? "catalog.py 조회 완료"
    : explorerState.statusMessage || "로컬 툴 연결 안 됨";
  scanned.textContent = explorerState.lastScannedAt
    ? `${explorerState.connected ? "마지막 조회" : "마지막 시도"} ${new Date(explorerState.lastScannedAt).toLocaleString("ko-KR")}`
    : "catalog.py 실행 대기";

  const summary = document.getElementById("localToolSummary");
  const summaryDot = document.getElementById("localToolStatusDot");
  const summaryLabel = document.getElementById("localToolStatusLabel");
  const summaryBase = document.getElementById("localToolBaseLabel");
  summary?.classList.toggle("is-connected", explorerState.connected);
  summaryDot?.classList.toggle("muted", !explorerState.connected);
  if (summaryBase) summaryBase.textContent = `${LOCAL_TOOL_BASE_URL.host} · workflows`;
  if (summaryLabel) {
    summaryLabel.textContent = explorerState.connected
      ? "로컬 툴 연결됨"
      : explorerState.statusMessage || "로컬 브리지 실행 필요";
  }
}

async function refreshLocalExplorer(options = {}) {
  const requestId = ++localToolCatalogRequestSequence;
  const requestContext = captureLocalToolContext();
  explorerState.lastScannedAt = new Date().toISOString();
  const button = document.getElementById("refreshExplorerBtn");
  if (button) button.disabled = true;
  renderExplorerStatus();
  const label = document.getElementById("explorerStatusLabel");
  if (label) label.textContent = "catalog.py 실행 중...";
  try {
    const response = await localToolFetch("catalog/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json().catch(() => ({}));
    if (
      requestId !== localToolCatalogRequestSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return null;
    if (!response.ok || !result.catalog) {
      throw new Error(
        response.status === 401
          ? "연결 토큰이 필요합니다"
          : result.error?.message || `HTTP ${response.status}`
      );
    }
    registerCatalog(result.catalog, "catalog.json", { silent: true });
    catalogReady = true;
    explorerState.connected = true;
    explorerState.mode = "local-tool";
    explorerState.statusMessage = null;
    explorerState.lastScannedAt = new Date().toISOString();
    persistAuxiliaryState();
    renderAll();
    if (!options.silent) {
      showToast(
        LOCAL_STUDIO_MODE
          ? `노드 목록을 새로고침했습니다: ${scriptLibrary.length}개`
          : `로컬 catalog 갱신 완료: ${scriptLibrary.length}개 노드`
      );
    }
    return true;
  } catch (error) {
    if (
      requestId !== localToolCatalogRequestSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return null;
    explorerState.connected = false;
    const errorMessage = String(error.message || "");
    explorerState.statusMessage = errorMessage.includes("토큰")
      ? "연결 토큰 입력 필요"
      : error instanceof TypeError || /failed to fetch|networkerror/i.test(errorMessage)
        ? "로컬 브리지 실행 필요"
        : "catalog 갱신 실패";
    explorerState.lastScannedAt = new Date().toISOString();
    renderExplorerStatus();
    if (!options.silent) {
      showToast(
        LOCAL_STUDIO_MODE
          ? `노드 목록 새로고침 실패: ${error.message || "조회 오류"}`
          : `로컬 툴 연결 실패: ${error.message || "연결 오류"} · python-3.10.0-embed-amd64\\python.exe studio_bridge.py를 실행해 주세요.`
      );
    }
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

window.refreshLocalExplorer = refreshLocalExplorer;

function renderAddNodeTypeSelect() {
  const select = document.getElementById("addNodeTypeSelect");
  if (!select) return;
  if (!catalogReady) {
    select.innerHTML = `<option value="">${LOCAL_STUDIO_MODE ? "노드 목록 준비 중" : "catalog 조회 필요"}</option>`;
    select.disabled = true;
    document.getElementById("addNodeBtn")?.setAttribute("disabled", "");
    return;
  }
  select.disabled = false;
  document.getElementById("addNodeBtn")?.removeAttribute("disabled");
  const previous = select.value;
  const types = [...new Map(scriptLibrary.map(script => [script.type, script])).values()];
  select.innerHTML = types.map(script => `<option value="${escapeHtml(script.type)}">${escapeHtml(script.name || script.type)} — ${escapeHtml(script.type)}</option>`).join("");
  const fallback = types.find(script => script.type === "Add")?.type || types[0]?.type || "";
  select.value = types.some(script => script.type === previous) ? previous : fallback;
}

function renderScriptLibrary() {
  const root = document.getElementById("scriptLibrary");
  root.innerHTML = "";
  if (!catalogReady) {
    root.innerHTML = `<div class="kv"><span>catalog.py 조회 후 확인된 Script 목록을 표시합니다.</span></div>`;
    return;
  }
  scriptLibrary.forEach(script => {
    const el = document.createElement("div");
    el.className = `script-card ${script.id === lastRegisteredScriptId ? "selected" : ""}`;
    const pathLabel = script.command ? ` / ${script.command}` : "";
    el.innerHTML = `<b>${escapeHtml(script.name || script.type)} · ${escapeHtml(script.version)}</b><span>${escapeHtml(script.type)} / ${escapeHtml(script.developer)} / ${escapeHtml(script.status)}${escapeHtml(pathLabel)}</span>`;
    root.appendChild(el);
  });
}

function isMarketplacePackageInstalled(pkg) {
  const isWorkspace = pkg.kind === "workflow-bundle" || Boolean(pkg.workflow);
  if (isWorkspace) return workflowStore.some(item => item.marketplacePackageId === pkg.id);
  if (LOCAL_STUDIO_MODE) {
    return installedLocalPackages.some(item => (
      item?.id === pkg.id
      && (!pkg.version || !item.version || item.version === pkg.version)
      && (!pkg.source?.sha256 || !item.sha256 || item.sha256 === pkg.source.sha256)
    ));
  }
  return downloadedMarketplacePackageIds.includes(pkg.id);
}

function renderMarketplaceNodeSelection() {
  const container = document.getElementById("marketplaceNodeSelection");
  const root = document.getElementById("marketplaceNodeOptions");
  const nodeTypesInput = document.getElementById("marketplacePackageNodeTypes");
  if (!container || !root || !nodeTypesInput) return;
  container.classList.toggle("hidden", !LOCAL_STUDIO_MODE);
  if (!LOCAL_STUDIO_MODE) return;
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

async function syncInstalledLocalPackages() {
  if (!LOCAL_STUDIO_MODE || !localToolContextId) return [];
  try {
    const response = await localToolFetch("packages");
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.packages)) {
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    }
    installedLocalPackages = result.packages;
    downloadedMarketplacePackageIds = result.packages
      .map(item => item?.id)
      .filter(Boolean);
    persistAuxiliaryState();
    renderMarketplace();
    return installedLocalPackages;
  } catch {
    // Older/offline local runtimes may not expose package registry yet.
    // Catalog, workflow editing and execution stay fully available.
    return null;
  }
}

function normalizeLocalPublishablePackage(pkg, source) {
  if (!pkg || typeof pkg !== "object") return null;
  const id = String(pkg.id || "").trim();
  if (!id || pkg.kind !== "node-pack" || source !== "custom_nodes") return null;
  const kind = "node-pack";
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
    source,
  };
}

function renderLocalPublishablePackages() {
  const select = document.getElementById("marketplaceLocalPackageSelect");
  if (!select) return;
  const previous = select.value;
  if (localPublishablePackageStatus === "loading") {
    select.innerHTML = `<option value="">로컬 패키지 목록을 불러오는 중...</option>`;
    select.disabled = true;
    return;
  }
  if (!localPublishablePackages.length) {
    select.innerHTML = `<option value="">게시할 수 있는 로컬 패키지가 없습니다.</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = [
    `<option value="">catalog 확인 노드 패키지를 선택하세요</option>`,
    ...localPublishablePackages.map(pkg => {
      const kindLabel = pkg.kind === "model-pack" ? "모델" : "노드";
      return `<option value="${escapeHtml(pkg.id)}">${escapeHtml(pkg.name)} · ${kindLabel} · 로컬 custom_nodes</option>`;
    }),
  ].join("");
  if (localPublishablePackages.some(pkg => pkg.id === previous)) {
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
      const normalized = normalizeLocalPublishablePackage(pkg, "custom_nodes");
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
  form.elements.name.value = pkg.name;
  if (pkg.version && isSemanticVersion(pkg.version)) {
    form.elements.version.value = pkg.version;
  }
  if (pkg.description) form.elements.description.value = pkg.description;
  form.elements.kind.value = pkg.kind;
  form.elements.nodeTypes.value = pkg.nodeTypes.join(", ");
  if (pkg.author && !authState.user) form.elements.author.value = pkg.author;
  renderMarketplaceNodeSelection();
}

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

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function semanticVersionParts(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isSemanticVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(String(value || ""));
}

function compareSemanticVersions(left, right) {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function pipelineToolReleaseUrl(release) {
  const resolvedRelease = release === undefined
    ? pipelineToolRelease || {
      source: "git",
      repositoryUrl: PIPELINE_TOOL_GIT_URL,
      downloadUrl: PIPELINE_TOOL_RELEASES_URL,
    }
    : release;
  if (resolvedRelease?.source !== "git") return "";
  const repositoryValue = String(
    resolvedRelease.repositoryUrl || PIPELINE_TOOL_GIT_URL
  ).trim();
  const downloadValue = String(resolvedRelease.downloadUrl || "").trim();
  if (!repositoryValue) return "";
  try {
    const repositoryUrl = new URL(repositoryValue);
    const repositoryPath = repositoryUrl.pathname
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "");
    const url = new URL(
      downloadValue
        || `https://github.com${repositoryPath}/releases/latest`
    );
    if (
      repositoryUrl.protocol !== "https:"
      || repositoryUrl.hostname.toLowerCase() !== "github.com"
      || repositoryUrl.username
      || repositoryUrl.password
      || repositoryUrl.port
      || repositoryUrl.search
      || repositoryUrl.hash
      || !/^\/[^/]+\/[^/]+$/.test(repositoryPath)
      || url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "github.com"
      || url.username
      || url.password
      || url.port
      || (
        url.pathname !== `${repositoryPath}/releases`
        && !url.pathname.startsWith(`${repositoryPath}/releases/`)
      )
    ) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function renderPipelineToolRelease() {
  const panel = document.getElementById("pipelineToolReleasePanel");
  const title = document.getElementById("pipelineToolReleaseTitle");
  const description = document.getElementById("pipelineToolReleaseDescription");
  const meta = document.getElementById("pipelineToolReleaseMeta");
  const downloadButton = document.getElementById("downloadPipelineToolBtn");
  const downloadLabel = document.getElementById("downloadPipelineToolLabel");
  const connectButton = document.getElementById("connectPlatformAccountBtn");
  if (!panel || !title || !description || !meta || !downloadButton || !downloadLabel) return;

  panel.classList.toggle("is-offline", pipelineToolReleaseStatus === "error");
  panel.classList.remove("is-update");
  if (hostedLocalConnectRequest) {
    panel.classList.remove("is-offline");
    title.textContent = "로컬 Pipeline Tool 계정 연결 요청";
    description.textContent = `${hostedLocalConnectRequest.returnOrigin}에서 시작한 요청입니다. 직접 실행한 로컬 Tool이 맞을 때만 허용하세요.`;
    meta.innerHTML = "<span>Marketplace 업로드 전용</span><span>관리자 권한 제외</span><span>최대 8시간</span>";
    downloadButton.disabled = true;
    downloadButton.classList.add("hidden");
    downloadLabel.textContent = "승인 버튼을 눌러주세요";
    if (connectButton) {
      connectButton.classList.remove("hidden", "light");
      connectButton.classList.add("primary");
      connectButton.disabled = false;
      connectButton.innerHTML = '<span class="material-symbols-outlined">verified_user</span>연결 승인';
    }
    return;
  }
  downloadButton.classList.remove("hidden");
  if (connectButton) {
    connectButton.classList.remove("primary");
    connectButton.classList.add("light");
    connectButton.disabled = false;
    connectButton.innerHTML = '<span class="material-symbols-outlined">link</span>서버 계정 연결';
  }
  connectButton?.classList.toggle(
    "hidden",
    !LOCAL_STUDIO_MODE || serverWritesEnabled()
  );

  if (pipelineToolReleaseStatus === "loading") {
    title.textContent = "Pipeline Tool Git 배포본 확인 중";
    description.textContent = "서버 확인과 관계없이 로컬 노드 탐색, 워크플로우 저장과 실행은 계속 사용할 수 있습니다.";
    meta.innerHTML = PIPELINE_TOOL_VERSION
      ? `<span>현재 v${escapeHtml(PIPELINE_TOOL_VERSION)}</span>`
      : "";
    downloadButton.disabled = false;
    downloadLabel.textContent = "GitHub Releases 열기";
    return;
  }

  if (pipelineToolReleaseStatus === "error" || !pipelineToolRelease) {
    title.textContent = LOCAL_STUDIO_MODE ? "서버 없이 로컬 모드로 실행 중" : "GitHub에서 Pipeline Tool 받기";
    description.textContent = LOCAL_STUDIO_MODE
      ? "Marketplace와 버전 확인만 잠시 사용할 수 없습니다. 편집, catalog 탐색, 저장과 main.py 실행에는 영향이 없으며 GitHub 다운로드 링크는 계속 사용할 수 있습니다."
      : "배포 파일은 중앙 서버가 아닌 GitHub Releases에서 직접 제공합니다.";
    meta.innerHTML = PIPELINE_TOOL_VERSION
      ? `<span>설치 버전 v${escapeHtml(PIPELINE_TOOL_VERSION)}</span><span>로컬 기능 정상</span>`
      : "<span>GitHub Releases</span>";
    downloadButton.disabled = false;
    downloadLabel.textContent = "GitHub Releases 열기";
    return;
  }

  const latestVersion = String(pipelineToolRelease.version || "").trim();
  const hasLatestVersion = Boolean(semanticVersionParts(latestVersion));
  const versionComparison = LOCAL_STUDIO_MODE && hasLatestVersion
    ? compareSemanticVersions(PIPELINE_TOOL_VERSION, latestVersion)
    : null;
  const updateAvailable = LOCAL_STUDIO_MODE
    && Boolean(PIPELINE_TOOL_VERSION)
    && hasLatestVersion
    && versionComparison != null
    && versionComparison < 0;
  panel.classList.toggle("is-update", updateAvailable);
  title.textContent = LOCAL_STUDIO_MODE
    ? updateAvailable
      ? `Pipeline Tool v${latestVersion} 업데이트가 있습니다`
      : hasLatestVersion
        ? `Pipeline Tool v${PIPELINE_TOOL_VERSION || latestVersion} 사용 중`
        : "Git에서 최신 Pipeline Tool 확인"
    : hasLatestVersion
      ? `Pipeline Tool v${latestVersion} · GitHub Releases`
      : "Git에서 최신 Pipeline Tool 확인";
  const releaseNotes = Array.isArray(pipelineToolRelease.releaseNotes)
    ? pipelineToolRelease.releaseNotes.filter(Boolean).join(" · ")
    : String(pipelineToolRelease.releaseNotes || "");
  description.textContent = updateAvailable
    ? `${releaseNotes || "GitHub에 새 배포본이 등록되었습니다."} 기존 workflows, custom_nodes, models 폴더는 보존한 뒤 새 버전으로 교체하세요.`
    : LOCAL_STUDIO_MODE
      ? "현재 로컬 실행기는 서버 연결 없이도 독립적으로 동작합니다. 업데이트가 필요할 때만 GitHub Releases를 확인하세요."
      : releaseNotes || "GitHub Releases에서 최신 ZIP을 받은 뒤 압축을 풀고 run_studio.bat을 실행하세요.";
  meta.innerHTML = [
    LOCAL_STUDIO_MODE && PIPELINE_TOOL_VERSION
      ? `<span>현재 v${escapeHtml(PIPELINE_TOOL_VERSION)}</span>`
      : "",
    hasLatestVersion ? `<span>최신 v${escapeHtml(latestVersion)}</span>` : "",
    "<span>GitHub Releases</span>",
    pipelineToolRelease.size
      ? `<span>${escapeHtml(formatFileSize(Number(pipelineToolRelease.size)))}</span>`
      : "",
    pipelineToolRelease.publishedAt
      ? `<span>${escapeHtml(new Date(pipelineToolRelease.publishedAt).toLocaleDateString("ko-KR"))}</span>`
      : "",
  ].filter(Boolean).join("");
  downloadButton.disabled = !pipelineToolReleaseUrl();
  downloadLabel.textContent = LOCAL_STUDIO_MODE
    ? updateAvailable ? "새 버전 GitHub에서 받기" : "GitHub Releases 열기"
    : "GitHub Releases 열기";
}

async function syncPipelineToolRelease(options = {}) {
  const requestId = ++pipelineToolReleaseRequestSequence;
  pipelineToolReleaseStatus = "loading";
  pipelineToolReleaseError = "";
  renderPipelineToolRelease();
  try {
    const response = await apiFetch("/pipeline-tool/releases/latest", {
      headers: { "Accept": "application/json" },
      authentication: "omit",
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (requestId !== pipelineToolReleaseRequestSequence) return null;
    const release = result.release || result;
    const versionIsValid = release?.version == null
      || release.version === ""
      || Boolean(semanticVersionParts(release.version));
    if (
      !response.ok
      || release?.source !== "git"
      || !versionIsValid
      || !pipelineToolReleaseUrl(release)
    ) {
      throw new Error(responseErrorMessage(response, result));
    }
    pipelineToolRelease = release;
    pipelineToolReleaseStatus = "ready";
    renderPipelineToolRelease();
    return release;
  } catch (error) {
    if (requestId !== pipelineToolReleaseRequestSequence) return null;
    pipelineToolRelease = null;
    pipelineToolReleaseStatus = "error";
    pipelineToolReleaseError = error?.name === "TimeoutError"
      ? "서버 응답 시간이 초과되었습니다."
      : String(error.message || "서버 연결 오류");
    renderPipelineToolRelease();
    if (options.notify && !LOCAL_STUDIO_MODE) {
      showToast(`Pipeline Tool 배포 정보 조회 실패: ${pipelineToolReleaseError}`);
    }
    return false;
  }
}

function downloadLatestPipelineTool() {
  const href = pipelineToolReleaseUrl();
  if (!href) return;
  const popup = window.open(href, "_blank", "noopener,noreferrer");
  if (popup) popup.opener = null;
}

function platformSiteUrl() {
  try {
    return new URL(MARKETPLACE_SITE_URL);
  } catch {
    return null;
  }
}

function openMarketplaceSite() {
  const siteUrl = platformSiteUrl();
  if (!siteUrl) {
    showToast("운영 Marketplace 사이트 주소가 설정되지 않았습니다.");
    return;
  }
  const popup = window.open(siteUrl.toString(), "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
  } else {
    globalThis.location.assign(siteUrl.toString());
  }
}

function isLoopbackOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname.toLowerCase())
      && Boolean(parsed.port)
      && parsed.pathname === "/"
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secureRandomBase64Url(byteLength = 32) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("보안 연결 코드를 만들 수 없는 브라우저입니다.");
  }
  return base64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("PKCE 연결을 지원하지 않는 브라우저입니다.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

async function openPlatformAccountConnect() {
  if (!LOCAL_STUDIO_MODE) return;
  const siteUrl = platformSiteUrl();
  if (!siteUrl || siteUrl.protocol !== "https:") {
    showToast("연결할 HTTPS Marketplace 서버 주소가 설정되지 않았습니다.");
    return;
  }
  try {
    const verifier = secureRandomBase64Url();
    const state = secureRandomBase64Url();
    const challenge = await pkceChallenge(verifier);
    sessionStorage.setItem(LOCAL_CONNECT_ATTEMPT_SESSION_KEY, JSON.stringify({
      verifier,
      state,
      returnOrigin: globalThis.location.origin,
      createdAt: Date.now(),
    }));
    siteUrl.searchParams.set("connectLocalOrigin", globalThis.location.origin);
    siteUrl.searchParams.set(LOCAL_CONNECT_CHALLENGE_PARAMETER, challenge);
    siteUrl.searchParams.set("connectState", state);
    // Reuse this tab so loopback sessionStorage containing the verifier is
    // available after the hosted site redirects back to the local Studio.
    globalThis.location.assign(siteUrl.toString());
  } catch (error) {
    sessionStorage.removeItem(LOCAL_CONNECT_ATTEMPT_SESSION_KEY);
    showToast(`Marketplace 계정 연결 준비 실패: ${error.message}`);
  }
}

function completeHostedLocalConnectRequest() {
  if (LOCAL_STUDIO_MODE) return false;
  const pageUrl = new URL(globalThis.location.href);
  const returnOrigin = pageUrl.searchParams.get("connectLocalOrigin");
  const challenge = pageUrl.searchParams.get(LOCAL_CONNECT_CHALLENGE_PARAMETER);
  const state = pageUrl.searchParams.get("connectState");
  if (!returnOrigin) return false;
  if (
    !isLoopbackOrigin(returnOrigin)
    || !/^[A-Za-z0-9_-]{43}$/.test(challenge || "")
    || !/^[A-Za-z0-9_-]{22,128}$/.test(state || "")
  ) {
    showToast("허용되지 않은 로컬 Tool 주소입니다.");
    return false;
  }
  if (!serverWritesEnabled()) {
    showToast("이 사이트에 로그인한 뒤 로컬 Tool 계정 연결을 다시 실행해 주세요.");
    return false;
  }
  hostedLocalConnectRequest = { returnOrigin, challenge, state };
  renderPipelineToolRelease();
  showToast("로컬 Tool 연결 요청을 확인하고 직접 허용해 주세요.");
  return true;
}

async function approveHostedLocalConnectRequest() {
  const request = hostedLocalConnectRequest;
  if (!request || LOCAL_STUDIO_MODE) return false;
  const connectButton = document.getElementById("connectPlatformAccountBtn");
  if (connectButton) connectButton.disabled = true;
  try {
    const response = await apiFetch("/local-connect/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge: request.challenge,
        state: request.state,
        returnOrigin: request.returnOrigin,
      }),
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.code !== "string" || !result.code) {
      throw new Error(responseErrorMessage(response, result));
    }
    const target = new URL(request.returnOrigin);
    target.hash = new URLSearchParams({
      [LOCAL_CONNECT_HASH_PARAMETER]: result.code,
      [LOCAL_CONNECT_STATE_PARAMETER]: request.state,
    }).toString();
    hostedLocalConnectRequest = null;
    globalThis.location.replace(target.toString());
    return true;
  } catch (error) {
    if (connectButton) connectButton.disabled = false;
    showToast(`로컬 Tool 계정 연결 실패: ${error.message || "서버 연결 오류"}`);
    return false;
  }
}

async function consumeLocalConnectCode() {
  if (!LOCAL_STUDIO_MODE || !globalThis.location.hash) return false;
  const params = new URLSearchParams(globalThis.location.hash.slice(1));
  const code = params.get(LOCAL_CONNECT_HASH_PARAMETER);
  const state = params.get(LOCAL_CONNECT_STATE_PARAMETER);
  if (!code) return false;
  params.delete(LOCAL_CONNECT_HASH_PARAMETER);
  params.delete(LOCAL_CONNECT_STATE_PARAMETER);
  const cleanUrl = `${globalThis.location.pathname}${globalThis.location.search}${params.toString() ? `#${params}` : ""}`;
  globalThis.history.replaceState(null, "", cleanUrl);
  let attempt;
  try {
    attempt = JSON.parse(sessionStorage.getItem(LOCAL_CONNECT_ATTEMPT_SESSION_KEY) || "null");
  } catch {
    attempt = null;
  }
  sessionStorage.removeItem(LOCAL_CONNECT_ATTEMPT_SESSION_KEY);
  if (
    !attempt
    || attempt.state !== state
    || attempt.returnOrigin !== globalThis.location.origin
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(String(attempt.verifier || ""))
    || !Number.isFinite(attempt.createdAt)
    || Date.now() - attempt.createdAt > 10 * 60 * 1000
  ) {
    showToast("Marketplace 계정 연결 상태가 일치하지 않습니다. 로컬 Tool에서 다시 시작해 주세요.");
    return false;
  }
  try {
    const response = await apiFetch("/local-connect/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        verifier: attempt.verifier,
        state: attempt.state,
        returnOrigin: attempt.returnOrigin,
      }),
      authentication: "omit",
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(responseErrorMessage(response, result));
    }
    // The loopback bridge captures the delegated token in process memory and
    // removes it from the browser response. Never persist it in web storage.
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    if (result.user) rememberAuthenticatedIdentity(result.user);
    showToast("Marketplace 서버 계정을 로컬 Tool에 연결했습니다.");
    // Restart once so account-scoped local storage is selected before the
    // editor restores its draft. The bridge keeps the delegated credential.
    globalThis.location.reload();
    return true;
  } catch (error) {
    showToast(`Marketplace 계정 연결 실패: ${error.message || "서버 연결 오류"} · 로컬 기능은 계속 사용할 수 있습니다.`);
    return false;
  }
}

async function logoutPlatformAccount() {
  if (!LOCAL_STUDIO_MODE || !authState.user) return false;
  const button = document.getElementById("logoutPlatformAccountBtn");
  if (button) button.disabled = true;
  try {
    const response = await apiFetch("/local-connect/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      authentication: "omit",
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseErrorMessage(response, result));
    authGeneration += 1;
    authIdentityEpoch += 1;
    Object.assign(authState, {
      status: "anonymous",
      mode: "required",
      user: null,
    });
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_IDENTITY_CACHE_KEY);
    establishStorageScope(authState);
    renderStudioContext();
    showToast("Marketplace 계정에서 로그아웃했습니다.");
    return true;
  } catch (error) {
    showToast(`로그아웃 실패: ${error.message || "서버 연결 오류"}`);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function handlePlatformAccountConnect() {
  if (hostedLocalConnectRequest) {
    void approveHostedLocalConnectRequest();
  } else {
    void openPlatformAccountConnect();
  }
}

function downloadBlob(filename, data, type = "application/json") {
  const blob = new Blob([data], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function filenameFromContentDisposition(value, fallback) {
  const header = String(value || "");
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return fallback;
    }
  }
  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  return asciiMatch ? asciiMatch[1] : fallback;
}

async function exportWorkspaceBundle() {
  const button = document.getElementById("exportWorkspaceBtn");
  if (button) button.disabled = true;
  try {
    if (isWorkflowDirty) {
      await saveWorkflowToServer({ silent: true });
    }
    const response = await localToolFetch("workspace/export", {
      method: "GET",
      headers: { Accept: "application/zip" }
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(responseErrorMessage(response, result) || "내보내기 실패");
    }
    const blob = await response.blob();
    const fallbackName = `${safeId(currentWorkflowFileName || currentWorkflow?.name || "workspace")}.zip`;
    const fileName = filenameFromContentDisposition(
      response.headers.get("Content-Disposition"),
      fallbackName
    );
    downloadBlob(fileName, blob, "application/zip");
    showToast(`내보내기 ZIP을 만들었습니다: ${fileName}`);
  } catch (error) {
    showToast(`내보내기 실패: ${errorMessage(error, "로컬 툴 연결 오류")}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function importWorkspaceBundle(file) {
  if (!file) return;
  if (!confirm("내보낸 ZIP의 파일을 현재 Pipeline Tool 폴더에 복구합니다.\n같은 위치의 파일은 덮어쓸 수 있습니다. 계속할까요?")) {
    return;
  }
  const button = document.getElementById("importWorkspaceBtn");
  if (button) button.disabled = true;
  try {
    const response = await localToolFetch("workspace/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        Accept: "application/json"
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result?.error?.message || "불러오기 실패");
    }
    showToast(`불러오기 완료: ${result.restoredCount || 0}개 파일 복구`);
    try {
      await refreshLocalExplorer({ silent: true });
    } catch {
      await syncServerWorkflows({ notify: false }).catch(() => {});
    }
    await syncServerWorkflows({ loadCurrent: true, notify: false });
  } catch (error) {
    showToast(`불러오기 실패: ${error.message || "ZIP 복구 오류"}`);
  } finally {
    if (button) button.disabled = false;
  }
}

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

function syncMarketplaceSourceFields() {
  const sourceType = document.querySelector('input[name="sourceType"]:checked')?.value || "git";
  const localPackageField = document.getElementById("marketplaceLocalPackageField");
  const localPackageSelect = document.getElementById("marketplaceLocalPackageSelect");
  const gitField = document.getElementById("marketplaceGitField");
  const zipField = document.getElementById("marketplaceZipField");
  const gitInput = document.getElementById("marketplaceGitSourcePath");
  const zipInput = document.getElementById("marketplaceZipFile");
  localPackageField?.classList.toggle("hidden", sourceType !== "local-package");
  gitField?.classList.toggle("hidden", sourceType !== "git");
  zipField?.classList.toggle("hidden", sourceType !== "zip");
  if (localPackageSelect) localPackageSelect.required = sourceType === "local-package";
  if (gitInput) gitInput.required = sourceType === "git";
  const kindInput = document.getElementById("marketplacePackageKind");
  if (kindInput) kindInput.disabled = sourceType === "local-package";
  const existing = editingModulePackageId
    ? registeredMarketplacePackages.find(item => item.id === editingModulePackageId && !item.workflow)
    : null;
  if (zipInput) zipInput.required = sourceType === "zip" && existing?.source?.type !== "zip";
  const zipHelp = document.getElementById("marketplaceZipHelp");
  if (zipHelp) {
    zipHelp.textContent = sourceType === "zip" && existing?.source?.type === "zip"
      ? `새 ZIP을 선택하지 않으면 서버의 기존 ${existing.source.fileName} 파일을 유지합니다. 최대 ${formatFileSize(MAX_MARKETPLACE_ZIP_BYTES)}.`
      : `ZIP 본문을 Marketplace 서버에 업로드합니다. 최대 ${formatFileSize(MAX_MARKETPLACE_ZIP_BYTES)}.`;
  }
  if (
    sourceType === "local-package"
    && LOCAL_STUDIO_MODE
    && localPublishablePackageStatus === "idle"
  ) {
    void syncLocalPublishablePackages({ notify: true });
  }
}

function isValidGitSourcePath(value) {
  if (!value || /[\u0000-\u001f]/.test(value) || value.length > 2048) return false;
  const scpLikeMatch = value.match(/^git@([^:/\s]+):([^\s]+)$/i);
  if (scpLikeMatch) {
    return !/[?#\\]/.test(scpLikeMatch[2])
      && !scpLikeMatch[2].split("/").some(segment => segment === "." || segment === "..");
  }
  try {
    const url = new URL(value);
    if (!["https:", "ssh:"].includes(url.protocol) || !url.hostname || url.password || url.search || url.hash) return false;
    return url.protocol === "ssh:" ? (!url.username || url.username === "git") : !url.username;
  } catch {
    return false;
  }
}

async function registerMarketplacePackage(event) {
  event.preventDefault();
  if (!requireServerWriteAccess()) return;
  const form = event.currentTarget;
  const error = document.getElementById("marketplaceRegisterError");
  const sourceType = form.elements.sourceType.value;
  const name = form.elements.name.value.trim();
  const version = form.elements.version.value.trim();
  const description = form.elements.description.value.trim();
  const nodeTypes = [...new Set(
    String(form.elements.nodeTypes?.value || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  )];
  const author = authState.user?.displayName || form.elements.author?.value.trim() || localAuthorProfile;
  const kind = form.elements.kind?.value === "model-pack" ? "model-pack" : "node-pack";
  const gitSourcePath = form.elements.gitSourcePath.value.trim();
  const zipFile = form.elements.zipFile.files?.[0];
  const localPackageId = String(form.elements.localPackageId?.value || "").trim();
  const selectedLocalPackage = localPublishablePackages.find(pkg => pkg.id === localPackageId) || null;
  const editingPackage = editingModulePackageId
    ? registeredMarketplacePackages.find(item => item.id === editingModulePackageId && !item.workflow)
    : null;
  const existing = sourceType === "local-package"
    ? registeredMarketplacePackages.find(item => item.id === localPackageId && !item.workflow)
    : editingPackage;
  let message = "";

  if (!name) message = "패키지명을 입력해 주세요.";
  else if (!isSemanticVersion(version)) message = "버전은 1.0.0과 같은 Semantic Version 형식으로 입력해 주세요.";
  else if (!description) message = "패키지 설명을 입력해 주세요.";
  else if (!author) message = "작성자를 입력해 주세요.";
  else if (sourceType === "local-package" && (!LOCAL_STUDIO_MODE || !selectedLocalPackage)) {
    message = "catalog에서 확인된 이 PC 노드 패키지를 선택해 주세요.";
  } else if (sourceType === "local-package" && kind !== selectedLocalPackage.kind) {
    message = "이 PC 패키지의 종류는 변경할 수 없습니다.";
  } else if (
    sourceType === "local-package"
    && !nodeTypes.every(nodeType => selectedLocalPackage.nodeTypes.includes(nodeType))
  ) {
    message = "선택한 로컬 패키지에서 확인되지 않은 노드 타입은 게시할 수 없습니다.";
  } else if (sourceType === "git" && !gitSourcePath) {
    message = "Git 소스경로를 입력해 주세요.";
  } else if (sourceType === "git" && !isValidGitSourcePath(gitSourcePath)) {
    message = "HTTPS, SSH 또는 git@ 형식의 Git 주소를 입력해 주세요. URL에 계정 정보나 query를 넣을 수 없습니다.";
  } else if (sourceType === "zip" && !zipFile && existing?.source?.type !== "zip") {
    message = "등록할 ZIP 파일을 선택해 주세요.";
  } else if (sourceType === "zip" && zipFile && !/\.zip$/i.test(zipFile.name)) {
    message = "확장자가 .zip인 파일만 선택할 수 있습니다.";
  } else if (sourceType === "zip" && zipFile && zipFile.size > MAX_MARKETPLACE_ZIP_BYTES) {
    message = `ZIP 파일은 ${formatFileSize(MAX_MARKETPLACE_ZIP_BYTES)} 이하여야 합니다.`;
  }

  if (message) {
    if (error) error.textContent = message;
    return;
  }

  const source = sourceType === "git"
    ? { type: "git", url: gitSourcePath }
    : sourceType === "zip"
      ? { type: "zip", fileName: zipFile?.name || existing.source.fileName }
      : null;
  const packageId = sourceType === "local-package"
    ? selectedLocalPackage.id
    : existing?.id || serverWorkflowId(`module_${Date.now()}_${safeId(name)}`);
  const payload = {
    id: packageId,
    name,
    version,
    description,
    kind,
    author,
    authMode: "unverified-local-profile",
    registrationOnly: true,
    nodeTypes,
    ...(source ? { source } : {})
  };
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  if (error) {
    error.textContent = sourceType === "local-package"
      ? "로컬 브리지가 안전한 소스 ZIP을 만들어 Marketplace에 게시 중입니다..."
      : sourceType === "zip" && zipFile
        ? `ZIP 업로드 중 · ${formatFileSize(zipFile.size)}`
        : "Marketplace 서버에 저장 중입니다...";
  }
  marketplaceModuleRequestSequence += 1;
  const requestIdentityEpoch = authIdentityEpoch;
  const requestStorageScope = activeStorageScope;
  const requestToolContext = sourceType === "local-package"
    ? captureLocalToolContext()
    : null;
  try {
    const headers = {};
    if (existing?.revision) headers["If-Match"] = existing.revision;
    let body;
    if (sourceType === "local-package") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        name,
        version,
        description,
        kind,
        nodeTypes,
        author,
      });
    } else if (sourceType === "zip" && zipFile) {
      headers["Content-Type"] = "application/zip";
      headers["X-InfraX-Package-Metadata"] = encodeURIComponent(JSON.stringify(payload));
      body = zipFile;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    }
    const response = sourceType === "local-package"
      ? await localToolFetch(`packages/${encodeURIComponent(packageId)}/publish`, {
          method: "PUT",
          headers,
          body,
        })
      : await apiFetch(`/marketplace/modules/${encodeURIComponent(packageId)}`, {
          method: "PUT",
          headers,
          body,
        });
    const result = await response.json().catch(() => ({}));
    if (!requestContextIsCurrent(requestIdentityEpoch, requestStorageScope)) return;
    if (requestToolContext && !isCurrentLocalToolContext(requestToolContext)) return;
    if (!response.ok || !result.package) {
      const detail = result.currentRevision
        ? `${result.error || "revision conflict"} (${result.currentRevision})`
        : result.error?.message || responseErrorMessage(response, result);
      throw new Error(detail);
    }
    const savedPackage = { ...result.package, registrationOnly: true };
    registeredMarketplacePackages = [
      savedPackage,
      ...registeredMarketplacePackages.filter(item => item.id !== savedPackage.id),
    ];
    localAuthorProfile = savedPackage.author || author;
    editingModulePackageId = null;
    marketplaceTab = savedPackage.kind === "model-pack" ? "model" : "module";
    moduleRegisterOpen = false;
    persistAuxiliaryState();
    form.reset();
    syncMarketplaceSourceFields();
    renderStudioContext();
    renderMarketplace();
    await syncMarketplaceModulesFromServer();
    if (error) error.textContent = "";
    showToast(`${name} 패키지를 Marketplace 서버에 저장했습니다.`);
  } catch (saveError) {
    if (error) error.textContent = `서버 등록 실패: ${saveError.message || "연결 오류"}`;
    showToast(`${marketplaceTargetLabel(marketplaceTab)} 등록 실패: ${saveError.message || "서버 연결 오류"}`);
  } finally {
    if (submitButton) submitButton.disabled = !serverWritesEnabled();
  }
}

function setMarketplaceTab(tab) {
  marketplaceTab = ["module", "model"].includes(tab) ? tab : "workspace";
  moduleRegisterOpen = false;
  editingModulePackageId = null;
  renderMarketplace();
  renderSidebarMarketplace();
}

function openMarketplaceView(options = {}) {
  if (options.fullList) marketplaceListExpanded = true;
  renderStudioContext();
  renderMarketplace();
  renderPipelineToolRelease();
  document.querySelector(".app")?.classList.add("hidden");
  document.getElementById("marketplaceView")?.classList.remove("hidden");
  void syncMarketplaceFromServer({ notify: true });
  void syncPipelineToolRelease({ notify: !LOCAL_STUDIO_MODE });
  if (LOCAL_STUDIO_MODE) void syncInstalledLocalPackages();
}

function closeMarketplaceView() {
  editingModulePackageId = null;
  moduleRegisterOpen = false;
  document.getElementById("marketplaceView")?.classList.add("hidden");
  document.querySelector(".app")?.classList.remove("hidden");
}

window.closeMarketplaceView = closeMarketplaceView;
window.setMarketplaceTab = setMarketplaceTab;

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

function renderNodes() {
  nodeLayer.innerHTML = "";
  currentWorkflow.nodes.forEach(node => {
    const missingFromCatalog = isNodeMissingFromCatalog(node);
    const el = document.createElement("article");
    el.className = `node ${node.run_status || ""} ${node.id === selectedNodeId ? "selected" : ""} ${missingFromCatalog ? "missing-node" : ""}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${node.pos[0]}px`;
    el.style.top = `${node.pos[1]}px`;
    el.style.width = `${node.size[0]}px`;
    el.style.minHeight = `${Math.max(node.size[1], 82)}px`;

    const badgeLabel = node.type === "InputInt" ? "input_int" : node.type === "OutputPrint" ? "output_print" : node.type.toLowerCase();
    const badge = `
      <div class="node-badge">
        <span>${missingFromCatalog ? "⚠ catalog 미확인" : escapeHtml(badgeLabel)}</span>
        <span class="node-badge-actions">
          <button type="button" title="노드 복제" onclick="event.stopPropagation(); duplicateNode(${inlineJson(node.id)})">⧉</button>
          <button class="danger" type="button" title="노드 삭제" onclick="event.stopPropagation(); deleteNode(${inlineJson(node.id)})">×</button>
        </span>
      </div>
    `;
    const inputs = (node.inputs || []).map((input, idx) => `
      <div class="port-row input ${isPendingPort(node.id, "input", idx) ? "pending" : ""}" data-port-kind="input" data-port-index="${idx}">
        <span class="port ${input.type === "*" ? "type-star" : ""}"></span>
        ${escapeHtml(input.name)}
      </div>
    `).join("");
    const widgets = renderWidgets(node);
    const outputs = (node.outputs || []).map((output, idx) => `
      <div class="port-row output ${isPendingPort(node.id, "output", idx) ? "pending" : ""}" data-port-kind="output" data-port-index="${idx}">
        ${escapeHtml(output.type === "INT" ? "정수" : output.type)}
        <span class="port"></span>
      </div>
    `).join("");

    el.innerHTML = `
      ${badge}
      <div class="node-head" title="${escapeHtml(`${displayNodeTitle(node)} · type ${node.type}`)}">
        <span class="node-dot"></span>
        <span class="node-title">${escapeHtml(displayNodeTitle(node))}</span>
        <span class="node-type-chip">${escapeHtml(node.type)}</span>
      </div>
      <div class="node-body">
        ${widgets ? `<div class="node-widgets">${widgets}</div>` : ""}
        ${inputs ? `<div class="node-inputs">${inputs}</div>` : ""}
        ${outputs ? `<div class="node-outputs">${outputs}</div>` : ""}
      </div>
    `;
    el.addEventListener("click", () => {
      if (!pendingLinkPort && !pendingLinkReconnect) {
        selectedNodeId = node.id;
        selectedLinkId = null;
        renderAll();
      }
  });
  el.querySelector(".node-badge").addEventListener("pointerdown", event => event.stopPropagation());
  el.querySelector(".node-head").addEventListener("pointerdown", (event) => {
    clearPendingLinkPort();
    clearPendingLinkReconnect();
    beginNodeDrag(event, node);
  });
    el.querySelectorAll(".port-row.output").forEach(row => {
      row.addEventListener("click", event => handlePortClick(event, node.id, "output", Number(row.dataset.portIndex)));
    });
    el.querySelectorAll(".port-row.input").forEach(row => {
      row.addEventListener("click", event => handlePortClick(event, node.id, "input", Number(row.dataset.portIndex)));
    });
    nodeLayer.appendChild(el);
  });
}

function isPendingPort(nodeId, kind, index) {
  return (pendingLinkPort?.nodeId === nodeId && pendingLinkPort?.kind === kind && pendingLinkPort?.index === index)
    || (pendingLinkReconnect?.origin?.nodeId === nodeId && pendingLinkReconnect?.origin?.kind === kind && pendingLinkReconnect?.origin?.index === index);
}

function renderLinks() {
  linksSvg.innerHTML = "";
  linkControlLayer.innerHTML = "";
  currentWorkflow.links.forEach(link => {
    const [linkId, fromNodeId, fromSlot, toNodeId, toSlot] = link;
    const from = getPortCenter(fromNodeId, "output", fromSlot);
    const to = getPortCenter(toNodeId, "input", toSlot);
    if (!from || !to) return;
    const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`);
    const isReconnectMoving = pendingLinkReconnect?.linkId === linkId;
    path.setAttribute("class", `link-path ${selectedLinkId === linkId ? "selected" : ""} ${isReconnectMoving ? "dim" : ""}`);
    path.addEventListener("click", event => {
      event.stopPropagation();
      clearPendingLinkPort();
      clearPendingLinkReconnect();
      selectedLinkId = linkId;
      selectedNodeId = null;
      renderAll();
    });
    linksSvg.appendChild(path);
    if (selectedLinkId === linkId) {
      const mid = cubicPoint(from, { x: from.x + dx, y: from.y }, { x: to.x - dx, y: to.y }, to, 0.5);
      const button = document.createElement("button");
      button.className = "link-delete-btn";
      button.type = "button";
      button.title = "링크 삭제";
      button.textContent = "×";
      button.style.position = "absolute";
      button.style.left = `${mid.x - 12}px`;
      button.style.top = `${mid.y - 11}px`;
      button.style.pointerEvents = "auto";
      button.addEventListener("click", event => {
        event.stopPropagation();
        deleteLink(linkId);
      });
      linkControlLayer.appendChild(button);
    }
  });
  if (pendingLinkPort?.pointer) {
    let from = null;
    let to = null;
    if (pendingLinkPort.kind === "output") {
      from = getPortCenter(pendingLinkPort.nodeId, "output", pendingLinkPort.index);
      to = pendingLinkPort.pointer;
    } else {
      from = pendingLinkPort.pointer;
      to = getPortCenter(pendingLinkPort.nodeId, "input", pendingLinkPort.index);
    }
    if (from && to) {
      const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`);
      path.setAttribute("class", "temp-link");
      linksSvg.appendChild(path);
    }
  }
  if (pendingLinkReconnect?.pointer) {
    const link = currentWorkflow.links.find(item => item[0] === pendingLinkReconnect.linkId);
    let from = null;
    let to = null;
    if (pendingLinkReconnect.mode === "reconnect-target") {
      from = getPortCenter(link?.[1], "output", link?.[2]);
      to = pendingLinkReconnect.pointer;
    } else {
      from = pendingLinkReconnect.pointer;
      to = getPortCenter(link?.[3], "input", link?.[4]);
    }
    if (from && to) {
      const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`);
      path.setAttribute("class", "temp-link");
      linksSvg.appendChild(path);
    }
  }
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

function getPortCenter(nodeId, kind, index) {
  const escapedNodeId = globalThis.CSS?.escape
    ? CSS.escape(String(nodeId))
    : String(nodeId).replace(/["\\]/g, "\\$&");
  const nodeEl = nodeLayer.querySelector(`[data-node-id="${escapedNodeId}"]`);
  if (!nodeEl) return null;
  const portRow = nodeEl.querySelector(`[data-port-kind="${kind}"][data-port-index="${index}"]`);
  if (!portRow) return null;
  const port = portRow.querySelector(".port");
  const nodeRect = port.getBoundingClientRect();
  const shellRect = canvasShell.getBoundingClientRect();
  return {
    x: (nodeRect.left + nodeRect.width / 2 - shellRect.left - worldTransform.x) / worldTransform.scale,
    y: (nodeRect.top + nodeRect.height / 2 - shellRect.top - worldTransform.y) / worldTransform.scale
  };
}

function renderInspector() {
  if (selectedLinkId != null) {
    const link = currentWorkflow.links.find(l => l[0] === selectedLinkId);
    inspectorTitle.textContent = link ? `Link ${selectedLinkId}` : "링크를 찾을 수 없습니다";
    inspectorSubtitle.textContent = link ? `${describeLink(link)}` : "삭제되었거나 JSON이 변경되었습니다.";
    selectedInfo.textContent = pendingLinkReconnect
      ? `링크 재연결 대기: ${pendingLinkReconnect.expectedKind}`
      : (link ? `link #${selectedLinkId}` : "선택 없음");
    nodeDetails.innerHTML = link ? `
      <h2>Selected Link</h2>
      <div class="kv-list">
        <div class="kv"><b>source</b><br><span>${escapeHtml(describeEndpoint(link[1], "outputs", link[2]))}</span></div>
        <div class="kv"><b>target</b><br><span>${escapeHtml(describeEndpoint(link[3], "inputs", link[4]))}</span></div>
        <div class="kv"><b>type</b><br><span>${escapeHtml(link[5])}</span></div>
      </div>
      <div class="mini-actions">
        <button class="btn light" onclick="deleteLink(${inlineJson(selectedLinkId)})">링크 삭제</button>
      </div>
    ` : "";
    return;
  }
  const node = currentWorkflow.nodes.find(n => n.id === selectedNodeId);
  if (!node) {
    inspectorTitle.textContent = "노드를 선택하세요";
    inspectorSubtitle.textContent = "캔버스에서 노드를 클릭하면 상세 설정이 표시됩니다.";
    selectedInfo.textContent = pendingLinkPort ? `연결 대기: ${pendingLinkPort.kind}` : "선택 없음";
    nodeDetails.innerHTML = `<div class="kv"><span>노드 선택 후 inputs, outputs, 노드 내부 설정값, compatible scripts를 확인할 수 있습니다.</span></div>`;
    return;
  }

  inspectorTitle.textContent = displayNodeTitle(node);
  inspectorSubtitle.textContent = `node id ${node.id} · type ${node.type}`;
  selectedInfo.textContent = pendingLinkPort
    ? `연결 대기: ${displayNodeTitle(node)} [${node.type}].${pendingLinkPort.kind}`
    : `${displayNodeTitle(node)} [${node.type}] #${node.id}`;
  const compatible = scriptLibrary.filter(s => s.type === node.type);
  const selectedScript = compatible.find(s => s.id === node.script_id) || compatible[0];
  const missingFromCatalog = isNodeMissingFromCatalog(node);
  const marketplaceCandidate = missingFromCatalog ? marketplacePackageForNode(node) : null;

  nodeDetails.innerHTML = `
    ${missingFromCatalog ? `
      <div class="missing-node-alert">
        <span class="material-symbols-outlined">warning</span>
        <div>
          <b>현재 PC의 catalog.json에서 확인되지 않은 노드입니다.</b>
          <span>${marketplaceCandidate
            ? `${escapeHtml(marketplaceCandidate.name)} Marketplace 항목이 ${escapeHtml(node.type)} 타입을 제공합니다.`
            : `Marketplace에서 ${escapeHtml(node.type)} 타입을 제공하는 모듈을 확인하거나 로컬 catalog를 다시 조회하세요.`}</span>
        </div>
        <button class="btn light" type="button" onclick="openMarketplaceForMissingNode(${inlineJson(node.id)})">
          ${marketplaceCandidate ? "다운로드 항목 보기" : "Marketplace에서 찾기"}
        </button>
      </div>
    ` : ""}
    <h2>Selected Script</h2>
    <div class="field">
      <label>Script Library</label>
      <select id="scriptSelect" onchange="changeNodeScript(${inlineJson(node.id)}, this.value)">
        ${compatible.map(s => `<option value="${escapeHtml(s.id)}" ${selectedScript?.id === s.id ? "selected" : ""}>${escapeHtml(s.name || s.type)} / ${escapeHtml(s.version)} / ${escapeHtml(s.developer)} / ${escapeHtml(s.status)}</option>`).join("")}
      </select>
    </div>
    <div class="compat">${renderCompatibility(node, selectedScript)}</div>
    <div class="json-contract-note">
      <b>Runner JSON 계약</b>
      <span>내보내기에는 name, type, node_ref와 아래 input/output parameter가 포함됩니다. 실행 경로와 명령은 PC Explorer의 신뢰된 catalog에서 해석합니다.</span>
    </div>
    <h2 style="margin-top:18px;">Inputs</h2>
    <div class="kv-list">${renderPorts(node, "inputs")}</div>
    <h2 style="margin-top:18px;">Outputs</h2>
    <div class="kv-list">${renderPorts(node, "outputs")}</div>
    <h2 style="margin-top:18px;">노드 내부 설정값</h2>
    <div class="kv-list">${renderWidgetEditors(node)}</div>
  `;
}

function renderCompatibility(node, script) {
  if (!script) return `<div class="compat-row"><span class="status-dot bad"></span>호환 가능한 Script가 없습니다.</div>`;
  const inputRows = (node.inputs || []).map(input => {
    const ok = script.inputs.some(si => si.name === input.name && (si.type === input.type || si.type === "*" || input.type === "*"));
    return `<div class="compat-row"><span class="status-dot ${ok ? "" : "bad"}"></span>input ${escapeHtml(input.name)}: ${ok ? "호환" : "불일치"}</div>`;
  });
  const outputRows = (node.outputs || []).map(output => {
    const ok = script.outputs.some(so => so.name === output.name || so.type === output.type || so.type === "*");
    return `<div class="compat-row"><span class="status-dot ${ok ? "" : "bad"}"></span>output ${escapeHtml(output.name)}: ${ok ? "호환" : "불일치"}</div>`;
  });
  return [...inputRows, ...outputRows].join("") || `<div class="compat-row"><span class="status-dot"></span>포트 없는 노드입니다.</div>`;
}

function describeEndpoint(nodeId, key, index) {
  const node = currentWorkflow.nodes.find(n => n.id === nodeId);
  const port = node?.[key]?.[index];
  const nodeLabel = node ? `${displayNodeTitle(node)} [${node.type}]` : `node ${nodeId}`;
  return `${nodeLabel}.${port?.name || index} (${port?.type || "unknown"})`;
}

function describeLink(link) {
  return `${describeEndpoint(link[1], "outputs", link[2])} → ${describeEndpoint(link[3], "inputs", link[4])}`;
}

function renderPorts(node, key) {
  const ports = node[key] || [];
  if (!ports.length) return UI.emptyKv(`${key} 없음`);
  return ports.map((port, index) => {
    const linkInfo = key === "inputs"
      ? findInputLink(port.link)
      : findOutputLinks(node.id, index);
    return UI.kv(`${port.name} · ${port.type}`, UI.escapeHtml(linkInfo));
  }).join("");
}

function findInputLink(linkId) {
  if (linkId == null) return "연결 없음";
  const link = currentWorkflow.links.find(l => l[0] === linkId);
  if (!link) return `link ${linkId} 누락`;
  const source = currentWorkflow.nodes.find(n => n.id === link[1]);
  const output = source?.outputs?.[link[2]];
  const sourceLabel = source ? `${displayNodeTitle(source)} [${source.type}]` : `node ${link[1]}`;
  return `← ${sourceLabel}.${output?.name || link[2]} / link ${linkId}`;
}

function findOutputLinks(nodeId, outputIndex) {
  const links = currentWorkflow.links.filter(l => l[1] === nodeId && l[2] === outputIndex);
  if (!links.length) return "사용되지 않음";
  return links.map(link => {
    const target = currentWorkflow.nodes.find(n => n.id === link[3]);
    const input = target?.inputs?.[link[4]];
    const targetLabel = target ? `${displayNodeTitle(target)} [${target.type}]` : `node ${link[3]}`;
    return `→ ${targetLabel}.${input?.name || link[4]} / link ${link[0]}`;
  }).join(", ");
}

function renderValidation() {
  const list = document.getElementById("validationList");
  const issues = validateWorkflow();
  if (!issues.length) {
    list.innerHTML = `<div class="validation-card"><b>검증 성공</b><br><span>모든 link와 포트 타입이 정상입니다.</span></div>`;
    return;
  }
  list.innerHTML = issues.map(issue => `<div class="validation-card"><b>${escapeHtml(issue.level)}</b><br><span>${escapeHtml(issue.message)}</span></div>`).join("");
}

function validateWorkflow() {
  const issues = [];
  const nodeMap = new Map(currentWorkflow.nodes.map(n => [n.id, n]));
  currentWorkflow.links.forEach(link => {
    const [id, fromId, fromSlot, toId, toSlot, type] = link;
    const source = nodeMap.get(fromId);
    const target = nodeMap.get(toId);
    if (!source) issues.push({ level: "ERROR", message: `link ${id}: source node ${fromId} 없음` });
    if (!target) issues.push({ level: "ERROR", message: `link ${id}: target node ${toId} 없음` });
    const output = source?.outputs?.[fromSlot];
    const input = target?.inputs?.[toSlot];
    if (!output) issues.push({ level: "ERROR", message: `link ${id}: source output slot ${fromSlot} 없음` });
    if (!input) issues.push({ level: "ERROR", message: `link ${id}: target input slot ${toSlot} 없음` });
    if (output && input && input.type !== "*" && output.type !== input.type) {
      issues.push({ level: "WARNING", message: `link ${id}: ${output.type} → ${input.type} 타입 확인 필요` });
    }
    if (output && output.links && !output.links.includes(id)) {
      issues.push({ level: "WARNING", message: `link ${id}: source output.links에 link id가 없습니다.` });
    }
    if (input && input.link !== id) {
      issues.push({ level: "WARNING", message: `link ${id}: target input.link 값이 다릅니다.` });
    }
  });
  currentWorkflow.nodes.forEach(node => {
    if (isNodeMissingFromCatalog(node)) {
      issues.push({
        level: "ERROR",
        message: `${displayNodeTitle(node)} [${node.type}] #${node.id}: 현재 catalog.json에서 확인되지 않음`,
      });
    }
    (node.inputs || []).forEach(input => {
      if (input.link == null) issues.push({ level: "WARNING", message: `${displayNodeTitle(node)} [${node.type}] #${node.id}: input ${input.name} 미연결` });
    });
  });
  return issues;
}

function worldPoint(event) {
  return canvasToWorld(event.clientX, event.clientY);
}

function beginNodeDrag(event, node) {
  event.stopPropagation();
  event.preventDefault();
  recordHistory("Move node");
  selectedNodeId = node.id;
  selectedLinkId = null;
  dragState = {
    nodeId: node.id,
    startX: event.clientX,
    startY: event.clientY,
    startPos: [...node.pos]
  };
  window.addEventListener("pointermove", onNodeDrag);
  window.addEventListener("pointerup", endNodeDrag, { once: true });
  renderAll();
}

function onNodeDrag(event) {
  if (!dragState) return;
  const node = currentWorkflow.nodes.find(n => n.id === dragState.nodeId);
  if (!node) return;
  node.pos[0] = dragState.startPos[0] + (event.clientX - dragState.startX) / worldTransform.scale;
  node.pos[1] = dragState.startPos[1] + (event.clientY - dragState.startY) / worldTransform.scale;
  const el = nodeLayer.querySelector(`[data-node-id="${node.id}"]`);
  if (el) {
    el.style.left = `${node.pos[0]}px`;
    el.style.top = `${node.pos[1]}px`;
  }
  renderLinks();
  syncJson();
}

function endNodeDrag() {
  window.removeEventListener("pointermove", onNodeDrag);
  dragState = null;
  renderAll();
  scheduleLocalDraftSave();
}

function onPendingReconnectMove(event) {
  if (!pendingLinkReconnect) return;
  pendingLinkReconnect.pointer = worldPoint(event);
  renderLinks();
}

function onPendingLinkMove(event) {
  if (!pendingLinkPort) return;
  pendingLinkPort.pointer = worldPoint(event);
  renderLinks();
}

function handlePortClick(event, nodeId, kind, index) {
  event.stopPropagation();
  if (pendingLinkReconnect) {
    finishPendingLinkReconnect(nodeId, kind, index);
    return;
  }
  if (beginSelectedLinkPortReconnect(nodeId, kind, index)) return;
  if (!pendingLinkPort) {
    pendingLinkPort = { nodeId, kind, index, pointer: worldPoint(event) };
    selectedNodeId = nodeId;
    selectedLinkId = null;
    window.addEventListener("pointermove", onPendingLinkMove);
    renderAll();
    return;
  }
  const first = pendingLinkPort;
  if (first.nodeId === nodeId && first.kind === kind && first.index === index) {
    clearPendingLinkPort();
    renderAll();
    return;
  }
  if (first.kind === kind) {
    clearPendingLinkPort();
    pendingLinkPort = { nodeId, kind, index, pointer: worldPoint(event) };
    selectedNodeId = nodeId;
    selectedLinkId = null;
    window.addEventListener("pointermove", onPendingLinkMove);
    renderAll();
    return;
  }
  const source = first.kind === "output" ? first : { nodeId, index };
  const target = first.kind === "input" ? first : { nodeId, index };
  clearPendingLinkPort();
  createLink(source.nodeId, source.index, target.nodeId, target.index);
  renderAll();
}

function beginSelectedLinkPortReconnect(nodeId, kind, index) {
  if (selectedLinkId == null) return false;
  const link = currentWorkflow.links.find(item => item[0] === selectedLinkId);
  if (!link) return false;
  const isSource = kind === "output" && link[1] === nodeId && link[2] === index;
  const isTarget = kind === "input" && link[3] === nodeId && link[4] === index;
  if (!isSource && !isTarget) return false;
  clearPendingLinkPort();
  pendingLinkReconnect = {
    linkId: selectedLinkId,
    mode: isSource ? "reconnect-source" : "reconnect-target",
    expectedKind: isSource ? "output" : "input",
    origin: { nodeId, kind, index },
    pointer: getPortCenter(nodeId, kind, index)
  };
  selectedNodeId = null;
  window.addEventListener("pointermove", onPendingReconnectMove);
  renderAll();
  return true;
}

function finishPendingLinkReconnect(nodeId, kind, index) {
  const pending = pendingLinkReconnect;
  if (!pending) return;
  if (pending.origin.nodeId === nodeId && pending.origin.kind === kind && pending.origin.index === index) {
    clearPendingLinkReconnect();
    renderAll();
    return;
  }
  if (kind !== pending.expectedKind) return;
  clearPendingLinkReconnect();
  if (pending.mode === "reconnect-target") {
    reconnectLinkTarget(pending.linkId, nodeId, index);
  } else {
    reconnectLinkSource(pending.linkId, nodeId, index);
  }
  renderAll();
}

function clearPendingLinkPort() {
  window.removeEventListener("pointermove", onPendingLinkMove);
  pendingLinkPort = null;
}

function clearPendingLinkReconnect() {
  window.removeEventListener("pointermove", onPendingReconnectMove);
  pendingLinkReconnect = null;
}

function findPortAt(clientX, clientY, kind) {
  const element = document.elementFromPoint(clientX, clientY);
  const row = element?.closest?.(`.port-row.${kind}`);
  const nodeEl = row?.closest?.("[data-node-id]");
  if (!row || !nodeEl) return null;
  return {
    nodeId: Number(nodeEl.dataset.nodeId),
    index: Number(row.dataset.portIndex)
  };
}

function createLink(sourceId, sourceOutputIndex, targetId, targetInputIndex) {
  if (sourceId === targetId) {
    alert("같은 노드 안에서는 연결하지 않도록 제한했습니다.");
    return;
  }
  const source = currentWorkflow.nodes.find(n => n.id === sourceId);
  const target = currentWorkflow.nodes.find(n => n.id === targetId);
  const output = source?.outputs?.[sourceOutputIndex];
  const input = target?.inputs?.[targetInputIndex];
  if (!source || !target || !output || !input) return;
  if (input.type !== "*" && output.type !== input.type) {
    const ok = confirm(`타입이 다릅니다: ${output.type} → ${input.type}\n그래도 연결할까요?`);
    if (!ok) return;
  }
  recordHistory("Create link");
  if (input.link != null) {
    removeLink(input.link);
  }
  const linkId = nextLinkId();
  currentWorkflow.links.push([linkId, sourceId, sourceOutputIndex, targetId, targetInputIndex, output.type]);
  input.link = linkId;
  output.links = [...new Set([...(output.links || []), linkId])];
  currentWorkflow.last_link_id = Math.max(currentWorkflow.last_link_id || 0, linkId);
  selectedLinkId = linkId;
  selectedNodeId = null;
  clearPendingLinkPort();
  clearPendingLinkReconnect();
  rebuildLinkRefs();
}

function confirmPortCompatibility(output, input) {
  if (!output || !input) return false;
  if (input.type === "*" || output.type === input.type) return true;
  return confirm(`타입이 다릅니다: ${output.type} → ${input.type}\n그래도 연결할까요?`);
}

function reconnectLinkTarget(linkId, targetId, targetInputIndex) {
  const link = currentWorkflow.links.find(item => item[0] === linkId);
  const source = currentWorkflow.nodes.find(node => node.id === link?.[1]);
  const target = currentWorkflow.nodes.find(node => node.id === targetId);
  const output = source?.outputs?.[link?.[2]];
  const input = target?.inputs?.[targetInputIndex];
  if (!link || !source || !target || !output || !input) return;
  if (source.id === target.id) {
    alert("같은 노드 안에서는 연결하지 않도록 제한했습니다.");
    return;
  }
  if (!confirmPortCompatibility(output, input)) return;
  recordHistory("Reconnect link target");
  currentWorkflow.links = currentWorkflow.links.filter(item => item[0] === linkId || item[0] !== input.link);
  link[3] = targetId;
  link[4] = targetInputIndex;
  link[5] = output.type;
  selectedLinkId = linkId;
  selectedNodeId = null;
  rebuildLinkRefs();
}

function reconnectLinkSource(linkId, sourceId, sourceOutputIndex) {
  const link = currentWorkflow.links.find(item => item[0] === linkId);
  const source = currentWorkflow.nodes.find(node => node.id === sourceId);
  const target = currentWorkflow.nodes.find(node => node.id === link?.[3]);
  const output = source?.outputs?.[sourceOutputIndex];
  const input = target?.inputs?.[link?.[4]];
  if (!link || !source || !target || !output || !input) return;
  if (source.id === target.id) {
    alert("같은 노드 안에서는 연결하지 않도록 제한했습니다.");
    return;
  }
  if (!confirmPortCompatibility(output, input)) return;
  recordHistory("Reconnect link source");
  link[1] = sourceId;
  link[2] = sourceOutputIndex;
  link[5] = output.type;
  selectedLinkId = linkId;
  selectedNodeId = null;
  rebuildLinkRefs();
}

function nextLinkId() {
  const used = new Set(currentWorkflow.links.map(l => l[0]));
  let id = (currentWorkflow.last_link_id || 0) + 1;
  while (used.has(id)) id += 1;
  return id;
}

function nextNodeId() {
  const used = new Set(currentWorkflow.nodes.map(n => n.id));
  let id = (currentWorkflow.last_node_id || 0) + 1;
  while (used.has(id)) id += 1;
  return id;
}

function removeLink(linkId) {
  currentWorkflow.links = currentWorkflow.links.filter(link => link[0] !== linkId);
  rebuildLinkRefs();
  if (selectedLinkId === linkId) selectedLinkId = null;
  if (pendingLinkReconnect?.linkId === linkId) clearPendingLinkReconnect();
}

function rebuildLinkRefs() {
  currentWorkflow.nodes.forEach(node => {
    (node.inputs || []).forEach(input => { input.link = null; });
    (node.outputs || []).forEach(output => { output.links = []; });
  });
  currentWorkflow.links.forEach(link => {
    const [id, sourceId, sourceOutputIndex, targetId, targetInputIndex] = link;
    const source = currentWorkflow.nodes.find(n => n.id === sourceId);
    const target = currentWorkflow.nodes.find(n => n.id === targetId);
    const output = source?.outputs?.[sourceOutputIndex];
    const input = target?.inputs?.[targetInputIndex];
    if (output) output.links = [...(output.links || []), id];
    if (input) input.link = id;
  });
  syncJson();
}

function deleteSelected() {
  if (selectedLinkId != null) {
    deleteLink(selectedLinkId);
    return;
  }
  if (selectedNodeId == null) return;
  deleteNode(selectedNodeId);
}

function deleteLink(linkId) {
  if (linkId == null) return;
  recordHistory("Delete link");
  removeLink(linkId);
  renderAll();
}

function deleteNode(nodeId) {
  const node = currentWorkflow.nodes.find(item => item.id === nodeId);
  if (!node) return;
  recordHistory("Delete node");
  const linkIds = currentWorkflow.links
    .filter(link => link[1] === nodeId || link[3] === nodeId)
    .map(link => link[0]);
  linkIds.forEach(removeLink);
  currentWorkflow.nodes = currentWorkflow.nodes.filter(node => node.id !== nodeId);
  if (selectedNodeId === nodeId) selectedNodeId = null;
  renderAll();
}

window.deleteSelected = deleteSelected;
window.deleteLink = deleteLink;
window.deleteNode = deleteNode;

function duplicateSelectedNode() {
  duplicateNode(selectedNodeId);
}

function duplicateNode(nodeId) {
  const node = currentWorkflow.nodes.find(n => n.id === nodeId);
  if (!node) return;
  recordHistory("Duplicate node");
  const copy = structuredClone(node);
  copy.id = nextNodeId();
  copy.pos = [node.pos[0] + 36, node.pos[1] + 36];
  (copy.inputs || []).forEach(input => { input.link = null; });
  (copy.outputs || []).forEach(output => { output.links = []; });
  currentWorkflow.nodes.push(copy);
  currentWorkflow.last_node_id = Math.max(currentWorkflow.last_node_id || 0, copy.id);
  selectedNodeId = copy.id;
  selectedLinkId = null;
  renderAll();
}

window.duplicateSelectedNode = duplicateSelectedNode;
window.duplicateNode = duplicateNode;

function syncJson() {
  jsonInput.value = JSON.stringify(currentWorkflow, null, 2);
}

function createHistoryEntry(snapshot, label = "Workflow change") {
  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    workflowId: currentWorkflowId,
    label,
    summary: describeWorkflowSnapshot(snapshot),
    snapshot
  };
}

function getHistorySnapshot(entry) {
  return typeof entry === "string" ? entry : entry?.snapshot;
}

function reviveHistoryEntry(entry, fallbackLabel = "Workflow state") {
  if (entry && typeof entry === "object" && entry.snapshot) {
    return {
      ...entry,
      label: entry.label || fallbackLabel,
      summary: entry.summary || describeWorkflowSnapshot(entry.snapshot)
    };
  }
  return createHistoryEntry(String(entry || "{}"), fallbackLabel);
}

function describeWorkflowSnapshot(snapshot) {
  try {
    const data = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    const nodes = Array.isArray(data?.nodes) ? data.nodes.length : 0;
    const links = Array.isArray(data?.links) ? data.links.length : 0;
    const selectedTypes = Array.isArray(data?.nodes)
      ? [...new Set(data.nodes.map(node => node.type).filter(Boolean))].slice(0, 4).join(", ")
      : "";
    return `${nodes} nodes / ${links} links${selectedTypes ? ` / ${selectedTypes}` : ""}`;
  } catch {
    return "Snapshot unavailable";
  }
}

function formatHistoryTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function recordHistory(label = "Workflow change") {
  const snapshot = JSON.stringify(currentWorkflow);
  historyStack.push(createHistoryEntry(snapshot, label));
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  redoStack = [];
  markWorkflowDirty();
  renderHistoryPanel();
}

function restoreHistorySnapshot(snapshot) {
  currentWorkflow = JSON.parse(snapshot);
  updateCurrentWorkflowStore();
  selectedNodeId = null;
  selectedLinkId = null;
  renderAll();
  applyWorldTransform();
  markWorkflowDirty();
}

function undo() {
  if (!historyStack.length) return;
  redoStack.push(createHistoryEntry(JSON.stringify(currentWorkflow), "Undo target"));
  const entry = reviveHistoryEntry(historyStack.pop(), "Previous state");
  restoreHistorySnapshot(getHistorySnapshot(entry));
}

function redo() {
  if (!redoStack.length) return;
  historyStack.push(createHistoryEntry(JSON.stringify(currentWorkflow), "Redo origin"));
  const entry = reviveHistoryEntry(redoStack.pop(), "Redo state");
  restoreHistorySnapshot(getHistorySnapshot(entry));
}

function jumpToHistory(index) {
  if (index < 0 || index >= historyStack.length) return;
  redoStack.push(createHistoryEntry(JSON.stringify(currentWorkflow), "Before history jump"));
  const discarded = historyStack.splice(index + 1).reverse();
  redoStack.push(...discarded.map(entry => reviveHistoryEntry(entry, "Skipped state")));
  const entry = reviveHistoryEntry(historyStack.pop(), "Restored state");
  restoreHistorySnapshot(getHistorySnapshot(entry));
  showToast("History state restored");
}

function jumpToRedo(index) {
  if (index < 0 || index >= redoStack.length) return;
  historyStack.push(createHistoryEntry(JSON.stringify(currentWorkflow), "Before redo jump"));
  const discarded = redoStack.splice(index + 1).reverse();
  historyStack.push(...discarded.map(entry => reviveHistoryEntry(entry, "Skipped redo state")));
  const entry = reviveHistoryEntry(redoStack.splice(index, 1)[0], "Redo state");
  restoreHistorySnapshot(getHistorySnapshot(entry));
  showToast("Future state restored");
}

function focusHistoryPanel() {
  renderHistoryPanel();
  const pane = document.getElementById("historyPane");
  if (!pane) return;
  pane.classList.remove("hidden");
  pane.setAttribute("aria-hidden", "false");
  document.getElementById("drawerScrim")?.classList.remove("hidden");
  document.getElementById("closeHistoryBtn")?.focus();
}

function closeHistoryPanel() {
  const pane = document.getElementById("historyPane");
  pane?.classList.add("hidden");
  pane?.setAttribute("aria-hidden", "true");
  document.getElementById("drawerScrim")?.classList.add("hidden");
}

function clearWorkflowHistory() {
  historyStack = [];
  redoStack = [];
  renderHistoryPanel();
  showToast("History cleared");
}

function renderHistoryPanel() {
  const list = document.getElementById("historyList");
  const summary = document.getElementById("historySummary");
  if (!list || !summary) return;
  summary.textContent = `${historyStack.length} undo states / ${redoStack.length} redo states`;

  const past = historyStack.map((entry, index) => ({ entry: reviveHistoryEntry(entry, "Previous state"), index })).reverse();
  const future = redoStack.map((entry, index) => ({ entry: reviveHistoryEntry(entry, "Redo state"), index })).reverse();
  const current = createHistoryEntry(JSON.stringify(currentWorkflow), "Current state");

  const rows = [
    ...future.map(item => renderHistoryItem(item.entry, "future", "Redo", `jumpToRedo(${item.index})`)),
    renderHistoryItem(current, "current", "Current", ""),
    ...past.map(item => renderHistoryItem(item.entry, "past", "Restore", `jumpToHistory(${item.index})`))
  ];

  list.innerHTML = rows.length
    ? rows.join("")
    : `<div class="history-item current"><div class="history-main"><b>Current state</b><span>No saved history yet.</span></div></div>`;
}

function renderHistoryItem(entry, kind, actionLabel, action) {
  const time = formatHistoryTime(entry.at);
  const classes = `history-item ${kind === "current" ? "current" : kind === "future" ? "future" : ""}`;
  const actionButton = action
    ? `<button class="btn light" type="button" onclick="${action}">${actionLabel}</button>`
    : `<span class="pill ok">Current</span>`;
  return `
    <div class="${classes}">
      <div class="history-main">
        <b>${escapeHtml(entry.label || "Workflow state")}</b>
        <span>${escapeHtml(entry.summary || describeWorkflowSnapshot(entry.snapshot))}${time ? ` / ${escapeHtml(time)}` : ""}</span>
      </div>
      <div class="history-actions">${actionButton}</div>
    </div>
  `;
}

window.focusHistoryPanel = focusHistoryPanel;
window.closeHistoryPanel = closeHistoryPanel;
window.clearWorkflowHistory = clearWorkflowHistory;
window.jumpToHistory = jumpToHistory;
window.jumpToRedo = jumpToRedo;

function updateCurrentWorkflowStore() {
  const item = workflowStore.find(workflow => workflow.id === currentWorkflowId);
  if (item) item.data = currentWorkflow;
}

function createBlankWorkflow() {
  return { last_node_id: 0, last_link_id: 0, nodes: [], links: [], extra: { ds: { scale: 1, offset: [0, 0] } }, version: 0.4 };
}

function switchProject(id) {
  if (id === currentProjectId) return;
  if (!confirmUnsavedBeforeSwitch()) {
    renderProjectList();
    return;
  }
  updateCurrentWorkflowStore();
  const project = projectStore.find(item => item.id === id);
  if (!project) return;
  currentProjectId = id;
  workflowListCollapsed = false;
  const firstWorkflow = workflowsForCurrentProject()[0];
  if (firstWorkflow) {
    currentWorkflowId = firstWorkflow.id;
    currentWorkflow = firstWorkflow.data;
  } else {
    const name = `${project.name}_workflow`;
    const workflowId = `${safeId(name)}_${Date.now()}`;
    const data = createBlankWorkflow();
    workflowStore.push({ id: workflowId, name, projectId: currentProjectId, data });
    currentWorkflowId = workflowId;
    currentWorkflow = data;
  }
  selectedNodeId = null;
  selectedLinkId = null;
  historyStack = [];
  redoStack = [];
  renderAll();
  if (firstWorkflow) applyCurrentWorkflowSaveState();
  else markWorkflowDirty();
  fitView();
}

window.switchProject = switchProject;

function newProject() {
  if (!confirmUnsavedBeforeSwitch()) return;
  const name = prompt("새 프로젝트 이름", `project_${projectStore.length + 1}`);
  if (!name) return;
  updateCurrentWorkflowStore();
  const id = `${safeId(name)}_${Date.now()}`;
  projectStore.push({ id, name });
  currentProjectId = id;
  workflowListCollapsed = false;
  const workflowName = `${name}_workflow`;
  const workflowId = `${safeId(workflowName)}_${Date.now()}`;
  const data = createBlankWorkflow();
  workflowStore.push({ id: workflowId, name: workflowName, projectId: id, data });
  currentWorkflowId = workflowId;
  currentWorkflow = data;
  selectedNodeId = null;
  selectedLinkId = null;
  historyStack = [];
  redoStack = [];
  renderAll();
  markWorkflowDirty();
  void syncServerWorkflows();
  fitView();
}

function cloneProject() {
  if (!confirmUnsavedBeforeSwitch()) return;
  const project = currentProject();
  const name = prompt("복제할 프로젝트 이름", `${project.name}_copy`);
  if (!name) return;
  updateCurrentWorkflowStore();
  const id = `${safeId(name)}_${Date.now()}`;
  projectStore.push({ id, name });
  const sourceWorkflows = workflowsForCurrentProject();
  sourceWorkflows.forEach((item, index) => {
    const workflowId = `${safeId(item.name)}_${Date.now()}_${index}`;
    workflowStore.push({ id: workflowId, name: item.name, projectId: id, data: structuredClone(item.data) });
  });
  currentProjectId = id;
  workflowListCollapsed = false;
  const firstWorkflow = workflowsForCurrentProject()[0];
  currentWorkflowId = firstWorkflow.id;
  currentWorkflow = firstWorkflow.data;
  selectedNodeId = null;
  selectedLinkId = null;
  historyStack = [];
  redoStack = [];
  renderAll();
  markWorkflowDirty();
  fitView();
}

function renameCurrentProject(name) {
  const project = currentProject();
  project.name = String(name || "Untitled Project").trim() || "Untitled Project";
  renderProjectList();
  markWorkflowDirty();
}

window.renameCurrentProject = renameCurrentProject;

function switchWorkflow(id, options = {}) {
  if (id === currentWorkflowId) return;
  if (!options.skipGuard && !confirmUnsavedBeforeSwitch()) return;
  updateCurrentWorkflowStore();
  const item = workflowStore.find(workflow => workflow.id === id);
  if (!item) return;
  currentWorkflowId = id;
  currentProjectId = "local_tool";
  projectStore = [{ id: currentProjectId, name: "Local Tool" }];
  item.projectId = currentProjectId;
  workflowStore = [item];
  workflowListCollapsed = true;
  currentWorkflow = item.data;
  currentWorkflowFileName = null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  workflowSyncState = {};
  selectedNodeId = null;
  selectedLinkId = null;
  historyStack = [];
  redoStack = [];
  renderAll();
  if (options.preserveDirty) markWorkflowDirty();
  else applyCurrentWorkflowSaveState();
  fitView();
}

async function clearCurrentWorkflowFolder(options = {}) {
  const archive = Boolean(options.archive);
  const response = await localToolFetch(
    "workflows/current/clear",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-InfraX-Archive-Current": archive ? "true" : "false",
      },
      body: "{}",
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  }
  return true;
}

async function saveCurrentWorkflowDraftFile(fileName, workflow) {
  const response = await localToolFetch(
    `workflows/${encodeURIComponent(fileName)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-InfraX-Current-Only": "true",
      },
      body: JSON.stringify(workflow),
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  }
  return result;
}

async function saveCurrentWorkflowAsFile(fileName, workflow, options = {}) {
  const response = await localToolFetch("workflows/current/save-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      workflow,
      ...(options.resetWorkflow ? { resetWorkflow: options.resetWorkflow } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  }
  return result;
}

async function archiveDirtyCurrentWorkflowBeforeReplacement() {
  if (!isWorkflowDirty) return false;
  updateCurrentWorkflowStore();
  if (!workflowShouldArchiveToTemp()) {
    await clearCurrentWorkflowFolder({ archive: false });
    return false;
  }
  const draftFileName = currentWorkflowFileName || currentWorkflowFileNameForName(currentWorkflowLabel());
  await saveCurrentWorkflowDraftFile(draftFileName, exportWorkflowForDownload());
  await clearCurrentWorkflowFolder({ archive: true });
  return true;
}

async function newWorkflow() {
  if (!confirmUnsavedBeforeSwitch()) return;
  const name = prompt("새 워크플로우 이름", "new_workflow");
  if (!name) return;
  const id = `${name.toLowerCase().replace(/[^a-z0-9_가-힣-]+/g, "_")}_${Date.now()}`;
  const data = createBlankWorkflow();
  const fileName = currentWorkflowFileNameForName(name);
  try {
    await saveCurrentWorkflowAsFile(fileName, data);
  } catch (error) {
    showToast(`새 워크플로우 파일 생성 실패: ${error.message || "로컬 파일 오류"}`);
    return;
  }
  currentProjectId = "local_tool";
  projectStore = [{ id: currentProjectId, name: "Local Tool" }];
  workflowStore = [{ id, name, projectId: currentProjectId, data }];
  currentWorkflowId = id;
  currentWorkflow = data;
  currentWorkflowFileName = fileName;
  currentWorkflowSourceFileName = null;
  currentWorkflowResetFileName = null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  workflowSyncState = {};
  workflowListCollapsed = true;
  selectedNodeId = null;
  selectedLinkId = null;
  historyStack = [];
  redoStack = [];
  renderAll();
  markWorkflowDirty();
  fitView();
}

async function resetCurrentWorkflow() {
  const resetTarget = currentWorkflowSourceFileName || currentWorkflowResetFileName;
  const resetDescription = resetTarget
    ? `연결된 원본 workflows/list/${resetTarget} 내용으로 되돌릴까요?`
    : "현재 이름을 유지하고 워크플로우 내용만 빈 상태로 초기화할까요?";
  if (!confirm(`${resetDescription}\n저장하지 않은 변경은 제거됩니다.`)) {
    return;
  }
  try {
    const response = await localToolFetch("workflows/current/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
    applyLoadedWorkflowResult(result, currentWorkflowFileName);
  } catch (error) {
    showToast(`워크플로우 초기화 실패: ${error.message || "로컬 파일 오류"}`);
    return;
  }
  showToast(resetTarget ? "연결된 원본 내용으로 되돌렸습니다." : "현재 이름을 유지하고 내용을 초기화했습니다.");
}

let cloneWorkflowSubmitting = false;

function closeCloneWorkflowModal(options = {}) {
  if (cloneWorkflowSubmitting && !options.force) return;
  document.getElementById("cloneWorkflowModal")?.classList.add("hidden");
  const error = document.getElementById("cloneWorkflowError");
  if (error) error.textContent = "";
  if (options.restoreFocus !== false) document.getElementById("cloneWorkflowBtn")?.focus();
}

function cloneWorkflow() {
  const current = workflowStore.find(workflow => workflow.id === currentWorkflowId);
  if (!current) return;
  const modal = document.getElementById("cloneWorkflowModal");
  const input = document.getElementById("cloneWorkflowName");
  const error = document.getElementById("cloneWorkflowError");
  if (!modal || !input) return;
  input.value = `${current.name}_copy`;
  if (error) error.textContent = "";
  modal.classList.remove("hidden");
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function submitCloneWorkflow(event) {
  event.preventDefault();
  if (cloneWorkflowSubmitting) return;
  const current = workflowStore.find(workflow => workflow.id === currentWorkflowId);
  if (!current) return;
  const input = document.getElementById("cloneWorkflowName");
  const error = document.getElementById("cloneWorkflowError");
  const name = String(input?.value || "").trim();
  if (!name) {
    if (error) error.textContent = "새 워크플로우 이름을 입력해 주세요.";
    input?.focus();
    return;
  }
  const id = `${name.toLowerCase().replace(/[^a-z0-9_가-힣-]+/g, "_")}_${Date.now()}`;
  updateCurrentWorkflowStore();
  const data = structuredClone(currentWorkflow);
  const fileName = currentWorkflowFileNameForName(name);
  const resetWorkflow = currentWorkflowSourceFileName ? `list/${currentWorkflowSourceFileName}` : null;
  const submitButton = event.currentTarget?.querySelector('button[type="submit"]');
  cloneWorkflowSubmitting = true;
  if (submitButton) submitButton.disabled = true;
  try {
    await saveCurrentWorkflowAsFile(fileName, data, { resetWorkflow });
  } catch (saveError) {
    const message = `새이름 복제 실패: ${saveError.message || "로컬 파일 오류"}`;
    if (error) error.textContent = message;
    showToast(message);
    return;
  } finally {
    cloneWorkflowSubmitting = false;
    if (submitButton) submitButton.disabled = false;
  }
  currentProjectId = "local_tool";
  projectStore = [{ id: currentProjectId, name: "Local Tool" }];
  workflowStore = [{ id, name, projectId: currentProjectId, data }];
  currentWorkflowId = id;
  currentWorkflow = data;
  currentWorkflowFileName = fileName;
  currentWorkflowSourceFileName = null;
  currentWorkflowResetFileName = resetWorkflow?.replace(/^list\//, "") || null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  workflowSyncState = {};
  historyStack = [];
  redoStack = [];
  selectedNodeId = null;
  selectedLinkId = null;
  closeCloneWorkflowModal({ force: true });
  renderAll();
  markWorkflowDirty();
  persistLocalDraft({ immediate: true, silent: true });
  void syncServerWorkflows();
  fitView();
  showToast(`workflows/${fileName} 새이름 복제본을 만들었습니다. 저장을 누르면 workflows/list에 확정됩니다.`);
}

function setSaveState(status, message) {
  const state = document.getElementById("saveState");
  if (!state) return;
  state.classList.toggle("is-saved", status === "saved");
  state.classList.toggle("is-error", status === "error");
  state.classList.toggle("is-dirty", status === "dirty");
  state.classList.toggle("is-saving", status === "saving");
  const text = document.getElementById("saveStateText");
  if (text) text.textContent = message;
}

function currentWorkflowSyncMeta(workflowId = currentWorkflowId) {
  workflowSyncState[workflowId] = workflowSyncState[workflowId] || {
    dirty: false,
    localDraftSavedAt: null,
    lastFolderSavedAt: null,
    lastFolderSavedHash: null,
    fileName: null,
  };
  return workflowSyncState[workflowId];
}

function formatSavedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function savedWorkflowDisplayName(fileName) {
  const baseName = String(fileName || "").split("/").filter(Boolean).pop();
  return baseName ? `list/${baseName}` : String(fileName || "");
}

function applyCurrentWorkflowSaveState() {
  const meta = currentWorkflowSyncMeta();
  isWorkflowDirty = Boolean(meta.dirty);
  if (meta.dirty) {
    setSaveState("dirty", meta.localDraftSavedAt ? "브라우저 자동저장됨 · 파일 미반영" : "브라우저 자동저장 대기");
  } else if (currentWorkflowFileName && (meta.lastFolderSavedAt || lastFolderSavedAt)) {
    setSaveState("saved", `workflows/${savedWorkflowDisplayName(currentWorkflowFileName)} 저장됨 · ${formatSavedTime(meta.lastFolderSavedAt || lastFolderSavedAt)}`);
  } else {
    setSaveState("unknown", "브라우저 초안 · 아직 파일로 저장하지 않음");
  }
}

function markWorkflowDirty() {
  isWorkflowDirty = true;
  const meta = currentWorkflowSyncMeta();
  meta.dirty = true;
  meta.localDraftSavedAt = null;
  setSaveState("dirty", "브라우저 자동저장 대기 · 파일 미반영");
  scheduleLocalDraftSave();
}

function clearWorkflowDirty(savedAt, _revision, hash, fileName, workflowId = currentWorkflowId) {
  const meta = currentWorkflowSyncMeta(workflowId);
  meta.dirty = false;
  meta.lastFolderSavedAt = savedAt;
  meta.lastFolderSavedHash = hash;
  meta.fileName = fileName || currentWorkflowFileName;
  meta.localDraftSavedAt = new Date().toISOString();
  if (workflowId === currentWorkflowId) {
    isWorkflowDirty = false;
    lastFolderSavedAt = savedAt;
    lastFolderSavedHash = hash;
    setSaveState("saved", `workflows/${savedWorkflowDisplayName(currentWorkflowFileName)} 저장됨 · ${formatSavedTime(savedAt)}`);
  }
}

function confirmUnsavedBeforeSwitch() {
  if (!isWorkflowDirty) return true;
  const draftSaved = persistLocalDraft({ immediate: true, silent: true });
  if (!draftSaved) {
    return confirm("브라우저 초안을 저장하지 못했습니다. 지금 이동하면 현재 변경을 잃을 수 있습니다.\n그래도 이동할까요?");
  }
  return confirm(
    "현재 변경은 브라우저 초안에만 있고 workflows 폴더에는 저장되지 않았습니다.\n"
    + "다른 워크플로우를 열면 이 초안 하나가 선택한 파일로 교체됩니다. 계속할까요?"
  );
}

function auxiliaryStatePayload() {
  return {
    scriptLibrary,
    catalogModels,
    portTypes,
    portTypePatterns,
    nodeTypes,
    registeredMarketplacePackages: registeredMarketplacePackages.map(pkg => {
      const { canManage: _serverPermission, ...cacheablePackage } = pkg;
      return cacheablePackage;
    }),
    downloadedMarketplacePackageIds,
    localAuthorProfile,
    explorerState
  };
}

function storageEnvelope(rawValue) {
  if (!rawValue) return { revision: 0, writerId: null };
  try {
    const parsed = JSON.parse(rawValue);
    return {
      revision: Number.isSafeInteger(parsed?.cacheRevision) && parsed.cacheRevision >= 0
        ? parsed.cacheRevision
        : 0,
      writerId: typeof parsed?.cacheWriterId === "string" ? parsed.cacheWriterId : null,
    };
  } catch {
    return { revision: 0, writerId: null };
  }
}

function persistAuxiliaryState() {
  try {
    if (storageScopeTransitionPending || externalAuxiliaryConflict) return false;
    const storageKey = scopedStorageKey(AUXILIARY_STORAGE_KEY);
    const currentEnvelope = storageEnvelope(localStorage.getItem(storageKey));
    if (
      currentEnvelope.writerId
      && currentEnvelope.writerId !== TAB_INSTANCE_ID
      && currentEnvelope.revision > auxiliaryStorageRevision
    ) {
      externalAuxiliaryConflict = true;
      showToast("다른 탭의 로컬 라이브러리 변경을 감지했습니다. 새로고침 후 다시 편집해 주세요.");
      return false;
    }
    const nextRevision = Math.max(auxiliaryStorageRevision, currentEnvelope.revision) + 1;
    const payload = {
      ...auxiliaryStatePayload(),
      cacheRevision: nextRevision,
      cacheWriterId: TAB_INSTANCE_ID,
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
    auxiliaryStorageRevision = nextRevision;
    auxiliaryPersistFailed = false;
    return true;
  } catch (error) {
    auxiliaryPersistFailed = true;
    showToast(`로컬 등록 정보를 저장하지 못했습니다: ${error.message || "브라우저 저장소 오류"}`);
    return false;
  }
}

function localDraftPayload() {
  updateCurrentWorkflowStore();
  const workflowItem = workflowStore.find(item => item.id === currentWorkflowId) || workflowStore[0];
  return {
    schema: "infrax.studio.current-draft.v2",
    fileName: currentWorkflowFileName,
    fileToolRoot: currentWorkflowFileName
      ? activeLocalToolRoot || localToolRootPreference || null
      : null,
    name: workflowItem?.name || currentWorkflowId || "untitled",
    data: currentWorkflow,
    historyStack,
    redoStack,
    dirty: isWorkflowDirty,
    lastFolderSavedAt,
    lastFolderSavedHash,
    draftCachedAt: new Date().toISOString()
  };
}

function persistLocalDraft(options = {}) {
  if (localDraftTimer) {
    clearTimeout(localDraftTimer);
    localDraftTimer = null;
  }
  try {
    if (localDraftWriteBlockedReason) {
      setSaveState("error", localDraftWriteBlockedReason);
      if (!options.silent) showToast(localDraftWriteBlockedReason);
      return false;
    }
    if (externalDraftConflict) {
      setSaveState("error", "다른 탭 변경 감지 · JSON 보기에서 복사 후 새로고침 필요");
      return false;
    }
    const storageKey = CURRENT_DRAFT_STORAGE_KEY;
    const currentEnvelope = storageEnvelope(localStorage.getItem(storageKey));
    if (
      currentEnvelope.writerId
      && currentEnvelope.writerId !== TAB_INSTANCE_ID
      && currentEnvelope.revision > localDraftStorageRevision
    ) {
      externalDraftConflict = true;
      setSaveState("error", "다른 탭 변경 감지 · JSON 보기에서 복사 후 새로고침 필요");
      if (!options.silent) showToast("다른 탭의 최신 초안을 덮지 않았습니다. JSON 보기에서 현재 내용을 복사한 뒤 새로고침해 주세요.");
      return false;
    }
    const cachedAt = new Date().toISOString();
    currentWorkflowSyncMeta().localDraftSavedAt = cachedAt;
    const nextRevision = Math.max(localDraftStorageRevision, currentEnvelope.revision) + 1;
    const payload = {
      ...localDraftPayload(),
      cacheRevision: nextRevision,
      cacheWriterId: TAB_INSTANCE_ID,
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
    localDraftStorageRevision = nextRevision;
    persistAuxiliaryState();
    if (!options.silent) {
      if (isWorkflowDirty) setSaveState("dirty", "브라우저 자동저장됨 · 파일 미반영");
      else applyCurrentWorkflowSaveState();
    }
    return true;
  } catch (error) {
    setSaveState("error", "브라우저 자동저장 실패");
    if (!options.silent) showToast(`브라우저 자동저장 실패: ${error.message || "브라우저 저장소 오류"}`);
    return false;
  }
}

function scheduleLocalDraftSave() {
  if (localDraftTimer) clearTimeout(localDraftTimer);
  localDraftTimer = setTimeout(() => persistLocalDraft(), LOCAL_DRAFT_DEBOUNCE_MS);
}

function serverWorkflowId(value) {
  const normalized = safeId(value).replace(/^[^a-z0-9]+/, "");
  const candidate = normalized || `workflow_${Date.now()}`;
  return candidate.slice(0, 128);
}

function hashSnapshot(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function workflowShouldArchiveToTemp() {
  if (!isWorkflowDirty) return false;
  const snapshot = exportWorkflowForDownload();
  const hasGraphContent = Boolean(snapshot.nodes?.length || snapshot.links?.length);
  if (!hasGraphContent) return false;
  const currentHash = hashSnapshot(snapshot);
  const meta = currentWorkflowSyncMeta();
  const savedHash = meta.lastFolderSavedHash || lastFolderSavedHash;
  return !savedHash || currentHash !== savedHash;
}

function suggestedWorkflowFileName() {
  const item = workflowStore.find(workflowItem => workflowItem.id === currentWorkflowId);
  const base = String(item?.name || currentWorkflowId || "workflow")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/[. ]+$/g, "")
    || "workflow";
  return `${base}.json`;
}

function currentWorkflowFileNameForName(value) {
  const base = String(value || "workflow")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/[. ]+$/g, "")
    || "workflow";
  const fileName = /\.json$/i.test(base) ? base : `${base}.json`;
  return `current/${fileName}`;
}

function validWorkflowFileName(value) {
  const name = String(value || "").trim();
  const parts = name.split("/");
  const scopedFolder = parts.length === 2 ? parts[0] : "";
  const basename = parts.length === 2 && ["list", "current", "temp"].includes(scopedFolder) ? parts[1] : name;
  return Boolean(
    name
    && (parts.length === 1 || (parts.length === 2 && ["list", "current", "temp"].includes(scopedFolder)))
    && basename
    && /\.json$/i.test(name)
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(basename)
    && basename !== "."
    && basename !== ".."
    && basename === basename.trim()
    && !/[. ]$/.test(basename)
  );
}

async function performWorkflowSave(options = {}) {
  const isNewFileAssociation = !currentWorkflowFileName;
  let fileName = currentWorkflowFileName;
  if (!fileName) {
    fileName = options.fileName
      || prompt("workflows 폴더에 저장할 파일명", suggestedWorkflowFileName())?.trim();
  }
  if (!fileName) return false;
  if (!/\.json$/i.test(fileName)) fileName += ".json";
  if (!fileName.includes("/")) fileName = `current/${fileName}`;
  if (!validWorkflowFileName(fileName)) {
    showToast("파일명은 폴더 경로 없이 .json 확장자로 입력해 주세요.");
    return false;
  }

  updateCurrentWorkflowStore();
  const snapshot = exportWorkflowForDownload();
  const requestedHash = hashSnapshot(snapshot);
  const requestContext = captureLocalToolContext();
  const requestWorkflowId = currentWorkflowId;
  const requestWorkflowObject = currentWorkflow;
  const requestStillCurrent = () => (
    isCurrentLocalToolContext(requestContext)
    && requestWorkflowId === currentWorkflowId
    && requestWorkflowObject === currentWorkflow
  );
  const savedAt = new Date().toISOString();
  const button = document.getElementById("saveWorkflowBtn");
  if (button) button.disabled = true;
  setSaveState("saving", `workflows/${savedWorkflowDisplayName(fileName)} 저장 중...`);
  try {
    const sendSaveRequest = overwrite => localToolFetch(
      `workflows/${encodeURIComponent(fileName)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(!overwrite ? { "If-None-Match": "*" } : {}),
        },
        body: JSON.stringify(snapshot),
      }
    );
    let response = await sendSaveRequest(!isNewFileAssociation);
    let result = await response.json().catch(() => ({}));
    if (!requestStillCurrent()) {
      if (!options.silent) {
        showToast(
          response.ok
            ? "이전 편집 상태는 파일에 저장됐지만 현재 워크플로우와 연결하지 않았습니다."
            : "이전 경로의 저장 응답은 현재 워크플로우에 적용하지 않았습니다."
        );
      }
      return false;
    }
    if (
      isNewFileAssociation
      && response.status === 409
      && result.error?.code === "workflow_exists"
    ) {
      if (!confirm(`workflows/${savedWorkflowDisplayName(fileName)} 파일이 이미 있습니다.\n기존 파일을 덮어쓸까요?`)) {
        setSaveState("dirty", "브라우저 자동저장됨 · 저장 취소");
        return false;
      }
      response = await sendSaveRequest(true);
      result = await response.json().catch(() => ({}));
      if (!requestStillCurrent()) return false;
    }
    if (!response.ok || !result.ok) {
      throw new Error(
        response.status === 401
          ? "연결 토큰이 필요합니다"
          : result.error?.message || `HTTP ${response.status}`
      );
    }
    currentWorkflowFileName = result.fileName || fileName;
    currentWorkflowSourceFileName = result.sourceWorkflow?.replace(/^list\//, "") || currentWorkflowSourceFileName;
    currentWorkflowResetFileName = result.resetWorkflow?.replace(/^list\//, "") || null;
    const latestHash = hashSnapshot(exportWorkflowForDownload());
    if (latestHash === requestedHash) {
      clearWorkflowDirty(savedAt, null, requestedHash, currentWorkflowFileName);
    } else {
      const meta = currentWorkflowSyncMeta();
      meta.dirty = true;
      meta.lastFolderSavedAt = savedAt;
      meta.lastFolderSavedHash = requestedHash;
      meta.fileName = currentWorkflowFileName;
      isWorkflowDirty = true;
      lastFolderSavedAt = savedAt;
      lastFolderSavedHash = requestedHash;
      setSaveState("dirty", "이전 편집본 저장됨 · 이후 변경은 브라우저에만 있음");
    }
    persistLocalDraft({ immediate: true, silent: true });
    await syncServerWorkflows();
    if (!requestStillCurrent()) return false;
    renderAll();
    if (!options.silent) showToast(`workflows/${savedWorkflowDisplayName(currentWorkflowFileName)} 저장 완료`);
    return true;
  } catch (error) {
    if (!requestStillCurrent()) return false;
    isWorkflowDirty = true;
    currentWorkflowSyncMeta().dirty = true;
    setSaveState("error", "저장 실패 · 브라우저 초안 유지");
    persistLocalDraft({ immediate: true, silent: true });
    if (!options.silent) {
      showToast(
        LOCAL_STUDIO_MODE
          ? `저장 실패: ${error.message || "workflows 폴더 쓰기 오류"}`
          : `저장 실패: ${error.message || "로컬 툴 연결 오류"} · 연결 토큰과 studio_bridge.py를 확인해 주세요.`
      );
    }
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function saveWorkflowToServer(options = {}) {
  if (localToolSavePromise) return localToolSavePromise;
  const operation = performWorkflowSave(options).finally(() => {
    if (localToolSavePromise === operation) localToolSavePromise = null;
  });
  localToolSavePromise = operation;
  return operation;
}

window.saveWorkflowToServer = saveWorkflowToServer;
window.saveWorkflowToFolder = saveWorkflowToServer;

async function syncServerWorkflows(options = {}) {
  const requestId = ++serverWorkflowRequestSequence;
  const requestContext = captureLocalToolContext();
  serverWorkflowListStatus = "loading";
  renderServerWorkflowList();
  renderStudioContext();
  try {
    const response = await localToolFetch("workflows");
    const result = await response.json().catch(() => ({}));
    if (
      requestId !== serverWorkflowRequestSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return null;
    if (!response.ok || !Array.isArray(result.workflows)) {
      throw new Error(
        response.status === 401
          ? "연결 토큰이 필요합니다"
          : result.error?.message || `HTTP ${response.status}`
      );
    }
    serverWorkflowItems = result.workflows;
    tempWorkflowItems = Array.isArray(result.tempWorkflows) ? result.tempWorkflows : [];
    serverWorkflowListStatus = "ready";
    if (options.loadCurrent && result.currentWorkflow?.workflow) {
      applyLoadedWorkflowResult(result.currentWorkflow, result.currentWorkflow.fileName);
    }
    renderWorkflowList();
    renderServerWorkflowList();
    renderStudioContext();
    return true;
  } catch (error) {
    if (
      requestId !== serverWorkflowRequestSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return null;
    serverWorkflowListStatus = "error";
    tempWorkflowItems = [];
    renderWorkflowList();
    renderServerWorkflowList();
    renderStudioContext();
    if (options.notify) {
      showToast(
        LOCAL_STUDIO_MODE
          ? `workflows 폴더 조회 실패: ${error.message || "읽기 오류"}`
          : `workflows 폴더 조회 실패: ${error.message || "연결 오류"} · 로컬 툴 연결을 확인해 주세요.`
      );
    }
    return false;
  }
}

function applyLoadedWorkflowResult(result, fallbackFileName) {
  const snapshot = structuredClone(result.workflow);
  normalizeWorkflowShape(snapshot);
  rebuildImportedLinkRefs(snapshot);
  const loadedFileName = result.fileName || fallbackFileName;
  const name = loadedFileName.split("/").pop().replace(/\.json$/i, "");
  const id = `${safeId(name) || "workflow"}_current`;
  currentWorkflowId = id;
  currentWorkflow = snapshot;
  currentWorkflowFileName = loadedFileName;
  currentWorkflowSourceFileName = result.sourceWorkflow?.replace(/^list\//, "") || null;
  currentWorkflowResetFileName = result.resetWorkflow?.replace(/^list\//, "") || null;
  projectStore = [{ id: "local_tool", name: "Local Tool" }];
  currentProjectId = "local_tool";
  workflowStore = [{ id, name, projectId: currentProjectId, data: snapshot }];
  historyStack = [];
  redoStack = [];
  selectedNodeId = null;
  selectedLinkId = null;
  workflowSyncState = {};
  const savedHash = hashSnapshot(exportWorkflowForDownload());
  clearWorkflowDirty(new Date().toISOString(), null, savedHash, loadedFileName);
  persistLocalDraft({ immediate: true, silent: true });
  renderAll();
  fitView();
  return loadedFileName;
}

async function loadServerWorkflow(fileName, options = {}) {
  if (!fileName) return false;
  if (!confirmUnsavedBeforeSwitch()) return false;
  const requestId = ++localToolWorkflowLoadSequence;
  const requestContext = captureLocalToolContext();
  try {
    if (isWorkflowDirty) await archiveDirtyCurrentWorkflowBeforeReplacement();
    const response = await localToolFetch(
      options.activate
        ? `workflows/${encodeURIComponent(fileName)}/activate`
        : `workflows/${encodeURIComponent(fileName)}`,
      options.activate
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-InfraX-Archive-Current": "false",
            },
            body: "{}",
          }
        : undefined
    );
    const result = await response.json().catch(() => ({}));
    if (
      requestId !== localToolWorkflowLoadSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return false;
    if (!response.ok || !result.workflow) {
      throw new Error(
        response.status === 401
          ? "연결 토큰이 필요합니다"
          : result.error?.message || `HTTP ${response.status}`
      );
    }
    const loadedFileName = applyLoadedWorkflowResult(result, fileName);
    await syncServerWorkflows();
    showToast(`workflows/${loadedFileName} 파일을 열었습니다.`);
    return true;
  } catch (error) {
    if (
      requestId !== localToolWorkflowLoadSequence
      || !isCurrentLocalToolContext(requestContext)
    ) return false;
    showToast(
      `워크플로우 파일 열기 실패: ${error.message || (LOCAL_STUDIO_MODE ? "파일 읽기 오류" : "로컬 툴 연결 오류")}`
    );
    return false;
  }
}

window.syncServerWorkflows = syncServerWorkflows;
window.loadServerWorkflow = loadServerWorkflow;

async function restoreTempWorkflow(fileName) {
  if (!fileName) return false;
  if (!confirmUnsavedBeforeSwitch()) return false;
  const requestContext = captureLocalToolContext();
  try {
    if (isWorkflowDirty) await archiveDirtyCurrentWorkflowBeforeReplacement();
    const response = await localToolFetch(
      `workflows/${encodeURIComponent(fileName)}/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!isCurrentLocalToolContext(requestContext)) return false;
    if (!response.ok || !result.ok) {
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    }
    const loadedFileName = applyLoadedWorkflowResult(result, fileName);
    await syncServerWorkflows();
    showToast(`임시 보관함에서 workflows/${loadedFileName} 작업본을 복원했습니다.`);
    return true;
  } catch (error) {
    showToast(`임시 작업본 복원 실패: ${error.message || "로컬 파일 오류"}`);
    return false;
  }
}

async function deleteTempWorkflow(fileName) {
  if (!fileName) return false;
  if (!confirm("이 임시 작업본을 삭제할까요?")) return false;
  try {
    const response = await localToolFetch(
      `workflows/${encodeURIComponent(fileName)}/delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error?.message || `HTTP ${response.status}`);
    }
    await syncServerWorkflows();
    showToast("임시 작업본을 삭제했습니다.");
    return true;
  } catch (error) {
    showToast(`임시 작업본 삭제 실패: ${error.message || "로컬 파일 오류"}`);
    return false;
  }
}

window.restoreTempWorkflow = restoreTempWorkflow;
window.deleteTempWorkflow = deleteTempWorkflow;

function applyAuxiliaryState(state = {}) {
  if (Array.isArray(state.registeredMarketplacePackages)) {
    registeredMarketplacePackages = state.registeredMarketplacePackages
      .filter(pkg => pkg && pkg.registrationOnly)
      .map(pkg => ({
        ...pkg,
        canManage: false,
        kind: pkg.kind === "workflow-bundle" || pkg.workflow ? "workflow-bundle" : "node-pack"
      }));
  }
  if (Array.isArray(state.downloadedMarketplacePackageIds)) {
    downloadedMarketplacePackageIds = [...new Set(state.downloadedMarketplacePackageIds.filter(Boolean))];
  }
  if (typeof state.localAuthorProfile === "string") {
    localAuthorProfile = state.localAuthorProfile.trim();
  }
  if (state.explorerState && typeof state.explorerState === "object") {
    explorerState.connected = Boolean(state.explorerState.connected);
    explorerState.mode = String(state.explorerState.mode || "mock-catalog");
    explorerState.lastScannedAt = state.explorerState.lastScannedAt || null;
  }
  if (Array.isArray(state.scriptLibrary)) {
    scriptLibrary.splice(0, scriptLibrary.length, ...state.scriptLibrary);
  }
  catalogModels = normalizeCatalogModels(state.catalogModels);
  if (Array.isArray(state.portTypes) && state.portTypes.length) {
    portTypes = [...new Set([...DEFAULT_PORT_TYPES, ...state.portTypes])];
  }
  if (Array.isArray(state.nodeTypes) && state.nodeTypes.length) {
    nodeTypes = [...new Set([...DEFAULT_NODE_TYPES, ...state.nodeTypes])];
  }
  if (state.portTypePatterns && typeof state.portTypePatterns === "object") {
    portTypePatterns = { ...DEFAULT_TYPE_PATTERNS, ...state.portTypePatterns };
  }
}

function preserveCorruptedLocalStorageValue(storageKey, rawValue) {
  if (!rawValue) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupKey = `${storageKey}:corrupt-backup:${timestamp}`;
  try {
    localStorage.setItem(backupKey, rawValue);
    return backupKey;
  } catch {
    return null;
  }
}

function restoreState() {
  let raw = null;
  let auxiliaryRaw = null;
  let restoreStage = "draft";
  try {
    raw = readScopedLocalStorage(WORKFLOW_STORAGE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    localDraftStorageRevision = storageEnvelope(raw).revision;
    externalDraftConflict = false;
    localDraftWriteBlockedReason = null;
    const legacyWorkflowItem = Array.isArray(state.workflowStore)
      ? state.workflowStore.find(item => item?.id === state.currentWorkflowId) || state.workflowStore[0]
      : null;
    const restoredData = state.data && typeof state.data === "object"
      ? state.data
      : legacyWorkflowItem?.data;
    const restoredName = String(
      state.name
      || legacyWorkflowItem?.name
      || currentWorkflowId
      || "untitled"
    );
    if (restoredData) {
      currentWorkflow = restoredData;
      normalizeWorkflowShape(currentWorkflow);
      rebuildLinkRefs();
    }
    currentProjectId = "local_tool";
    projectStore = [{ id: currentProjectId, name: "Local Tool" }];
    currentWorkflowId = `${safeId(restoredName) || "workflow"}_current`;
    workflowStore = [{
      id: currentWorkflowId,
      name: restoredName,
      projectId: currentProjectId,
      data: currentWorkflow,
    }];
    const restoredFileToolRoot = typeof state.fileToolRoot === "string"
      ? state.fileToolRoot
      : "";
    const fileAssociationMatchesToolRoot = (
      typeof state.fileName === "string"
      && Boolean(restoredFileToolRoot)
      && Boolean(localToolRootPreference)
      && sameToolRoot(restoredFileToolRoot, localToolRootPreference)
    );
    currentWorkflowFileName = fileAssociationMatchesToolRoot ? state.fileName : null;
    lastFolderSavedAt = fileAssociationMatchesToolRoot ? state.lastFolderSavedAt || null : null;
    lastFolderSavedHash = fileAssociationMatchesToolRoot ? state.lastFolderSavedHash || null : null;
    isWorkflowDirty = raw
      ? fileAssociationMatchesToolRoot
        ? Boolean(state.dirty ?? true)
        : true
      : true;
    workflowSyncState = {
      [currentWorkflowId]: {
        dirty: isWorkflowDirty,
        localDraftSavedAt: state.draftCachedAt || null,
        lastFolderSavedAt,
        lastFolderSavedHash,
        fileName: currentWorkflowFileName,
      },
    };
    workflowListCollapsed = true;
    if (Array.isArray(state.historyStack)) {
      historyStack = state.historyStack.map(entry => reviveHistoryEntry(entry, "Previous state")).slice(-HISTORY_LIMIT);
    }
    if (Array.isArray(state.redoStack)) {
      redoStack = state.redoStack.map(entry => reviveHistoryEntry(entry, "Redo state")).slice(-HISTORY_LIMIT);
    }
    restoreStage = "auxiliary";
    auxiliaryRaw = readScopedLocalStorage(AUXILIARY_STORAGE_KEY);
    auxiliaryStorageRevision = storageEnvelope(auxiliaryRaw).revision;
    externalAuxiliaryConflict = false;
    auxiliaryPersistFailed = false;
    if (auxiliaryRaw) applyAuxiliaryState(JSON.parse(auxiliaryRaw));
    explorerState.connected = false;
    explorerState.mode = "local-tool";
    scriptLibrary.forEach(script => {
      if (script?.type && !nodeTypes.includes(script.type)) nodeTypes.push(script.type);
    });
    portTypes.forEach(type => {
      if (!portTypePatterns[type]) portTypePatterns[type] = type === "*" ? "^.*$" : "";
    });
    applyCurrentWorkflowSaveState();
    return {
      restored: Boolean(raw),
      corrupted: false,
      allowInitialPersist: !raw,
    };
  } catch (error) {
    const draftFailed = restoreStage === "draft";
    const storageKey = draftFailed
      ? CURRENT_DRAFT_STORAGE_KEY
      : scopedStorageKey(AUXILIARY_STORAGE_KEY);
    const corruptedValue = draftFailed ? raw : auxiliaryRaw;
    const backupKey = preserveCorruptedLocalStorageValue(storageKey, corruptedValue);
    if (draftFailed && corruptedValue && !backupKey) {
      localDraftWriteBlockedReason = "손상된 브라우저 초안을 보존하기 위해 자동저장을 중지했습니다. JSON 보기에서 내용을 복사한 뒤 저장소를 정리해 주세요.";
    }
    if (!draftFailed) auxiliaryPersistFailed = !backupKey;
    return {
      restored: !draftFailed && Boolean(raw),
      corrupted: true,
      backupKey,
      allowInitialPersist: draftFailed ? !corruptedValue || Boolean(backupKey) : !raw,
      error,
    };
  }
}

function fitView() {
  if (!currentWorkflow.nodes.length) {
    worldTransform = { x: 0, y: 0, scale: 1 };
    applyWorldTransform();
    return;
  }
  const minX = Math.min(...currentWorkflow.nodes.map(node => node.pos[0]));
  const minY = Math.min(...currentWorkflow.nodes.map(node => node.pos[1]));
  const maxX = Math.max(...currentWorkflow.nodes.map(node => node.pos[0] + (node.size?.[0] || 270)));
  const maxY = Math.max(...currentWorkflow.nodes.map(node => node.pos[1] + (node.size?.[1] || 82)));
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const rect = canvasShell.getBoundingClientRect();
  const padding = Math.min(110, Math.max(48, rect.width * 0.09));
  const availableWidth = Math.max(1, rect.width - padding * 2);
  const availableHeight = Math.max(1, rect.height - padding * 2);
  const fittedScale = Math.min(1.2, availableWidth / graphWidth, availableHeight / graphHeight);
  worldTransform.scale = Math.max(0.35, fittedScale);
  worldTransform.x = (rect.width - graphWidth * worldTransform.scale) / 2 - minX * worldTransform.scale;
  worldTransform.y = (rect.height - graphHeight * worldTransform.scale) / 2 - minY * worldTransform.scale;
  applyWorldTransform();
}

function applyWorldTransform() {
  world.style.transform = `translate(${worldTransform.x}px, ${worldTransform.y}px) scale(${worldTransform.scale})`;
  document.getElementById("zoomResetBtn").textContent = `${Math.round(worldTransform.scale * 100)}%`;
  requestAnimationFrame(renderLinks);
}

function zoomBy(delta) {
  worldTransform.scale = Math.min(2.2, Math.max(0.35, worldTransform.scale + delta));
  applyWorldTransform();
}

function resetZoom() {
  worldTransform.scale = 1;
  applyWorldTransform();
}

function canvasToWorld(clientX, clientY) {
  const rect = canvasShell.getBoundingClientRect();
  return {
    x: (clientX - rect.left - worldTransform.x) / worldTransform.scale,
    y: (clientY - rect.top - worldTransform.y) / worldTransform.scale
  };
}

function visibleCanvasCenterWorld() {
  const rect = canvasShell.getBoundingClientRect();
  return canvasToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function registerScript() {
  openScriptModal();
}

function openScriptModal() {
  const selectedNode = currentWorkflow.nodes.find(node => node.id === selectedNodeId);
  const modal = document.getElementById("scriptModal");
  populateNodeTypeSelect();
  populatePortTypeSelects();
  fillScriptModalDefaults(selectedNode);
  modal.classList.remove("hidden");
  document.getElementById("scriptTypeInput").focus();
}

function closeScriptModal() {
  document.getElementById("scriptModal").classList.add("hidden");
}

window.closeScriptModal = closeScriptModal;

function fillScriptModalDefaults(selectedNode = currentWorkflow.nodes.find(node => node.id === selectedNodeId)) {
  populateNodeTypeSelect();
  document.getElementById("scriptTypeInput").value = selectedNode?.type || "Add";
  document.getElementById("scriptNameInput").value = selectedNode ? `${selectedNode.type} Script` : "Add Script";
  document.getElementById("scriptDeveloperInput").value = "user";
  document.getElementById("scriptVersionInput").value = "1.0";
  document.getElementById("scriptStatusInput").value = "experimental";
  document.getElementById("scriptCommandInput").value = selectedNode ? `python-3.10.0-embed-amd64\\python.exe scripts/${selectedNode.type.toLowerCase()}.py` : "python-3.10.0-embed-amd64\\python.exe scripts/math/add.py";
  modalPorts.inputs = structuredClone(selectedNode?.inputs?.map(({ name, type }) => ({ name, type })) || [{ name: "a", type: "INT" }, { name: "b", type: "INT" }]);
  modalPorts.outputs = structuredClone(selectedNode?.outputs?.map(({ name, type }) => ({ name, type })) || [{ name: "INT", type: "INT" }]);
  document.getElementById("scriptInputNameInput").value = "";
  document.getElementById("scriptOutputNameInput").value = "";
  document.getElementById("scriptInputTypeInput").value = "INT";
  document.getElementById("scriptOutputTypeInput").value = "INT";
  document.getElementById("createNodeAfterRegisterInput").checked = false;
  renderPortChips();
}

function resetScriptModal() {
  fillScriptModalDefaults();
  document.getElementById("scriptTypeInput").focus();
}

window.resetScriptModal = resetScriptModal;

function cancelScriptModal() {
  fillScriptModalDefaults();
  closeScriptModal();
}

window.cancelScriptModal = cancelScriptModal;

function populatePortTypeSelects() {
  ["scriptInputTypeInput", "scriptOutputTypeInput"].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value || "INT";
    select.innerHTML = portTypes.map(type => `<option value="${type}">${type}</option>`).join("");
    select.value = portTypes.includes(previous) ? previous : (portTypes[0] || "*");
  });
}

function populateNodeTypeSelect() {
  const select = document.getElementById("scriptTypeInput");
  if (!select) return;
  scriptLibrary.forEach(script => {
    if (script?.type && !nodeTypes.includes(script.type)) nodeTypes.push(script.type);
  });
  currentWorkflow.nodes.forEach(node => {
    if (node?.type && !nodeTypes.includes(node.type)) nodeTypes.push(node.type);
  });
  const previous = select.value || "Add";
  select.innerHTML = nodeTypes.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  select.value = nodeTypes.includes(previous) ? previous : (nodeTypes.includes("Add") ? "Add" : nodeTypes[0]);
}

function addPortFromModal(kind) {
  const isInput = kind === "input";
  const nameEl = document.getElementById(isInput ? "scriptInputNameInput" : "scriptOutputNameInput");
  const typeEl = document.getElementById(isInput ? "scriptInputTypeInput" : "scriptOutputTypeInput");
  const name = nameEl.value.trim();
  const type = typeEl.value;
  if (!name) {
    alert("변수명을 입력하세요.");
    nameEl.focus();
    return;
  }
  const key = isInput ? "inputs" : "outputs";
  if (modalPorts[key].some(port => port.name === name)) {
    alert("같은 이름의 변수가 이미 있습니다.");
    nameEl.focus();
    return;
  }
  modalPorts[key].push({ name, type });
  nameEl.value = "";
  nameEl.focus();
  renderPortChips();
}

window.addPortFromModal = addPortFromModal;

function removePortFromModal(kind, index) {
  const key = kind === "input" ? "inputs" : "outputs";
  modalPorts[key].splice(index, 1);
  renderPortChips();
}

window.removePortFromModal = removePortFromModal;

function renderPortChips() {
  renderPortChipList("input", modalPorts.inputs);
  renderPortChipList("output", modalPorts.outputs);
}

function renderPortChipList(kind, ports) {
  const root = document.getElementById(kind === "input" ? "scriptInputChipList" : "scriptOutputChipList");
  if (!root) return;
  root.innerHTML = ports.length
    ? ports.map((port, index) => `
      <span class="port-chip">
        ${escapeHtml(port.name)} <small>${escapeHtml(port.type)}</small>
        <button type="button" title="삭제" onclick="removePortFromModal('${kind}', ${index})">x</button>
      </span>
    `).join("")
    : `<span style="color:var(--muted);">아직 추가된 변수가 없습니다.</span>`;
}

function openTypeModal() {
  renderTypeChips();
  updateResetTypesVisibility();
  document.getElementById("typeModal").classList.remove("hidden");
  document.getElementById("newTypeInput").focus();
}

window.openTypeModal = openTypeModal;

function closeTypeModal() {
  document.getElementById("typeModal").classList.add("hidden");
  document.getElementById("regexHelpTooltip")?.classList.remove("pinned");
  populatePortTypeSelects();
}

window.closeTypeModal = closeTypeModal;

function toggleRegexHelp(event) {
  event.stopPropagation();
  document.getElementById("regexHelpTooltip")?.classList.toggle("pinned");
}

window.toggleRegexHelp = toggleRegexHelp;

function addTypeFromModal() {
  const raw = document.getElementById("newTypeInput").value.trim();
  const type = raw.toUpperCase().replace(/[^A-Z0-9_*.-]/g, "_");
  const pattern = document.getElementById("newTypePatternInput").value.trim();
  if (!type) {
    alert("타입명을 입력하세요.");
    return;
  }
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch (error) {
      alert(`정규식 문법을 확인하세요.\n${error.message}`);
      document.getElementById("newTypePatternInput").focus();
      return;
    }
  }
  if (portTypes.includes(type)) {
    portTypePatterns[type] = pattern || portTypePatterns[type] || "";
    document.getElementById("newTypeInput").value = "";
    document.getElementById("newTypePatternInput").value = "";
    renderTypeChips();
    updateResetTypesVisibility();
    populatePortTypeSelects();
    persistAuxiliaryState();
    showToast(`타입 정규식 수정: ${type}`);
    return;
  }
  portTypes.push(type);
  portTypePatterns[type] = pattern;
  document.getElementById("newTypeInput").value = "";
  document.getElementById("newTypePatternInput").value = "";
  renderTypeChips();
  updateResetTypesVisibility();
  populatePortTypeSelects();
  persistAuxiliaryState();
  showToast(`타입 추가: ${type}`);
}

window.addTypeFromModal = addTypeFromModal;

function removeType(type) {
  if (DEFAULT_PORT_TYPES.includes(type)) {
    alert("기본 타입은 삭제하지 않도록 제한했습니다.");
    return;
  }
  const used = scriptLibrary.some(script =>
    [...(script.inputs || []), ...(script.outputs || [])].some(port => port.type === type)
  );
  if (used && !confirm(`${type} 타입을 사용하는 Script가 있습니다. 그래도 삭제할까요?`)) return;
  portTypes = portTypes.filter(item => item !== type);
  delete portTypePatterns[type];
  renderTypeChips();
  updateResetTypesVisibility();
  populatePortTypeSelects();
  persistAuxiliaryState();
}

window.removeType = removeType;

function editTypePattern(type) {
  document.getElementById("newTypeInput").value = type;
  document.getElementById("newTypePatternInput").value = portTypePatterns[type] || "";
  document.getElementById("newTypePatternInput").focus();
}

window.editTypePattern = editTypePattern;

function resetTypes() {
  portTypes = [...new Set([...DEFAULT_PORT_TYPES, ...portTypes])];
  portTypePatterns = { ...portTypePatterns, ...DEFAULT_TYPE_PATTERNS };
  renderTypeChips();
  updateResetTypesVisibility();
  populatePortTypeSelects();
  persistAuxiliaryState();
}

window.resetTypes = resetTypes;

function resetTypePattern(type) {
  if (!DEFAULT_PORT_TYPES.includes(type)) return;
  portTypePatterns[type] = DEFAULT_TYPE_PATTERNS[type] || "";
  renderTypeChips();
  updateResetTypesVisibility();
  persistAuxiliaryState();
  showToast(`기본 정규식 복원: ${type}`);
}

window.resetTypePattern = resetTypePattern;

function isDefaultTypePatternChanged(type) {
  return DEFAULT_PORT_TYPES.includes(type) && (portTypePatterns[type] || "") !== (DEFAULT_TYPE_PATTERNS[type] || "");
}

function renderTypeChips() {
  const root = document.getElementById("typeChipList");
  if (!root) return;
  root.innerHTML = portTypes.map(type => `
    <span class="port-chip type-chip" onclick="editTypePattern(${inlineJson(type)})" title="클릭해서 정규식 수정">
      ${escapeHtml(type)}
      <small>${DEFAULT_PORT_TYPES.includes(type) ? "기본" : "사용자"}</small>
      <code title="${escapeHtml(portTypePatterns[type] || "")}">${escapeHtml(portTypePatterns[type] || "정규식 없음")}</code>
      ${isDefaultTypePatternChanged(type) ? `<button class="revert" type="button" title="기본값으로 되돌리기" onclick="event.stopPropagation(); resetTypePattern(${inlineJson(type)})">↺</button>` : ""}
      <button type="button" title="삭제" onclick="event.stopPropagation(); removeType(${inlineJson(type)})">x</button>
    </span>
  `).join("");
  updateResetTypesVisibility();
}

function hasDefaultTypePatternChanged() {
  return DEFAULT_PORT_TYPES.some(type => (portTypePatterns[type] || "") !== (DEFAULT_TYPE_PATTERNS[type] || ""));
}

function updateResetTypesVisibility() {
  document.getElementById("resetTypesBtn")?.classList.add("hidden");
}

function submitScriptForm(event) {
  event.preventDefault();
  addScriptFromModal();
}

function addScriptFromModal() {
  const type = document.getElementById("scriptTypeInput").value.trim();
  const name = document.getElementById("scriptNameInput").value.trim();
  if (!type || !name) {
    alert("Node Type과 Script Name은 필수입니다.");
    return;
  }
  if (!modalPorts.inputs.length && !modalPorts.outputs.length) {
    alert("Input 또는 Output 변수를 하나 이상 추가하세요.");
    return;
  }
  const script = {
    id: `${type.toLowerCase()}_${Date.now()}`,
    type,
    name,
    developer: document.getElementById("scriptDeveloperInput").value.trim() || "user",
    version: document.getElementById("scriptVersionInput").value.trim() || "1.0",
    status: document.getElementById("scriptStatusInput").value || "experimental",
    command: document.getElementById("scriptCommandInput").value.trim() || "python",
    path: document.getElementById("scriptCommandInput").value.trim(),
    inputs: structuredClone(modalPorts.inputs),
    outputs: structuredClone(modalPorts.outputs)
  };
  scriptLibrary.push(script);
  lastRegisteredScriptId = script.id;
  const shouldCreateNode = document.getElementById("createNodeAfterRegisterInput").checked;
  persistAuxiliaryState();
  closeScriptModal();
  renderAll();
  openSidebarSection("paletteSection");
  appendLog(`[INFO] registered script ${script.name} / ${script.type} / ${script.version}`);
  showToast(`Script 등록 완료: ${script.name} (${script.type})`);
  if (shouldCreateNode) {
    addNode(script.type);
    showToast(`Script 등록 후 ${script.type} 노드를 추가했습니다.`);
  }
}

window.addScriptFromModal = addScriptFromModal;

function setupAssetSidebar() {
  const sideContent = document.querySelector(".side-content");
  const localFilesSection = document.getElementById("localFilesSection");
  const paletteSection = document.getElementById("paletteSection");
  if (!sideContent || !localFilesSection || !paletteSection || document.getElementById("assetSection")) return;

  const assetSection = document.createElement("section");
  assetSection.className = "section sidebar-hidden";
  assetSection.id = "assetSection";
  assetSection.innerHTML = `
    <div class="section-heading">
      <div>
        <span class="eyebrow">LOCAL ASSETS</span>
        <h2>자산</h2>
      </div>
    </div>
    <div class="sidebar-tabs" role="tablist" aria-label="자산 목록">
      <button class="sidebar-tab active" type="button" data-asset-tab="workflow" role="tab" aria-selected="true">워크플로우</button>
      <button class="sidebar-tab" type="button" data-asset-tab="node" role="tab" aria-selected="false">노드</button>
      <button class="sidebar-tab" type="button" data-asset-tab="model" role="tab" aria-selected="false">모델</button>
    </div>
    <div class="asset-pane-stack"></div>
  `;
  sideContent.insertBefore(assetSection, localFilesSection);
  const stack = assetSection.querySelector(".asset-pane-stack");
  const modelSection = document.createElement("section");
  modelSection.className = "asset-pane hidden";
  modelSection.id = "modelAssetSection";
  modelSection.dataset.assetPane = "model";
  modelSection.innerHTML = `
    <div class="section-heading">
      <div>
        <span class="eyebrow">MODEL LIBRARY</span>
        <h2>모델 라이브러리</h2>
      </div>
    </div>
    <p class="section-description">catalog.json에서 확인된 모델 파일을 <code>models</code> 폴더 구조에 따라 표시합니다.</p>
    <div class="library-search">
      <label>
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input id="modelSearchInput" type="search" placeholder="모델 이름 또는 경로 검색" autocomplete="off" />
      </label>
    </div>
    <div class="nav-list node-library-list" id="modelPalette"></div>
  `;

  [localFilesSection, paletteSection].forEach(section => {
    section.classList.remove("section", "sidebar-hidden");
    section.classList.add("asset-pane");
    stack.appendChild(section);
  });
  stack.appendChild(modelSection);
  localFilesSection.dataset.assetPane = "workflow";
  paletteSection.dataset.assetPane = "node";
  modelSection.querySelector("#modelSearchInput")?.addEventListener("input", renderModelPalette);

  assetSection.querySelectorAll("[data-asset-tab]").forEach(button => {
    button.addEventListener("click", () => setAssetSidebarTab(button.dataset.assetTab));
  });
  setAssetSidebarTab(assetSidebarTab, { scroll: false });
}

function setAssetSidebarTab(tab, options = {}) {
  assetSidebarTab = ["workflow", "node", "model"].includes(tab) ? tab : "workflow";
  document.querySelectorAll("[data-asset-tab]").forEach(button => {
    const active = button.dataset.assetTab === assetSidebarTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-asset-pane]").forEach(pane => {
    pane.classList.toggle("hidden", pane.dataset.assetPane !== assetSidebarTab);
  });
  if (options.scroll !== false) {
    document.querySelector(".side-content")?.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function openSidebarSection(sectionId) {
  if (sectionId === "localFilesSection") {
    setAssetSidebarTab("workflow", { scroll: false });
    sectionId = "assetSection";
  } else if (sectionId === "paletteSection") {
    setAssetSidebarTab("node", { scroll: false });
    sectionId = "assetSection";
  } else if (sectionId === "modelAssetSection") {
    setAssetSidebarTab("model", { scroll: false });
    sectionId = "assetSection";
  } else if (sectionId === "marketplaceSection") {
    renderSidebarMarketplace();
    void syncMarketplaceFromServer({ notify: false }).then(() => renderSidebarMarketplace());
    if (LOCAL_STUDIO_MODE) {
      void Promise.allSettled([
        syncInstalledLocalPackages(),
        syncLocalPublishablePackages(),
      ]).then(() => renderSidebarMarketplace());
    }
  }
  const section = document.getElementById(sectionId);
  if (!section) return;
  document.querySelectorAll(".side-content > .section").forEach(item => {
    item.classList.toggle("sidebar-hidden", item.id !== sectionId);
  });
  section.classList.remove("collapsed");
  document.querySelectorAll(".icon-tab").forEach(item => item.classList.toggle("active", item.dataset.target === sectionId));
  document.querySelector(".side-content")?.scrollTo({ top: 0, behavior: "smooth" });
}

function appendLog(message) {
  const log = document.querySelector(".log");
  log.innerHTML += `\n<span class="info">${escapeHtml(message)}</span>`;
  log.scrollTop = log.scrollHeight;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = errorMessage(message, "오류");
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "null";
  return escapeHtml(
    serialized
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029")
  );
}

function parsePortSpec(raw) {
  return raw.split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [name, type = "*"] = part.split(":").map(value => value.trim());
      return { name, type };
    });
}

function openNodeTypeModal() {
  renderNodeTypeChips();
  document.getElementById("nodeTypeModal").classList.remove("hidden");
  document.getElementById("newNodeTypeInput").focus();
}

window.openNodeTypeModal = openNodeTypeModal;

function closeNodeTypeModal() {
  document.getElementById("nodeTypeModal").classList.add("hidden");
  populateNodeTypeSelect();
}

window.closeNodeTypeModal = closeNodeTypeModal;

function addNodeTypeFromModal() {
  const raw = document.getElementById("newNodeTypeInput").value.trim();
  const type = raw.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!type) {
    alert("노드 타입명을 입력하세요.");
    return;
  }
  if (nodeTypes.includes(type)) {
    alert("이미 등록된 노드 타입입니다.");
    return;
  }
  nodeTypes.push(type);
  document.getElementById("newNodeTypeInput").value = "";
  renderNodeTypeChips();
  populateNodeTypeSelect();
  persistAuxiliaryState();
  showToast(`노드 타입 추가: ${type}`);
}

window.addNodeTypeFromModal = addNodeTypeFromModal;

function removeNodeType(type) {
  const used = currentWorkflow.nodes.some(node => node.type === type) || scriptLibrary.some(script => script.type === type);
  if (used && !confirm(`${type} 타입을 사용하는 노드 또는 Script가 있습니다. 그래도 목록에서 삭제할까요?`)) return;
  nodeTypes = nodeTypes.filter(item => item !== type);
  renderNodeTypeChips();
  populateNodeTypeSelect();
  persistAuxiliaryState();
}

window.removeNodeType = removeNodeType;

function renderNodeTypeChips() {
  const root = document.getElementById("nodeTypeChipList");
  if (!root) return;
  root.innerHTML = nodeTypes.map(type => {
    const used = scriptLibrary.some(script => script.type === type) || currentWorkflow.nodes.some(node => node.type === type);
    return `
      <span class="port-chip type-chip">
        ${escapeHtml(type)}
        <small>${DEFAULT_NODE_TYPES.includes(type) ? "기본" : "사용자"}</small>
        ${used ? "<code>사용중</code>" : ""}
        <button type="button" title="삭제" onclick="removeNodeType(${inlineJson(type)})">x</button>
      </span>
    `;
  }).join("");
}

function showRunOutput(title, output) {
  const panel = document.getElementById("runOutputPanel");
  const titleElement = document.getElementById("runOutputTitle");
  const textElement = document.getElementById("runOutputText");
  if (titleElement) titleElement.textContent = title;
  if (textElement) textElement.textContent = output || "(출력 없음)";
  panel?.classList.remove("hidden");
}

function appendRunOutput(line) {
  const textElement = document.getElementById("runOutputText");
  if (!textElement) return;
  textElement.textContent = `${textElement.textContent || ""}${line}\n`;
  textElement.scrollTop = textElement.scrollHeight;
}

function setRunNodeStatus(nodeId, status) {
  const node = currentWorkflow.nodes.find(item => String(item.id) === String(nodeId));
  if (!node) return null;
  node.run_status = status;
  return node;
}

function markWorkflowRunQueued() {
  currentWorkflow.nodes.forEach(node => { node.run_status = "pending"; });
  renderAll();
}

function applyWorkflowRunEvent(event) {
  if (event?.type === "node") {
    const node = setRunNodeStatus(event.nodeId, event.status);
    if (node && event.status === "running") {
      selectedNodeId = node.id;
      selectedLinkId = null;
    }
    renderAll();
    return;
  }
  if (event?.type === "output" && event.text) {
    appendRunOutput(`[${event.stream || "stdout"}] ${event.text}`);
  }
}

async function readRunEventStream(response, onEvent) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      onEvent(event);
      if (event.type === "run") finalEvent = event;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    onEvent(event);
    if (event.type === "run") finalEvent = event;
  }
  return finalEvent;
}

async function runWorkflowWithLegacyEndpoint(requestFileName) {
  const response = await localToolFetch(
    `workflows/${encodeURIComponent(requestFileName)}/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isInteger(result.returnCode)) {
    throw new Error(
      response.status === 401
        ? "연결 토큰이 필요합니다"
        : result.error?.message || `HTTP ${response.status}`
    );
  }
  return {
    ...result,
    legacyRun: true,
  };
}

async function runLocalWorkflow() {
  if (localToolRunActive) return false;
  localToolRunActive = true;
  const button = document.getElementById("runWorkflowBtn");
  if (button) button.disabled = true;
  let requestContext = null;
  let requestWorkflowId = null;
  let requestWorkflowObject = null;
  let requestFileName = null;
  try {
    if (!currentWorkflowFileName || isWorkflowDirty) {
      const saved = await saveWorkflowToServer({ silent: true });
      if (!saved || !currentWorkflowFileName || isWorkflowDirty) {
        showToast(
          saved
            ? "저장 중 추가 변경이 생겼습니다. 최신 편집본을 다시 저장한 뒤 실행해 주세요."
            : "실행 전에 workflows 폴더 저장이 필요합니다."
        );
        return false;
      }
    }
    requestContext = captureLocalToolContext();
    requestWorkflowId = currentWorkflowId;
    requestWorkflowObject = currentWorkflow;
    requestFileName = currentWorkflowFileName;
    markWorkflowRunQueued();
    showRunOutput(`${requestFileName} 실행 중`, "python-3.10.0-embed-amd64\\python.exe main.py workflows/... 실행을 기다리는 중입니다.\n");
    const response = await localToolFetch(
      `workflows/${encodeURIComponent(requestFileName)}/run-stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    let result = null;
    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      if (response.status === 404 && errorResult.error?.code === "not_found") {
        appendRunOutput("[info] 현재 실행 중인 studio_bridge.py가 실시간 진행 API를 아직 지원하지 않아 기존 실행 방식으로 전환합니다.");
        showToast("studio_bridge.py를 재시작하면 노드별 실시간 진행 표시가 활성화됩니다.");
        result = await runWorkflowWithLegacyEndpoint(requestFileName);
        result.stdout = [
          "studio_bridge.py 재시작 전이라 노드별 실시간 진행 표시는 사용할 수 없습니다.",
          result.stdout || "",
        ].filter(Boolean).join("\n");
      } else {
        throw new Error(
          response.status === 401
            ? "연결 토큰이 필요합니다"
            : errorResult.error?.message || `HTTP ${response.status}`
        );
      }
    } else {
      result = await readRunEventStream(response, applyWorkflowRunEvent) || {};
    }
    if (
      !isCurrentLocalToolContext(requestContext)
      || requestWorkflowId !== currentWorkflowId
      || requestWorkflowObject !== currentWorkflow
      || requestFileName !== currentWorkflowFileName
    ) return false;
    if (!Number.isInteger(result.returnCode)) {
      throw new Error(
        result.message || "실행 완료 상태를 확인하지 못했습니다."
      );
    }
    const output = [
      result.stdout ? `[stdout]\n${result.stdout.trimEnd()}` : "",
      result.stderr ? `[stderr]\n${result.stderr.trimEnd()}` : "",
      `\n종료 코드: ${result.returnCode}`,
    ].filter(Boolean).join("\n\n");
    showRunOutput(
      result.returnCode === 0 ? `${requestFileName} 실행 완료` : `${requestFileName} 실행 실패`,
      output
    );
    showToast(result.returnCode === 0 ? "로컬 워크플로우 실행을 완료했습니다." : `실행 종료 코드: ${result.returnCode}`);
    return result.returnCode === 0;
  } catch (error) {
    if (
      requestContext
      && (
        !isCurrentLocalToolContext(requestContext)
        || requestWorkflowId !== currentWorkflowId
        || requestWorkflowObject !== currentWorkflow
        || requestFileName !== currentWorkflowFileName
      )
    ) return false;
    const fallbackMessage = LOCAL_STUDIO_MODE ? "실행 처리 오류" : "로컬 툴 연결 오류";
    showRunOutput("로컬 실행 실패", error.message || fallbackMessage);
    showToast(`실행 실패: ${error.message || fallbackMessage}`);
    return false;
  } finally {
    localToolRunActive = false;
    if (button) button.disabled = false;
  }
}

window.runLocalWorkflow = runLocalWorkflow;

function runMockWorkflow() {
  clearRunTimers();
  const order = executionOrder();
  const log = document.querySelector(".log");
  log.innerHTML = `<span class="info">[INFO]</span> mock run started\n`;
  currentWorkflow.nodes.forEach(node => { node.run_status = "pending"; });
  renderAll();
  order.forEach((nodeId, index) => {
    runTimers.push(setTimeout(() => {
      const node = currentWorkflow.nodes.find(n => n.id === nodeId);
      if (!node) return;
      node.run_status = "running";
      log.innerHTML += `<span class="info">[INFO]</span> running ${node.type} #${node.id}\n`;
      renderAll();
    }, index * 700));
    runTimers.push(setTimeout(() => {
      const node = currentWorkflow.nodes.find(n => n.id === nodeId);
      if (!node) return;
      node.run_status = "success";
      log.innerHTML += `<span class="info">[INFO]</span> success ${node.type} #${node.id}\n`;
      if (index === order.length - 1) log.innerHTML += `<span class="info">[INFO]</span> mock run completed\n`;
      renderAll();
    }, index * 700 + 520));
  });
}

function clearRunTimers() {
  runTimers.forEach(timer => clearTimeout(timer));
  runTimers = [];
}

function executionOrder() {
  const nodes = currentWorkflow.nodes.map(node => node.id);
  const indegree = new Map(nodes.map(id => [id, 0]));
  const outgoing = new Map(nodes.map(id => [id, []]));
  currentWorkflow.links.forEach(link => {
    if (!outgoing.has(link[1]) || !indegree.has(link[3])) return;
    outgoing.get(link[1]).push(link[3]);
    indegree.set(link[3], indegree.get(link[3]) + 1);
  });
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    outgoing.get(id).forEach(next => {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    });
  }
  return order.length === nodes.length ? order : nodes;
}

async function importWorkflowFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  updateCurrentWorkflowStore();
  const name = file.name.replace(/\.json$/i, "");
  const id = `${name}_${Date.now()}`;
  workflowStore.push({ id, name, projectId: currentProjectId, data });
  currentWorkflowId = id;
  currentWorkflow = data;
  workflowListCollapsed = true;
  selectedNodeId = null;
  selectedLinkId = null;
  renderAll();
  fitView();
}

function displayNodeTitle(node) {
  return getScriptForNode(node)?.name || node.type;
}

function resetMarketplaceRegisterForm() {
  editingModulePackageId = null;
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

function openDeveloperTools() {
  document.getElementById("developerPanel")?.classList.remove("hidden");
  renderScriptLibrary();
  requestAnimationFrame(() => document.getElementById("closeDeveloperToolsBtn")?.focus());
}

function closeDeveloperTools() {
  document.getElementById("developerPanel")?.classList.add("hidden");
}

window.openDeveloperTools = openDeveloperTools;
window.closeDeveloperTools = closeDeveloperTools;

function currentWorkflowLabel() {
  return workflowStore.find(item => item.id === currentWorkflowId)?.name || currentWorkflowId || "Untitled workflow";
}

function openWorkflowRegisterModal(existingPackage = null) {
  const modal = document.getElementById("workflowRegisterModal");
  const form = document.getElementById("workflowRegisterForm");
  if (!modal || !form) return;
  const sourceData = existingPackage?.workflow?.data || exportWorkflowForDownload();
  const sourceName = existingPackage?.workflow?.name || currentWorkflowLabel();
  editingWorkflowPackageId = existingPackage?.id || null;
  form.elements.name.value = existingPackage?.name || currentWorkflowLabel();
  form.elements.version.value = existingPackage?.version || "1.0.0";
  form.elements.description.value = existingPackage?.description || "";
  form.elements.author.value = authState.user?.displayName || existingPackage?.author || localAuthorProfile || "";
  form.elements.tested.checked = Boolean(existingPackage?.tested);
  const name = document.getElementById("workflowRegisterSnapshotName");
  const meta = document.getElementById("workflowRegisterSnapshotMeta");
  if (name) name.textContent = sourceName;
  if (meta) meta.textContent = `${sourceData.nodes?.length || 0} nodes · ${sourceData.links?.length || 0} links · ${existingPackage ? "등록된 스냅샷" : "현재 편집본"}`;
  const error = document.getElementById("workflowRegisterError");
  if (error) error.textContent = "";
  modal.classList.remove("hidden");
  requestAnimationFrame(() => form.elements.name.focus());
}

function closeWorkflowRegisterModal() {
  document.getElementById("workflowRegisterModal")?.classList.add("hidden");
  editingWorkflowPackageId = null;
}

async function registerWorkflowPackage(event) {
  event.preventDefault();
  if (!requireServerWriteAccess()) return;
  const form = event.currentTarget;
  const error = document.getElementById("workflowRegisterError");
  const name = form.elements.name.value.trim();
  const version = form.elements.version.value.trim();
  const description = form.elements.description.value.trim();
  const author = authState.user?.displayName || form.elements.author.value.trim();
  const tested = form.elements.tested.checked;
  let message = "";
  if (!name) message = "표시 이름을 입력해 주세요.";
  else if (!version) message = "버전을 입력해 주세요.";
  else if (!description) message = "워크플로우 설명을 입력해 주세요.";
  else if (!author) message = "작성자를 입력해 주세요.";
  else if (!tested) message = "별도 실행기에서 테스트 완료했음을 확인해 주세요.";
  if (message) {
    if (error) error.textContent = message;
    return;
  }

  const existing = editingWorkflowPackageId
    ? registeredMarketplacePackages.find(item => item.id === editingWorkflowPackageId && item.workflow)
    : null;
  const uploadedAt = new Date().toISOString();
  const packageId = existing?.id || `workflow_package_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    id: serverWorkflowId(packageId),
    name,
    version,
    description,
    author,
    authMode: "unverified-local-profile",
    kind: "workflow-bundle",
    registrationOnly: true,
    tested: true,
    uploadedAt,
    updatedAt: existing ? uploadedAt : null,
    sourceWorkflowId: existing?.sourceWorkflowId || currentWorkflowId,
    workflow: {
      name: existing?.workflow?.name || currentWorkflowLabel(),
      data: structuredClone(existing?.workflow?.data || exportWorkflowForDownload())
    }
  };
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  if (error) error.textContent = "Marketplace 서버에 업로드 중입니다...";
  marketplaceWorkflowRequestSequence += 1;
  const requestIdentityEpoch = authIdentityEpoch;
  const requestStorageScope = activeStorageScope;
  try {
    if (error) error.textContent = "workflows/list 저장 후 Git commit/push 중입니다...";
    const workflowGit = await saveWorkflowPackageToGit(payload, { existing });
    if (workflowGit) {
      payload.git = {
        path: workflowGit.path,
        fileName: workflowGit.fileName,
        committed: Boolean(workflowGit.git?.committed),
        pushed: Boolean(workflowGit.git?.push),
      };
      payload.source = {
        ...(payload.source || {}),
        type: "git",
        path: workflowGit.path,
      };
    }
    if (error) error.textContent = "Marketplace 서버에 메타데이터를 저장 중입니다...";
    const headers = { "Content-Type": "application/json" };
    if (existing?.revision) headers["If-Match"] = existing.revision;
    const response = await apiFetch(`/marketplace/workflows/${encodeURIComponent(payload.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!requestContextIsCurrent(requestIdentityEpoch, requestStorageScope)) return;
    if (!response.ok || !result.package) {
      const detail = result.currentRevision
        ? `${result.error || "revision conflict"} (${result.currentRevision})`
        : responseErrorMessage(response, result);
      throw new Error(detail);
    }
    if (workflowGit) {
      await localToolFetch("workflow-assets/mark-synced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: workflowGit.fileName,
          marketplaceId: payload.id,
          marketplaceRevision: result.package.revision || "",
        }),
      }).catch(() => null);
    }
    const uploadedPackage = { ...result.package, registrationOnly: true };
    registeredMarketplacePackages = [
      uploadedPackage,
      ...registeredMarketplacePackages.filter(item => item.id !== uploadedPackage.id)
    ];
    localAuthorProfile = uploadedPackage.author || author;
    marketplaceTab = "workspace";
    persistAuxiliaryState();
    renderStudioContext();
    closeWorkflowRegisterModal();
    openMarketplaceView();
    showToast(`Marketplace 업로드 완료: ${name} v${version}`);
  } catch (uploadError) {
    if (error) error.textContent = `Marketplace 업로드 실패: ${uploadError.message || "서버 연결 오류"}`;
    showToast(`Marketplace 업로드 실패: ${uploadError.message || "서버 연결 오류"}`);
  } finally {
    if (submitButton) submitButton.disabled = !serverWritesEnabled();
  }
}

async function syncMarketplaceWorkflowsFromServer(options = {}) {
  const requestId = ++marketplaceWorkflowRequestSequence;
  const requestAuthGeneration = authGeneration;
  const requestStorageScope = activeStorageScope;
  const isCurrentRequest = () => (
    requestId === marketplaceWorkflowRequestSequence
    && requestAuthGeneration === authGeneration
    && requestStorageScope === activeStorageScope
  );
  try {
    const response = await apiFetch("/marketplace/workflows", {
      headers: { "Accept": "application/json" },
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.items)) throw new Error(responseErrorMessage(response, result));
    if (!isCurrentRequest()) return null;
    const localModulePackages = registeredMarketplacePackages.filter(item => !item.workflow);
    const serverWorkflowPackages = result.items
      .filter(item => item?.kind === "workflow-bundle" && item?.workflow)
      .map(item => ({ ...item, registrationOnly: true }));
    registeredMarketplacePackages = [...serverWorkflowPackages, ...localModulePackages];
    persistAuxiliaryState();
    renderMarketplace();
    return true;
  } catch (syncError) {
    if (!isCurrentRequest()) return null;
    if (options.notify) showToast(`공유 Marketplace 동기화 실패: ${syncError.message || "서버 연결 오류"}`);
    return false;
  }
}

async function syncMarketplaceModulesFromServer(options = {}) {
  const requestId = ++marketplaceModuleRequestSequence;
  const requestAuthGeneration = authGeneration;
  const requestStorageScope = activeStorageScope;
  const isCurrentRequest = () => (
    requestId === marketplaceModuleRequestSequence
    && requestAuthGeneration === authGeneration
    && requestStorageScope === activeStorageScope
  );
  try {
    const response = await apiFetch("/marketplace/modules", {
      headers: { "Accept": "application/json" },
      timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.items)) throw new Error(responseErrorMessage(response, result));
    if (!isCurrentRequest()) return null;
    const workflowPackages = registeredMarketplacePackages.filter(item => item.workflow);
    const serverModulePackages = result.items
      .filter(item => (item?.kind === "node-pack" || item?.kind === "model-pack") && !item?.workflow)
      .map(item => ({ ...item, registrationOnly: true }));
    registeredMarketplacePackages = [...workflowPackages, ...serverModulePackages];
    persistAuxiliaryState();
    renderMarketplace();
    return true;
  } catch (syncError) {
    if (!isCurrentRequest()) return null;
    if (options.notify) showToast(`노드/모델 Marketplace 동기화 실패: ${syncError.message || "서버 연결 오류"}`);
    return false;
  }
}

async function syncMarketplaceFromServer(options = {}) {
  const [workflowsReady, modulesReady] = await Promise.all([
    syncMarketplaceWorkflowsFromServer(),
    syncMarketplaceModulesFromServer(),
  ]);
  if (options.notify && (workflowsReady === false || modulesReady === false)) {
    const failed = [
      workflowsReady === false && "워크플로우",
      modulesReady === false && "노드/모델"
    ].filter(Boolean).join(", ");
    showToast(`Marketplace 일부 동기화 실패: ${failed}`);
  }
  return workflowsReady !== false && modulesReady !== false;
}

window.syncMarketplaceWorkflowsFromServer = syncMarketplaceWorkflowsFromServer;
window.syncMarketplaceModulesFromServer = syncMarketplaceModulesFromServer;
window.syncMarketplaceFromServer = syncMarketplaceFromServer;

window.openWorkflowRegisterModal = openWorkflowRegisterModal;
window.closeWorkflowRegisterModal = closeWorkflowRegisterModal;

function renderWidgets(node) {
  const initInputs = getInitInputsForNode(node);
  if (!initInputs.length) return "";
  syncWidgetValuesFromInit(node);
  return initInputs.map((input, index) => {
    const value = node.widgets_values?.[index] ?? "";
    const label = input.syntheticLabel
      ? ""
      : `<span class="widget-label">${escapeHtml(input.name)}</span>`;
    return `
      <div class="widget ${input.syntheticLabel ? "widget-value-only" : ""}">
        ${label}
        <span class="widget-value">${escapeHtml(value)}</span>
      </div>
    `;
  }).join("");
}

function renderWidgetEditors(node) {
  const initInputs = getInitInputsForNode(node);
  if (!initInputs.length) return UI.emptyKv("No init values");
  syncWidgetValuesFromInit(node);
  return initInputs
    .map((input, index) => {
      const value = node.widgets_values?.[index] ?? "";
      if (isModelCatalogInput(input) && catalogModels.length) {
        return UI.fieldSelect(
          input.name,
          value,
          catalogModelSelectOptions(value),
          `updateWidget(${node.id}, ${index}, this.value, true)`,
          "탐색된 모델을 선택하세요"
        );
      }
      return UI.fieldInput(
        input.name,
        value,
        `updateWidget(${node.id}, ${index}, this.value)`
      );
    })
    .join("");
}

function getWidgetLabel(node, index) {
  return getInitInputsForNode(node)[index]?.name || `value_${index + 1}`;
}

function defaultWidgetsFor(type) {
  const script = scriptLibrary.find(item => item.type === type);
  return (script?.initInputs || []).map(input => input.default ?? "");
}

function addNode(type = "Add") {
  recordHistory("Add node");
  const id = nextNodeId();
  const base = scriptLibrary.find(script => script.type === type) || scriptLibrary[0];
  if (!base) return;
  const initValues = initValuesForScript(base);
  const size = base.type === "OutputPrint" || base.type === "basic.OutputValue" ? [180, 70] : [270, 100];
  const center = visibleCanvasCenterWorld();
  const offset = (currentWorkflow.nodes.length % 4) * 24;
  const node = {
    id,
    type: base.type,
    pos: [Math.max(24, center.x - size[0] / 2 + offset), Math.max(24, center.y - size[1] / 2 + offset)],
    size,
    init_values: initValues,
    inputs: base.inputs.map(input => ({ name: input.name, type: normalizeType(input.type), link: null })),
    outputs: base.outputs.map(output => ({ name: output.name, type: normalizeType(output.type), links: [] })),
    widgets_values: (base.initInputs || []).map(input => initValues[input.name]),
    script_id: base.id
  };
  currentWorkflow.nodes.push(node);
  currentWorkflow.last_node_id = Math.max(currentWorkflow.last_node_id || 0, id);
  selectedNodeId = id;
  selectedLinkId = null;
  renderAll();
}

function updateWidget(nodeId, index, value, preserveString = false) {
  const node = currentWorkflow.nodes.find(n => n.id === nodeId);
  if (!node) return;
  recordHistory("Update node value");
  const initInput = getInitInputsForNode(node)[index];
  const numeric = Number(value);
  const parsed = preserveString
    ? String(value)
    : value !== "" && Number.isFinite(numeric) ? numeric : value;
  node.widgets_values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  node.widgets_values[index] = parsed;
  node.init_values = node.init_values && typeof node.init_values === "object" ? node.init_values : {};
  if (initInput?.name) node.init_values[initInput.name] = parsed;
  renderAll();
}

function changeNodeScript(nodeId, scriptId) {
  const node = currentWorkflow.nodes.find(n => n.id === nodeId);
  const script = scriptLibrary.find(s => s.id === scriptId);
  if (!node || !script) return;
  recordHistory("Change node script");
  const previousInputs = new Map((node.inputs || []).map(input => [input.name, input.link]));
  const previousOutputs = new Map((node.outputs || []).map((output, index) => [output.name, { index, links: output.links || [] }]));

  node.script_id = script.id;
  node.type = script.type;
  node.init_values = { ...initValuesForScript(script), ...(node.init_values || {}) };
  node.widgets_values = (script.initInputs || []).map(input => node.init_values[input.name]);
  node.inputs = script.inputs.map(input => ({
    name: input.name,
    type: normalizeType(input.type),
    link: previousInputs.get(input.name) ?? null
  }));
  node.outputs = script.outputs.map(output => ({
    name: output.name,
    type: normalizeType(output.type),
    links: previousOutputs.get(output.name)?.links || []
  }));

  currentWorkflow.links = currentWorkflow.links.filter(link => {
    if (link[3] === node.id) return Boolean(node.inputs[link[4]]);
    if (link[1] === node.id) {
      const oldOutputName = [...previousOutputs.entries()].find(([, info]) => info.index === link[2])?.[0];
      const newOutputIndex = node.outputs.findIndex(output => output.name === oldOutputName);
      if (newOutputIndex < 0) return false;
      link[2] = newOutputIndex;
      link[5] = node.outputs[newOutputIndex].type;
    }
    return true;
  });
  rebuildLinkRefs();
  renderAll();
}

function registerCatalog(data, fileName = "catalog.json", options = {}) {
  if (!Array.isArray(data?.nodes)) throw new Error("catalog.nodes must be an array");
  const scripts = data.nodes.map(node => scriptFromCatalogNode(node, data));
  catalogModels = normalizeCatalogModels(data.models);
  scriptLibrary.splice(0, scriptLibrary.length, ...scripts);
  nodeTypes = scripts.map(script => script.type);
  const discoveredTypes = new Set(portTypes);
  scripts.forEach(script => {
    [...script.inputs, ...script.outputs, ...(script.initInputs || [])].forEach(port => discoveredTypes.add(normalizeType(port.type)));
  });
  portTypes = [...discoveredTypes];
  portTypes.forEach(type => {
    if (!portTypePatterns[type]) portTypePatterns[type] = type === "*" ? "^.*$" : "";
  });
  lastRegisteredScriptId = scripts[0]?.id || null;
  explorerState.mode = "local-tool";
  explorerState.lastScannedAt = new Date().toISOString();
  persistAuxiliaryState();
  catalogReady = true;
  renderAll();
  appendLog(
    `[INFO] catalog loaded: ${fileName} (${scripts.length} nodes, ${catalogModels.length} models)`
  );
  if (!options.silent) {
    showToast(`Catalog loaded: ${scripts.length} nodes · ${catalogModels.length} models`);
  }
}

async function importWorkflowFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.schema === CATALOG_SCHEMA || (Array.isArray(data?.nodes) && data.nodes.some(node => node.key && node.io))) {
    registerCatalog(data, file.name);
    return;
  }
  if (!confirmUnsavedBeforeSwitch()) return;
  normalizeWorkflowShape(data);
  rebuildImportedLinkRefs(data);
  const name = file.name.replace(/\.json$/i, "");
  const id = `${name}_${Date.now()}`;
  currentProjectId = "local_tool";
  projectStore = [{ id: currentProjectId, name: "Local Tool" }];
  workflowStore = [{ id, name, projectId: currentProjectId, data }];
  currentWorkflowId = id;
  currentWorkflow = data;
  currentWorkflowFileName = null;
  lastFolderSavedAt = null;
  lastFolderSavedHash = null;
  workflowSyncState = {};
  workflowListCollapsed = true;
  selectedNodeId = null;
  selectedLinkId = null;
  renderAll();
  markWorkflowDirty();
  fitView();
}

async function importCatalogFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.schema !== CATALOG_SCHEMA && !(Array.isArray(data?.nodes) && data.nodes.some(node => node.key && node.io))) {
    throw new Error("workflow.catalog.v1 형식의 catalog.json 파일을 선택해 주세요.");
  }
  registerCatalog(data, file.name);
}

function rebuildImportedLinkRefs(data) {
  const previous = currentWorkflow;
  currentWorkflow = data;
  rebuildLinkRefs();
  currentWorkflow = previous;
}

function exportWorkflowForDownload() {
  normalizeWorkflowShape(currentWorkflow);
  rebuildLinkRefs();
  return {
    schema: GRAPH_SCHEMA,
    last_node_id: currentWorkflow.last_node_id || 0,
    last_link_id: currentWorkflow.last_link_id || 0,
    nodes: currentWorkflow.nodes.map(node => {
      const script = getScriptForNode(node);
      const nodeRef = script ? {
        package_id: script.packageId || script.package?.id || "local-catalog",
        definition_id: script.definitionId || script.id,
        version: script.version || null,
        digest: script.digest || null
      } : null;
      return {
        id: node.id,
        name: displayNodeTitle(node),
        type: node.type,
        script_id: node.script_id || script?.id || null,
        node_ref: nodeRef,
        implementation_ref: nodeRef,
        pos: node.pos,
        size: node.size,
        init_values: node.init_values && typeof node.init_values === "object" ? node.init_values : {},
        widgets_values: Array.isArray(node.widgets_values) ? [...node.widgets_values] : [],
        inputs: (node.inputs || []).map(input => {
          const output = { name: input.name, type: normalizeType(input.type), link: input.link ?? null };
          if (Object.prototype.hasOwnProperty.call(input, "value")) output.value = input.value;
          return output;
        }),
        outputs: (node.outputs || []).map(output => ({
          name: output.name,
          type: normalizeType(output.type),
          links: Array.isArray(output.links) ? output.links : []
        }))
      };
    }),
    links: currentWorkflow.links.map(link => [...link]),
    version: 0.1
  };
}

document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);
document.getElementById("marketplaceBtn").addEventListener("click", () => openSidebarSection("marketplaceSection"));
document.getElementById("closeMarketplaceBtn").addEventListener("click", closeMarketplaceView);
document.getElementById("downloadPipelineToolBtn")?.addEventListener("click", downloadLatestPipelineTool);
document.getElementById("connectPlatformAccountBtn")?.addEventListener("click", handlePlatformAccountConnect);
document.getElementById("logoutPlatformAccountBtn")?.addEventListener("click", logoutPlatformAccount);
document.getElementById("resetWorkflowBtn")?.addEventListener("click", resetCurrentWorkflow);
document.getElementById("saveWorkflowBtn")?.addEventListener("click", saveWorkflowToServer);
document.getElementById("exportWorkspaceBtn")?.addEventListener("click", exportWorkspaceBundle);
document.getElementById("importWorkspaceBtn")?.addEventListener("click", () => document.getElementById("workspaceImportInput")?.click());
document.getElementById("workspaceImportInput")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importWorkspaceBundle(file);
  } finally {
    event.target.value = "";
  }
});
document.getElementById("runWorkflowBtn")?.addEventListener("click", runLocalWorkflow);
document.getElementById("closeRunOutputBtn")?.addEventListener("click", () => {
  document.getElementById("runOutputPanel")?.classList.add("hidden");
});
document.getElementById("pairLocalToolBtn")?.addEventListener("click", pairLocalTool);
document.getElementById("saveLocalToolRootBtn")?.addEventListener("click", saveLocalToolRoot);
document.getElementById("registerWorkflowBtn")?.addEventListener("click", () => {
  if (serverWritesEnabled()) {
    const user = authState.user;
    showToast(`Marketplace 연결됨: ${user?.displayName || "계정"}${user?.role ? ` · ${user.role}` : ""}`);
    return;
  }
  void openPlatformAccountConnect();
});
document.getElementById("workflowRegisterForm")?.addEventListener("submit", registerWorkflowPackage);
document.getElementById("closeWorkflowRegisterBtn")?.addEventListener("click", closeWorkflowRegisterModal);
document.getElementById("cancelWorkflowRegisterBtn")?.addEventListener("click", closeWorkflowRegisterModal);
document.getElementById("workflowRegisterModal")?.addEventListener("click", event => {
  if (event.target.id === "workflowRegisterModal") closeWorkflowRegisterModal();
});
document.getElementById("developerToolsBtn")?.addEventListener("click", openDeveloperTools);
document.getElementById("closeDeveloperToolsBtn")?.addEventListener("click", closeDeveloperTools);
document.getElementById("closeHistoryBtn")?.addEventListener("click", closeHistoryPanel);
document.getElementById("drawerScrim")?.addEventListener("click", closeHistoryPanel);
document.getElementById("openModuleRegisterBtn")?.addEventListener("click", toggleModuleRegisterPanel);
document.getElementById("recoverLegacyDraftBtn")?.addEventListener("click", recoverLegacyDraft);
document.getElementById("retryAuthStartupBtn")?.addEventListener("click", () => window.location.reload());
document.getElementById("refreshExplorerBtn")?.addEventListener("click", refreshLocalExplorer);
document.getElementById("refreshServerWorkflowsBtn")?.addEventListener("click", () => syncServerWorkflows({ notify: true }));
document.getElementById("nodeSearchInput")?.addEventListener("input", renderNodePalette);
document.getElementById("marketplaceRegisterForm")?.addEventListener("submit", registerMarketplacePackage);
document.getElementById("resetMarketplaceRegisterBtn")?.addEventListener("click", resetMarketplaceRegisterForm);
document.querySelectorAll('input[name="sourceType"]').forEach(input => {
  input.addEventListener("change", syncMarketplaceSourceFields);
});
document.getElementById("marketplaceLocalPackageSelect")?.addEventListener(
  "change",
  applyLocalPublishablePackageSelection
);
syncMarketplaceSourceFields();
document.querySelectorAll("[data-marketplace-tab]").forEach(button => {
  button.addEventListener("click", () => setMarketplaceTab(button.dataset.marketplaceTab));
});
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
document.getElementById("openMarketplaceShortcutBtn")?.addEventListener("click", () => {
  openMarketplaceSite();
});
document.getElementById("historyBtn").addEventListener("click", focusHistoryPanel);
document.getElementById("fitBtn").addEventListener("click", fitView);
document.getElementById("zoomOutBtn").addEventListener("click", () => zoomBy(-0.1));
document.getElementById("zoomInBtn").addEventListener("click", () => zoomBy(0.1));
document.getElementById("zoomResetBtn").addEventListener("click", resetZoom);
document.getElementById("addNodeBtn").addEventListener("click", () => {
  const type = document.getElementById("addNodeTypeSelect")?.value;
  if (!type) return;
  addNode(type);
});
document.getElementById("newWorkflowBtn").addEventListener("click", newWorkflow);
document.getElementById("cloneWorkflowBtn").addEventListener("click", cloneWorkflow);
document.getElementById("cloneWorkflowForm").addEventListener("submit", submitCloneWorkflow);
document.getElementById("closeCloneWorkflowBtn").addEventListener("click", closeCloneWorkflowModal);
document.getElementById("cancelCloneWorkflowBtn").addEventListener("click", closeCloneWorkflowModal);
document.getElementById("cloneWorkflowModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) closeCloneWorkflowModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.getElementById("cloneWorkflowModal")?.classList.contains("hidden")) {
    event.preventDefault();
    closeCloneWorkflowModal();
  }
});
document.getElementById("toggleWorkflowListBtn").addEventListener("click", toggleWorkflowListMode);
document.getElementById("tempWorkflowToggleBtn")?.addEventListener("click", event => {
  const button = event.currentTarget;
  const list = document.getElementById("tempWorkflowList");
  if (!list || !tempWorkflowItems.length) return;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", expanded ? "false" : "true");
  list.classList.toggle("hidden", expanded);
});
document.getElementById("newProjectBtn").addEventListener("click", newProject);
document.getElementById("cloneProjectBtn").addEventListener("click", cloneProject);
document.getElementById("projectSelect").addEventListener("change", event => switchProject(event.target.value));
document.getElementById("projectNameInput")?.addEventListener("change", event => renameCurrentProject(event.target.value));
document.getElementById("registerScriptBtn").addEventListener("click", registerScript);
document.getElementById("manageTypesBtn").addEventListener("click", openTypeModal);
document.getElementById("manageNodeTypesBtn").addEventListener("click", openNodeTypeModal);
document.getElementById("scriptInputNameInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addPortFromModal("input");
  }
});
document.getElementById("scriptOutputNameInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addPortFromModal("output");
  }
});
document.getElementById("newTypeInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTypeFromModal();
  }
});
document.getElementById("newNodeTypeInput").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addNodeTypeFromModal();
  }
});
document.querySelectorAll("[data-accordion] .accordion-head").forEach(button => {
  button.addEventListener("click", () => {
    button.closest("[data-accordion]").classList.toggle("collapsed");
  });
});
document.querySelectorAll(".icon-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    openSidebarSection(tab.dataset.target);
  });
});
document.getElementById("validateBtn").addEventListener("click", renderValidation);
document.getElementById("runBtn").addEventListener("click", runMockWorkflow);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("catalogImportBtn").addEventListener("click", () => document.getElementById("catalogInput").click());
document.getElementById("fileInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importWorkflowFile(file);
    event.target.value = "";
  } catch (error) {
    alert(`JSON 불러오기 실패: ${error.message}`);
  }
});
document.getElementById("catalogInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importCatalogFile(file);
    event.target.value = "";
  } catch (error) {
    alert(`Catalog 업로드 실패: ${error.message}`);
  }
});
document.getElementById("jsonBtn").addEventListener("click", () => {
  const willShow = jsonInput.classList.contains("hidden");
  jsonInput.classList.toggle("hidden", !willShow);
  jsonHint.classList.toggle("hidden", willShow);
});
canvasShell.addEventListener("click", event => {
  if (event.target === canvasShell || event.target === world || event.target === nodeLayer || event.target === linksSvg) {
    clearPendingLinkPort();
    clearPendingLinkReconnect();
    selectedNodeId = null;
    selectedLinkId = null;
    renderAll();
  }
});

canvasShell.addEventListener("contextmenu", event => {
  if (!pendingLinkPort && !pendingLinkReconnect) return;
  event.preventDefault();
  clearPendingLinkPort();
  clearPendingLinkReconnect();
  renderAll();
});

canvasShell.addEventListener("dragover", event => event.preventDefault());
canvasShell.addEventListener("drop", event => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/plain");
  const known = scriptLibrary.find(script => script.type === type);
  if (!known) return;
  addNode(type);
  const node = currentWorkflow.nodes.find(n => n.id === selectedNodeId);
  if (node) {
    const point = canvasToWorld(event.clientX, event.clientY);
    node.pos = [point.x, point.y];
  }
  renderAll();
});

canvasShell.addEventListener("wheel", event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? -0.08 : 0.08);
}, { passive: false });

canvasShell.addEventListener("pointerdown", event => {
  if (event.button !== 1 && !(event.button === 0 && event.altKey)) return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, tx: worldTransform.x, ty: worldTransform.y };
  function move(moveEvent) {
    worldTransform.x = start.tx + moveEvent.clientX - start.x;
    worldTransform.y = start.ty + moveEvent.clientY - start.y;
    applyWorldTransform();
  }
  function up() {
    window.removeEventListener("pointermove", move);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && (pendingLinkPort || pendingLinkReconnect)) {
    clearPendingLinkPort();
    clearPendingLinkReconnect();
    renderAll();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("scriptModal").classList.contains("hidden")) {
    closeScriptModal();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("typeModal").classList.contains("hidden")) {
    closeTypeModal();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("nodeTypeModal").classList.contains("hidden")) {
    closeNodeTypeModal();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("workflowRegisterModal").classList.contains("hidden")) {
    closeWorkflowRegisterModal();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("developerPanel").classList.contains("hidden")) {
    closeDeveloperTools();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("historyPane").classList.contains("hidden")) {
    closeHistoryPanel();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("marketplaceView").classList.contains("hidden")) {
    closeMarketplaceView();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    deleteSelected();
  }
});

function hasAnyDirtyWorkflow() {
  return isWorkflowDirty;
}

function formControlHasUnsavedValue(control) {
  if (!control || control.disabled) return false;
  const type = String(control.type || "").toLowerCase();
  if (["button", "submit", "reset", "hidden"].includes(type)) return false;
  if (type === "file") return Boolean(control.files?.length);
  if (type === "checkbox" || type === "radio") return control.checked !== control.defaultChecked;
  if (control.tagName === "SELECT") {
    return Array.from(control.options || []).some(option => option.selected !== option.defaultSelected);
  }
  return String(control.value ?? "") !== String(control.defaultValue ?? "");
}

function hasUnsavedFormInput() {
  return [
    "marketplaceRegisterForm",
    "workflowRegisterForm",
    "scriptForm",
    "nodeTypeForm",
    "typeForm",
  ].some(id => {
    const form = document.getElementById(id);
    if (!form || form.closest(".hidden")) return false;
    if (["scriptForm", "nodeTypeForm", "typeForm"].includes(id)) return true;
    return Array.from(form.elements || []).some(formControlHasUnsavedValue);
  });
}

window.addEventListener("beforeunload", event => {
  const hasDirtyWorkflow = hasAnyDirtyWorkflow();
  const hasFormInput = hasUnsavedFormInput();
  if (
    !hasDirtyWorkflow
    && !hasFormInput
    && !externalDraftConflict
    && !externalAuxiliaryConflict
    && !auxiliaryPersistFailed
  ) return;
  const draftSaved = !hasDirtyWorkflow
    ? !externalDraftConflict
    : persistLocalDraft({ immediate: true, silent: true });
  if (
    !draftSaved
    || hasFormInput
    || externalDraftConflict
    || externalAuxiliaryConflict
    || auxiliaryPersistFailed
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("storage", event => {
  if (event.key === ACCESS_TOKEN_STORAGE_KEY) {
    if (LOCAL_STUDIO_MODE) return;
    if (!appInitialized) {
      window.location.reload();
      return;
    }
    persistLocalDraft({ immediate: true, silent: true });
    void refreshAuthenticatedData({ notify: true });
    return;
  }
  if (!appInitialized || !activeStorageScope) return;
  const workflowStorageKey = CURRENT_DRAFT_STORAGE_KEY;
  const auxiliaryStorageKey = scopedStorageKey(AUXILIARY_STORAGE_KEY);
  const toolRootStorageKey = localToolRootStorageKey();
  if (!LOCAL_STUDIO_MODE && event.key === toolRootStorageKey) {
    const incomingToolRoot = event.newValue || "";
    if (sameToolRoot(incomingToolRoot, localToolRootPreference)) return;
    localToolContextRequestSequence += 1;
    localToolRootPreference = incomingToolRoot;
    const input = document.getElementById("localToolRootInput");
    if (input) input.value = incomingToolRoot;
    explorerState.statusMessage = "다른 탭에서 실행 도구 경로 변경됨";
    renderExplorerStatus();
    renderLocalToolRootStatus("다른 탭에서 경로가 변경되었습니다. 저장을 눌러 이 탭에 적용하세요.");
    showToast("다른 탭에서 실행 도구 경로가 변경되었습니다. 현재 탭은 기존 경로를 계속 사용합니다.");
    return;
  }
  if (event.key !== workflowStorageKey && event.key !== auxiliaryStorageKey) return;
  const incomingEnvelope = storageEnvelope(event.newValue);
  if (incomingEnvelope.writerId === TAB_INSTANCE_ID) return;

  if (event.key === workflowStorageKey) {
    if (
      incomingEnvelope.writerId
      && incomingEnvelope.revision <= localDraftStorageRevision
      && event.newValue != null
    ) return;
    if (!hasAnyDirtyWorkflow() && !hasUnsavedFormInput()) {
      const restored = restoreState();
      if (restored.restored) {
        renderAll();
        fitView();
        applyCurrentWorkflowSaveState();
      }
      return;
    }
    externalDraftConflict = true;
    setSaveState("error", "다른 탭 변경 감지 · JSON 보기에서 복사 후 새로고침 필요");
    showToast("다른 탭의 최신 초안을 감지했습니다. JSON 보기에서 현재 내용을 복사한 뒤 새로고침해 주세요.");
  } else {
    if (
      incomingEnvelope.writerId
      && incomingEnvelope.revision <= auxiliaryStorageRevision
      && event.newValue != null
    ) return;
    let incomingState = null;
    try {
      incomingState = event.newValue ? JSON.parse(event.newValue) : null;
    } catch {}
    if (incomingState && !hasAnyDirtyWorkflow() && !hasUnsavedFormInput()) {
      auxiliaryStorageRevision = incomingEnvelope.revision;
      applyAuxiliaryState(incomingState);
      auxiliaryPersistFailed = false;
      renderAll();
      return;
    }
    externalAuxiliaryConflict = true;
    showToast("다른 탭의 로컬 라이브러리 변경을 감지했습니다. 입력 내용을 보존하려면 새로고침 전에 확인해 주세요.");
  }
});

window.addEventListener("focus", () => {
  if (appInitialized) void refreshAuthenticatedData();
});

jsonInput.addEventListener("change", () => {
  try {
    currentWorkflow = JSON.parse(jsonInput.value);
    updateCurrentWorkflowStore();
    selectedNodeId = null;
    renderAll();
    markWorkflowDirty();
    fitView();
  } catch (error) {
    alert(`JSON 파싱 실패: ${error.message}`);
  }
});

setupAssetSidebar();
openSidebarSection("workflowSection");

document.getElementById("objectSearchInput")?.addEventListener("input", event => {
  objectListViewState.query = event.target.value;
  renderObjectList();
});

document.getElementById("objectSortSelect")?.addEventListener("change", event => {
  objectListViewState.sortBy = event.target.value;
  renderObjectList();
});

document.getElementById("objectSortDirectionBtn")?.addEventListener("click", event => {
  objectListViewState.descending = !objectListViewState.descending;
  const button = event.currentTarget;
  const label = objectListViewState.descending ? "정렬 방향: 내림차순" : "정렬 방향: 오름차순";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(objectListViewState.descending));
  button.title = objectListViewState.descending ? "내림차순" : "오름차순";
  button.querySelector(".material-symbols-outlined").textContent =
    objectListViewState.descending ? "arrow_downward" : "arrow_upward";
  renderObjectList();
});

async function refreshAuthenticatedData(options = {}) {
  const ready = await loadAuthSession({
    ...options,
    timeoutMs: options.timeoutMs || PLATFORM_REQUEST_TIMEOUT_MS,
  });
  if (storageScopeTransitionPending) return false;
  if (!document.getElementById("marketplaceView")?.classList.contains("hidden")) {
    await syncMarketplaceFromServer(options);
  }
  return ready;
}

function initializeEditorFromBrowserState() {
  if (!activeStorageScope) activeStorageScope = storageScopeForAuth(authState);
  restoreLocalToolRootPreference();
  const restoreResult = restoreState();
  if (authState.user?.displayName) localAuthorProfile = authState.user.displayName;
  appInitialized = true;
  renderAll();
  fitView();
  if (!restoreResult.restored && restoreResult.allowInitialPersist) {
    persistLocalDraft({ immediate: true, silent: true });
  }
  setStudioInteractionLocked(false);
  document.getElementById("authStartupGate")?.classList.add("hidden");
  if (restoreResult.corrupted) {
    showToast(
      restoreResult.backupKey
        ? "손상된 브라우저 저장값을 백업하고 안전한 상태로 복구했습니다."
        : "손상된 브라우저 저장값을 보존하기 위해 자동저장을 중지했습니다."
    );
  }
  if (hasRecoverableLegacyDraft()) {
    showToast("이전 버전 로컬 초안이 있습니다. 개발자 도구에서 현재 계정으로 복구할 수 있습니다.");
  }
  return restoreResult;
}

async function initializeApplication() {
  if (LOCAL_STUDIO_MODE) {
    restoreCachedAuthIdentity();
    if (authState.status === "loading" && !getAccessToken()) {
      authState.status = "anonymous";
    }
    initializeEditorFromBrowserState();
    renderPipelineToolRelease();

    const accountConnectPromise = consumeLocalConnectCode();
    void accountConnectPromise
      .then(() => loadAuthSession({ timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS }))
      .then(() => {
        renderStudioContext();
        renderMarketplace();
        renderPipelineToolRelease();
      });
    void syncPipelineToolRelease();

    const contextReady = await configureLocalToolContext({
      silent: true,
      resetFileAssociation: false,
    });
    if (!contextReady) return;
    await Promise.allSettled([
      refreshLocalExplorer({ silent: true }),
      syncServerWorkflows({ loadCurrent: true }),
      syncInstalledLocalPackages(),
      syncLocalPublishablePackages(),
    ]);
    return;
  }

  await loadAuthSession({ timeoutMs: PLATFORM_REQUEST_TIMEOUT_MS });
  initializeEditorFromBrowserState();
  openMarketplaceView();
  await completeHostedLocalConnectRequest();
}

window.recoverLegacyDraft = recoverLegacyDraft;
void initializeApplication();
