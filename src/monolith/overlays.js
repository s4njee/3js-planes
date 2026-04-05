// Planes keeps Monolith's scene runtime but does not use set-specific text or
// franchise overlays. These no-op helpers preserve the existing call sites.

export function createOverlays() {
  return {
    applyWhiteMode: () => {},
    destroy: () => {},
    hideAllOverlays: () => {},
    updateTextVisibility: () => {},
  };
}
