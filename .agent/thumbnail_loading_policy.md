# Thumbnail Loading Policy & Architecture

## Objective
To maintain maximum responsiveness and "native feel" in the file explorer, specifically in Grid View and large folders.

## The "Zero-Latency" Rule
> [!IMPORTANT]
> **No additional processes** (dimension extraction, metadata probing, external CLI launches like FFmpeg) should ever be added to the primary thumbnail loading commands (`get_thumbnail` and `get_video_thumbnail`).

## Performance Architecture

### 1. Thumbnail Loading (Grid/List View)
- **Tool**: `get_thumbnail` / `get_video_thumbnail`.
- **Logic**: Use pure native Windows Shell API (`IShellItemImageFactory`).
- **Input**: Path, Size, Modified Timestamp.
- **Output**: Base64 Image Data and Source only.
- **Strict Prohibition**: Do **NOT** open the file or probe dimensions during this phase. If the Shell API fails to provide a thumbnail, return a generic icon or fall back to a *fast* image generation, but never include metadata extraction.

### 2. Dimension Extraction (On-Demand)
- **Tool**: `get_file_dimensions`.
- **Trigger**: Only when an item is **selected** or explicitly inspected.
- **Logic**: This is where expensive operations belong. It can use Shell Properties, the `image` crate (opening headers), or FFmpeg probes.
- **Reason**: Users expect the grid to scroll at 60fps. Extracting dimensions for 100 files simultaneously during scroll breaks this experience.

## Why this must be respected
A previous regression coupled these two processes, causing the application to "pay the price" of metadata extraction for every visible file in the grid. This led to inconsistent loading and high CPU usage. The current decoupled state is the **correct architecture** for SpeedExplorer and must be preserved in all future updates.
