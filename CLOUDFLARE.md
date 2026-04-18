# Cloudflare Deployment

## Cloudflare Pages

Cloudflare Pages is a static site hosting platform with a global CDN built in. It replaces the S3 + CloudFront stack with a single deploy command and no manual cache invalidation step.

### First-time setup

Create the Pages project (one time only):

```bash
wrangler pages project create planes
```

### Deploy

```bash
npm run build
wrangler pages deploy dist/ --project-name planes
```

Pages automatically purges the CDN cache on every deploy — no equivalent of `aws cloudfront create-invalidation` is needed.

### Custom domain

1. Go to the Pages project in the Cloudflare dashboard
2. Settings → Custom domains → Add `planes.s8njee.com`
3. Since `s8njee.com` is already on Cloudflare DNS, the CNAME is added automatically

### Cache headers

Pages sets `Cache-Control: public, max-age=31536000, immutable` on content-hashed assets (JS/CSS chunks) automatically. Binary assets served from `public/` — GLBs, textures, fonts — are not hashed by Vite, so the `?v=<build-timestamp>` appended by `resolveAssetUrl()` is still the mechanism that forces browsers to fetch updated versions.

### Preview deployments

Every branch gets its own preview URL when deployed:

```bash
# Deploy the current branch as a preview (not production)
wrangler pages deploy dist/ --project-name planes --branch $(git branch --show-current)
```

The preview URL follows the pattern `<branch>.<project>.pages.dev`.

### File size limits

Cloudflare Pages enforces a 25MB per-file limit on the free plan. Current asset sizes are well within this:

- Largest GLB: ~10MB (`Meshy_AI_Desert_Thunder` at 9.9MB)
- All textures and fonts: well under 5MB each

If a future model exceeds 25MB, move it to R2 (see below).

---

## R2 Object Storage

R2 is Cloudflare's S3-compatible object storage. It is not a replacement for Pages — it serves large binary assets while Pages continues to serve the app itself.

### When to use R2

- A binary asset (GLB, video, audio) exceeds the 25MB Pages file size limit
- You want to share assets across multiple Pages projects without duplicating them in each repo
- You need to update assets independently of the app (e.g. swap a model without triggering a full redeploy)
- Total asset storage grows large enough that keeping binaries in the git repo becomes impractical

### Why R2 over S3

- **No egress fees** — S3 charges per GB transferred out; R2 does not
- **Same AWS S3 API** — the `aws` CLI and any S3 SDK work against R2 with an endpoint override, making migration straightforward
- **Unified billing and dashboard** — everything stays inside Cloudflare

### How it would work for this project

1. Create an R2 bucket:
   ```bash
   wrangler r2 bucket create planes-assets
   ```

2. Upload assets to R2 using the S3-compatible API (R2 requires an API token with R2 permissions and a Cloudflare account ID):
   ```bash
   aws s3 sync public/set3/ s3://planes-assets/set3/ \
     --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

3. Make the bucket publicly accessible via a custom domain (`assets.planes.s8njee.com`) in the R2 dashboard.

4. Update `resolveAssetUrl()` in `src/monolith/asset-url.js` to route GLBs to the R2 domain:
   ```js
   const R2_ORIGIN = 'https://assets.planes.s8njee.com';
   const R2_EXTENSIONS = ['.glb', '.gltf'];

   export function resolveAssetUrl(path) {
     const ext = path.slice(path.lastIndexOf('.'));
     if (R2_EXTENSIONS.includes(ext)) {
       return `${R2_ORIGIN}${path}?v=${__ASSET_VERSION__}`;
     }
     // ... existing logic for Pages-served assets
   }
   ```

The app continues to deploy to Pages; only oversized or frequently-updated binary assets move to R2.
