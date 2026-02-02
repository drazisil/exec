/**
 * Simple Graphics Rendering Example
 *
 * Shows how we could capture D3D8 drawing commands and render them.
 * This is a proof-of-concept using software rendering (no GPU).
 */

// Vector math for 3D graphics
class Vec3 {
    constructor(public x: number, public y: number, public z: number) {}

    static from(data: number[]): Vec3 {
        return new Vec3(data[0], data[1], data[2]);
    }

    project(fov: number = 75, width: number = 800, height: number = 600): [number, number] {
        // Perspective projection: convert 3D to 2D
        const aspect = width / height;
        const scale = 1 / Math.tan((fov / 2) * (Math.PI / 180));

        const x = (this.x * scale / this.z) * (width / 2) + width / 2;
        const y = height / 2 - (this.y * scale / aspect / this.z) * (height / 2);

        return [x, y];
    }
}

/**
 * Software Framebuffer - stores pixel data
 */
class Framebuffer {
    private pixels: Uint8ClampedArray;
    private width: number;
    private height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.pixels = new Uint8ClampedArray(width * height * 4);
        this.clear([0, 0, 0, 255]); // Black background
    }

    clear(color: [number, number, number, number]) {
        for (let i = 0; i < this.pixels.length; i += 4) {
            this.pixels[i] = color[0];     // R
            this.pixels[i + 1] = color[1]; // G
            this.pixels[i + 2] = color[2]; // B
            this.pixels[i + 3] = color[3]; // A
        }
    }

    setPixel(x: number, y: number, color: [number, number, number, number]) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

        const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
        this.pixels[idx] = color[0];
        this.pixels[idx + 1] = color[1];
        this.pixels[idx + 2] = color[2];
        this.pixels[idx + 3] = color[3];
    }

    drawLine(x1: number, y1: number, x2: number, y2: number, color: [number, number, number, number]) {
        // Bresenham's line algorithm
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const sx = x1 < x2 ? 1 : -1;
        const sy = y1 < y2 ? 1 : -1;
        let err = dx - dy;

        let x = x1;
        let y = y1;

        while (true) {
            this.setPixel(x, y, color);

            if (x === x2 && y === y2) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
    }

    drawTriangle(
        p1: Vec3, p2: Vec3, p3: Vec3,
        color: [number, number, number, number],
        width: number = 800,
        height: number = 600
    ) {
        // Project 3D points to 2D
        const [x1, y1] = p1.project(75, width, height);
        const [x2, y2] = p2.project(75, width, height);
        const [x3, y3] = p3.project(75, width, height);

        // Simple rasterization using scanlines
        this.rasterizeTriangle(x1, y1, x2, y2, x3, y3, color);
    }

    private rasterizeTriangle(
        x1: number, y1: number,
        x2: number, y2: number,
        x3: number, y3: number,
        color: [number, number, number, number]
    ) {
        // Get bounding box
        const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
        const maxX = Math.min(this.width, Math.ceil(Math.max(x1, x2, x3)));
        const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
        const maxY = Math.min(this.height, Math.ceil(Math.max(y1, y2, y3)));

        // Simple point-in-triangle test using barycentric coordinates
        for (let y = minY; y < maxY; y++) {
            for (let x = minX; x < maxX; x++) {
                if (this.pointInTriangle(x, y, x1, y1, x2, y2, x3, y3)) {
                    this.setPixel(x, y, color);
                }
            }
        }
    }

    private pointInTriangle(
        px: number, py: number,
        x1: number, y1: number,
        x2: number, y2: number,
        x3: number, y3: number
    ): boolean {
        // Barycentric coordinate method
        const area = Math.abs((x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)) / 2);
        const area1 = Math.abs((px * (y2 - y3) + x2 * (y3 - py) + x3 * (py - y2)) / 2);
        const area2 = Math.abs((x1 * (py - y3) + px * (y3 - y1) + x3 * (y1 - py)) / 2);
        const area3 = Math.abs((x1 * (y2 - py) + x2 * (py - y1) + px * (y1 - y2)) / 2);

        return Math.abs(area - (area1 + area2 + area3)) < 0.01;
    }

    getPixelData(): Uint8ClampedArray {
        return this.pixels;
    }

    getWidth(): number {
        return this.width;
    }

    getHeight(): number {
        return this.height;
    }
}

/**
 * Simple Graphics Emulator
 * Captures D3D8 drawing commands and renders them
 */
export class GraphicsRenderer {
    private framebuffer: Framebuffer;
    private vertexBuffer: Vec3[] = [];
    private indexBuffer: number[] = [];
    private drawCalls: DrawCall[] = [];

