"""Seed a vault with a large set of fake data for graph stress-testing.

Usage:
    python scripts/seed_bulk_data.py [vault_name]

Generates ~80 interconnected notes with dense wikilinks so the graph
looks realistic at scale.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
from random import randint

LOOM_HOME = Path.home() / ".loom"
NOW = datetime.now()


def vault_dir(name: str) -> Path:
    return LOOM_HOME / "vaults" / name / "threads"


def nid() -> str:
    return f"thr_{randint(100000, 999999):06x}"


def ts(days_ago: int = 0) -> str:
    return (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")


NOTES: list[dict] = [
    # ── Projects (10) ────────────────────────────────────────────────────
    {
        "folder": "projects",
        "filename": "helios-solar-tracker.md",
        "title": "Helios Solar Tracker",
        "type": "project",
        "tags": ["solar", "hardware", "iot"],
        "days_ago": 5,
        "body": """## Overview

Helios is a dual-axis solar tracking system that maximizes photovoltaic panel
efficiency. Combines embedded firmware with a cloud dashboard.

## Architecture

- Firmware written in C on STM32 (see [[Embedded C Patterns]])
- Sensor fusion from [[IMU Calibration Techniques]] and light-dependent resistors
- Data pipeline through [[MQTT Broker Design]]
- Dashboard built with [[React Dashboard Patterns]]

[[Tomoko Hayashi]] designed the PCB layout.
[[Ravi Chandrasekaran]] handles the cloud infrastructure.

## Status

Field testing in progress. Tracking accuracy at 98.3%.
See [[Signal Processing Fundamentals]] for noise reduction approach.
""",
    },
    {
        "folder": "projects",
        "filename": "cascade-stream-processor.md",
        "title": "Cascade Stream Processor",
        "type": "project",
        "tags": ["streaming", "data", "scala"],
        "days_ago": 8,
        "body": """## Overview

A real-time event stream processor built on Apache Flink. Handles 500K
events/sec with exactly-once semantics.

## Components

- Ingestion layer using [[Apache Kafka Patterns]]
- Windowing logic based on [[Stream Processing Theory]]
- State management with RocksDB
- Monitoring via [[Prometheus Alerting Rules]]

[[Omar Farouk]] architected the partitioning strategy.
[[Yuki Watanabe]] built the dead letter queue handler.

## Related

Uses [[Backpressure Strategies]] to handle burst traffic.
Output feeds into [[Data Lake Architecture]].
""",
    },
    {
        "folder": "projects",
        "filename": "prism-color-engine.md",
        "title": "Prism Color Engine",
        "type": "project",
        "tags": ["graphics", "color", "rust"],
        "days_ago": 12,
        "body": """## Overview

A high-performance color management engine in Rust. Handles ICC profile
conversion, gamut mapping, and perceptual color matching.

## Design

- Core conversion pipeline (see [[Color Science Notes]])
- ICC v4 profile parser
- GPU-accelerated transforms via [[Compute Shader Patterns]]
- Python bindings via PyO3

[[Dr. Amara Osei]] consults on perceptual color models.
[[Niko Petrov]] wrote the ICC parser.

## Applications

Used by [[Helios Solar Tracker]] for spectral analysis display.
Feeds into [[Generative Art System]] color palette generation.
""",
    },
    {
        "folder": "projects",
        "filename": "vortex-search-engine.md",
        "title": "Vortex Search Engine",
        "type": "project",
        "tags": ["search", "nlp", "python"],
        "days_ago": 15,
        "body": """## Overview

A semantic search engine combining BM25 with vector similarity.
Serves 10M document corpus with sub-100ms p99 latency.

## Architecture

- Inverted index using [[Information Retrieval Theory]]
- Embedding pipeline from [[Transformer Architecture Notes]]
- Hybrid ranking with [[Learning to Rank Approaches]]
- Index sharding per [[Distributed Systems Patterns]]

[[Priya Sharma]] designed the query parser.
[[Omar Farouk]] handles the distributed index.

## Performance

See [[Cache Hierarchy Design]] for the multi-layer caching strategy.
""",
    },
    {
        "folder": "projects",
        "filename": "aurora-auth-service.md",
        "title": "Aurora Auth Service",
        "type": "project",
        "tags": ["auth", "security", "golang"],
        "days_ago": 20,
        "body": """## Overview

Centralized authentication and authorization service. Supports OAuth2,
SAML, and passkey-based WebAuthn flows.

## Design

- Token service based on [[JWT Best Practices]]
- Rate limiting using [[Token Bucket Algorithm]]
- Audit logging per [[Compliance Logging Standards]]
- mTLS between services (see [[Zero Trust Architecture]])

[[Sofia Reyes]] performed the threat model review.
[[Elias Hoffman]] built the passkey implementation.

## Integrations

- SSO for [[Lighthouse Monitoring]] dashboard
- API auth for [[Vortex Search Engine]]
- Session management for [[React Dashboard Patterns]]
""",
    },
    {
        "folder": "projects",
        "filename": "fern-static-site-gen.md",
        "title": "Fern Static Site Generator",
        "type": "project",
        "tags": ["static-site", "markdown", "typescript"],
        "days_ago": 18,
        "body": """## Overview

A markdown-first static site generator with incremental builds.
Targets documentation sites and developer blogs.

## Features

- [[Markdown AST Transforms]] for custom syntax extensions
- Template engine based on [[Template Compilation Strategies]]
- Asset pipeline using esbuild
- Live reload dev server

[[Yuki Watanabe]] built the plugin system.
[[Kai Tanaka]] designed the default theme.

## Performance

Builds 10K pages in under 3 seconds.
Uses [[Content Hashing Strategies]] for incremental invalidation.
""",
    },
    {
        "folder": "projects",
        "filename": "generative-art-system.md",
        "title": "Generative Art System",
        "type": "project",
        "tags": ["creative-coding", "art", "webgl"],
        "days_ago": 10,
        "body": """## Overview

A browser-based generative art platform. Users compose visual programs
using node-based editors and export high-res outputs.

## Technology

- Rendering via [[WebGL Rendering]] and [[Compute Shader Patterns]]
- Color palettes from [[Prism Color Engine]]
- Noise functions from [[Procedural Generation Techniques]]
- UI built with [[React Dashboard Patterns]]

