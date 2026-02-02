import type { Memory } from "../hardware/Memory.ts";

/**
 * Minimal Direct3D 8.0 emulation for Motor City Online
 *
 * This provides stub implementations of Direct3D COM objects
 * so the game doesn't crash trying to access graphics memory.
 */

export interface D3DCAPS8 {
    // Device capabilities
    maxTextureWidth: number;
    maxTextureHeight: number;
    maxVolumeExtent: number;
    maxVertexBufferSize: number;
    maxVertexIndex: number;
}

export class GraphicsEmulator {
    private _memory: Memory;
    private _nextObjectId: number = 1;
    private _devices: Map<number, D3DDevice> = new Map();
    private _textures: Map<number, D3DTexture> = new Map();
    private _vertexBuffers: Map<number, D3DVertexBuffer> = new Map();
    private _allocatedSize: number = 0;

    constructor(memory: Memory) {
        this._memory = memory;
    }

    /**
     * Create an IDirect3D8 interface
     * This is what Direct3DCreate8() returns
     */
    createDirect3D8Interface(): number {
        // Allocate memory for vtable and object
        const vtableAddr = this.allocateMemory(16 * 4); // 16 methods * 4 bytes each
        const objectAddr = this.allocateMemory(16); // IDirect3D8 object data

        console.log(`[GraphicsEmulator] Created IDirect3D8 interface at 0x${objectAddr.toString(16)}`);

        // Write vtable pointer
        this._memory.write32(objectAddr, vtableAddr);

        // Write vtable entries (function pointers)
        // These would point to our stub implementations
        this.writeVtable(vtableAddr, [
            0, // QueryInterface (stub)
            0, // AddRef (stub)
            0, // Release (stub)
            0, // RegisterSoftwareDevice
            this.getAdapterCountAddr(),
            0, // GetAdapterIdentifier
            0, // GetAdapterModeCount
            0, // EnumAdapterModes
            0, // GetAdapterDisplayMode
            0, // CheckDeviceType
            0, // CheckDeviceFormat
            0, // CheckDeviceMultiSampleType
            0, // CheckDepthStencilMatch
            this.getDeviceCapsAddr(),
            0, // GetAdapterMonitor
            this.createDeviceAddr(),
        ]);

        return objectAddr;
    }

    /**
     * Create an IDirect3DDevice8 interface
     * This is what CreateDevice() returns
     */
    createDevice(adapter: number, deviceType: number, focusWindow: number, behaviorFlags: number): number {
        const deviceId = this._nextObjectId++;
        const device = new D3DDevice(deviceId, this._memory);
        this._devices.set(deviceId, device);

        console.log(`[GraphicsEmulator] Created IDirect3DDevice8 #${deviceId}`);

        return device.getInterfacePtr();
    }

    /**
     * Create a texture
     */
    createTexture(device: number, width: number, height: number, levels: number, usage: number, format: number): number {
        const textureId = this._nextObjectId++;
        const texture = new D3DTexture(textureId, width, height, levels, this._memory);
        this._textures.set(textureId, texture);

        console.log(`[GraphicsEmulator] Created texture #${textureId} (${width}x${height})`);

        return texture.getInterfacePtr();
    }

    /**
     * Create a vertex buffer
     */
    createVertexBuffer(device: number, size: number, usage: number, format: number): number {
        const bufferId = this._nextObjectId++;
        const buffer = new D3DVertexBuffer(bufferId, size, this._memory);
        this._vertexBuffers.set(bufferId, buffer);

        console.log(`[GraphicsEmulator] Created vertex buffer #${bufferId} (${size} bytes)`);

        return buffer.getInterfacePtr();
    }

    private allocateMemory(size: number): number {
        // Allocate from the graphics memory region (0x8b000000+)
        // For now, use a simple incrementing allocator
        const addr = 0x8b000000 + this._allocatedSize;
        this._allocatedSize += size;
        return addr >>> 0;
    }