    constructor(width: number = 800, height: number = 600) {
        this.framebuffer = new Framebuffer(width, height);
    }

    /**
     * Simulate: device->SetStreamSource(vertices)
     */
    setVertexBuffer(vertices: Float32Array) {
        this.vertexBuffer = [];
        for (let i = 0; i < vertices.length; i += 3) {
            this.vertexBuffer.push(new Vec3(vertices[i], vertices[i + 1], vertices[i + 2]));
        }
        console.log(`[Graphics] Set vertex buffer with ${this.vertexBuffer.length} vertices`);
    }

    /**
     * Simulate: device->SetIndices(indices)
     */
    setIndexBuffer(indices: Uint16Array) {
        this.indexBuffer = Array.from(indices);
        console.log(`[Graphics] Set index buffer with ${this.indexBuffer.length} indices`);
    }

    /**
     * Simulate: device->DrawPrimitive(D3DPT_TRIANGLELIST, 0, count)
     */
    drawPrimitive(
        primitiveType: number, // 0 = triangles, 1 = lines, etc.
        startVertex: number,
        primitiveCount: number,
        color: [number, number, number, number] = [255, 0, 0, 255]
    ) {
        console.log(
            `[Graphics] DrawPrimitive(type=${primitiveType}, start=${startVertex}, count=${primitiveCount})`
        );

        if (primitiveType === 0) {
            // D3DPT_TRIANGLELIST
            for (let i = 0; i < primitiveCount; i++) {
                const idx1 = startVertex + i * 3;
                const idx2 = startVertex + i * 3 + 1;
                const idx3 = startVertex + i * 3 + 2;

                if (idx1 < this.vertexBuffer.length &&
                    idx2 < this.vertexBuffer.length &&
                    idx3 < this.vertexBuffer.length) {
                    this.framebuffer.drawTriangle(
                        this.vertexBuffer[idx1],
                        this.vertexBuffer[idx2],
                        this.vertexBuffer[idx3],
                        color
                    );
                }
            }
        }

        this.drawCalls.push({
            type: primitiveType,
            startVertex,
            primitiveCount,
            color
        });
    }

    /**
     * Get rendered frame as pixel data
     */
    getFramePixels(): Uint8ClampedArray {
        return this.framebuffer.getPixelData();
    }

    /**
     * Clear framebuffer
     */
    clear(color: [number, number, number, number] = [0, 0, 0, 255]) {
        this.framebuffer.clear(color);
        this.drawCalls = [];
    }

    /**
     * Export frame as PPM (simple image format)
     */
    saveFrameAsPPM(filename: string) {
        const width = this.framebuffer.getWidth();
        const height = this.framebuffer.getHeight();
        const pixels = this.framebuffer.getPixelData();

        // PPM format: P6 (binary RGB)
        let ppm = `P6\n${width} ${height}\n255\n`;

        // Convert to binary RGB (skip alpha)
        const rgbData = new Uint8Array(width * height * 3);
        for (let i = 0; i < pixels.length; i += 4) {
            const idx = (i / 4) * 3;
            rgbData[idx] = pixels[i];     // R
            rgbData[idx + 1] = pixels[i + 1]; // G
            rgbData[idx + 2] = pixels[i + 2]; // B
        }

        // Combine header + binary data
        const header = Buffer.from(ppm, 'utf-8');
        const combined = Buffer.concat([header, Buffer.from(rgbData)]);

        console.log(`[Graphics] Saved frame to ${filename}`);
        return combined; // Would write to file with fs.writeFileSync
    }
}

interface DrawCall {
    type: number;
    startVertex: number;
    primitiveCount: number;
    color: [number, number, number, number];
}

// ============ Example Usage ============

if (import.meta.main) {
    const renderer = new GraphicsRenderer(800, 600);

    // Create a simple pyramid
    const vertices = new Float32Array([
        // Front face
        -1, -1, 5,   // 0
         1, -1, 5,   // 1
         0,  1, 5,   // 2

        // Back face
        -1, -1, 10,  // 3
         1, -1, 10,  // 4
         0,  1, 10,  // 5
    ]);

    renderer.setVertexBuffer(vertices);

    // Draw front triangle (red)
    renderer.drawPrimitive(0, 0, 1, [255, 0, 0, 255]);

    // Draw back triangle (green)
    renderer.drawPrimitive(0, 3, 1, [0, 255, 0, 255]);

    console.log("\nFrame rendered!");
    console.log("Framebuffer size: 800x600");
    console.log("Draw calls made:", 2);
}

export { Vec3 };
