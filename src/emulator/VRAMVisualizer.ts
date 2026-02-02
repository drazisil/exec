/**
 * VRAM Visualizer
 *
 * Monitors memory writes to detect VRAM modifications
 * and provides pixel-by-pixel framebuffer data for rendering
 */

export interface VRAMConfig {
    width: number;
    height: number;
    baseAddress: number;  // Where VRAM starts in emulated memory
}

export class VRAMVisualizer {
    private _config: VRAMConfig;
    private _framebuffer: Uint8Array;  // RGBA pixel data
    private _dirty: boolean = true;
    private _writeCount = 0;
    private _lastFrameWrites = 0;

    constructor(config: VRAMConfig) {
        this._config = config;
        // Allocate RGBA framebuffer (4 bytes per pixel)
        this._framebuffer = new Uint8Array(config.width * config.height * 4);
        // Initialize with black
        this._framebuffer.fill(0);
    }

    /**
     * Handle a memory write that might affect VRAM
     */
    onMemoryWrite(address: number, value: number, size: number): void {
        const relativeAddr = address - this._config.baseAddress;

        // Check if this write is within VRAM bounds
        const maxAddr = this._config.width * this._config.height * 4;
        if (relativeAddr < 0 || relativeAddr >= maxAddr) {
            return;
        }

        // Track writes for stats
        this._writeCount++;
        this._dirty = true;

        // For now, we'll interpret memory as raw RGBA data
        // This is a simplification - real VRAM has various formats
        const pixelOffset = Math.floor(relativeAddr / 4) * 4;
        if (pixelOffset + 3 < this._framebuffer.length) {
            switch (size) {
                case 1:
                    this._framebuffer[pixelOffset] = value & 0xFF;
                    break;
                case 2:
                    this._framebuffer[pixelOffset] = value & 0xFF;
                    this._framebuffer[pixelOffset + 1] = (value >> 8) & 0xFF;
                    break;
                case 4:
                    this._framebuffer[pixelOffset] = value & 0xFF;
                    this._framebuffer[pixelOffset + 1] = (value >> 8) & 0xFF;
                    this._framebuffer[pixelOffset + 2] = (value >> 16) & 0xFF;
                    this._framebuffer[pixelOffset + 3] = (value >> 24) & 0xFF;
                    break;
            }
        }
    }

    /**
     * Get the current framebuffer
     */
    getFramebuffer(): Uint8Array {
        return this._framebuffer;
    }

    /**
     * Check if framebuffer has changed since last frame
     */
    isDirty(): boolean {
        return this._dirty;
    }

    /**
     * Mark framebuffer as clean (synced to display)
     */
    markClean(): void {
        this._dirty = false;
        this._lastFrameWrites = this._writeCount;
    }

    /**
     * Get write stats for debugging
     */
    getStats() {
        return {
            writeCount: this._writeCount,
            writesThisFrame: this._writeCount - this._lastFrameWrites,
            isDirty: this._dirty,
        };
    }

    /**
     * Clear the framebuffer to black
     */
    clear(): void {
        this._framebuffer.fill(0);
        this._dirty = true;
    }

    /**
     * Fill with a test pattern for debugging
     */
    testPattern(): void {
        const { width, height } = this._config;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelOffset = (y * width + x) * 4;
                // Create a gradient pattern
                this._framebuffer[pixelOffset] = (x / width) * 255;      // R
                this._framebuffer[pixelOffset + 1] = (y / height) * 255; // G
                this._framebuffer[pixelOffset + 2] = 128;                // B
                this._framebuffer[pixelOffset + 3] = 255;                // A
            }
        }
        this._dirty = true;
    }
}
