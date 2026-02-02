import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXEFile } from "../exefile.ts";
import type { Memory } from "../hardware/Memory.ts";

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
    private _dllSize: number = 0x01000000; // Each DLL gets 16MB of address space
    private _maxAddress: number = 0x40000000; // Max addressable (1GB)

    constructor(searchPaths: string[] = []) {
        this._searchPaths = searchPaths;
    }

    /**
     * Check if an address range is already allocated
     */
    private isAddressRangeAvailable(baseAddress: number, size: number): boolean {
        const endAddress = baseAddress + size - 1;
        for (const mapping of this._addressMappings) {
            // Check if this range overlaps with any existing mapping
            if (!(endAddress < mapping.baseAddress || baseAddress > mapping.endAddress)) {
                return false; // Overlap detected
            }
        }
        return true;
    }

    /**
     * Find next available address slot for a DLL
     */
    private findAvailableBase(preferredBase: number): number {
        // Try preferred base first
        if (preferredBase > 0 && preferredBase < this._maxAddress) {
            if (this.isAddressRangeAvailable(preferredBase, this._dllSize)) {
                return preferredBase;
            }
        }

        // Fallback: scan from 0x10000000 upward for first available slot
        for (let base = 0x10000000; base < this._maxAddress; base += this._dllSize) {
            if (this.isAddressRangeAvailable(base, this._dllSize)) {
                return base;
            }
        }

        throw new Error(`No available address space for DLL (needed 0x${this._dllSize.toString(16)} bytes)`);
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

        // Try case-insensitive search in each directory
        const lowerName = dllName.toLowerCase();
        for (const dirPath of this._searchPaths) {
            try {
                const files = readdirSync(dirPath);
                const match = files.find((f: string) => f.toLowerCase() === lowerName);
                if (match) {
                    return join(dirPath, match);
                }
            } catch (e) {
                // Directory doesn't exist or can't be read
            }
        }

        return null;
    }

    /**
     * Get forwarding candidates for an api-ms-win-* DLL
     * These DLLs re-export from other system DLLs
     */
    private getForwardingCandidates(dllName: string): string[] {
        const forwardingMap: { [key: string]: string[] } = {
            'api-ms-win-core-rtlsupport': ['ntdll', 'kernel32'],
            'api-ms-win-core-processthreads': ['kernel32', 'ntdll'],
            'api-ms-win-core-synch': ['kernel32', 'ntdll'],
            'api-ms-win-core-file': ['kernel32', 'ntdll'],
            'api-ms-win-core-memory': ['kernel32', 'ntdll'],
            'api-ms-win-core-heap': ['kernel32', 'ntdll'],
            'api-ms-win-core-registry': ['advapi32', 'kernel32'],
            'api-ms-win-core-io': ['kernel32', 'ntdll'],
            'api-ms-win-core-handle': ['kernel32', 'ntdll'],
            'api-ms-win-core-errorhandling': ['kernel32', 'ntdll'],
            'api-ms-win-core-string': ['kernel32', 'ntdll'],
            'api-ms-win-core-localization': ['kernel32', 'ntdll'],
            'api-ms-win-core-sysinfo': ['kernel32', 'ntdll'],
            'api-ms-win-core-datetime': ['kernel32', 'ntdll'],
            'api-ms-win-core-libraryloader': ['kernel32', 'ntdll'],
            'api-ms-win-core-console': ['kernel32'],
            'api-ms-win-security-': ['advapi32', 'ntdll'],
            'api-ms-win-crt-': ['msvcrt'],
            'api-ms-win-shell-': ['shell32', 'kernel32'],
            'api-ms-win-mm-': ['winmm', 'kernel32'],
            'api-ms-win-gdi-': ['gdi32', 'kernel32'],
        };

        // Find the longest matching prefix
        for (const [prefix, candidates] of Object.entries(forwardingMap)) {
            if (dllName.toLowerCase().startsWith(prefix)) {
                return candidates;
            }
        }

        // Default fallback: try core DLLs
        return ['kernel32', 'ntdll'];
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
            if (dllName.startsWith('api-ms-win-')) {
                console.log(`[DLLLoader] ${dllName} not found (API forwarding DLL - imports will be resolved at runtime)`);
            } else {
                console.log(`[DLLLoader] Could not find ${dllName}`);
            }
            return null;
        }

        try {
            console.log(`[DLLLoader] Loading ${dllName} from ${dllPath}`);
            const exe = new EXEFile(dllPath);

            // Windows-style DLL loading: try preferred base, fall back if conflict
            const preferredBase = exe.optionalHeader.imageBase;
            const baseAddress = this.findAvailableBase(preferredBase);

            if (baseAddress === preferredBase) {
                console.log(`  Loaded at preferred base 0x${baseAddress.toString(16)}`);
            } else {
                console.log(`  Preferred base 0x${preferredBase.toString(16)} unavailable, using 0x${baseAddress.toString(16)}`);
            }

            // Load all sections into memory
            for (const section of exe.sectionHeaders) {
                const vaddr = baseAddress + section.virtualAddress;
                memory.load(vaddr, section.data);
            }

            // Apply base relocations
            // The relocation delta is the difference between where we loaded it and where it was compiled for
            const relocationDelta = (baseAddress - preferredBase) >>> 0;

            if (relocationDelta !== 0 && exe.baseRelocationTable) {
                console.log(`  [Relocations] Applying delta 0x${relocationDelta.toString(16)} (loaded at 0x${baseAddress.toString(16)}, preferred 0x${preferredBase.toString(16)})`);
                for (const block of exe.baseRelocationTable.blocks) {
                    for (const entry of block.entries) {
                        const relocAddr = baseAddress + block.pageRva + entry.offset;

                        if (entry.type === 3) { // HIGHLOW (32-bit absolute)
                            const currentValue = memory.read32(relocAddr);
                            const newValue = (currentValue + relocationDelta) >>> 0;
                            memory.write32(relocAddr, newValue);
                        }
                        // Type 0 (ABS) means no relocation needed
                        // Other types are less common in 32-bit x86
                    }
                }
            }

            // Extract exports (both named and ordinal)
            const exports = new Map<string, number>();
            if (exe.exportTable) {
                for (const exp of exe.exportTable.entries) {
                    const funcAddr = baseAddress + exp.rva;

                    // Store by name if available
                    if (exp.name) {
                        exports.set(exp.name, funcAddr);
                    }

                    // Also store by ordinal (format: "Ordinal #N")
                    const ordinalKey = `Ordinal #${exp.ordinal}`;
                    exports.set(ordinalKey, funcAddr);

                    const exportLabel = exp.name ? exp.name : ordinalKey;
                    console.log(`  [Export] ${exportLabel} @ 0x${funcAddr.toString(16)}`);
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

            // CRITICAL: Resolve the DLL's own imports by filling in its IAT
            if (exe.importTable) {
                console.log(`  [IAT Resolution] Resolving ${exe.importTable.descriptors.length} import descriptors for ${dllName} (base: 0x${baseAddress.toString(16)})`);
                for (const descriptor of exe.importTable.descriptors) {
                    // Recursively load the imported DLL
                    const importedDLL = this.loadDLL(descriptor.dllName, memory);

                    for (const entry of descriptor.entries) {
                        let importAddr: number | null = null;

                        if (importedDLL) {
                            importAddr = importedDLL.exports.get(entry.name) || null;
                        }

                        // If not found in the imported DLL, try API forwarding for api-ms-win-* DLLs
                        // These are thin forwarding wrappers - real code is in KERNELBASE/ntdll/kernel32
                        if (!importAddr && descriptor.dllName.startsWith('api-ms-win-')) {
                            // First try the known forwarding candidates map
                            const forwardingCandidates = this.getForwardingCandidates(descriptor.dllName);
                            for (const candidate of forwardingCandidates) {
                                const candidateDLL = this._loadedDLLs.get(candidate.toLowerCase());
                                if (candidateDLL && candidateDLL.exports.size > 0) {
                                    const addr = candidateDLL.exports.get(entry.name);
                                    if (addr) {
                                        importAddr = addr;
                                        break;
                                    }
                                }
                            }

                            // If still not found, brute-force search ALL loaded DLLs
                            // api-ms-win-* DLLs are just forwarders - the function exists somewhere
                            if (!importAddr) {
                                for (const [loadedName, loadedDLL] of this._loadedDLLs) {
                                    // Skip the current DLL being loaded and other api-ms-win-* DLLs
                                    if (loadedName.startsWith('api-ms-win-') || loadedName === key) continue;
                                    const addr = loadedDLL.exports.get(entry.name);
                                    if (addr) {
                                        importAddr = addr;
                                        break;
                                    }
                                }
                            }
                        }

                        if (importAddr) {
                            // Write the imported function address into the IAT
                            const iatAddr = baseAddress + entry.iatRva;
                            memory.write32(iatAddr, importAddr);
                        } else {
                            console.log(`    [IAT] 0x${(baseAddress + entry.iatRva).toString(16)} => ${descriptor.dllName}!${entry.name} UNRESOLVED`);
                        }
                    }
                }
            }

            return dll;
        } catch (err: any) {
            console.log(`[DLLLoader] Failed to load ${dllName}: ${err.message}`);
            if (err.stack) {
                const lines = err.stack.split('\n').slice(0, 3);
                lines.forEach((line: string) => console.log(`  ${line}`));
            }
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
