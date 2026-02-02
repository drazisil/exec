# Graphics Implementation Plan

## Summary

We have multiple approaches to render graphics from captured D3D8 commands:

### Quick Comparison

| Approach | GPU | Node.js | 3D | Setup Time | Performance |
|----------|-----|---------|----|----|----------|
| **Software Rasterizer** (built-in) | No | Yes | ✓ | 30 min | Slow (~5-10 FPS) |
| **Canvas + 2D** | No | Yes (with node-canvas) | 2D only | 1 hour | Medium |
| **Three.js** | Yes/No | Yes | ✓ | 2 hours | Good (20+ FPS) |
| **Babylon.js** | Yes/No | Yes | ✓ | 2 hours | Good (20+ FPS) |

---

## Recommended Path (Staged)

### Stage 1: Software Rasterizer (NOW - 1 hour)
✅ **Use**: Built-in TypeScript, no dependencies
✅ **What we get**: See the game's 3D geometry rendered as PPM images
✅ **Effort**: Already created `graphics-simple-example.ts`

**Steps**:
1. Integrate `GraphicsRenderer` into emulator
2. Hook D3D8 calls to capture vertex/index data
3. Call `drawPrimitive()` when game renders
4. Save frames as PPM files each frame

**Output**: Sequence of PPM images showing what game is trying to render

### Stage 2: Canvas Rendering (OPTIONAL - 2 hours)
📦 **Add dependency**: `npm install canvas`
🎨 **What we get**: PNG files instead of PPM, faster rendering
⏱️ **Effort**: Moderate

**Steps**:
1. Create `CanvasRenderer` extending `GraphicsRenderer`
2. Use canvas API for triangle rasterization (faster)
3. Export frames as PNG

**Output**: Better quality images, more efficient

### Stage 3: Three.js (ADVANCED - 4 hours)
📦 **Add dependencies**: `npm install three` (and `headless-gl` for GPU)
⚡ **What we get**: Full GPU rendering, 30+ FPS
🚀 **Effort**: Moderate, but worth it

**Steps**:
1. Create `ThreeJSRenderer` that converts D3D8 commands to Three.js
2. Set up scene, camera, lights
3. Create geometries from vertex buffers
4. Apply materials and textures
5. Render each frame to canvas

**Output**: Full 3D rendering at real frame rates

---

## Implementation Order

### Phase 1: Stub Everything (Now - Working)
```
Game code
    ↓
[CPU Emulator] ← we are here
    ↓
[Graphics Stubs - return fake D3D objects]
    ↓
Game continues (crashes later)
```

### Phase 2: Capture and Render (Next - 1 hour)
```
Game code
    ↓
[CPU Emulator]
    ↓
[Graphics Capture - record all calls]
    ↓
[Graphics Renderer - convert to images]
    ↓
PNG/PPM files on disk
    ↓
Game continues (crashes later)
```

### Phase 3: Full Emulation (Best)
```
Game code
    ↓
[CPU Emulator]
    ↓
[Graphics Emulation - full D3D8 + renderer]
    ↓
Real-time display (GUI window)
    ↓
Game continues to gameplay
```

---

## Immediate Next Step: Software Rasterizer

The file `graphics-simple-example.ts` shows:

1. **Vec3**: 3D vector with perspective projection
2. **Framebuffer**: Pixel storage and rasterization
3. **GraphicsRenderer**: Captures D3D commands and renders
4. **Barycentric coordinates**: Triangle fill algorithm

### To Use It:

1. **Create GraphicsCapture class**:
```typescript
class GraphicsCapture extends GraphicsRenderer {
    captureDrawCall(cmd: DrawCommand) {
        // When game calls DrawPrimitive:
        const vertices = this.getVertexBuffer();
        this.setVertexBuffer(vertices);

        // Extract color from render state
        const color = this.getRenderState(D3DRS_DIFFUSE);

        // Render
        this.drawPrimitive(0, 0, count, color);

        // Save frame
        const pixels = this.getFramePixels();
        saveAsImage(`frame_${frameNum}.ppm`, pixels);
    }
}
```

2. **Hook into D3D8 stubs**:
```typescript
const graphicsCapture = new GraphicsCapture(800, 600);

// When game calls device->DrawPrimitive():
graphicsCapture.drawPrimitive(
    primitiveType,
    startVertex,
    primitiveCount,
    extractedColor
);
```

3. **Run emulator and capture**:
```bash
node run-exe.ts
# Outputs: frame_0.ppm, frame_1.ppm, frame_2.ppm, ...
```

4. **View results**:
```bash
ffmpeg -i frame_%d.ppm -c:v libx264 output.mp4
# Or just open PPM files in image viewer
```

---

## What We'd See

If the game renders a cube:

```
Frame 0: Black screen (before game initializes)
Frame 1: Black screen (creating device)
Frame 2: Simple geometry appears (game draws cube)
Frame 3: Cube rotates (different angle)
Frame 4: More complex geometry (city environment)
...
Frame N: Crash when game does something unsupported
```

We'd be able to **see exactly what the game is trying to render** and **where it breaks**.

---

## Key Advantages

1. **Debug visibility**: See what game is drawing vs. what's crashing
2. **Incremental**: Works without GPU, Canvas, or Three.js
3. **Portable**: No external dependencies (stays TypeScript)
4. **Extensible**: Can swap renderer backend later
5. **Video**: Can create MP4 of execution

---

## Files Involved

- **graphics-simple-example.ts**: Complete software rasterizer
- **GraphicsEmulator.ts**: D3D8 COM object stubs (already created)
- **New: GraphicsCapture.ts**: Integration layer
- **New: graphics-hooks.ts**: D3D8 function interception

---

## Next Decision

**Option A**: Implement software rasterizer rendering
- Start: 1 hour
- Result: See what game renders
- Follow-up: Add canvas or Three.js later

**Option B**: Skip rendering, stay with stubs only
- Start: 10 minutes
- Result: Game runs further before crashing
- Follow-up: Add graphics later when needed

**Option C**: Jump to Three.js rendering
- Start: 3-4 hours
- Result: Full 3D rendering immediately
- Follow-up: Already have all graphics capability

My recommendation: **Option A** (software rasterizer)
- See what we're dealing with
- Build incrementally
- Can switch to Three.js later if needed
