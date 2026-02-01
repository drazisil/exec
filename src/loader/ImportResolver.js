import { DLLLoader } from "./DLLLoader.ts";
export class ImportResolver {
    constructor(options) {
        this._memory = null;
        this._dllLoader = new DLLLoader(options.dllSearchPaths);
        this._iatMap = new Map();
    }
    /**
     * Set the memory instance for loading DLLs
     */
    setMemory(memory) {
        this._memory = memory;
    }
    /**
     * Build the IAT map from the import table.
     * This should be called before running the emulator.
     */
    buildIATMap(importTable, imageBase) {
        if (!importTable || !this._memory)
            return;
        for (const descriptor of importTable.descriptors) {
            const dllName = descriptor.dllName.toLowerCase();
            // Try to load the real DLL
            const loadedDll = this._dllLoader.loadDLL(descriptor.dllName, this._memory);
            for (const entry of descriptor.entries) {
                let realAddr = null;
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
                    console.log(`[ImportResolver] ${dllName}!${entry.name} => 0x${realAddr.toString(16)}`);
                }
                else {
                    console.log(`[ImportResolver] ${dllName}!${entry.name} => NOT FOUND`);
                }
            }
        }
        console.log(`[ImportResolver] Built IAT map with ${this._iatMap.size} imports`);
    }
    /**
     * Write real import addresses into the IAT at the given memory address.
     * This should be called after loading sections but before running.
     */
    writeIATStubs(memory, imageBase, importTable) {
        if (!importTable)
            return;
        for (const descriptor of importTable.descriptors) {
            for (const entry of descriptor.entries) {
                const mapEntry = this._iatMap.get(entry.iatRva);
                if (mapEntry && mapEntry.realAddr) {
                    const iatAddr = imageBase + entry.iatRva;
                    memory.write32(iatAddr, mapEntry.realAddr);
                    console.log(`[ImportResolver] IAT @ 0x${iatAddr.toString(16)} => 0x${mapEntry.realAddr.toString(16)}`);
                }
                else if (mapEntry) {
                    console.log(`[ImportResolver] IAT @ 0x${(imageBase + entry.iatRva).toString(16)} => UNRESOLVED (${mapEntry.dllName}!${mapEntry.functionName})`);
                }
            }
        }
    }
    /**
     * Get all DLL search paths.
     */
    getDllSearchPaths() {
        return this._dllLoader["_searchPaths"] || [];
    }
    /**
     * Add a DLL search path.
     */
    addDllSearchPath(path) {
        this._dllLoader.addSearchPath(path);
    }
    /**
     * Get the DLL loader instance
     */
    getDLLLoader() {
        return this._dllLoader;
    }
    /**
     * Find which DLL owns a given address
     */
    findDLLForAddress(address) {
        return this._dllLoader.findDLLForAddress(address);
    }
    /**
     * Check if an address belongs to any loaded DLL
     */
    isInDLLRange(address) {
        return this._dllLoader.isInDLLRange(address);
    }
    /**
     * Get all address mappings
     */
    getAddressMappings() {
        return this._dllLoader.getAddressMappings();
    }
}
