# Deploy

This project is deployed to Cloudflare Pages with Wrangler.

Current production project:
- Pages project: `planes`
- Production domain: `af1.s8njee.com`
- Default `*.pages.dev` URL: `https://planes-czq.pages.dev`

## Prerequisites

- Logged into Cloudflare with `wrangler login`
- A successful local build

You can verify the account with:

```bash
npx wrangler whoami
```

## Production deploy

```bash
npm run build
npx wrangler pages deploy dist/ --project-name planes
```

That uploads the contents of `dist/` and publishes a new production deployment for the `planes` Pages project. Cloudflare Pages automatically handles cache invalidation, so there is no separate purge step.

## Preview deploy

To publish the current branch as a preview deployment:

```bash
npm run build
npx wrangler pages deploy dist/ --project-name planes --branch "$(git branch --show-current)"
```

The preview URL follows the pattern `<branch>.<project>.pages.dev`.

## Domain

The `planes` Pages project already has `af1.s8njee.com` attached as a custom domain in Cloudflare. If that mapping ever needs to be recreated, do it in the Cloudflare dashboard:

1. Open the `planes` Pages project
2. Go to `Settings`
3. Open `Custom domains`
4. Add `af1.s8njee.com`

## Notes

- Content-hashed JS and CSS assets are cached aggressively by Cloudflare Pages.
- Binary assets from `public/` are not hashed by Vite, so the app uses versioned asset URLs to ensure updates are fetched.
- If you need the longer-form Cloudflare notes, see [CLOUDFLARE.md](./CLOUDFLARE.md).
