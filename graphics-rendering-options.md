# Graphics Rendering Options for TypeScript/Node.js

## Problem
We need to:
1. Capture D3D8 drawing commands from the game
2. Convert them to a renderable format
3. Actually display graphics (not just stub them)

## Option 1: Canvas API (Browser-based)
**Where**: Browser with HTML5 Canvas
**Pros**:
- Easy to use
- Direct 2D drawing
- Built-in to browsers
- Can save frames as images

**Cons**:
- 2D only (game uses 3D)
- Would need to convert 3D → 2D
- Requires running in browser context

**How it works**:
```typescript
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 100, 100);
```

---

## Option 2: Three.js (WebGL in Browser)
**Where**: Browser or Node.js (with headless-gl)
**Complexity**: Medium
**Pros**:
- Full 3D support
- WebGL rendering
- Large community
- Can render to canvas or off-screen

**Cons**:
- Requires browser context or headless setup
- Need to convert D3D8 commands to Three.js

**How it works**:
```typescript
import * as THREE from 'three';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();

// When game does: DrawPrimitive(triangles)
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
renderer.render(scene, camera);
```

---

## Option 3: Babylon.js (WebGL in Browser)
**Where**: Browser or Node.js
**Complexity**: Medium
**Pros**:
- Excellent 3D engine
- Good D3D compatibility (was originally DirectX-inspired)
- Canvas and WebGL support
- Good documentation

**Cons**:
- Requires browser context
- Need conversion layer from D3D8

**Similar to Three.js in usage**

---

## Option 4: Canvas + pixel manipulation (Node.js compatible)
**Library**: `canvas` npm package (node-canvas)
**Where**: Node.js or Browser
**Complexity**: Medium-High
**Pros**:
- Works in Node.js (no browser needed)
- Direct pixel manipulation
- Can render to PNG/JPG files
- Can do basic 3D ourselves

**Cons**:
- Requires native bindings (cairo)
- 2D only, but we can implement 3D ourselves
- Slower than GPU

**How it works**:
```typescript
import { createCanvas } from 'canvas';

const canvas = createCanvas(800, 600);
const ctx = canvas.getContext('2d');

// Draw triangle
ctx.fillStyle = 'red';
ctx.beginPath();
ctx.moveTo(100, 100);
ctx.lineTo(200, 100);
ctx.lineTo(150, 200);
ctx.fill();

// Save to file
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('output.png', buffer);
```

---

## Option 5: Regl (WebGL wrapper, Node.js compatible)
**Library**: `regl` npm package
**Where**: Node.js or Browser (via headless-gl)
**Complexity**: High (lower level)
**Pros**:
- Functional WebGL API
- Very fast
- Works with Node.js + headless-gl
- Direct shader control

**Cons**:
- Lower level, more setup needed
- Shader programming required
- Steeper learning curve

**How it works**:
```typescript
import createREGL from 'regl';
const regl = createREGL();

const draw = regl({
  vert: `
    precision mediump float;
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0, 1);
    }
  `,
  frag: `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1, 0, 0, 1);
    }
  `,
  attributes: {
    position: [[0, 1], [-1, -1], [1, -1]]
  },
  count: 3
});

draw();
```

---

## Option 6: Actual GPU via WGPU (Rust bindings - overkill)
**Where**: Node.js (via native bindings to Rust)
**Complexity**: Very High
**Pros**: Maximum performance, modern GPU API

**Cons**: Too complex, requires Rust knowledge, slow compilation

---

## Option 7: OpenGL via headless rendering (Node.js)
**Libraries**:
- `headless-gl` - OpenGL in Node.js
- `angle` - WebGL via ANGLE

**Where**: Node.js
**Complexity**: Medium-High
**Pros**:
- True GPU rendering without browser
- Good performance
- Can save frames

**Cons**:
- Requires native bindings
- Not always available on all systems

---

## My Recommendation: **Option 4 (node-canvas) + Software 3D**

