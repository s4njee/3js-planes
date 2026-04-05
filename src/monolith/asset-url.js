// ── Asset URL resolver ───────────────────────────────────────────────────────
// Monolith runs in two different contexts:
//   1. Standalone dev / deploy (visualizations/monolith/)
//      BASE_URL is typically '/' or a subpath like '/monolith/'
//   2. Embedded in the root homepage (s8njee.com)
//      BASE_URL is '/' and assets are served from the root public/ tree
//
// All asset paths inside Monolith source code are written as absolute-looking
// strings (e.g. '/set3/Meshy_AI_sr71_0404124235_texture.glb'). resolveAssetUrl() strips the leading slash
// and prepends the Vite BASE_URL so the path is correct in both contexts.
//
// See also: docs/assets-and-deploy.md for the public/ mirroring rules.

export function resolveAssetUrl(path) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  // Directory paths are used as prefixes (e.g. DracoLoader.setDecoderPath),
  // so don't append a query string — it would corrupt the concatenated filename.
  if (path.endsWith('/')) {
    return `${normalizedBase}${normalizedPath}`;
  }
  return `${normalizedBase}${normalizedPath}?v=${__ASSET_VERSION__}`;
}
