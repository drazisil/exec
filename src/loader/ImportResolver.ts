import { ImportTable, ImportEntry } from "../ImportTable.ts";
import { DLLLoader, type LoadedDLL } from "./DLLLoader.ts";
import type { Memory } from "../hardware/Memory.ts";
import type { Win32Stubs } from "../kernel/Win32Stubs.ts";

export interface ImportResolverOptions {
    dllSearchPaths: string[];
}

export class ImportResolver {
    private _dllLoader: DLLLoader;
    // Map: iatRva => { dllName, functionName, realAddr }
    private _iatMap: Map<number, { dllName: string; functionName: string; realAddr: number | null }>;
    private _memory: Memory | null = null;

    constructor(options: ImportResolverOptions) {
        this._dllLoader = new DLLLoader(options.dllSearchPaths);
        this._iatMap = new Map();
    }

    /**
     * Set the memory instance for loading DLLs
     */
    setMemory(memory: Memory): void {
        this._memory = memory;
    }

    /**
     * Build the IAT map from the import table.
     * This should be called before running the emulator.
     */
    buildIATMap(importTable: ImportTable | null, imageBase: number): void {
        if (!importTable || !this._memory) return;

        for (const descriptor of importTable.descriptors) {
            const dllName = descriptor.dllName.toLowerCase();

            // Try to load the real DLL
            const loadedDll = this._dllLoader.loadDLL(descriptor.dllName, this._memory);

            for (const entry of descriptor.entries) {
                let realAddr: number | null = null;

                if (loadedDll) {
                    // Try to find the exported function in the loaded DLL
                    realAddr = loadedDll.exports.get(entry.name) || null;
                }

                // Map the IAT RVA to the real address (or null if not found)
                this._iatMap.set(entry.iatRva, {
                    dllName,
                    functionName: entry.name,
                    realAddr,
                });

                if (realAddr) {
                    console.log(
                        `[ImportResolver] ${dllName}!${entry.name} => 0x${realAddr.toString(16)}`
                    );
                } else {
                    console.log(
                        `[ImportResolver] ${dllName}!${entry.name} => NOT FOUND`
                    );
                }
            }
        }

        console.log(`[ImportResolver] Built IAT map with ${this._iatMap.size} imports`);
    }

    /**
     * Write import addresses into the IAT at the given memory address.
     * If win32Stubs is provided, stubbed functions use stub addresses instead of real DLL code.
     * This should be called after loading sections but before running.
     */
    writeIATStubs(memory: any, imageBase: number, importTable: ImportTable | null, win32Stubs?: Win32Stubs): void {
        if (!importTable) return;

        let stubCount = 0;
        let realCount = 0;
        let unresolvedCount = 0;

        for (const descriptor of importTable.descriptors) {
            for (const entry of descriptor.entries) {
                const mapEntry = this._iatMap.get(entry.iatRva);
                if (!mapEntry) continue;

                const iatAddr = imageBase + entry.iatRva;

                // Check if we have a JS stub for this function (preferred over real DLL code)
                const stubAddr = win32Stubs?.getStubAddress(mapEntry.dllName + ".dll", mapEntry.functionName)
                    ?? win32Stubs?.getStubAddress(mapEntry.dllName, mapEntry.functionName)
                    ?? null;

                if (stubAddr !== null) {
                    memory.write32(iatAddr, stubAddr);
                    stubCount++;
                } else if (mapEntry.realAddr) {
                    memory.write32(iatAddr, mapEntry.realAddr);
                    realCount++;
                } else {
                    unresolvedCount++;
                }
            }
        }

        console.log(`[ImportResolver] IAT written: ${stubCount} stubs, ${realCount} real DLL, ${unresolvedCount} unresolved`);

        // Also patch all loaded DLLs' IAT entries to use stubs where available
        // This prevents DLL→DLL calls from entering real DLL code
        if (win32Stubs) {
            this._dllLoader.patchDLLIATs(memory, win32Stubs);
            // Also patch DLL export addresses directly with trampolines.
            // This catches calls through export forwarding chains that bypass IAT.
            this._dllLoader.patchDLLExports(memory, win32Stubs);
        }
    }

    /**
     * Get all DLL search paths.
     */
    getDllSearchPaths(): string[] {
        return this._dllLoader["_searchPaths"] || [];
    }

    /**
     * Add a DLL search path.
     */
    addDllSearchPath(path: string): void {
        this._dllLoader.addSearchPath(path);
    }

    /**
     * Get the DLL loader instance
     */
    getDLLLoader(): DLLLoader {
        return this._dllLoader;
    }

    /**
     * Find which DLL owns a given address
     */
    findDLLForAddress(address: number) {
        return this._dllLoader.findDLLForAddress(address);
    }

    /**
     * Check if an address belongs to any loaded DLL
     */
    isInDLLRange(address: number): boolean {
        return this._dllLoader.isInDLLRange(address);
    }

    /**
     * Get all address mappings
     */
    getAddressMappings() {
        return this._dllLoader.getAddressMappings();
    }
}