[[Dr. Amara Osei]] advises on aesthetic color theory.
[[Kai Tanaka]] built the node editor UI.

## Gallery

Ships with 40 example compositions. Community sharing planned for v2.
""",
    },
    {
        "folder": "projects",
        "filename": "tundra-cold-storage.md",
        "title": "Tundra Cold Storage",
        "type": "project",
        "tags": ["storage", "archive", "infrastructure"],
        "days_ago": 25,
        "body": """## Overview

A tiered cold storage system for archiving infrequently accessed data.
Optimizes cost by moving data between hot, warm, and cold tiers.

## Architecture

- Lifecycle policies based on [[Data Lifecycle Management]]
- Compression using zstd (see [[Compression Algorithm Comparison]])
- Integrity checks via [[Content Hashing Strategies]])
- Metadata index in SQLite

[[Ravi Chandrasekaran]] designed the tiering logic.
[[Omar Farouk]] built the migration workers.

## Integration

Archives old data from [[Cascade Stream Processor]].
Stores [[Vortex Search Engine]] historical indices.
""",
    },
    {
        "folder": "projects",
        "filename": "meridian-geo-api.md",
        "title": "Meridian Geo API",
        "type": "project",
        "tags": ["geospatial", "api", "python"],
        "days_ago": 14,
        "body": """## Overview

A geospatial REST API that serves map tiles, geocoding, and routing.
Built on PostGIS and FastAPI.

## Endpoints

- `/tiles/{z}/{x}/{y}` - vector tiles
- `/geocode?q=` - forward/reverse geocoding
- `/route` - shortest path routing

Uses [[API Design Principles]] and [[PostGIS Spatial Queries]].
Data sourced from [[Satellite Data Formats]].

[[Dr. Lena Okafor]] advises on coordinate reference systems.
[[Elias Hoffman]] built the routing engine.

## Performance

Tile serving at 2ms p50. See [[Cache Hierarchy Design]].
""",
    },
    {
        "folder": "projects",
        "filename": "nebula-feature-flags.md",
        "title": "Nebula Feature Flags",
        "type": "project",
        "tags": ["feature-flags", "devops", "golang"],
        "days_ago": 22,
        "body": """## Overview

A feature flag service with real-time evaluation, gradual rollouts,
and experiment support.

## Design

- Flag evaluation engine with [[Boolean Logic Optimization]]
- Percentage rollouts using consistent hashing
- A/B experiment framework
- SDK for Go, Python, TypeScript

[[Niko Petrov]] built the evaluation engine.
[[Yuki Watanabe]] wrote the TypeScript SDK.

## Integration

Used by [[Aurora Auth Service]] for gradual rollouts.
Integrated with [[Lighthouse Monitoring]] for flag-correlated alerts.
[[Cascade Stream Processor]] uses flags for pipeline routing.
""",
    },
    # ── Topics (30) ──────────────────────────────────────────────────────
    {
        "folder": "topics",
        "filename": "embedded-c-patterns.md",
        "title": "Embedded C Patterns",
        "type": "topic",
        "tags": ["embedded", "c", "firmware"],
        "days_ago": 30,
        "body": """## Key Patterns

### State Machines
- Enum-based states with transition tables
- Timer-driven periodic tasks
- Watchdog integration for fault recovery

### Memory Management
- Static allocation only (no malloc in firmware)
- Ring buffers for sensor data
- DMA for high-throughput peripheral I/O

Referenced by [[Helios Solar Tracker]] firmware.
See also [[Signal Processing Fundamentals]] for filter implementations.
""",
    },
    {
        "folder": "topics",
        "filename": "imu-calibration-techniques.md",
        "title": "IMU Calibration Techniques",
        "type": "topic",
        "tags": ["sensors", "calibration", "embedded"],
        "days_ago": 28,
        "body": """## Calibration Steps

1. Bias estimation (static sampling)
2. Scale factor correction
3. Cross-axis alignment
4. Temperature compensation

## Algorithms

- Madgwick filter for orientation fusion
- Kalman filter for position tracking
- Complementary filter for fast estimates

Used in [[Helios Solar Tracker]] for panel orientation sensing.
""",
    },
    {
        "folder": "topics",
        "filename": "mqtt-broker-design.md",
        "title": "MQTT Broker Design",
        "type": "topic",
        "tags": ["mqtt", "iot", "messaging"],
        "days_ago": 26,
        "body": """## Broker Architecture

- Topic tree with wildcard subscriptions
- QoS levels 0/1/2 for delivery guarantees
- Retained messages for late subscribers
- Session persistence for reconnecting clients

## Scaling

- Bridge mode for multi-broker clusters
- Shared subscriptions for load balancing
- Message deduplication at QoS 2

Used by [[Helios Solar Tracker]] telemetry pipeline.
See [[Apache Kafka Patterns]] for higher-throughput alternatives.
""",
    },
    {
        "folder": "topics",
        "filename": "apache-kafka-patterns.md",
        "title": "Apache Kafka Patterns",
        "type": "topic",
        "tags": ["kafka", "streaming", "messaging"],
        "days_ago": 35,
        "body": """## Core Patterns

### Partitioning
- Key-based for ordering guarantees
- Round-robin for throughput
- Custom partitioners for affinity

### Consumer Groups
- Automatic rebalancing
- Sticky assignment for locality
- Cooperative rebalancing (incremental)

### Exactly-Once
- Idempotent producers
- Transactional writes
- Read-committed consumers

Referenced by [[Cascade Stream Processor]] and [[Stream Processing Theory]].
""",
    },
    {
        "folder": "topics",
        "filename": "stream-processing-theory.md",
        "title": "Stream Processing Theory",
        "type": "topic",
        "tags": ["streaming", "theory", "data"],
        "days_ago": 32,
        "body": """## Windowing

- Tumbling: fixed, non-overlapping
- Sliding: fixed size, configurable slide
- Session: gap-based, per-key
- Global: unbounded, trigger-driven

## Time Semantics

- Event time vs processing time
- Watermarks for progress tracking
- Late data handling strategies

## State Management

- Keyed state per partition
- Operator state for aggregations
- Checkpointing for fault tolerance

