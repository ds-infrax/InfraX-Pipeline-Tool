function initMarketplaceNavigation() {
  const marketplaceMenuButton = document.getElementById("marketplaceBtn");
  marketplaceMenuButton?.addEventListener("click", () => {
    openSidebarSection("marketplaceSection");
  });

  const hostedMarketplaceShortcut = document.getElementById("openMarketplaceShortcutBtn");
  hostedMarketplaceShortcut?.addEventListener("click", () => {
    openMarketplaceSite();
  });
}

initMarketplaceNavigation();
