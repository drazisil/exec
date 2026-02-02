# Graphics Card Emulation Strategy for Motor City Online

## Problem
The game crashes trying to access 0x8b000000 (graphics memory). We need to provide some kind of response without implementing a full DirectX driver.

## Options

### Option 1: Stub Memory Allocation (Easiest)
**Complexity**: Low | **Effort**: 1-2 hours | **Effectiveness**: ~20%

Allocate real memory at 0x8b000000 and return zeros for all reads.

**Pros:**
- Game won't crash on first graphics access
- Very simple to implement
- Minimal performance impact

**Cons:**
- Game will probably crash on next graphics operation that needs real data
- Won't render anything
- Game likely checks for specific graphics capabilities

**Implementation:**
```typescript
// In Memory.ts, allocate special region
const graphicsMemory = new Uint8Array(16 * 1024 * 1024); // 16MB
// Map reads/writes to this region when addr >= 0x8b000000
```

### Option 2: Hook Direct3D API Calls (Better)
**Complexity**: Medium | **Effort**: 4-6 hours | **Effectiveness**: ~50%

Intercept Direct3D function calls from kernel32/ntdll and return stub responses.

**What the game does:**
1. Calls `Direct3DCreate8()` to get a device
2. Calls device methods like `CreateTexture()`, `SetRenderState()`, etc.
3. Calls `DrawPrimitive()` to render
4. Reads back graphics state from memory

**How to stub it:**
1. Detect when game calls D3D functions
2. Return fake but valid device pointers
3. Track state (render states, textures, buffers) in our emulator
4. Return zero data for all reads

**Pros:**
- Intercepts graphics commands before they reach bad memory
- Can track what game is trying to render
- More robust than memory allocation alone

**Cons:**
- Requires implementing ~20-30 D3D8 API functions
- Need to understand D3D8 COM interface layout
- More complex debugging

**Implementation approach:**
```typescript
// In ImportResolver or separate GraphicsEmulator:
- Hook kernel32!LoadLibraryA to detect d3d8.dll loads
- Intercept d3d8.dll exports (Direct3DCreate8, etc.)
- Return fake COM objects
- Track calls in emulator state
```

### Option 3: Detect and Skip Graphics Code (Hacky)
**Complexity**: Low-Medium | **Effort**: 2-3 hours | **Effectiveness**: ~30%

Detect when code is trying to access graphics memory and provide fake responses.

**Approach:**
- Catch ACCESS_VIOLATION exceptions at 0x8b000000
- Inject fake return values
- Continue execution
- Hope game has a graphics-free code path

**Pros:**
- No complex D3D implementation needed
- Can handle unknown graphics operations

**Cons:**
- Very fragile
- Requires understanding game's error handling
- Will break if game does anything non-trivial with graphics

### Option 4: Minimal D3D8 Simulation (Best)
**Complexity**: High | **Effort**: 8-12 hours | **Effectiveness**: ~70%

Implement a minimal but correct D3D8 device that mimics the real interface.

**Key D3D8 Functions:**
- `Direct3DCreate8()` - Create the main interface
- `CreateDevice()` - Create a device (tracks state, formats, capabilities)
- `CreateTexture()` - Allocate texture memory
- `CreateVertexBuffer()` - Allocate vertex buffer
- `SetRenderState()` - Store render state
- `DrawPrimitive()` - Track draw calls
- `Present()` - Return success (no actual rendering)

**What we'd track:**
- Device capabilities (texture formats, max texture size, etc.)
- Currently set render states (lighting, culling, etc.)
- Allocated textures/buffers
- Current vertex/index buffers
- Render target

**Pros:**
- Game can actually run graphics initialization code
- More likely to reach gameplay code
- Can log what game is trying to render

**Cons:**
- Requires understanding D3D8 COM object layout
- Need to implement enough to be "correct"
- More debugging if something goes wrong

---

## My Recommendation

**Start with Option 2 (Hook D3D API calls)** because:

1. Minimal but effective
2. We already have DLL loading infrastructure
3. Can track what the game is doing
4. Easier to debug than generic memory allocation
5. Can be extended to Option 4 later

### Implementation Steps

1. **Identify which D3D functions are called first**
   - Trace execution until we hit graphics code
   - See which d3d8.dll exports are referenced

2. **Create a GraphicsEmulator class**
   - Tracks D3D device state
   - Implements stub device COM object
   - Returns valid but fake responses

3. **Hook the d3d8.dll exports**
   - Intercept `Direct3DCreate8()`
   - Return our fake device
   - Let other calls go through our simulator

4. **Implement minimum functions**
   - Start with just what's needed to not crash
   - Expand as we find more requirements

### What Would Direct3DCreate8 Return?

A COM object structure (pointer to vtable):

```
IDirect3D8 interface:
- vtable[0]: QueryInterface
- vtable[1]: AddRef
- vtable[2]: Release
- vtable[3]: RegisterSoftwareDevice
- vtable[4]: GetAdapterCount
- vtable[5]: GetAdapterIdentifier
- vtable[6]: GetAdapterModeCount
- vtable[7]: EnumAdapterModes
- vtable[8]: GetAdapterDisplayMode
- vtable[9]: CheckDeviceType
- vtable[10]: CheckDeviceFormat
- vtable[11]: CheckDeviceMultiSampleType
- vtable[12]: CheckDepthStencilMatch
- vtable[13]: GetDeviceCaps
- vtable[14]: GetAdapterMonitor
- vtable[15]: CreateDevice  ← Game calls this
```

Each vtable entry points to a function that:
- Takes COM object pointer as first argument
- Returns HRESULT (0 = success, negative = error)
- Fills in output structures
- Manages memory

---

## Immediate Next Steps

1. Run the game with a breakpoint at graphics code
2. See exactly which functions are called
3. Log the call sequence
4. Implement stubs in order of first use
5. Iteratively expand as we hit new unimplemented calls

This way we only implement what's actually needed.