Foundational for [[Cascade Stream Processor]].
See [[Apache Kafka Patterns]] for source integration.
""",
    },
    {
        "folder": "topics",
        "filename": "backpressure-strategies.md",
        "title": "Backpressure Strategies",
        "type": "topic",
        "tags": ["streaming", "resilience", "performance"],
        "days_ago": 24,
        "body": """## Approaches

### Drop Policies
- Drop newest (tail drop)
- Drop oldest (head drop)
- Random early detection

### Flow Control
- Credit-based (receiver advertises capacity)
- Rate limiting (token bucket)
- Adaptive batching

### Buffering
- Bounded in-memory queues
- Spillover to disk
- Overflow to [[Tundra Cold Storage]]

Critical for [[Cascade Stream Processor]] burst handling.
See also [[Token Bucket Algorithm]].
""",
    },
    {
        "folder": "topics",
        "filename": "prometheus-alerting-rules.md",
        "title": "Prometheus Alerting Rules",
        "type": "topic",
        "tags": ["monitoring", "alerting", "prometheus"],
        "days_ago": 20,
        "body": """## Rule Structure

```yaml
groups:
  - name: service_health
    rules:
      - alert: HighErrorRate
        expr: rate(http_errors_total[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
```

## Best Practices

- Alert on symptoms, not causes
- Use `for` duration to avoid flapping
- Group related alerts to reduce noise
- Runbook links in annotations

Referenced by [[Lighthouse Monitoring]] and [[Observability Stack]].
Used to monitor [[Cascade Stream Processor]] throughput.
""",
    },
    {
        "folder": "topics",
        "filename": "color-science-notes.md",
        "title": "Color Science Notes",
        "type": "topic",
        "tags": ["color", "science", "perception"],
        "days_ago": 18,
        "body": """## Color Spaces

- sRGB: standard for web and displays
- CIELAB: perceptually uniform
- OKLCH: modern perceptual, good for gradients
- Display P3: wider gamut, Apple ecosystem

## Gamut Mapping

- Clipping: fast but loses relationships
- Compression: preserves hue, adjusts chroma
- Perceptual: maintains visual similarity

Foundational for [[Prism Color Engine]].
[[Dr. Amara Osei]] recommended OKLCH for [[Generative Art System]].
""",
    },
    {
        "folder": "topics",
        "filename": "compute-shader-patterns.md",
        "title": "Compute Shader Patterns",
        "type": "topic",
        "tags": ["gpu", "compute", "graphics"],
        "days_ago": 16,
        "body": """## Parallel Reduction

- Tree-based reduction for sum/min/max
- Warp-level primitives for speed
- Bank conflict avoidance in shared memory

## Image Processing

- Separable convolution (2-pass)
- Prefix sum for histogram equalization
- Tile-based processing for cache locality

## Physics

- Particle systems (position + velocity update)
- N-body simulation with Barnes-Hut
- Cloth simulation with Verlet integration

Used by [[Prism Color Engine]] and [[Generative Art System]].
See [[WebGL Rendering]] for browser-based compute.
""",
    },
    {
        "folder": "topics",
        "filename": "information-retrieval-theory.md",
        "title": "Information Retrieval Theory",
        "type": "topic",
        "tags": ["search", "ir", "nlp"],
        "days_ago": 40,
        "body": """## Ranking Models

### BM25
- TF-IDF successor with length normalization
- Tunable k1 and b parameters
- Still competitive with neural models

### Vector Space
- Dense embeddings from transformers
- Cosine similarity for matching
- Approximate nearest neighbor (ANN) search

### Hybrid
- Linear interpolation of BM25 + vector scores
- Late interaction (ColBERT)
- Learned sparse representations

Foundational for [[Vortex Search Engine]].
See [[Transformer Architecture Notes]] for embedding models.
""",
    },
    {
        "folder": "topics",
        "filename": "transformer-architecture-notes.md",
        "title": "Transformer Architecture Notes",
        "type": "topic",
        "tags": ["ml", "nlp", "transformers"],
        "days_ago": 38,
        "body": """## Self-Attention

- Scaled dot-product attention
- Multi-head for parallel subspace learning
- Positional encoding (sinusoidal or learned)

## Variants

- Encoder-only: BERT, classification
- Decoder-only: GPT, generation
- Encoder-decoder: T5, translation

## Efficient Attention

- Flash Attention (IO-aware)
- Sliding window (Longformer)
- Linear attention approximations

Referenced by [[Vortex Search Engine]] embedding pipeline.
See [[Machine Learning Workflows]] for training infrastructure.
Related to [[Learning to Rank Approaches]].
""",
    },
    {
        "folder": "topics",
        "filename": "learning-to-rank-approaches.md",
        "title": "Learning to Rank Approaches",
        "type": "topic",
        "tags": ["search", "ml", "ranking"],
        "days_ago": 22,
        "body": """## Categories

### Pointwise
- Regression on relevance scores
- Simple but ignores list structure

### Pairwise
- LambdaRank: optimizes pairwise ordering
- RankNet: neural pairwise loss

### Listwise
- ListNet: probability distribution over permutations
- ApproxNDCG: differentiable NDCG proxy

## Features

- Query-document similarity
- Click-through rate signals
- Document quality metrics

Used by [[Vortex Search Engine]] hybrid ranker.
Builds on [[Information Retrieval Theory]].
""",
    },
    {
        "folder": "topics",
        "filename": "jwt-best-practices.md",
        "title": "JWT Best Practices",
        "type": "topic",
        "tags": ["security", "auth", "jwt"],
        "days_ago": 25,
        "body": """## Token Design

- Keep payloads small (< 1KB)
- Use short expiry (15 min for access tokens)
- Refresh tokens: opaque, stored server-side
- Always validate `iss`, `aud`, `exp` claims

## Signing

- RS256 for public key verification
- ES256 for smaller tokens
- Never use `none` algorithm
- Rotate keys with JWKS endpoint

## Revocation

- Token blacklist for immediate revocation
- Short TTL + refresh rotation as alternative
- Logout = revoke refresh token

