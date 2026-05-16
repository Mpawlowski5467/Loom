"""Seed a vault with sample data for demo/testing purposes.

Usage:
    python scripts/seed_sample_data.py [vault_name]

Defaults to the 'default' vault. Creates ~25 interconnected notes
across all note types with realistic wikilinks.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
from random import randint

LOOM_HOME = Path.home() / ".loom"


def vault_dir(name: str) -> Path:
    return LOOM_HOME / "vaults" / name / "threads"


def note_id() -> str:
    return f"thr_{randint(100000, 999999):06x}"


NOW = datetime.now()


def ts(days_ago: int = 0) -> str:
    return (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")


NOTES: list[dict] = [
    # -- Projects --
    {
        "folder": "projects",
        "filename": "atlas-mapping-engine.md",
        "id": note_id(),
        "title": "Atlas Mapping Engine",
        "type": "project",
        "tags": ["mapping", "geospatial", "python"],
        "author": "user",
        "days_ago": 12,
        "body": """## Overview

Atlas is a geospatial mapping engine built in Python. It processes satellite
imagery and produces interactive vector tile maps.

## Architecture

The pipeline has three stages:
1. Ingest raw imagery from [[Satellite Data Formats]]
2. Run feature extraction via [[Computer Vision Fundamentals]]
3. Render tiles using the vector pipeline

[[Dr. Lena Okafor]] is the domain expert consulting on projection systems.
[[Marco Bellini]] handles the backend infrastructure.

## Status

Currently in beta. The tile renderer needs optimization for large datasets.
See [[Performance Tuning Strategies]] for current approaches.
""",
    },
    {
        "folder": "projects",
        "filename": "neptune-weather-sim.md",
        "id": note_id(),
        "title": "Neptune Weather Sim",
        "type": "project",
        "tags": ["simulation", "weather", "rust"],
        "author": "user",
        "days_ago": 8,
        "body": """## Overview

A weather simulation system built in Rust. Models atmospheric conditions
using fluid dynamics and outputs 72-hour forecasts.

## Key Components

- Atmosphere model based on [[Fluid Dynamics Notes]]
- Data ingestion from [[Satellite Data Formats]]
- Visualization layer using [[WebGL Rendering]]
- [[Dr. Lena Okafor]] advises on numerical methods

## Links

Related to [[Atlas Mapping Engine]] for geospatial overlay support.
[[Kai Tanaka]] is building the frontend dashboard.
""",
    },
    {
        "folder": "projects",
        "filename": "lighthouse-monitoring.md",
        "id": note_id(),
        "title": "Lighthouse Monitoring",
        "type": "project",
        "tags": ["monitoring", "devops", "golang"],
        "author": "user",
        "days_ago": 20,
        "body": """## Overview

An infrastructure monitoring system that tracks service health, latency,
and error rates across distributed systems.

## Design

Uses a pull-based model inspired by Prometheus. Agents run on each host
and report metrics to the central collector.

See [[Distributed Systems Patterns]] for the architecture decisions.
[[Marco Bellini]] designed the alerting pipeline.

## Integrations

- Slack notifications via webhook
- PagerDuty escalation
- Grafana dashboards (see [[Observability Stack]])
""",
    },
    # -- Topics --
    {
        "folder": "topics",
        "filename": "distributed-systems-patterns.md",
        "id": note_id(),
        "title": "Distributed Systems Patterns",
        "type": "topic",
        "tags": ["architecture", "distributed", "patterns"],
        "author": "user",
        "days_ago": 30,
        "body": """## Core Patterns

### Consensus
- Raft protocol for leader election
- Paxos for state machine replication

### Communication
- Event sourcing with append-only logs
- CQRS for read/write separation

### Resilience
- Circuit breaker pattern (see [[Performance Tuning Strategies]])
- Bulkhead isolation
- Retry with exponential backoff

Referenced by [[Lighthouse Monitoring]] and [[Atlas Mapping Engine]].
""",
    },
    {
        "folder": "topics",
        "filename": "computer-vision-fundamentals.md",
        "id": note_id(),
        "title": "Computer Vision Fundamentals",
        "type": "topic",
        "tags": ["ml", "vision", "python"],
        "author": "user",
        "days_ago": 25,
        "body": """## Core Concepts

### Feature Detection
- SIFT and SURF descriptors
- Corner detection (Harris, Shi-Tomasi)
- Edge detection (Canny, Sobel)

### Deep Learning Approaches
- CNNs for classification
- U-Net for segmentation
- YOLO for object detection

Used heavily in [[Atlas Mapping Engine]] for satellite imagery analysis.
[[Dr. Lena Okafor]] recommended the U-Net approach for terrain classification.

