"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphicsEmulator = void 0;
var GraphicsEmulator = /** @class */ (function () {
    function GraphicsEmulator(memory) {
        this._nextObjectId = 1;
        this._devices = new Map();
        this._textures = new Map();
        this._vertexBuffers = new Map();
        this._allocatedSize = 0;
        this._memory = memory;
    }
    /**
     * Create an IDirect3D8 interface
     * This is what Direct3DCreate8() returns
     */
    GraphicsEmulator.prototype.createDirect3D8Interface = function () {
        // Allocate memory for vtable and object
        var vtableAddr = this.allocateMemory(16 * 4); // 16 methods * 4 bytes each
        var objectAddr = this.allocateMemory(16); // IDirect3D8 object data
        console.log("[GraphicsEmulator] Created IDirect3D8 interface at 0x".concat(objectAddr.toString(16)));
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
    };
    /**
     * Create an IDirect3DDevice8 interface
     * This is what CreateDevice() returns
     */
    GraphicsEmulator.prototype.createDevice = function (adapter, deviceType, focusWindow, behaviorFlags) {
        var deviceId = this._nextObjectId++;
        var device = new D3DDevice(deviceId, this._memory);
        this._devices.set(deviceId, device);
        console.log("[GraphicsEmulator] Created IDirect3DDevice8 #".concat(deviceId));
        return device.getInterfacePtr();
    };
    /**
     * Create a texture
     */
    GraphicsEmulator.prototype.createTexture = function (device, width, height, levels, usage, format) {
        var textureId = this._nextObjectId++;
        var texture = new D3DTexture(textureId, width, height, levels, this._memory);
        this._textures.set(textureId, texture);
        console.log("[GraphicsEmulator] Created texture #".concat(textureId, " (").concat(width, "x").concat(height, ")"));
        return texture.getInterfacePtr();
    };
    /**
     * Create a vertex buffer
     */
    GraphicsEmulator.prototype.createVertexBuffer = function (device, size, usage, format) {
        var bufferId = this._nextObjectId++;
        var buffer = new D3DVertexBuffer(bufferId, size, this._memory);
        this._vertexBuffers.set(bufferId, buffer);
        console.log("[GraphicsEmulator] Created vertex buffer #".concat(bufferId, " (").concat(size, " bytes)"));
        return buffer.getInterfacePtr();
    };
    GraphicsEmulator.prototype.allocateMemory = function (size) {
        // Allocate from the graphics memory region (0x8b000000+)
        // For now, use a simple incrementing allocator
        var addr = 0x8b000000 + this._allocatedSize;
        this._allocatedSize += size;
        return addr >>> 0;
    };
    GraphicsEmulator.prototype.writeVtable = function (addr, methods) {
        for (var i = 0; i < methods.length; i++) {
            this._memory.write32(addr + i * 4, methods[i]);
        }
    };
    GraphicsEmulator.prototype.getAdapterCountAddr = function () {
        // Return 1 adapter
        return 1; // Stub implementation
    };
    GraphicsEmulator.prototype.getDeviceCapsAddr = function () {
        // Return device capabilities
        return 0; // Stub implementation
    };
    GraphicsEmulator.prototype.createDeviceAddr = function () {
        // Stub implementation
        return 0;
    };
    return GraphicsEmulator;
}());
exports.GraphicsEmulator = GraphicsEmulator;
/**
 * Fake IDirect3DDevice8 implementation
 */
var D3DDevice = /** @class */ (function () {
    function D3DDevice(id, memory) {
        this._renderStates = new Map();
        this._textures = new Map();
        this._vertexBuffer = null;
        this._indexBuffer = null;
        this._id = id;
        this._memory = memory;
        this._interfacePtr = this.allocateInterface();
    }
    D3DDevice.prototype.allocateInterface = function () {
        // Allocate and initialize device object
        var addr = 0x8b100000 + this._id * 0x1000; // Allocate per-device space
        return addr >>> 0;
    };
    D3DDevice.prototype.getInterfacePtr = function () {
        return this._interfacePtr;
    };
    /**
     * Set render state (e.g., lighting, culling mode, etc.)
     */
    D3DDevice.prototype.setRenderState = function (state, value) {
        console.log("[Device #".concat(this._id, "] SetRenderState(").concat(state, ", ").concat(value, ")"));
        this._renderStates.set(state, value);
        return 0; // D3D_OK
    };
    /**
     * Draw primitive (renders geometry)
     */
    D3DDevice.prototype.drawPrimitive = function (type, startVertex, primitiveCount) {
        console.log("[Device #".concat(this._id, "] DrawPrimitive(type=").concat(type, ", start=").concat(startVertex, ", count=").concat(primitiveCount, ")"));
        return 0; // D3D_OK
    };
    /**
     * Present the frame
     */
    D3DDevice.prototype.present = function (srcRect, destRect, destWindow, palette) {
        console.log("[Device #".concat(this._id, "] Present()"));
        return 0; // D3D_OK
    };
    return D3DDevice;
}());
/**
 * Fake IDirect3DTexture8 implementation
 */
var D3DTexture = /** @class */ (function () {
    function D3DTexture(id, width, height, levels, memory) {
        this._id = id;
        this._width = width;
        this._height = height;
        this._levels = levels;
        this._memory = memory;
        this._interfacePtr = this.allocateInterface();
    }
    D3DTexture.prototype.allocateInterface = function () {
        var addr = 0x8b200000 + this._id * 0x1000;
        return addr >>> 0;
    };
    D3DTexture.prototype.getInterfacePtr = function () {
        return this._interfacePtr;
    };
    return D3DTexture;
}());
/**
 * Fake IDirect3DVertexBuffer8 implementation
 */
var D3DVertexBuffer = /** @class */ (function () {
    function D3DVertexBuffer(id, size, memory) {
        this._id = id;
        this._size = size;
        this._memory = memory;
        this._data = new Uint8Array(size);
        this._interfacePtr = this.allocateInterface();
    }
    D3DVertexBuffer.prototype.allocateInterface = function () {
        var addr = 0x8b300000 + this._id * 0x1000;
        return addr >>> 0;
    };
    D3DVertexBuffer.prototype.getInterfacePtr = function () {
        return this._interfacePtr;
    };
    D3DVertexBuffer.prototype.lock = function (offset, size, flags) {
        // Return pointer to buffer data
        console.log("[VertexBuffer #".concat(this._id, "] Lock(offset=").concat(offset, ", size=").concat(size, ")"));
        return (this._interfacePtr + 256) >>> 0; // Simple offset for data
    };
    D3DVertexBuffer.prototype.unlock = function () {
        console.log("[VertexBuffer #".concat(this._id, "] Unlock()"));
        return 0;
    };
    return D3DVertexBuffer;
}());