Referenced by [[Aurora Auth Service]].
See [[Zero Trust Architecture]] for broader auth patterns.
""",
    },
    {
        "folder": "topics",
        "filename": "token-bucket-algorithm.md",
        "title": "Token Bucket Algorithm",
        "type": "topic",
        "tags": ["rate-limiting", "algorithms", "networking"],
        "days_ago": 30,
        "body": """## How It Works

- Bucket holds N tokens (capacity)
- Tokens added at fixed rate R
- Each request consumes one token
- Request rejected if bucket empty

## Variants

- Leaky bucket: constant output rate
- Sliding window log: exact counts
- Sliding window counter: approximate, memory-efficient

## Implementation Notes

- Redis + Lua for distributed rate limiting
- Per-user and per-endpoint buckets
- Burst allowance via initial capacity

Used by [[Aurora Auth Service]] and [[Backpressure Strategies]].
See [[API Design Principles]] for rate limit headers.
""",
    },
    {
        "folder": "topics",
        "filename": "compliance-logging-standards.md",
        "title": "Compliance Logging Standards",
        "type": "topic",
        "tags": ["compliance", "logging", "security"],
        "days_ago": 35,
        "body": """## Required Events

- Authentication attempts (success/failure)
- Authorization decisions
- Data access (read/write/delete)
- Configuration changes
- Admin operations

## Format

- Structured JSON with ISO 8601 timestamps
- Correlation ID across request chain
- PII masking in log output
- Immutable append-only storage

## Retention

- Auth logs: 2 years
- Data access: 5 years
- System events: 1 year

Referenced by [[Aurora Auth Service]] audit trail.
[[Sofia Reyes]] defined these standards for SOC 2 compliance.
""",
    },
    {
        "folder": "topics",
        "filename": "zero-trust-architecture.md",
        "title": "Zero Trust Architecture",
        "type": "topic",
        "tags": ["security", "architecture", "networking"],
        "days_ago": 28,
        "body": """## Principles

- Never trust, always verify
- Least privilege access
- Assume breach
- Verify explicitly (every request)

## Implementation

- mTLS between all services
- Short-lived certificates (SPIFFE/SPIRE)
- Identity-aware proxy (BeyondCorp model)
- Microsegmentation at network layer

## Monitoring

- Continuous authentication signals
- Anomaly detection on access patterns
- Device trust scoring

Referenced by [[Aurora Auth Service]] mTLS setup.
[[Sofia Reyes]] authored the zero trust migration plan.
""",
    },
    {
        "folder": "topics",
        "filename": "react-dashboard-patterns.md",
        "title": "React Dashboard Patterns",
        "type": "topic",
        "tags": ["react", "frontend", "dashboard"],
        "days_ago": 15,
        "body": """## Layout Patterns

- Grid-based responsive layouts
- Collapsible sidebar navigation
- Tabbed detail panels
- Drag-and-drop widget arrangement

## Data Patterns

- SWR/React Query for server state
- Optimistic updates for snappy UX
- WebSocket for real-time metrics
- Virtual scrolling for large lists

## Visualization

- Chart.js for standard charts
- D3 for custom visualizations
- Canvas for high-frequency updates

Used by [[Helios Solar Tracker]], [[Generative Art System]].
[[Kai Tanaka]] maintains the shared component library.
""",
    },
    {
        "folder": "topics",
        "filename": "signal-processing-fundamentals.md",
        "title": "Signal Processing Fundamentals",
        "type": "topic",
        "tags": ["dsp", "signals", "math"],
        "days_ago": 20,
        "body": """## Filtering

- FIR: finite impulse response, always stable
- IIR: infinite impulse response, more efficient
- Butterworth: maximally flat passband
- Chebyshev: steeper rolloff, passband ripple

## Transforms

- FFT for frequency domain analysis
- Wavelet for time-frequency localization
- Hilbert for envelope detection

## Applications

- Sensor noise reduction in [[Helios Solar Tracker]]
- Audio analysis for [[Procedural Generation Techniques]]
- Vibration monitoring in [[Embedded C Patterns]]
""",
    },
    {
        "folder": "topics",
        "filename": "data-lake-architecture.md",
        "title": "Data Lake Architecture",
        "type": "topic",
        "tags": ["data", "architecture", "storage"],
        "days_ago": 22,
        "body": """## Layers

### Bronze (Raw)
- Unprocessed data as-is from sources
- Schema-on-read
- Immutable, append-only

### Silver (Curated)
- Cleaned, deduplicated, typed
- Delta Lake for ACID transactions
- Schema enforcement

### Gold (Aggregated)
- Business-level aggregations
- Pre-computed metrics
- Served to dashboards

## Technology

- Iceberg or Delta Lake for table format
- Spark for batch processing
- Storage on object store (S3/GCS/MinIO)

Fed by [[Cascade Stream Processor]].
Archives move to [[Tundra Cold Storage]].
""",
    },
    {
        "folder": "topics",
        "filename": "cache-hierarchy-design.md",
        "title": "Cache Hierarchy Design",
        "type": "topic",
        "tags": ["caching", "performance", "architecture"],
        "days_ago": 18,
        "body": """## Layers

1. **L1 - In-process**: HashMap/LRU, ~1us
2. **L2 - Local**: Redis on same host, ~0.5ms
3. **L3 - Distributed**: Redis cluster, ~2ms
4. **L4 - CDN**: Edge cache, ~20ms

## Invalidation Strategies

- TTL-based: simple, eventual consistency
- Event-driven: pub/sub on mutations
- Version stamping: compare-and-set
- Cache-aside with write-through

## Anti-patterns

- Thundering herd (use request coalescing)
- Cache stampede (use locking or probabilistic early expiry)
- Stale reads (use lease-based invalidation)

Used by [[Vortex Search Engine]] and [[Meridian Geo API]].
""",
    },
    {
        "folder": "topics",
        "filename": "markdown-ast-transforms.md",
        "title": "Markdown AST Transforms",
        "type": "topic",
        "tags": ["markdown", "parsing", "ast"],
        "days_ago": 12,
        "body": """## Pipeline

1. Parse markdown to AST (unified/remark)
2. Transform AST nodes (visitor pattern)
3. Serialize back to markdown or HTML

## Common Transforms

- Wikilink resolution: `[[Title]]` to `<a href="...">Title</a>`
- Code block syntax highlighting
- Table of contents generation
- Frontmatter extraction to metadata

