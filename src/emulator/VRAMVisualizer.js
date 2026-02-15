"use strict";
/**
 * VRAM Visualizer
 *
 * Monitors memory writes to detect VRAM modifications
 * and provides pixel-by-pixel framebuffer data for rendering
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VRAMVisualizer = void 0;
var VRAMVisualizer = /** @class */ (function () {
    function VRAMVisualizer(config) {
        this._dirty = true;
        this._writeCount = 0;
        this._lastFrameWrites = 0;
        this._config = config;
        // Allocate RGBA framebuffer (4 bytes per pixel)
        this._framebuffer = new Uint8Array(config.width * config.height * 4);
        // Initialize with black
        this._framebuffer.fill(0);
    }
    /**
     * Handle a memory write that might affect VRAM
     */
    VRAMVisualizer.prototype.onMemoryWrite = function (address, value, size) {
        var relativeAddr = address - this._config.baseAddress;
        // Check if this write is within VRAM bounds
        var maxAddr = this._config.width * this._config.height * 4;
        if (relativeAddr < 0 || relativeAddr >= maxAddr) {
            return;
        }
        // Track writes for stats
        this._writeCount++;
        this._dirty = true;
        // For now, we'll interpret memory as raw RGBA data
        // This is a simplification - real VRAM has various formats
        var pixelOffset = Math.floor(relativeAddr / 4) * 4;
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
    };
    /**
     * Get the current framebuffer
     */
    VRAMVisualizer.prototype.getFramebuffer = function () {
        return this._framebuffer;
    };
    /**
     * Check if framebuffer has changed since last frame
     */
    VRAMVisualizer.prototype.isDirty = function () {
        return this._dirty;
    };
    /**
     * Mark framebuffer as clean (synced to display)
     */
    VRAMVisualizer.prototype.markClean = function () {
        this._dirty = false;
        this._lastFrameWrites = this._writeCount;
    };
    /**
     * Get write stats for debugging
     */
    VRAMVisualizer.prototype.getStats = function () {
        return {
            writeCount: this._writeCount,
            writesThisFrame: this._writeCount - this._lastFrameWrites,
            isDirty: this._dirty,
        };
    };
    /**
     * Clear the framebuffer to black
     */
    VRAMVisualizer.prototype.clear = function () {
        this._framebuffer.fill(0);
        this._dirty = true;
    };
    /**
     * Fill with a test pattern for debugging
     */
    VRAMVisualizer.prototype.testPattern = function () {
        var _a = this._config, width = _a.width, height = _a.height;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var pixelOffset = (y * width + x) * 4;
                // Create a gradient pattern
                this._framebuffer[pixelOffset] = (x / width) * 255; // R
                this._framebuffer[pixelOffset + 1] = (y / height) * 255; // G
                this._framebuffer[pixelOffset + 2] = 128; // B
                this._framebuffer[pixelOffset + 3] = 255; // A
            }
        }
        this._dirty = true;
    };
    return VRAMVisualizer;
}());
exports.VRAMVisualizer = VRAMVisualizer;