See also [[Machine Learning Workflows]].
""",
    },
    {
        "folder": "topics",
        "filename": "satellite-data-formats.md",
        "id": note_id(),
        "title": "Satellite Data Formats",
        "type": "topic",
        "tags": ["geospatial", "data", "formats"],
        "author": "user",
        "days_ago": 22,
        "body": """## Common Formats

### Raster
- GeoTIFF: georeferenced TIFF, most common
- HDF5: hierarchical, used by NASA missions
- NetCDF: climate and ocean data

### Vector
- GeoJSON: web-friendly, human-readable
- Shapefile: legacy but ubiquitous
- GeoPackage: modern SQLite-based

Referenced by [[Atlas Mapping Engine]] and [[Neptune Weather Sim]].

## Processing Tools

- GDAL for format conversion
- Rasterio for Python raster I/O
- Fiona for vector data
""",
    },
    {
        "folder": "topics",
        "filename": "fluid-dynamics-notes.md",
        "id": note_id(),
        "title": "Fluid Dynamics Notes",
        "type": "topic",
        "tags": ["physics", "simulation", "math"],
        "author": "user",
        "days_ago": 15,
        "body": """## Navier-Stokes Equations

The foundation of fluid simulation. Describes velocity, pressure,
temperature, and density of a moving fluid.

## Numerical Methods

- Finite difference for simple grids
- Finite element for complex geometries
- Spectral methods for periodic domains

Used in [[Neptune Weather Sim]] for atmosphere modeling.

## Turbulence

- Reynolds-averaged models (RANS)
- Large eddy simulation (LES)
- Direct numerical simulation (DNS) -- too expensive for real-time
""",
    },
    {
        "folder": "topics",
        "filename": "performance-tuning-strategies.md",
        "id": note_id(),
        "title": "Performance Tuning Strategies",
        "type": "topic",
        "tags": ["performance", "optimization", "engineering"],
        "author": "user",
        "days_ago": 18,
        "body": """## Profiling First

Always measure before optimizing. Tools:
- Python: cProfile, py-spy, scalene
- Rust: cargo flamegraph, perf
- Go: pprof

## Common Strategies

### Memory
- Object pooling for frequent allocations
- Arena allocators for batch workloads
- Cache-friendly data layouts

### Concurrency
- Work stealing for uneven loads
- Lock-free data structures
- Batching to amortize overhead

Referenced by [[Atlas Mapping Engine]], [[Distributed Systems Patterns]].
[[Marco Bellini]] presented these patterns at the last architecture review.
""",
    },
    {
        "folder": "topics",
        "filename": "machine-learning-workflows.md",
        "id": note_id(),
        "title": "Machine Learning Workflows",
        "type": "topic",
        "tags": ["ml", "workflows", "mlops"],
        "author": "user",
        "days_ago": 10,
        "body": """## Pipeline Stages

1. Data collection and labeling
2. Feature engineering
3. Model training and validation
4. Deployment and monitoring

## Tools

- MLflow for experiment tracking
- DVC for data versioning
- Kubeflow for orchestration

See [[Computer Vision Fundamentals]] for vision-specific workflows.
[[Kai Tanaka]] is evaluating MLflow for the team.

## Best Practices

- Version everything: data, code, models
- Automate retraining pipelines
- Monitor for data drift in production
""",
    },
    {
        "folder": "topics",
        "filename": "webgl-rendering.md",
        "id": note_id(),
        "title": "WebGL Rendering",
        "type": "topic",
        "tags": ["graphics", "web", "rendering"],
        "author": "user",
        "days_ago": 14,
        "body": """## Fundamentals

WebGL provides GPU-accelerated rendering in the browser via OpenGL ES 2.0.

### Pipeline
1. Vertex shader: transform positions
2. Rasterization: convert to fragments
3. Fragment shader: compute pixel colors

## Libraries

- Three.js: high-level 3D
- Deck.gl: geospatial visualization
- Regl: functional WebGL

Used in [[Neptune Weather Sim]] for the forecast visualization layer.

## Performance Tips

- Minimize draw calls
- Use instanced rendering for repeated geometry
- Texture atlases to reduce state changes
""",
    },
    {
        "folder": "topics",
        "filename": "observability-stack.md",
        "id": note_id(),
        "title": "Observability Stack",
        "type": "topic",
        "tags": ["monitoring", "logging", "tracing"],
        "author": "user",
        "days_ago": 16,
        "body": """## Three Pillars

### Metrics
- Prometheus for collection
- Grafana for visualization
- Custom dashboards per service

