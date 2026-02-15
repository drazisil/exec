"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportResolver = void 0;
var DLLLoader_ts_1 = require("./DLLLoader.ts");
var ImportResolver = /** @class */ (function () {
    function ImportResolver(options) {
        this._memory = null;
        this._dllLoader = new DLLLoader_ts_1.DLLLoader(options.dllSearchPaths);
        this._iatMap = new Map();
    }
    /**
     * Set the memory instance for loading DLLs
     */
    ImportResolver.prototype.setMemory = function (memory) {
        this._memory = memory;
    };
    /**
     * Build the IAT map from the import table.
     * This should be called before running the emulator.
     */
    ImportResolver.prototype.buildIATMap = function (importTable, imageBase) {
        if (!importTable || !this._memory)
            return;
        for (var _i = 0, _a = importTable.descriptors; _i < _a.length; _i++) {
            var descriptor = _a[_i];
            var dllName = descriptor.dllName.toLowerCase();
            // Try to load the real DLL
            var loadedDll = this._dllLoader.loadDLL(descriptor.dllName, this._memory);
            for (var _b = 0, _c = descriptor.entries; _b < _c.length; _b++) {
                var entry = _c[_b];
                var realAddr = null;
                if (loadedDll) {
                    // Try to find the exported function in the loaded DLL
                    realAddr = loadedDll.exports.get(entry.name) || null;
                }
                // Map the IAT RVA to the real address (or null if not found)
                this._iatMap.set(entry.iatRva, {
                    dllName: dllName,
                    functionName: entry.name,
                    realAddr: realAddr,
                });
                if (realAddr) {
                    console.log("[ImportResolver] ".concat(dllName, "!").concat(entry.name, " => 0x").concat(realAddr.toString(16)));
                }
                else {
                    console.log("[ImportResolver] ".concat(dllName, "!").concat(entry.name, " => NOT FOUND"));
                }
            }
        }
        console.log("[ImportResolver] Built IAT map with ".concat(this._iatMap.size, " imports"));
    };
    /**
     * Write import addresses into the IAT at the given memory address.
     * If win32Stubs is provided, stubbed functions use stub addresses instead of real DLL code.
     * This should be called after loading sections but before running.
     */
    ImportResolver.prototype.writeIATStubs = function (memory, imageBase, importTable, win32Stubs) {
        var _a, _b;
        if (!importTable)
            return;
        var stubCount = 0;
        var realCount = 0;
        var unresolvedCount = 0;
        for (var _i = 0, _c = importTable.descriptors; _i < _c.length; _i++) {
            var descriptor = _c[_i];
            for (var _d = 0, _e = descriptor.entries; _d < _e.length; _d++) {
                var entry = _e[_d];
                var mapEntry = this._iatMap.get(entry.iatRva);
                if (!mapEntry)
                    continue;
                var iatAddr = imageBase + entry.iatRva;
                // Check if we have a JS stub for this function (preferred over real DLL code)
                var stubAddr = (_b = (_a = win32Stubs === null || win32Stubs === void 0 ? void 0 : win32Stubs.getStubAddress(mapEntry.dllName + ".dll", mapEntry.functionName)) !== null && _a !== void 0 ? _a : win32Stubs === null || win32Stubs === void 0 ? void 0 : win32Stubs.getStubAddress(mapEntry.dllName, mapEntry.functionName)) !== null && _b !== void 0 ? _b : null;
                if (stubAddr !== null) {
                    memory.write32(iatAddr, stubAddr);
                    stubCount++;
                }
                else if (mapEntry.realAddr) {
                    memory.write32(iatAddr, mapEntry.realAddr);
                    realCount++;
                }
                else {
                    unresolvedCount++;
                }
            }
        }
        console.log("[ImportResolver] IAT written: ".concat(stubCount, " stubs, ").concat(realCount, " real DLL, ").concat(unresolvedCount, " unresolved"));
        // Also patch all loaded DLLs' IAT entries to use stubs where available
        // This prevents DLL→DLL calls from entering real DLL code
        if (win32Stubs) {
            this._dllLoader.patchDLLIATs(memory, win32Stubs);
        }
    };
    /**
     * Get all DLL search paths.
     */
    ImportResolver.prototype.getDllSearchPaths = function () {
        return this._dllLoader["_searchPaths"] || [];
    };
    /**
     * Add a DLL search path.
     */
    ImportResolver.prototype.addDllSearchPath = function (path) {
        this._dllLoader.addSearchPath(path);
    };
    /**
     * Get the DLL loader instance
     */
    ImportResolver.prototype.getDLLLoader = function () {
        return this._dllLoader;
    };
    /**
     * Find which DLL owns a given address
     */
    ImportResolver.prototype.findDLLForAddress = function (address) {
        return this._dllLoader.findDLLForAddress(address);
    };
    /**
     * Check if an address belongs to any loaded DLL
     */
    ImportResolver.prototype.isInDLLRange = function (address) {
        return this._dllLoader.isInDLLRange(address);
    };
    /**
     * Get all address mappings
     */
    ImportResolver.prototype.getAddressMappings = function () {
        return this._dllLoader.getAddressMappings();
    };
    return ImportResolver;
}());
exports.ImportResolver = ImportResolver;
