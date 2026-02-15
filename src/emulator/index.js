"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VRAMVisualizer = exports.registerAllOpcodes = exports.ImportResolver = exports.DLLLoader = exports.patchCRTInternals = exports.registerCRTStartupStubs = exports.Win32Stubs = exports.KernelStructures = exports.setupExceptionDiagnostics = exports.FLAG = exports.REG_NAMES = exports.REG = exports.CPU = exports.Memory = void 0;
// Hardware (x86-32 hardware simulation)
var Memory_ts_1 = require("../hardware/Memory.ts");
Object.defineProperty(exports, "Memory", { enumerable: true, get: function () { return Memory_ts_1.Memory; } });
var CPU_ts_1 = require("../hardware/CPU.ts");
Object.defineProperty(exports, "CPU", { enumerable: true, get: function () { return CPU_ts_1.CPU; } });
Object.defineProperty(exports, "REG", { enumerable: true, get: function () { return CPU_ts_1.REG; } });
Object.defineProperty(exports, "REG_NAMES", { enumerable: true, get: function () { return CPU_ts_1.REG_NAMES; } });
Object.defineProperty(exports, "FLAG", { enumerable: true, get: function () { return CPU_ts_1.FLAG; } });
// Kernel (OS integration and diagnostics)
var ExceptionDiagnostics_ts_1 = require("../kernel/ExceptionDiagnostics.ts");
Object.defineProperty(exports, "setupExceptionDiagnostics", { enumerable: true, get: function () { return ExceptionDiagnostics_ts_1.setupExceptionDiagnostics; } });
var KernelStructures_ts_1 = require("../kernel/KernelStructures.ts");
Object.defineProperty(exports, "KernelStructures", { enumerable: true, get: function () { return KernelStructures_ts_1.KernelStructures; } });
var Win32Stubs_ts_1 = require("../kernel/Win32Stubs.ts");
Object.defineProperty(exports, "Win32Stubs", { enumerable: true, get: function () { return Win32Stubs_ts_1.Win32Stubs; } });
Object.defineProperty(exports, "registerCRTStartupStubs", { enumerable: true, get: function () { return Win32Stubs_ts_1.registerCRTStartupStubs; } });
Object.defineProperty(exports, "patchCRTInternals", { enumerable: true, get: function () { return Win32Stubs_ts_1.patchCRTInternals; } });
// Loader (PE and DLL loading)
var DLLLoader_ts_1 = require("../loader/DLLLoader.ts");
Object.defineProperty(exports, "DLLLoader", { enumerable: true, get: function () { return DLLLoader_ts_1.DLLLoader; } });
var ImportResolver_ts_1 = require("../loader/ImportResolver.ts");
Object.defineProperty(exports, "ImportResolver", { enumerable: true, get: function () { return ImportResolver_ts_1.ImportResolver; } });
// Emulator (instruction implementations and graphics)
var opcodes_ts_1 = require("./opcodes.ts");
Object.defineProperty(exports, "registerAllOpcodes", { enumerable: true, get: function () { return opcodes_ts_1.registerAllOpcodes; } });
var VRAMVisualizer_ts_1 = require("./VRAMVisualizer.ts");
Object.defineProperty(exports, "VRAMVisualizer", { enumerable: true, get: function () { return VRAMVisualizer_ts_1.VRAMVisualizer; } });
