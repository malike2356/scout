# Publishing @scout-security/client

## Private pilot (recommended first)

From `scout/scout-sdk`:

```bash
npm install
npm run build
npm pack
# produces scout-security-client-0.1.0.tgz
```

Client install:

```bash
npm install ./scout-security-client-0.1.0.tgz
# or
npm install /absolute/path/to/scout-security-client-0.1.0.tgz
```

Env:

```bash
export SCOUT_API_KEY=sk_live_...
export SCOUT_API_URL=https://console.labyrinthscout.com
# local: http://localhost:4444
```

## npm registry (later)

1. Set package access / org on npm
2. `npm login`
3. `npm publish --access public` (or restricted)

Do not publish until prompt 05 e2e is green against a hosted/staging API.

## GitHub Packages (optional)

Configure `.npmrc` with a GitHub token and publish `@your-org/scout-security-client` if you rename; keep `@scout-security/client` if the org owns that scope.
