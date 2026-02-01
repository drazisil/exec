/**
 * Architecture:
 *
 *   ┌─────────────────────────────────┐
 *   │      EXEFile (PE Loader)        │
 *   └─────────────┬───────────────────┘
 *                 │
 *     ┌───────────┼───────────┬──────────┐
 *     │           │           │          │
 *  ┌──▼────┐ ┌───▼──────┐ ┌─▼──────┐ ┌─▼──────┐
 *  │Loader │ │Hardware  │ │ Kernel │ │Emulator│
 *  ├───────┤ ├──────────┤ ├────────┤ ├────────┤
 *  │DLLLoad│ │Memory    │ │Diagnost│ │Opcodes │
 *  │Import │ │CPU       │ │        │ │        │
 *  │Resolve│ │          │ │        │ │        │
 *  └───────┘ └──────────┘ └────────┘ └────────┘
 */

// Hardware (x86-32 hardware simulation)
export { Memory } from "../hardware/Memory.ts";
export { CPU, REG, REG_NAMES, FLAG } from "../hardware/CPU.ts";
export type { OpcodeHandler } from "../hardware/CPU.ts";

// Kernel (OS integration and diagnostics)
export { setupExceptionDiagnostics } from "../kernel/ExceptionDiagnostics.ts";

// Loader (PE and DLL loading)
export { DLLLoader, type LoadedDLL, type AddressMapping } from "../loader/DLLLoader.ts";
export { ImportResolver } from "../loader/ImportResolver.ts";

// Emulator (instruction implementations)
export { registerAllOpcodes } from "./opcodes.ts";
