# How to Integrate Graphics Emulation

## The Simplest Approach: Handle Memory Access Faults

Instead of pre-allocating graphics memory, we can:

1. **Allocate graphics memory region on-demand**
2. **When game accesses 0x8b000000, provide a buffer**
3. **Return zeros for all reads (most graphics operations just check status)**

### Step 1: Extend Memory.ts

```typescript
export class Memory {
    private _buffer: ArrayBuffer;
    private _view: DataView;
    private _bytes: Uint8Array;
    private _graphicsBuffer: ArrayBuffer | null = null;  // NEW
    private _graphicsView: DataView | null = null;       // NEW

    constructor(sizeBytes: number = 0x100000) {
        this._buffer = new ArrayBuffer(sizeBytes);
        // ... rest of init

        // Pre-allocate graphics memory at 0x8b000000 region
        // Map to a separate buffer
        this._graphicsBuffer = new ArrayBuffer(128 * 1024 * 1024); // 128MB for graphics
        this._graphicsView = new DataView(this._graphicsBuffer);
    }

    read32(addr: number): number {
        // Check if address is in graphics region
        if (addr >= 0x8b000000 && addr < 0x8b000000 + 128 * 1024 * 1024) {
            const offset = addr - 0x8b000000;
            if (this._graphicsView) {
                try {
                    return this._graphicsView.getUint32(offset, true);
                } catch {
                    return 0; // Return 0 for any graphics reads
                }
            }
            return 0;
        }

        // Normal memory access
        if (addr < 0 || addr >= this._buffer.byteLength) {
            throw new Error(`read32: address 0x${(addr >>> 0).toString(16)} outside bounds`);
        }
        return this._view.getUint32(addr, true);
    }

    write32(addr: number, val: number): void {
        // Check if address is in graphics region
        if (addr >= 0x8b000000 && addr < 0x8b000000 + 128 * 1024 * 1024) {
            const offset = addr - 0x8b000000;
            if (this._graphicsView) {
                try {
                    this._graphicsView.setUint32(offset, val, true);
                } catch {
                    // Ignore graphics writes
                }
            }
            return;
        }

        // Normal memory write
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error(`write32: address 0x${(addr >>> 0).toString(16)} outside bounds`);
        }
        this._view.setUint32(addr, val, true);
    }

    // Same for read8, write8, read16, write16, readSigned8, etc.
}
```

### Step 2: The Game Tries to Access 0x8b000000

Game code:
```
TEST [ECX + 0x8b000000], ESP
```

With ECX = 0:
- Address = 0x8b000000
- Our Memory class intercepts this
- Returns 0 (zeroed graphics memory)
- Game continues

### Step 3: When Game Calls Direct3D Functions

The game initializes like this:
```c
IDirect3D8 *pD3D = Direct3DCreate8(D3D_SDK_VERSION);
IDirect3DDevice8 *pDevice = pD3D->CreateDevice(...);
pDevice->SetRenderState(D3DRS_LIGHTING, TRUE);
pDevice->DrawPrimitive(D3DPT_TRIANGLELIST, 0, ...);
```

We intercept these by:
1. **Hooking the d3d8.dll exports**
2. **Returning fake but valid COM objects**
3. **Logging what game is trying to do**

### Integration Points

#### In run-exe.ts:

```typescript
import { Memory } from "./src/hardware/Memory.ts";
import { GraphicsEmulator } from "./src/emulator/GraphicsEmulator.ts";

// ... setup code ...

const mem = new Memory(2 * 1024 * 1024 * 1024);
const graphicsEmu = new GraphicsEmulator(mem);

// When we intercept Direct3DCreate8(), call:
const d3d8Interface = graphicsEmu.createDirect3D8Interface();

// Now when game calls IDirect3D8::CreateDevice, we return:
const device = graphicsEmu.createDevice(...);

// And when game calls SetRenderState:
graphicsEmu.setDeviceRenderState(device, state, value);
```

#### In ImportResolver.ts (or new GraphicsHooks.ts):

```typescript
// When writing IAT stubs for d3d8.dll, intercept these:
const d3d8Stubs = {
    'Direct3DCreate8': {
        impl: (graphicsEmu, sdk_version) => {
            return graphicsEmu.createDirect3D8Interface();
        }
    },
    'Direct3DCreate8Ex': {
        impl: (graphicsEmu, sdk_version, ppD3D) => {
            // Similar, but more modern
            return graphicsEmu.createDirect3D8Interface();
        }
    },
    // ... more stubs ...
};
```

## Result

```
Game runs → Tries to access 0x8b000000
↓
Memory class intercepts → Returns 0
↓
Game continues → Calls Direct3DCreate8()
↓
ImportResolver intercepts → Returns fake device
↓
Game continues → Calls device->CreateTexture()
↓
GraphicsEmulator intercepts → Returns fake texture
↓
Game continues → Calls device->DrawPrimitive()
↓
GraphicsEmulator logs → No crash
↓
Game continues → Maybe reaches gameplay code!
```

## Advantages of This Approach

1. **No full DirectX implementation needed**
2. **Minimal changes to existing code**
3. **Easy to debug** - log every graphics call
4. **Extensible** - can add real implementations later
5. **Catches most common graphics operations**

## What Happens Next

Game will probably:
- Try to read render states
- Try to create textures
- Try to lock vertex buffers
- Try to get device capabilities
- Try to present frames

All of these can return safe defaults and keep the game running.

## What Will Eventually Break

The game will crash when:
- It needs actual render target data
- It reads back rendered pixels (rarely happens)
- It does something unusual with graphics memory
- It tries to use graphics features we haven't stubbed

But at that point we'll know exactly what's needed and can add it.
