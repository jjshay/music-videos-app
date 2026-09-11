# Music Video Creator — Project Brief

## At a glance

| Field | Value |
|---|---|
| Portfolio area | Creative tooling |
| Repository | [jjshay/music-videos-app](https://github.com/jjshay/music-videos-app) |
| Status | Source available; runtime not revalidated in this documentation review |
| Evidence review | 2026-09-11; [commit fb63740](https://github.com/jjshay/music-videos-app/tree/fb63740d6987b37521b6ad45276c8e6b04088aa5) |

## Problem and intended value

Branded listing videos need coordinated clip selection, text, transitions, and music timing.

The intended value is a repeatable workflow whose inputs, transformations, and outputs can be inspected. Use the evidence below to distinguish implementation from business outcomes.

## Architecture and data flow

Upload or clip intake → frame analysis → beat detection → timeline assembly → branded FFmpeg render.

```mermaid
flowchart LR
    N0["Upload or clip intake"]
    N1["frame analysis"]
    N2["beat detection"]
    N3["timeline assembly"]
    N4["branded FFmpeg render"]
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
```

## Implementation evidence

| Source | Reading purpose |
|---|---|
| [src/services/beatDetector.js](../src/services/beatDetector.js) | Implementation component supporting the data flow described above. |
| [src/services/musicVideoCompositor.js](../src/services/musicVideoCompositor.js) | Implementation component supporting the data flow described above. |
| [src/services/claudeVision.js](../src/services/claudeVision.js) | Implementation component supporting the data flow described above. |

The links above point to the current repository. The review reference identifies the version used to prepare this brief.

## Setup and operation

Use the existing [README](../README.md) for setup and operating commands. Configuration and dependency references: [package.json](../package.json).

Start with sample or fixture inputs. Where external services are involved, configure a test account and check the distinction between a local preview, a generated artifact, and a remote write. Credentials and operational datasets are environment-specific.

## Validation and outcomes

**Review result:** Repository tree and referenced source reviewed. Existing application tests, hosted deployments, paid providers, and external mutations were not re-run in this documentation review.

No conventional test suite was identified in the reviewed repository tree; validation should begin with the next improvement below.

The source implements the workflow described above. No new revenue, accuracy, conversion, or production-uptime result is asserted by this documentation update.

Documentation itself is checked by `python3 scripts/check_project_docs.py`; that check validates this structure and its source references, not application behavior.

## Decisions and limitations

Deterministic compositing makes edits repeatable; generated descriptions and timing still need exported-media review.

Keep provider-dependent observations dated and separate from deterministic transformations. State which assumptions a demonstration uses and which integrations it actually exercises.

## Interview talking points

- **Problem and product judgment:** Explain why this workflow mattered to its intended operator: Branded listing videos need coordinated clip selection, text, transitions, and music timing.
- **Technical walkthrough:** Trace one concrete input through this sequence: Upload or clip intake → frame analysis → beat detection → timeline assembly → branded FFmpeg render.
- **Engineering tradeoff:** Deterministic compositing makes edits repeatable; generated descriptions and timing still need exported-media review.
- **Evidence and ownership:** Open the source links above, identify the specific design or implementation decisions you personally drove, and distinguish AI-assisted implementation from measured operating results.
- **What comes next:** Record a reproducible render fixture and verify audio, overlays, duration, and recovery after a failed provider call.

## Next improvements

Record a reproducible render fixture and verify audio, overlays, duration, and recovery after a failed provider call.

Record any follow-up result with a date, exact command or evaluation method, input scope, observed output, and limitations. Update `project.json` alongside this brief.

## Related projects

- [Art Print Manager](https://github.com/jjshay/ArtPrint) — Creative tooling.
- [AirDrop Photo Pipeline](https://github.com/jjshay/airdrop-processor) — Creative tooling.
- [Art Crop System](https://github.com/jjshay/art-crop-system) — Creative tooling.
- [Art Video Overlay](https://github.com/jjshay/art-video-project) — Creative tooling.
- [Handwriting Analysis Prototype](https://github.com/jjshay/handwriting-analysis) — Creative tooling.

Some related repositories require authorized GitHub access.