    private writeVtable(addr: number, methods: number[]): void {
        for (let i = 0; i < methods.length; i++) {
            this._memory.write32(addr + i * 4, methods[i]);
        }
    }

    private getAdapterCountAddr(): number {
        // Return 1 adapter
        return 1; // Stub implementation
    }

    private getDeviceCapsAddr(): number {
        // Return device capabilities
        return 0; // Stub implementation
    }

    private createDeviceAddr(): number {
        // Stub implementation
        return 0;
    }
}

/**
 * Fake IDirect3DDevice8 implementation
 */
class D3DDevice {
    private _id: number;
    private _memory: Memory;
    private _interfacePtr: number;
    private _renderStates: Map<number, number> = new Map();
    private _textures: Map<number, D3DTexture> = new Map();
    private _vertexBuffer: D3DVertexBuffer | null = null;
    private _indexBuffer: D3DVertexBuffer | null = null;

    constructor(id: number, memory: Memory) {
        this._id = id;
        this._memory = memory;
        this._interfacePtr = this.allocateInterface();
    }

    private allocateInterface(): number {
        // Allocate and initialize device object
        const addr = 0x8b100000 + this._id * 0x1000; // Allocate per-device space
        return addr >>> 0;
    }

    getInterfacePtr(): number {
        return this._interfacePtr;
    }

    /**
     * Set render state (e.g., lighting, culling mode, etc.)
     */
    setRenderState(state: number, value: number): number {
        console.log(`[Device #${this._id}] SetRenderState(${state}, ${value})`);
        this._renderStates.set(state, value);
        return 0; // D3D_OK
    }

    /**
     * Draw primitive (renders geometry)
     */
    drawPrimitive(type: number, startVertex: number, primitiveCount: number): number {
        console.log(`[Device #${this._id}] DrawPrimitive(type=${type}, start=${startVertex}, count=${primitiveCount})`);
        return 0; // D3D_OK
    }

    /**
     * Present the frame
     */
    present(srcRect: number, destRect: number, destWindow: number, palette: number): number {
        console.log(`[Device #${this._id}] Present()`);
        return 0; // D3D_OK
    }
}

/**
 * Fake IDirect3DTexture8 implementation
 */
class D3DTexture {
    private _id: number;
    private _width: number;
    private _height: number;
    private _levels: number;
    private _memory: Memory;
    private _interfacePtr: number;

    constructor(id: number, width: number, height: number, levels: number, memory: Memory) {
        this._id = id;
        this._width = width;
        this._height = height;
        this._levels = levels;
        this._memory = memory;
        this._interfacePtr = this.allocateInterface();
    }

    private allocateInterface(): number {
        const addr = 0x8b200000 + this._id * 0x1000;
        return addr >>> 0;
    }

    getInterfacePtr(): number {
        return this._interfacePtr;
    }
}

/**
 * Fake IDirect3DVertexBuffer8 implementation
 */
class D3DVertexBuffer {
    private _id: number;
    private _size: number;
    private _memory: Memory;
    private _interfacePtr: number;
    private _data: Uint8Array;

    constructor(id: number, size: number, memory: Memory) {
        this._id = id;
        this._size = size;
        this._memory = memory;
        this._data = new Uint8Array(size);
        this._interfacePtr = this.allocateInterface();
    }

    private allocateInterface(): number {
        const addr = 0x8b300000 + this._id * 0x1000;
        return addr >>> 0;
    }

    getInterfacePtr(): number {
        return this._interfacePtr;
    }

    lock(offset: number, size: number, flags: number): number {
        // Return pointer to buffer data
        console.log(`[VertexBuffer #${this._id}] Lock(offset=${offset}, size=${size})`);
        return (this._interfacePtr + 256) >>> 0; // Simple offset for data
    }

    unlock(): number {
        console.log(`[VertexBuffer #${this._id}] Unlock()`);
        return 0;
    }
}
