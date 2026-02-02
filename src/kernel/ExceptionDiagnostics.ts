import type { CPU } from "../hardware/CPU.js";
import type { ImportResolver } from "../loader/ImportResolver.js";
import { REG, REG_NAMES } from "../hardware/CPU.js";

export function setupExceptionDiagnostics(cpu: CPU, importResolver: ImportResolver | null): void {
    cpu.onException((error: Error, cpu: CPU) => {
        console.log(`\n[EXCEPTION] ${error.message}`);

        // Extract address from error message if present
        const addressMatch = error.message.match(/0x([0-9a-f]+)/i);
        if (addressMatch) {
            const addr = parseInt(addressMatch[1], 16);
            console.log(`\n--- Memory Access Diagnostics ---`);
            console.log(`Attempted address: 0x${addr.toString(16).padStart(8, "0")}`);

            // Check memory bounds
            const bounds = cpu.memory.getBounds();
            console.log(`Valid memory range: 0x${bounds.start.toString(16).padStart(8, "0")}-0x${bounds.end.toString(16).padStart(8, "0")} (${(bounds.size / (1024*1024)).toFixed(0)}MB)`);

            // If address looks like a segment-relative offset (very high), try to identify it
            if (addr > 0x40000000) {
                console.log(`\n⚠️  Address is outside normal DLL range - likely segment-relative (e.g., FS:[offset])`);

                // Common Windows segment bases
                const fsBase = 0x7ffdd000; // Typical FS base in x86 Windows (TEB)
                const gsBase = 0x7ffdac00; // Typical GS base
                const potentialOffset = addr - fsBase;

                console.log(`  If FS base is 0x${fsBase.toString(16)}: offset would be 0x${potentialOffset.toString(16)}`);
                console.log(`  Common TEB/PEB fields:`);
                console.log(`    TEB.ExceptionList: FS:[0x00] (offset 0x00)`);
                console.log(`    TEB.StackBase: FS:[0x04] (offset 0x04)`);
                console.log(`    TEB.StackLimit: FS:[0x08] (offset 0x08)`);
                console.log(`    TEB.SubSystemTib: FS:[0x0C] (offset 0x0C)`);
            }

            // Check if address is in a loaded DLL
            if (importResolver) {
                const dll = importResolver.findDLLForAddress(addr);
                if (dll) {
                    console.log(`\n✓ Address is in ${dll.name}`);
                    console.log(`  Range: 0x${dll.baseAddress.toString(16).padStart(8, "0")}-0x${(dll.baseAddress + dll.size - 1).toString(16).padStart(8, "0")}`);
                    console.log(`  Offset in DLL: 0x${(addr - dll.baseAddress).toString(16).padStart(8, "0")}`);
                } else {
                    console.log(`\n✗ Address is NOT in any loaded DLL`);

                    // Check if this looks like an unresolved import (small value that wasn't relocated)
                    if (addr < 0x00100000) {
                        console.log(`\n⚠️  Address looks like an UNRESOLVED IMPORT:`);
                        console.log(`  This is typically a value that should have been filled in from an IAT`);
                        console.log(`  but was left as an unrelocated offset or NULL pointer`);
                        console.log(`\n  Likely causes:`);
                        console.log(`  1. Missing DLL - an imported DLL couldn't be found`);
                        console.log(`  2. Missing function - a function export wasn't found in a loaded DLL`);
                        console.log(`  3. Circular import - trying to resolve imports before dependencies are loaded`);
                    }

                    console.log(`\nLoaded DLL ranges:`);
                    for (const mapping of importResolver.getAddressMappings()) {
                        console.log(`  0x${mapping.baseAddress.toString(16).padStart(8, "0")}-0x${mapping.endAddress.toString(16).padStart(8, "0")} ${mapping.dllName}`);
                    }
                }
            }
        }

        console.log(`\n--- CPU State ---`);
        console.log(`EIP: 0x${(cpu.eip >>> 0).toString(16).padStart(8, "0")}`);

        // Show which module we're in
        if (importResolver) {
            const currentDLL = importResolver.findDLLForAddress(cpu.eip);
            if (currentDLL) {
                console.log(`Location: ${currentDLL.name}`);
            } else {
                console.log(`Location: Main executable`);
                // If in main executable and address is small, likely unresolved import
                if (cpu.eip < 0x00100000) {
                    console.log(`\n⚠️  LIKELY UNRESOLVED IMPORT:`);
                    console.log(`  EIP is pointing to a small address (< 1MB) in the main executable.`);
                    console.log(`  This typically means an indirect jump/call through an IAT entry`);
                    console.log(`  that was never filled with the actual function address.`);
                }
            }
        }

        console.log(`\nGeneral Purpose Registers:`);
        for (let i = 0; i < 8; i++) {
            const val = cpu.regs[i];
            const isValid = cpu.memory.isValidAddress(val);
            const status = isValid ? "✓" : "✗";
            console.log(`  ${status} ${REG_NAMES[i]}: 0x${(val >>> 0).toString(16).padStart(8, "0")}`);
        }

        console.log(`\nStack Pointers:`);
        console.log(`  ESP: 0x${(cpu.regs[4] >>> 0).toString(16).padStart(8, "0")}`);
        console.log(`  EBP: 0x${(cpu.regs[5] >>> 0).toString(16).padStart(8, "0")}`);

        // Check stack integrity
        const esp = cpu.regs[REG.ESP];
        const stackValid = cpu.memory.isValidAddress(esp);
        console.log(`  Stack pointer ${stackValid ? "✓ valid" : "✗ invalid"}`);

        console.log(`\nExecution stopped.`);
        process.exit(1);
    });
}