### Logging
- Structured JSON logs
- Loki for aggregation
- Correlation IDs across services

### Tracing
- OpenTelemetry SDK
- Jaeger for trace visualization
- Distributed context propagation

Referenced by [[Lighthouse Monitoring]] for the monitoring design.
[[Marco Bellini]] set up the initial Grafana dashboards.
""",
    },
    {
        "folder": "topics",
        "filename": "api-design-principles.md",
        "id": note_id(),
        "title": "API Design Principles",
        "type": "topic",
        "tags": ["api", "rest", "design"],
        "author": "user",
        "days_ago": 28,
        "body": """## REST Guidelines

- Use nouns for resources, verbs for actions
- Consistent pluralization
- Pagination with cursor-based tokens
- Version via URL path (/v1/)

## Error Handling

- Structured error bodies with code + message
- 4xx for client errors, 5xx for server errors
- Include request ID for debugging

## Authentication

- Bearer tokens for API access
- OAuth2 for third-party integrations
- API keys for service-to-service

See [[Distributed Systems Patterns]] for inter-service communication.
""",
    },
    # -- People --
    {
        "folder": "people",
        "filename": "dr-lena-okafor.md",
        "id": note_id(),
        "title": "Dr. Lena Okafor",
        "type": "person",
        "tags": ["advisor", "geospatial", "research"],
        "author": "user",
        "days_ago": 35,
        "body": """## Role

Domain expert and research advisor. PhD in Remote Sensing from ETH Zurich.
Specializes in satellite imagery processing and terrain classification.

## Involvement

- Advises on [[Atlas Mapping Engine]] projection systems
- Recommended U-Net for [[Computer Vision Fundamentals]] terrain work
- Consults on numerical methods for [[Neptune Weather Sim]]

## Contact

Weekly syncs on Tuesdays. Prefers async communication via email.
""",
    },
    {
        "folder": "people",
        "filename": "marco-bellini.md",
        "id": note_id(),
        "title": "Marco Bellini",
        "type": "person",
        "tags": ["engineering", "infrastructure", "backend"],
        "author": "user",
        "days_ago": 32,
        "body": """## Role

Senior infrastructure engineer. Handles backend systems, CI/CD,
and platform reliability.

## Involvement

- Backend infrastructure for [[Atlas Mapping Engine]]
- Alerting pipeline in [[Lighthouse Monitoring]]
- Presented [[Performance Tuning Strategies]] at architecture review
- Set up [[Observability Stack]] Grafana dashboards

## Notes

Strong opinions on observability. Advocates for structured logging.
Prefers Go for infrastructure tooling.
""",
    },
    {
        "folder": "people",
        "filename": "kai-tanaka.md",
        "id": note_id(),
        "title": "Kai Tanaka",
        "type": "person",
        "tags": ["frontend", "visualization", "ml"],
        "author": "user",
        "days_ago": 20,
        "body": """## Role

Frontend engineer and data visualization specialist.
Background in interactive graphics and dashboard design.

## Involvement

- Building the dashboard for [[Neptune Weather Sim]]
- Evaluating MLflow for [[Machine Learning Workflows]]
- Interested in [[WebGL Rendering]] for data viz

## Notes

Runs the weekly frontend guild meeting.
Advocates for TypeScript everywhere.
""",
    },
    {
        "folder": "people",
        "filename": "sofia-reyes.md",
        "id": note_id(),
        "title": "Sofia Reyes",
        "type": "person",
        "tags": ["security", "architecture", "review"],
        "author": "user",
        "days_ago": 26,
        "body": """## Role

Security architect. Reviews system designs for vulnerabilities
and compliance requirements.

## Involvement

- Security review for [[Lighthouse Monitoring]] agent protocol
- Advised on auth patterns in [[API Design Principles]]
- Reviews [[Distributed Systems Patterns]] for trust boundaries

## Notes

Leads the quarterly security audit. Maintains the threat model.
""",
    },
    # -- Daily --
    {
        "folder": "daily",
        "filename": "2026-03-14.md",
        "id": note_id(),
        "title": "2026-03-14",
        "type": "daily",
        "tags": ["standup"],
        "author": "agent:standup",
        "days_ago": 1,
        "body": """## Standup

### Done
- Merged tile optimization PR for [[Atlas Mapping Engine]]
- Reviewed [[Marco Bellini]]'s alerting pipeline changes
- Updated [[Performance Tuning Strategies]] with Rust flamegraph notes

### Today
- Continue [[Neptune Weather Sim]] atmosphere model testing
- Meet with [[Dr. Lena Okafor]] on projection accuracy
- Review [[Kai Tanaka]]'s dashboard PR