### Why?
1. **Works in Node.js** without browser complexity
2. **Incremental**: Start with 2D, add 3D math later
3. **Outputs images**: Can save each frame
4. **Pure TypeScript**: Can implement 3D rasterizer ourselves
5. **No GPU required**: Works on any system

### The Approach

```typescript
import { createCanvas } from 'canvas';

class GraphicsRenderer {
    private canvas: Canvas;
    private ctx: CanvasRenderingContext2D;

    constructor(width: number, height: number) {
        this.canvas = createCanvas(width, height);
        this.ctx = this.canvas.getContext('2d');
    }

    drawTriangle(p1: Vec3, p2: Vec3, p3: Vec3, color: string) {
        // Convert 3D points to 2D (simple perspective projection)
        const [x1, y1] = this.project3Dto2D(p1);
        const [x2, y2] = this.project3Dto2D(p2);
        const [x3, y3] = this.project3Dto2D(p3);

        // Draw on canvas
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.lineTo(x3, y3);
        this.ctx.fill();
    }

    private project3Dto2D(p: Vec3): [number, number] {
        // Simple perspective projection
        const scale = 500 / p.z; // Adjust based on z depth
        return [
            this.canvas.width / 2 + p.x * scale,
            this.canvas.height / 2 - p.y * scale
        ];
    }

    saveFrame(filename: string) {
        const buffer = this.canvas.toBuffer('image/png');
        fs.writeFileSync(filename, buffer);
    }

    clear(color: string) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
```

---

## Option 8: Three.js in Node.js (Best Balance)
**Library**: `three` npm package + `canvas` or `jsdom`
**Where**: Node.js
**Complexity**: Medium
**Pros**:
- Full 3D support
- Canvas renderer (CPU) + WebGL (GPU via headless-gl)
- Mature library
- Good documentation

**Cons**:
- Requires setup
- Canvas renderer is slower

**Installation**:
```bash
npm install three canvas
```

**How it works**:
```typescript
import * as THREE from 'three';
import { createCanvas } from 'canvas';

const canvas = createCanvas(800, 600);
const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 1000);

// When game draws:
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

renderer.render(scene, camera);

// Save frame
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('frame.png', buffer);
```

---

## Comparison Table

| Option | GPU | Node.js | 3D | Effort | Best For |
|--------|-----|---------|----|----|----------|
| Canvas | No | Yes | 2D only | Low | Simple 2D debug |
| Three.js | Yes/No | Yes | ✓ | Medium | Full 3D rendering |
| Babylon.js | Yes/No | Yes | ✓ | Medium | Full 3D rendering |
| node-canvas | No | Yes | Can implement | Medium-High | 3D software rasterizer |
| Regl | Yes | Yes (headless-gl) | ✓ | High | Performance-critical |
| headless-gl + WebGL | Yes | Yes | ✓ | Medium-High | GPU rendering without browser |

---

## My Final Recommendation

### Start with: **Three.js + node-canvas**

**Why:**
1. Install: `npm install three canvas`
2. Get immediate 3D rendering
3. Can save frames as PNG
4. Works in Node.js
5. Can scale to GPU rendering later
6. Huge community for D3D → Three.js conversion

### Then upgrade to: **Three.js + headless-gl**
If we need GPU performance:
1. Install: `npm install three headless-gl`
2. Same Three.js code
3. GPU rendering instead of CPU
4. Much faster frame rates

### Quick Start Example:

```typescript
import * as THREE from 'three';
import { createCanvas } from 'canvas';
import * as fs from 'fs';

function renderScene() {
    const canvas = createCanvas(800, 600);
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 1000);
    camera.position.z = 5;

    // Create a red triangle
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -1,  1,  0,
         1,  1,  0,
         0, -1,  0,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Render
    renderer.render(scene, camera);

    // Save
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('output.png', buffer);
}

renderScene();
```

This would give us working 3D graphics we can build the D3D8 emulation on top of!