## Custom Syntax

- Callout/admonition blocks
- Embedded queries
- Transclusion (`![[note]]`)

Core of [[Fern Static Site Generator]] rendering.
""",
    },
    {
        "folder": "topics",
        "filename": "template-compilation-strategies.md",
        "title": "Template Compilation Strategies",
        "type": "topic",
        "tags": ["templates", "compilation", "performance"],
        "days_ago": 16,
        "body": """## Approaches

### Interpreted
- Walk AST at render time
- Flexible but slow
- Example: Mustache, Handlebars

### Compiled to Functions
- Template -> JS function at build time
- Fast render, moderate compile time
- Example: Svelte, Marko

### String Concatenation
- Template -> string concat code
- Fastest render
- Example: EJS (compiled mode)

## Optimization

- Partial precompilation for static sections
- Hoisting constant expressions
- Fragment caching for repeated blocks

Used by [[Fern Static Site Generator]] template engine.
""",
    },
    {
        "folder": "topics",
        "filename": "content-hashing-strategies.md",
        "title": "Content Hashing Strategies",
        "type": "topic",
        "tags": ["hashing", "caching", "builds"],
        "days_ago": 14,
        "body": """## Use Cases

- Build cache invalidation ([[Fern Static Site Generator]])
- Data integrity verification ([[Tundra Cold Storage]])
- Content-addressable storage (CAS)
- Deduplication in backup systems

## Algorithms

- xxHash: non-cryptographic, fastest
- BLAKE3: fast, cryptographic
- SHA-256: standard, widely supported
- CRC32: checksum, not collision-resistant

## Strategies

- File-level hashing for change detection
- Chunk-level (rolling hash) for dedup
- Tree hashing (Merkle) for verification
""",
    },
    {
        "folder": "topics",
        "filename": "procedural-generation-techniques.md",
        "title": "Procedural Generation Techniques",
        "type": "topic",
        "tags": ["creative-coding", "algorithms", "noise"],
        "days_ago": 10,
        "body": """## Noise Functions

- Perlin noise: gradient-based, smooth
- Simplex noise: fewer artifacts, higher dims
- Worley/Voronoi: cellular patterns
- Value noise: simple, fast, blocky

## Applications

- Terrain generation (heightmaps)
- Texture synthesis
- Particle system behaviors
- Music/sound generation

## Composition

- Fractal Brownian motion (fBm): layered octaves
- Domain warping: distort input coordinates
- Ridged noise: inverted abs for mountain ridges

Core of [[Generative Art System]] visual engine.
See [[Signal Processing Fundamentals]] for frequency analysis.
""",
    },
    {
        "folder": "topics",
        "filename": "postgis-spatial-queries.md",
        "title": "PostGIS Spatial Queries",
        "type": "topic",
        "tags": ["geospatial", "sql", "postgis"],
        "days_ago": 19,
        "body": """## Essential Functions

- `ST_Contains(geom, point)`: containment test
- `ST_DWithin(a, b, dist)`: proximity search
- `ST_Intersection(a, b)`: geometry overlay
- `ST_Transform(geom, srid)`: CRS conversion

## Indexing

- GiST index for spatial queries
- BRIN for sorted spatial data
- SP-GiST for quadtree-like splits

## Performance

- Simplify geometries before complex operations
- Use geography type for spherical calculations
- Cluster data by spatial locality

Foundational for [[Meridian Geo API]].
Used alongside [[Satellite Data Formats]] processing.
""",
    },
    {
        "folder": "topics",
        "filename": "boolean-logic-optimization.md",
        "title": "Boolean Logic Optimization",
        "type": "topic",
        "tags": ["algorithms", "logic", "optimization"],
        "days_ago": 24,
        "body": """## Techniques

### Algebraic Simplification
- De Morgan's laws for negation distribution
- Absorption: A + AB = A
- Consensus theorem

### Decision Diagrams
- BDD (Binary Decision Diagrams)
- ZDD for set families
- ROBDD for canonical representation

### Practical Applications
- Feature flag evaluation ([[Nebula Feature Flags]])
- Query optimization in search engines
- Access control policy evaluation

## Short-Circuit Evaluation

Order conditions by probability for early exit.
Used in [[Nebula Feature Flags]] rule engine.
""",
    },
    {
        "folder": "topics",
        "filename": "data-lifecycle-management.md",
        "title": "Data Lifecycle Management",
        "type": "topic",
        "tags": ["data", "governance", "storage"],
        "days_ago": 30,
        "body": """## Stages

1. **Creation**: schema validation, metadata tagging
2. **Active Use**: indexed, cached, frequently queried
3. **Retention**: compliance-driven, reduced access
4. **Archival**: compressed, cold storage, infrequent reads
5. **Deletion**: cryptographic erasure, audit logging

## Policies

- Classification-based retention rules
- Automated tier migration triggers
- Legal hold overrides
- Right-to-deletion workflows

Governs data flow in [[Tundra Cold Storage]].
Related to [[Compliance Logging Standards]].
[[Data Lake Architecture]] implements the active use tier.
""",
    },
    {
        "folder": "topics",
        "filename": "compression-algorithm-comparison.md",
        "title": "Compression Algorithm Comparison",
        "type": "topic",
        "tags": ["compression", "algorithms", "performance"],
        "days_ago": 26,
        "body": """## Lossless Algorithms

| Algorithm | Ratio | Speed | Use Case |
|-----------|-------|-------|----------|
| zstd | High | Fast | General purpose |
| LZ4 | Medium | Fastest | Real-time |
| Brotli | Highest | Slow | Web assets |
| gzip | Medium | Medium | Legacy compat |
| Snappy | Low | Very fast | Database pages |

## Choosing

- Latency-sensitive: LZ4 or Snappy
- Storage-sensitive: zstd or Brotli
- Compatibility: gzip

Used by [[Tundra Cold Storage]] for archive compression.
[[Cascade Stream Processor]] uses LZ4 for in-flight messages.
""",
    },
    # ── People (8) ───────────────────────────────────────────────────────
    {
        "folder": "people",
        "filename": "tomoko-hayashi.md",
        "title": "Tomoko Hayashi",
        "type": "person",
        "tags": ["hardware", "pcb", "embedded"],
        "days_ago": 30,
        "body": """## Role

