# Onairos Next 16 Vercel Repro App

This app is a minimal repro + known-good baseline for `onairos@8.2.10` on Next.js 16 App Router.

## What this app demonstrates

- Client-only usage of `onairos` from `app/components/OnairosDemo.tsx`
- `transpilePackages: ['onairos']` in `next.config.ts`
- A debug build switch to disable webpack build workers and reveal full stack traces:
  - `npm run build:debug-worker`

## Local usage

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Build checks

```bash
# Normal build (matches Vercel behavior)
npm run build

# Debug build (shows real error stack instead of worker exit wrapper)
npm run build:debug-worker
```

## Vercel settings

- Runtime Node: `22.x` (set in `package.json` engines and recommend matching in Vercel Project Settings)
- If you see `Next.js build worker exited with code: 1 and signal: null`, set env var:
  - `NEXT_DEBUG_BUILD_WORKER=0`
  - redeploy once to capture full stack trace

## Common failure pattern this avoids

Do not import `onairos` from a Server Component or any module executed during static generation.
Keep it behind a `'use client'` boundary (or `next/dynamic(..., { ssr: false })`).
# vercel-onairos-demo