### Blockers
- None
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-13.md",
        "id": note_id(),
        "title": "2026-03-13",
        "type": "daily",
        "tags": ["standup"],
        "author": "agent:standup",
        "days_ago": 2,
        "body": """## Standup

### Done
- Set up [[Observability Stack]] tracing for Atlas services
- Paired with [[Kai Tanaka]] on [[WebGL Rendering]] performance
- Published [[Fluid Dynamics Notes]] from research session

### Today
- Atlas tile renderer optimization
- [[Lighthouse Monitoring]] load test

### Blockers
- Waiting on [[Satellite Data Formats]] sample data from vendor
""",
    },
    {
        "folder": "daily",
        "filename": "2026-03-12.md",
        "id": note_id(),
        "title": "2026-03-12",
        "type": "daily",
        "tags": ["standup"],
        "author": "agent:standup",
        "days_ago": 3,
        "body": """## Standup

### Done
- [[Sofia Reyes]] completed security review of Lighthouse
- Updated [[API Design Principles]] with pagination patterns
- [[Machine Learning Workflows]] doc reviewed by Kai

### Today
- Atlas mapping accuracy tests
- Neptune weather model calibration

### Blockers
- None
""",
    },
    # -- Captures --
    {
        "folder": "captures",
        "filename": "capture-webgpu-article.md",
        "id": note_id(),
        "title": "WebGPU Migration Notes",
        "type": "capture",
        "tags": ["graphics", "web", "migration"],
        "author": "user",
        "days_ago": 3,
        "body": """## Source

Article on migrating from WebGL to WebGPU for compute-heavy visualizations.

## Key Takeaways

- WebGPU offers compute shaders (not available in WebGL)
- Better memory management with explicit buffer control
- Supported in Chrome and Firefox nightly

Relevant to [[WebGL Rendering]] and [[Neptune Weather Sim]] dashboard.
""",
    },
    {
        "folder": "captures",
        "filename": "capture-team-retro.md",
        "id": note_id(),
        "title": "Q1 Team Retro Notes",
        "type": "capture",
        "tags": ["retro", "process", "team"],
        "author": "user",
        "days_ago": 5,
        "body": """## What Went Well

- [[Atlas Mapping Engine]] beta launch on schedule
- [[Lighthouse Monitoring]] caught three incidents early
- [[Marco Bellini]]'s observability work saved hours of debugging

## What To Improve

- Need better test coverage on [[Neptune Weather Sim]]
- Documentation gaps in [[Distributed Systems Patterns]]
- [[Machine Learning Workflows]] tooling still manual

## Action Items

- [[Kai Tanaka]] to set up automated ML pipeline
- [[Sofia Reyes]] to schedule quarterly security training
""",
    },
    {
        "folder": "captures",
        "filename": "capture-conference-talk.md",
        "id": note_id(),
        "title": "GeoTech Conf Talk Ideas",
        "type": "capture",
        "tags": ["conference", "talk", "geospatial"],
        "author": "user",
        "days_ago": 7,
        "body": """## Potential Topics

1. Real-time satellite tile rendering at scale ([[Atlas Mapping Engine]])
2. Combining [[Computer Vision Fundamentals]] with geospatial data
3. [[Fluid Dynamics Notes]] applied to weather prediction

## Submission Deadline

April 15, 2026

## Co-speakers

- [[Dr. Lena Okafor]] for the CV + geospatial talk
- [[Marco Bellini]] for the infrastructure scaling story
""",
    },
]


def write_note(threads_dir: Path, note: dict) -> None:
    folder = threads_dir / note["folder"]
    folder.mkdir(parents=True, exist_ok=True)
    filepath = folder / note["filename"]

    created = ts(note["days_ago"])
    modified = ts(max(0, note["days_ago"] - 2))

    frontmatter = f"""---
id: {note["id"]}
title: "{note["title"]}"
type: {note["type"]}
tags: [{", ".join(note["tags"])}]
created: {created}
modified: {modified}
author: {note["author"]}
source: manual
links: []
status: active
history:
  - action: created
    by: {note["author"]}
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
        print("Run: python -m api.main to init the vault first")
        sys.exit(1)

    print(f"Seeding vault '{vault_name}' with {len(NOTES)} sample notes...")

    for note in NOTES:
        write_note(threads, note)

    # Clear cached graph so it rebuilds
    graph_cache = threads.parent / ".loom" / "graph.json"
    if graph_cache.exists():
        graph_cache.unlink()
        print("  cleared graph cache")

    print(f"Done! {len(NOTES)} notes written.")


if __name__ == "__main__":
    main()