Hardware engineer specializing in PCB design and embedded systems.
Background in power electronics and sensor integration.

## Involvement

- PCB layout for [[Helios Solar Tracker]]
- Sensor selection for [[IMU Calibration Techniques]]
- Reviews [[Embedded C Patterns]] for hardware compatibility

## Notes

Based in Osaka. Available for async reviews, prefers diagrams over text.
Runs the hardware-software integration sync biweekly.
""",
    },
    {
        "folder": "people",
        "filename": "ravi-chandrasekaran.md",
        "title": "Ravi Chandrasekaran",
        "type": "person",
        "tags": ["cloud", "infrastructure", "devops"],
        "days_ago": 28,
        "body": """## Role

Cloud infrastructure lead. Manages AWS/GCP deployments, Kubernetes clusters,
and CI/CD pipelines.

## Involvement

- Cloud infra for [[Helios Solar Tracker]] dashboard
- Tiering logic for [[Tundra Cold Storage]]
- Kubernetes setup for [[Cascade Stream Processor]]

## Notes

Strong advocate for infrastructure as code (Terraform).
Mentors junior DevOps engineers. Weekly office hours on Fridays.
""",
    },
    {
        "folder": "people",
        "filename": "omar-farouk.md",
        "title": "Omar Farouk",
        "type": "person",
        "tags": ["data", "distributed", "architecture"],
        "days_ago": 25,
        "body": """## Role

Data infrastructure architect. Specializes in distributed data systems
and stream processing at scale.

## Involvement

- Partitioning strategy for [[Cascade Stream Processor]]
- Distributed index for [[Vortex Search Engine]]
- Migration workers for [[Tundra Cold Storage]]

## Notes

Previously at Confluent. Deep expertise in Kafka internals.
Prefers whiteboard sessions for architecture discussions.
Speaks at data engineering conferences regularly.
""",
    },
    {
        "folder": "people",
        "filename": "yuki-watanabe.md",
        "title": "Yuki Watanabe",
        "type": "person",
        "tags": ["backend", "typescript", "sdk"],
        "days_ago": 22,
        "body": """## Role

Backend engineer with strong TypeScript skills. Builds SDKs,
APIs, and developer tooling.

## Involvement

- Dead letter queue for [[Cascade Stream Processor]]
- Plugin system for [[Fern Static Site Generator]]
- TypeScript SDK for [[Nebula Feature Flags]]

## Notes

Maintains internal TypeScript style guide.
Active in code review. Pair programs on Wednesdays.
""",
    },
    {
        "folder": "people",
        "filename": "dr-amara-osei.md",
        "title": "Dr. Amara Osei",
        "type": "person",
        "tags": ["color", "perception", "research"],
        "days_ago": 20,
        "body": """## Role

Color science researcher and consultant. PhD in Visual Perception
from University of Edinburgh.

## Involvement

- Perceptual color models for [[Prism Color Engine]]
- Aesthetic color theory for [[Generative Art System]]
- Recommended OKLCH color space (see [[Color Science Notes]])

## Notes

Publishes in Journal of the Optical Society. Quarterly consulting
arrangement. Prefers video calls with screen sharing.
""",
    },
    {
        "folder": "people",
        "filename": "priya-sharma.md",
        "title": "Priya Sharma",
        "type": "person",
        "tags": ["search", "nlp", "ml"],
        "days_ago": 18,
        "body": """## Role

Search engineer and NLP specialist. Focuses on query understanding
and relevance tuning.

## Involvement

- Query parser for [[Vortex Search Engine]]
- Evaluated [[Learning to Rank Approaches]] for hybrid ranking
- Reviews [[Information Retrieval Theory]] applications

## Notes

Former search engineer at Elastic. Strong opinions on evaluation
metrics (prefers NDCG over MAP). Runs the search quality weekly.
""",
    },
    {
        "folder": "people",
        "filename": "niko-petrov.md",
        "title": "Niko Petrov",
        "type": "person",
        "tags": ["rust", "systems", "parsers"],
        "days_ago": 16,
        "body": """## Role

Systems programmer specializing in Rust. Builds parsers, compilers,
and high-performance data processing tools.

## Involvement

- ICC profile parser for [[Prism Color Engine]]
- Evaluation engine for [[Nebula Feature Flags]]
- Contributes to [[Boolean Logic Optimization]] patterns

## Notes

Open source contributor (serde, nom). Advocates for algebraic types
and exhaustive matching. Code reviews are thorough.
""",
    },
    {
        "folder": "people",
        "filename": "elias-hoffman.md",
        "title": "Elias Hoffman",
        "type": "person",
        "tags": ["security", "auth", "backend"],
        "days_ago": 14,
        "body": """## Role

Security engineer focusing on authentication systems and cryptography.

## Involvement

- Passkey/WebAuthn implementation in [[Aurora Auth Service]]
- Routing engine for [[Meridian Geo API]]
- Reviews [[JWT Best Practices]] and [[Zero Trust Architecture]]

## Notes

CISSP certified. Previously at an identity provider startup.
Runs security training sessions quarterly.
""",
    },
    # ── Daily (10) ───────────────────────────────────────────────────────
    {
        "folder": "daily",
        "filename": "2026-03-15.md",
        "title": "2026-03-15",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 0,
        "body": """## Standup

### Done
- Deployed [[Helios Solar Tracker]] firmware v2.3
- [[Tomoko Hayashi]] confirmed PCB rev C passes all tests
- Fixed memory leak in [[Cascade Stream Processor]] state backend

### Today
- [[Prism Color Engine]] gamut mapping benchmarks
- Review [[Niko Petrov]]'s ICC parser PR
- Sync with [[Dr. Amara Osei]] on OKLCH integration

### Blockers
- Waiting on [[Ravi Chandrasekaran]] for staging cluster access
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-11.md",
        "title": "2026-03-11",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 4,
        "body": """## Standup

### Done
- [[Vortex Search Engine]] query parser refactored
- [[Priya Sharma]] tuned BM25 parameters, +8% NDCG
- [[Nebula Feature Flags]] TypeScript SDK released

### Today
- [[Aurora Auth Service]] passkey testing
- [[Elias Hoffman]] presenting WebAuthn flow
- Update [[JWT Best Practices]] with rotation strategy

### Blockers
- None
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-10.md",
        "title": "2026-03-10",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 5,
        "body": """## Standup

