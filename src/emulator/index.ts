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
export { Memory } from "../hardware/Memory.js";
export { CPU, REG, REG_NAMES, FLAG } from "../hardware/CPU.js";
export type { OpcodeHandler } from "../hardware/CPU.js";

// Kernel (OS integration and diagnostics)
export { setupExceptionDiagnostics } from "../kernel/ExceptionDiagnostics.js";
export { KernelStructures, type TEBStructure, type PEBStructure } from "../kernel/KernelStructures.js";

// Loader (PE and DLL loading)
export { DLLLoader, type LoadedDLL, type AddressMapping } from "../loader/DLLLoader.js";
export { ImportResolver } from "../loader/ImportResolver.js";

// Emulator (instruction implementations)
export { registerAllOpcodes } from "./opcodes.js";
