# Screenshots

Every view in every theme, at 1440 × 900, with the fictional demo vault
(`?demo=1`) and the mock adapters for endpoints the backend doesn't have yet
(`VITE_LOOM_MOCKS=1`). Each capture is also checked with axe: a serious or
critical violation fails the run.

| View | Graphite | Paper | Midnight | Forest | Linen | High contrast |
| --- | --- | --- | --- | --- | --- | --- |
| Graph | [png](graph-graphite.png) | [png](graph-paper.png) | [png](graph-midnight.png) | [png](graph-forest.png) | [png](graph-linen.png) | [png](graph-high-contrast.png) |
| Notes | [png](notes-graphite.png) | [png](notes-paper.png) | [png](notes-midnight.png) | [png](notes-forest.png) | [png](notes-linen.png) | [png](notes-high-contrast.png) |
| Search palette | [png](palette-graphite.png) | [png](palette-paper.png) | [png](palette-midnight.png) | [png](palette-forest.png) | [png](palette-linen.png) | [png](palette-high-contrast.png) |
| Board | [png](board-graphite.png) | [png](board-paper.png) | [png](board-midnight.png) | [png](board-forest.png) | [png](board-linen.png) | [png](board-high-contrast.png) |
| Inbox | [png](inbox-graphite.png) | [png](inbox-paper.png) | [png](inbox-midnight.png) | [png](inbox-forest.png) | [png](inbox-linen.png) | [png](inbox-high-contrast.png) |
| Threads | [png](threads-graphite.png) | [png](threads-paper.png) | [png](threads-midnight.png) | [png](threads-forest.png) | [png](threads-linen.png) | [png](threads-high-contrast.png) |
| Settings | [png](settings-graphite.png) | [png](settings-paper.png) | [png](settings-midnight.png) | [png](settings-forest.png) | [png](settings-linen.png) | [png](settings-high-contrast.png) |

Only `/api/config` is answered while capturing, so search runs in its offline
title-and-tag mode. Regenerate with:

```bash
cd frontend && npm run screenshots
```