### Done
- [[Fern Static Site Generator]] plugin API finalized
- [[Yuki Watanabe]] shipped plugin system v1
- [[Tundra Cold Storage]] compression benchmarks complete

### Today
- Start [[Meridian Geo API]] routing optimization
- [[Omar Farouk]] pair programming on Kafka consumer groups
- Review [[Compression Algorithm Comparison]] for cold storage

### Blockers
- [[Data Lake Architecture]] schema migration pending
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-09.md",
        "title": "2026-03-09",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 6,
        "body": """## Standup

### Done
- [[Generative Art System]] node editor shipped
- [[Kai Tanaka]] finalized the visual programming UI
- [[Signal Processing Fundamentals]] doc reviewed

### Today
- [[Prism Color Engine]] Python bindings
- Test [[Procedural Generation Techniques]] noise library
- [[Dr. Amara Osei]] consultation on color harmony

### Blockers
- GPU test machine down, affects [[Compute Shader Patterns]] work
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-08.md",
        "title": "2026-03-08",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 7,
        "body": """## Standup

### Done
- [[Cache Hierarchy Design]] doc published
- [[Vortex Search Engine]] p99 latency down to 85ms
- [[Priya Sharma]] integrated [[Learning to Rank Approaches]]

### Today
- [[Cascade Stream Processor]] exactly-once testing
- [[Omar Farouk]] investigating partition skew
- [[Nebula Feature Flags]] A/B experiment framework

### Blockers
- Waiting for [[Apache Kafka Patterns]] cluster upgrade
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-07.md",
        "title": "2026-03-07",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 8,
        "body": """## Standup

### Done
- [[Aurora Auth Service]] OAuth2 flow complete
- [[Sofia Reyes]] signed off on threat model
- Updated [[Compliance Logging Standards]] retention policy

### Today
- [[Lighthouse Monitoring]] Grafana dashboard refresh
- [[Marco Bellini]] migrating to new [[Prometheus Alerting Rules]]
- [[Zero Trust Architecture]] mTLS rollout to staging

### Blockers
- Certificate rotation script failing on arm64 nodes
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-06.md",
        "title": "2026-03-06",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 9,
        "body": """## Standup

### Done
- [[Helios Solar Tracker]] field test week 1 complete (98.3% accuracy)
- [[MQTT Broker Design]] scaling tested to 50K connections
- [[IMU Calibration Techniques]] temperature compensation calibrated

### Today
- Start [[Prism Color Engine]] ICC v4 compliance tests
- [[Tomoko Hayashi]] shipping PCB rev C prototypes
- Review [[Embedded C Patterns]] watchdog implementation

### Blockers
- Sensor supplier delayed shipment by 2 days
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-05.md",
        "title": "2026-03-05",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 10,
        "body": """## Standup

### Done
- [[Meridian Geo API]] geocoding endpoint live
- [[PostGIS Spatial Queries]] performance tuned (2ms p50 tiles)
- [[Dr. Lena Okafor]] reviewed CRS transform accuracy

### Today
- [[Fern Static Site Generator]] incremental build implementation
- [[Content Hashing Strategies]] for invalidation
- [[Yuki Watanabe]] starting plugin system architecture

### Blockers
- None
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-04.md",
        "title": "2026-03-04",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 11,
        "body": """## Standup

### Done
- [[Data Lake Architecture]] bronze layer migration
- [[Tundra Cold Storage]] zstd integration benchmarked
- [[Ravi Chandrasekaran]] provisioned new Kubernetes cluster

### Today
- [[Cascade Stream Processor]] windowing implementation
- [[Stream Processing Theory]] session window testing
- [[Backpressure Strategies]] load testing

