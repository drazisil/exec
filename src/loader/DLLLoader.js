"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DLLLoader = void 0;
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var exefile_ts_1 = require("../exefile.ts");
var DLLLoader = /** @class */ (function () {
    function DLLLoader(searchPaths) {
        if (searchPaths === void 0) { searchPaths = []; }
        this._loadedDLLs = new Map();
        this._addressMappings = []; // Sorted list of address ranges
        this._dllIATEntries = []; // Track all DLL IAT writes for later stub patching
        this._dllSize = 0x01000000; // Each DLL gets 16MB of address space
        this._maxAddress = 0x40000000; // Max addressable (1GB)
        this._searchPaths = searchPaths;
    }
    /**
     * Check if an address range is already allocated
     */
    DLLLoader.prototype.isAddressRangeAvailable = function (baseAddress, size) {
        var endAddress = baseAddress + size - 1;
        for (var _i = 0, _a = this._addressMappings; _i < _a.length; _i++) {
            var mapping = _a[_i];
            // Check if this range overlaps with any existing mapping
            if (!(endAddress < mapping.baseAddress || baseAddress > mapping.endAddress)) {
                return false; // Overlap detected
            }
        }
        return true;
    };
    /**
     * Find next available address slot for a DLL
     */
    DLLLoader.prototype.findAvailableBase = function (preferredBase) {
        // Try preferred base first
        if (preferredBase > 0 && preferredBase < this._maxAddress) {
            if (this.isAddressRangeAvailable(preferredBase, this._dllSize)) {
                return preferredBase;
            }
        }
        // Fallback: scan from 0x10000000 upward for first available slot
        for (var base = 0x10000000; base < this._maxAddress; base += this._dllSize) {
            if (this.isAddressRangeAvailable(base, this._dllSize)) {
                return base;
            }
        }
        throw new Error("No available address space for DLL (needed 0x".concat(this._dllSize.toString(16), " bytes)"));
    };
    /**
     * Add a search path for DLLs
     */
    DLLLoader.prototype.addSearchPath = function (path) {
        if (!this._searchPaths.includes(path)) {
            this._searchPaths.push(path);
        }
    };
    /**
     * Find a DLL file in the search paths
     */
    DLLLoader.prototype.findDLLFile = function (dllName) {
        // Try exact name first
        for (var _i = 0, _a = this._searchPaths; _i < _a.length; _i++) {
            var path = _a[_i];
            var fullPath = (0, node_path_1.join)(path, dllName);
            if ((0, node_fs_1.existsSync)(fullPath)) {
                return fullPath;
            }
        }
        // Try case-insensitive search in each directory
        var lowerName = dllName.toLowerCase();
        for (var _b = 0, _c = this._searchPaths; _b < _c.length; _b++) {
            var dirPath = _c[_b];
            try {
                var files = (0, node_fs_1.readdirSync)(dirPath);
                var match = files.find(function (f) { return f.toLowerCase() === lowerName; });
                if (match) {
                    return (0, node_path_1.join)(dirPath, match);
                }
            }
            catch (e) {
                // Directory doesn't exist or can't be read
            }
        }
        return null;
    };
    /**
     * Get forwarding candidates for an api-ms-win-* DLL
     * These DLLs re-export from other system DLLs
     */
    DLLLoader.prototype.getForwardingCandidates = function (dllName) {
        var forwardingMap = {
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
        for (var _i = 0, _a = Object.entries(forwardingMap); _i < _a.length; _i++) {
            var _b = _a[_i], prefix = _b[0], candidates = _b[1];
            if (dllName.toLowerCase().startsWith(prefix)) {
                return candidates;
            }
        }
        // Default fallback: try core DLLs
        return ['kernel32', 'ntdll'];
    };
    /**
     * Load a DLL into memory
     */
    DLLLoader.prototype.loadDLL = function (dllName, memory) {
        // Check if already loaded
        var key = dllName.toLowerCase();
        if (this._loadedDLLs.has(key)) {
            return this._loadedDLLs.get(key);
        }
        // Find the DLL file
        var dllPath = this.findDLLFile(dllName);
        if (!dllPath) {
            if (dllName.startsWith('api-ms-win-')) {
                console.log("[DLLLoader] ".concat(dllName, " not found (API forwarding DLL - imports will be resolved at runtime)"));
            }
            else {
                console.log("[DLLLoader] Could not find ".concat(dllName));
            }
            return null;
        }
        try {
            console.log("[DLLLoader] Loading ".concat(dllName, " from ").concat(dllPath));
            var exe = new exefile_ts_1.EXEFile(dllPath);
            // Windows-style DLL loading: try preferred base, fall back if conflict
            var preferredBase = exe.optionalHeader.imageBase;
            var baseAddress = this.findAvailableBase(preferredBase);
            if (baseAddress === preferredBase) {
                console.log("  Loaded at preferred base 0x".concat(baseAddress.toString(16)));
            }
            else {
                console.log("  Preferred base 0x".concat(preferredBase.toString(16), " unavailable, using 0x").concat(baseAddress.toString(16)));
            }
            // Load all sections into memory
            for (var _i = 0, _a = exe.sectionHeaders; _i < _a.length; _i++) {
                var section = _a[_i];
                var vaddr = baseAddress + section.virtualAddress;
                memory.load(vaddr, section.data);
            }
            // Apply base relocations
            // The relocation delta is the difference between where we loaded it and where it was compiled for
            var relocationDelta = (baseAddress - preferredBase) >>> 0;
            if (relocationDelta !== 0 && exe.baseRelocationTable) {
                console.log("  [Relocations] Applying delta 0x".concat(relocationDelta.toString(16), " (loaded at 0x").concat(baseAddress.toString(16), ", preferred 0x").concat(preferredBase.toString(16), ")"));
                for (var _b = 0, _c = exe.baseRelocationTable.blocks; _b < _c.length; _b++) {
                    var block = _c[_b];
                    for (var _d = 0, _e = block.entries; _d < _e.length; _d++) {
                        var entry = _e[_d];
                        var relocAddr = baseAddress + block.pageRva + entry.offset;
                        if (entry.type === 3) { // HIGHLOW (32-bit absolute)
                            var currentValue = memory.read32(relocAddr);
                            var newValue = (currentValue + relocationDelta) >>> 0;
                            memory.write32(relocAddr, newValue);
                        }
                        // Type 0 (ABS) means no relocation needed
                        // Other types are less common in 32-bit x86
                    }
                }
            }
            // Extract exports (both named and ordinal)
            var exports_1 = new Map();
            if (exe.exportTable) {
                for (var _f = 0, _g = exe.exportTable.entries; _f < _g.length; _f++) {
                    var exp = _g[_f];
                    var funcAddr = baseAddress + exp.rva;
                    // Store by name if available
                    if (exp.name) {
                        exports_1.set(exp.name, funcAddr);
                    }
                    // Also store by ordinal (format: "Ordinal #N")
                    var ordinalKey = "Ordinal #".concat(exp.ordinal);
                    exports_1.set(ordinalKey, funcAddr);
                    var exportLabel = exp.name ? exp.name : ordinalKey;
                    console.log("  [Export] ".concat(exportLabel, " @ 0x").concat(funcAddr.toString(16)));
                }
            }
            var dll = {
                name: dllName,
                baseAddress: baseAddress,
                size: this._dllSize,
                exports: exports_1,
            };
            this._loadedDLLs.set(key, dll);
            // Add address mapping for this DLL
            this._addressMappings.push({
                dllName: dllName,
                baseAddress: baseAddress,
                endAddress: baseAddress + this._dllSize - 1,
            });
            console.log("[DLLLoader] Loaded ".concat(dllName, " at 0x").concat(baseAddress.toString(16), "-0x").concat((baseAddress + this._dllSize - 1).toString(16), " with ").concat(exports_1.size, " exports"));
            // CRITICAL: Resolve the DLL's own imports by filling in its IAT
            if (exe.importTable) {
                console.log("  [IAT Resolution] Resolving ".concat(exe.importTable.descriptors.length, " import descriptors for ").concat(dllName, " (base: 0x").concat(baseAddress.toString(16), ")"));
                for (var _h = 0, _j = exe.importTable.descriptors; _h < _j.length; _h++) {
                    var descriptor = _j[_h];
                    // Recursively load the imported DLL
                    var importedDLL = this.loadDLL(descriptor.dllName, memory);
                    for (var _k = 0, _l = descriptor.entries; _k < _l.length; _k++) {
                        var entry = _l[_k];
                        var importAddr = null;
                        if (importedDLL) {
                            importAddr = importedDLL.exports.get(entry.name) || null;
                        }
                        // If not found in the imported DLL, try API forwarding for api-ms-win-* DLLs
                        // These are thin forwarding wrappers - real code is in KERNELBASE/ntdll/kernel32
                        if (!importAddr && descriptor.dllName.startsWith('api-ms-win-')) {
                            // First try the known forwarding candidates map
                            var forwardingCandidates = this.getForwardingCandidates(descriptor.dllName);
                            for (var _m = 0, forwardingCandidates_1 = forwardingCandidates; _m < forwardingCandidates_1.length; _m++) {
                                var candidate = forwardingCandidates_1[_m];
                                var candidateDLL = this._loadedDLLs.get(candidate.toLowerCase());
                                if (candidateDLL && candidateDLL.exports.size > 0) {
                                    var addr = candidateDLL.exports.get(entry.name);
                                    if (addr) {
                                        importAddr = addr;
                                        break;
                                    }
                                }
                            }
                            // If still not found, brute-force search ALL loaded DLLs
                            // api-ms-win-* DLLs are just forwarders - the function exists somewhere
                            if (!importAddr) {
                                for (var _o = 0, _p = this._loadedDLLs; _o < _p.length; _o++) {
                                    var _q = _p[_o], loadedName = _q[0], loadedDLL = _q[1];
                                    // Skip the current DLL being loaded and other api-ms-win-* DLLs
                                    if (loadedName.startsWith('api-ms-win-') || loadedName === key)
                                        continue;
                                    var addr = loadedDLL.exports.get(entry.name);
                                    if (addr) {
                                        importAddr = addr;
                                        break;
                                    }
                                }
                            }
                        }
                        if (importAddr) {
                            // Write the imported function address into the IAT
                            var iatAddr = baseAddress + entry.iatRva;
                            memory.write32(iatAddr, importAddr);
                            // Track this IAT entry so we can re-patch with stubs later
                            this._dllIATEntries.push({
                                iatAddr: iatAddr,
                                dllName: key,
                                importedDllName: descriptor.dllName.toLowerCase(),
                                funcName: entry.name,
                            });
                        }
                        else {
                            console.log("    [IAT] 0x".concat((baseAddress + entry.iatRva).toString(16), " => ").concat(descriptor.dllName, "!").concat(entry.name, " UNRESOLVED"));
                        }
                    }
                }
            }
            return dll;
        }
        catch (err) {
            console.log("[DLLLoader] Failed to load ".concat(dllName, ": ").concat(err.message));
            if (err.stack) {
                var lines = err.stack.split('\n').slice(0, 3);
                lines.forEach(function (line) { return console.log("  ".concat(line)); });
            }
            return null;
        }
    };
    /**
     * Re-patch all loaded DLLs' IAT entries to use Win32 stubs where available.
     * This must be called after stubs are registered and sections are loaded.
     * Without this, DLLs calling other DLLs (e.g. msvcrt calling kernel32!TlsSetValue)
     * would jump into real DLL code instead of our JS stubs.
     */
    DLLLoader.prototype.patchDLLIATs = function (memory, win32Stubs) {
        var _a, _b;
        var patchedCount = 0;
        for (var _i = 0, _c = this._dllIATEntries; _i < _c.length; _i++) {
            var entry = _c[_i];
            // Try to find a stub for this function
            // The importedDllName might be "kernel32.dll" or "api-ms-win-core-synch-l1-1-0.dll"
            // Stubs are registered under the canonical DLL name (e.g. "kernel32.dll")
            var stubAddr = (_b = (_a = win32Stubs.getStubAddress(entry.importedDllName, entry.funcName)) !== null && _a !== void 0 ? _a : win32Stubs.getStubAddress(entry.importedDllName + ".dll", entry.funcName)) !== null && _b !== void 0 ? _b : null;
            if (stubAddr !== null) {
                memory.write32(entry.iatAddr, stubAddr);
                patchedCount++;
            }
        }
        console.log("[DLLLoader] Patched ".concat(patchedCount, "/").concat(this._dllIATEntries.length, " DLL IAT entries with stubs"));
    };
    /**
     * Get the address of an exported function
     */
    DLLLoader.prototype.getExportAddress = function (dllName, functionName) {
        var key = dllName.toLowerCase();
        var dll = this._loadedDLLs.get(key);
        if (!dll) {
            return null;
        }
        return dll.exports.get(functionName) || null;
    };
    /**
     * Get a loaded DLL by name
     */
    DLLLoader.prototype.getDLL = function (dllName) {
        return this._loadedDLLs.get(dllName.toLowerCase()) || null;
    };
    /**
     * Get all loaded DLLs
     */
    DLLLoader.prototype.getLoadedDLLs = function () {
        return Array.from(this._loadedDLLs.values());
    };
    /**
     * Find which DLL owns a given address
     */
    DLLLoader.prototype.findDLLForAddress = function (address) {
        for (var _i = 0, _a = this._addressMappings; _i < _a.length; _i++) {
            var mapping = _a[_i];
            if (address >= mapping.baseAddress && address <= mapping.endAddress) {
                return this._loadedDLLs.get(mapping.dllName.toLowerCase()) || null;
            }
        }
        return null;
    };
    /**
     * Get all address mappings (for debugging/inspection)
     */
    DLLLoader.prototype.getAddressMappings = function () {
        return __spreadArray([], this._addressMappings, true);
    };
    /**
     * Check if an address belongs to any loaded DLL
     */
    DLLLoader.prototype.isInDLLRange = function (address) {
        return this.findDLLForAddress(address) !== null;
    };
    return DLLLoader;
}());
exports.DLLLoader = DLLLoader;
