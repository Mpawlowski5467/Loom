# Graph performance benchmark

The benchmark opens Chromium with hardware-backed WebGL and exercises a
page-clocked 36-sample, 600 ms drag against deterministic 500- and 2,000-node
graph fixtures.

```bash
npx playwright install chromium
npm run benchmark:graph
```

It records graph construction time, input-to-paint delay, rendered cursor
error, animation-frame gaps, long tasks, direct-neighbor reaction, and exact
elastic return time. A JSON report is attached to each Playwright test result.

The browser is intentionally headed: Chromium's headless SwiftShader path
measures a software rasterizer rather than the WebGL path Loom users see.

While the Vite development server is running, the fixtures can also be opened
directly:

- `/?graphFixture=500`
- `/?graphFixture=2000`

Fixture mode is development-only and does not change saved vault data or graph
preferences.