### Blockers
- Spark cluster out of disk space, requesting expansion
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-03.md",
        "title": "2026-03-03",
        "type": "daily",
        "tags": ["standup"],
        "author_override": "agent:standup",
        "days_ago": 12,
        "body": """## Standup

### Done
- [[Vortex Search Engine]] hybrid ranking prototype
- [[Transformer Architecture Notes]] survey published
- [[Information Retrieval Theory]] benchmark suite created

### Today
- [[Generative Art System]] noise function library
- [[Procedural Generation Techniques]] fBm implementation
- [[Color Science Notes]] OKLCH conversion testing

### Blockers
- GPU driver issue on dev workstation
""",
    },
    # ── Captures (7) ─────────────────────────────────────────────────────
    {
        "folder": "captures",
        "filename": "capture-iot-security-audit.md",
        "title": "IoT Security Audit Findings",
        "type": "capture",
        "tags": ["security", "iot", "audit"],
        "days_ago": 3,
        "body": """## Findings

### Critical
- [[MQTT Broker Design]] allows anonymous connections in staging
- Firmware update channel for [[Helios Solar Tracker]] lacks signing

### High
- [[Embedded C Patterns]] stack buffer sizes not validated
- Telemetry data in transit not encrypted (MQTT without TLS)

### Recommendations
- Enable TLS on all MQTT connections
- Implement firmware signing with ED25519
- Add stack canaries to firmware build
- [[Sofia Reyes]] to review remediation plan by March 20
""",
    },
    {
        "folder": "captures",
        "filename": "capture-search-quality-review.md",
        "title": "Search Quality Weekly Review",
        "type": "capture",
        "tags": ["search", "quality", "metrics"],
        "days_ago": 4,
        "body": """## Metrics (Week of March 10)

- NDCG@10: 0.78 (up from 0.72)
- MRR: 0.85
- p50 latency: 42ms
- p99 latency: 85ms

## Changes

- [[Priya Sharma]] tuned BM25 k1 from 1.2 to 1.5
- [[Learning to Rank Approaches]] LambdaRank model retrained
- [[Vortex Search Engine]] added query expansion

## Next Steps

- Evaluate ColBERT for late interaction
- Test [[Transformer Architecture Notes]] new embedding model
- Build click-through rate feedback loop
""",
    },
    {
        "folder": "captures",
        "filename": "capture-color-space-research.md",
        "title": "OKLCH Color Space Research",
        "type": "capture",
        "tags": ["color", "research", "perception"],
        "days_ago": 6,
        "body": """## Why OKLCH

- Perceptually uniform lightness channel
- Hue stability across lightness changes
- Better than HSL for programmatic color manipulation
- CSS Color Level 4 native support

## Findings from [[Dr. Amara Osei]]

- OKLCH gamut mapping superior to CIELAB for wide-gamut displays
- Chroma reduction preferred over hue shifting for out-of-gamut colors
- Lightness-based contrast ratios more reliable than sRGB calculations

## Implementation

Apply to [[Prism Color Engine]] core pipeline.
Update [[Generative Art System]] palette generation.
See [[Color Science Notes]] for detailed conversion math.
""",
    },
    {
        "folder": "captures",
        "filename": "capture-infra-cost-review.md",
        "title": "Infrastructure Cost Review Q1",
        "type": "capture",
        "tags": ["infrastructure", "cost", "review"],
        "days_ago": 8,
        "body": """## Summary

Total cloud spend: $47,200 (Q1 2026)

### By Service
- [[Cascade Stream Processor]] Kafka cluster: $12,400
- [[Vortex Search Engine]] GPU instances: $9,800
- [[Tundra Cold Storage]] S3: $4,100
- [[Meridian Geo API]] compute: $3,900
- [[Aurora Auth Service]] multi-region: $2,800
- Other: $14,200

### Recommendations from [[Ravi Chandrasekaran]]
- Move to spot instances for [[Vortex Search Engine]] training jobs (-40%)
- [[Tundra Cold Storage]] glacier tier for data > 1 year (-60%)
- Right-size [[Cascade Stream Processor]] partitions (-20%)
""",
    },
    {
        "folder": "captures",
        "filename": "capture-art-gallery-feedback.md",
        "title": "Generative Art Gallery User Feedback",
        "type": "capture",
        "tags": ["feedback", "creative-coding", "ux"],
        "days_ago": 5,
        "body": """## Beta Tester Feedback

### Positive
- Node editor intuitive for non-programmers
- Color palette generation from [[Prism Color Engine]] praised
- Export quality excellent at 4K resolution

### Issues
- [[Procedural Generation Techniques]] noise preview too slow on mobile
- Color picker should support [[Color Science Notes]] OKLCH natively
- Need undo/redo in node editor (currently missing)

### Feature Requests
- Audio-reactive mode (connect to [[Signal Processing Fundamentals]])
- Collaborative editing (multi-user on same canvas)
- Template marketplace

## Action Items
- [[Kai Tanaka]] to optimize mobile rendering
- [[Dr. Amara Osei]] to review OKLCH picker design
""",
    },
    {
        "folder": "captures",
        "filename": "capture-kafka-upgrade-plan.md",
        "title": "Kafka Cluster Upgrade Plan",
        "type": "capture",
        "tags": ["kafka", "infrastructure", "migration"],
        "days_ago": 9,
        "body": """## Current State

- Apache Kafka 3.4 on 5-broker cluster
- 120 topics, 2400 partitions
- Peak throughput: 500K events/sec

## Target

- Upgrade to Kafka 3.7 (KRaft mode, no ZooKeeper)
- Scale to 8 brokers for [[Cascade Stream Processor]] growth
- Enable tiered storage for [[Data Lake Architecture]] integration

## Migration Plan

1. Rolling upgrade 3.4 -> 3.5 -> 3.6 -> 3.7
2. Migrate metadata from ZooKeeper to KRaft
3. Add 3 new brokers, rebalance partitions
4. Enable tiered storage on cold topics

[[Omar Farouk]] leading the migration.
[[Ravi Chandrasekaran]] provisioning new hardware.
See [[Apache Kafka Patterns]] for partition strategy.
""",
    },
    {
        "folder": "captures",
        "filename": "capture-security-training-notes.md",
        "title": "Q1 Security Training Notes",
        "type": "capture",
        "tags": ["security", "training", "team"],
        "days_ago": 11,
        "body": """## Session by [[Sofia Reyes]]

### Topics Covered
- OWASP Top 10 2025 updates
- [[Zero Trust Architecture]] principles
- [[JWT Best Practices]] common mistakes
- Supply chain security (dependency scanning)

### Key Takeaways
- All services must implement [[Compliance Logging Standards]]
- [[Aurora Auth Service]] to be mandatory SSO gateway
- Dependency bot (Renovate) required on all repos
- mTLS rollout deadline: end of Q2

### Action Items
- Each team to complete threat model for their services
- [[Elias Hoffman]] to run WebAuthn workshop
- [[Niko Petrov]] to audit Rust dependency tree for [[Prism Color Engine]]
""",
    },
]


def write_note(threads_dir: Path, note: dict) -> None:
    """Write a single note to the vault."""
    folder = threads_dir / note["folder"]
    folder.mkdir(parents=True, exist_ok=True)
    filepath = folder / note["filename"]

    created = ts(note["days_ago"])
    modified = ts(max(0, note["days_ago"] - 2))
    author = note.get("author_override", "user")

    tags_str = ", ".join(note["tags"])
    frontmatter = f"""---
id: {nid()}
title: "{note["title"]}"
type: {note["type"]}
tags: [{tags_str}]
created: {created}
modified: {modified}
author: {author}
source: manual
links: []
status: active
history:
  - action: created
    by: {author}
    at: {created}
    reason: "initial creation"
---
"""
    filepath.write_text(frontmatter + note["body"])
    print(f"  wrote {filepath.relative_to(threads_dir)}")


def main() -> None:
    vault_name = sys.argv[1] if len(sys.argv) > 1 else "default"
    threads = vault_dir(vault_name)

    if not threads.exists():
        print(f"Vault '{vault_name}' not found at {threads}")
        sys.exit(1)

    print(f"Seeding vault '{vault_name}' with {len(NOTES)} notes...")

    for note in NOTES:
        write_note(threads, note)

    # Clear cached graph so it rebuilds
    graph_cache = threads.parent / ".loom" / "graph.json"
    if graph_cache.exists():
        graph_cache.unlink()
        print("  cleared graph cache")

    print(f"\nDone! {len(NOTES)} notes written.")


if __name__ == "__main__":
    main()
