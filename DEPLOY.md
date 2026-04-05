# Deploy

Site is hosted on S3 at `planes.s8njee.com` behind CloudFront distribution `E2V8EAB3MTM09M`.

## Deploy steps

```bash
# 1. Build
npm run build

# 2. Sync to S3 (--delete removes files no longer in dist)
aws s3 sync dist/ s3://planes.s8njee.com/ --delete

# 3. Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E2V8EAB3MTM09M --paths "/*"
```

The invalidation typically completes within 1–2 minutes. The site is live at https://planes.s8njee.com.
