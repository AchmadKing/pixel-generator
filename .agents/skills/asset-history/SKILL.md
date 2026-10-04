---
name: asset-history
description: Instructions for reading, inspecting, and managing version lineages and non-destructive revision histories for pixel art assets.
---

# Asset History & Version Lineage Skill

## Purpose
Guide the AI agent in tracking and querying version progression across revisions, reading version manifests, and ensuring non-destructive versioning conventions are upheld.

## Directory Structure
Versioned assets follow an incremental directory structure:
```
assets/generated/<asset-slug>/
  ├── manifest.json       (Optional summary of all versions)
  ├── v1/
  │   ├── processed.png
  │   └── metadata.json   (version: 1)
  ├── v2/
  │   ├── processed.png
  │   └── metadata.json   (version: 2, parent_version: 1, change_summary: "...")
  └── v3/
      ├── processed.png
      └── metadata.json   (version: 3, parent_version: 2, change_summary: "...")
```

## Execution Flow
1. **Discover Available Versions**:
   - List the contents of `assets/generated/<asset-slug>/`.
   - Identify version folders matching the pattern `v[0-9]+` or UUIDs.
2. **Inspect Version Metadata**:
   - Read `metadata.json` in each version folder.
   - Extract `version`, `created_at`, `prompt`, `model`, `change_summary`, and `parent_version`.
3. **Compare Versions**:
   - Determine the active or latest version.
   - In Studio, older versions can be viewed in the Version History sidebar and compared using the Before/After split comparison view.
