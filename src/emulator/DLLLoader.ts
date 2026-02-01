import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EXEFile } from "../exefile.ts";
import type { Memory } from "./Memory.ts";

export interface LoadedDLL {
    name: string;
    baseAddress: number;
    size: number; // Total allocated size
    exports: Map<string, number>; // function name => address
}

export interface AddressMapping {
    dllName: string;
    baseAddress: number;
    endAddress: number;
}

export class DLLLoader {
    private _searchPaths: string[];
    private _loadedDLLs: Map<string, LoadedDLL> = new Map();
    private _addressMappings: AddressMapping[] = []; // Sorted list of address ranges
    private _nextDLLBase: number = 0x10000000; // Start DLLs at 0x10000000
    private _dllSize: number = 0x01000000; // Each DLL gets 16MB of address space

    constructor(searchPaths: string[] = []) {
        this._searchPaths = searchPaths;
    }

    /**
     * Add a search path for DLLs
     */
    addSearchPath(path: string): void {
        if (!this._searchPaths.includes(path)) {
            this._searchPaths.push(path);
        }
    }

    /**
     * Find a DLL file in the search paths
     */
    private findDLLFile(dllName: string): string | null {
        // Try exact name first
        for (const path of this._searchPaths) {
            const fullPath = join(path, dllName);
            if (existsSync(fullPath)) {
                return fullPath;
            }
        }

        // Try lowercase
        const lowerName = dllName.toLowerCase();
        for (const path of this._searchPaths) {
            const fullPath = join(path, lowerName);
            if (existsSync(fullPath)) {
                return fullPath;
            }
        }

        return null;
    }

    /**
     * Load a DLL into memory
     */
    loadDLL(dllName: string, memory: Memory): LoadedDLL | null {
        // Check if already loaded
        const key = dllName.toLowerCase();
        if (this._loadedDLLs.has(key)) {
            return this._loadedDLLs.get(key)!;
        }

        // Find the DLL file
        const dllPath = this.findDLLFile(dllName);
        if (!dllPath) {
            console.log(`[DLLLoader] Could not find ${dllName}`);
            return null;
        }

        try {
            console.log(`[DLLLoader] Loading ${dllName} from ${dllPath}`);
            const exe = new EXEFile(dllPath);

            // Allocate memory for the DLL
            const baseAddress = this._nextDLLBase;
            this._nextDLLBase += 0x01000000; // Each DLL gets 16MB of address space

            // Load all sections into memory
            for (const section of exe.sectionHeaders) {
                const vaddr = baseAddress + section.virtualAddress;
                memory.load(vaddr, section.data);
            }

            // Extract exports
            const exports = new Map<string, number>();
            if (exe.exportTable) {
                for (const exp of exe.exportTable.entries) {
                    const funcAddr = baseAddress + exp.rva;
                    exports.set(exp.name, funcAddr);
                    console.log(`  [Export] ${exp.name} @ 0x${funcAddr.toString(16)}`);
                }
            }

            const dll: LoadedDLL = {
                name: dllName,
                baseAddress,
                size: this._dllSize,
                exports,
            };

            this._loadedDLLs.set(key, dll);

            // Add address mapping for this DLL
            this._addressMappings.push({
                dllName,
                baseAddress,
                endAddress: baseAddress + this._dllSize - 1,
            });

            console.log(
                `[DLLLoader] Loaded ${dllName} at 0x${baseAddress.toString(16)}-0x${(baseAddress + this._dllSize - 1).toString(16)} with ${exports.size} exports`
            );

            return dll;
        } catch (err: any) {
            console.log(`[DLLLoader] Failed to load ${dllName}: ${err.message}`);
            return null;
        }
    }

    /**
     * Get the address of an exported function
     */
    getExportAddress(dllName: string, functionName: string): number | null {
        const key = dllName.toLowerCase();
        const dll = this._loadedDLLs.get(key);
        if (!dll) {
            return null;
        }

        return dll.exports.get(functionName) || null;
    }

    /**
     * Get a loaded DLL by name
     */
    getDLL(dllName: string): LoadedDLL | null {
        return this._loadedDLLs.get(dllName.toLowerCase()) || null;
    }

    /**
     * Get all loaded DLLs
     */
    getLoadedDLLs(): LoadedDLL[] {
        return Array.from(this._loadedDLLs.values());
    }

    /**
     * Find which DLL owns a given address
     */
    findDLLForAddress(address: number): LoadedDLL | null {
        for (const mapping of this._addressMappings) {
            if (address >= mapping.baseAddress && address <= mapping.endAddress) {
                return this._loadedDLLs.get(mapping.dllName.toLowerCase()) || null;
            }
        }
        return null;
    }

    /**
     * Get all address mappings (for debugging/inspection)
     */
    getAddressMappings(): AddressMapping[] {
        return [...this._addressMappings];
    }

    /**
     * Check if an address belongs to any loaded DLL
     */
    isInDLLRange(address: number): boolean {
        return this.findDLLForAddress(address) !== null;
    }
}
