"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportTable = exports.ExportEntry = void 0;
var helpers_ts_1 = require("./helpers.ts");
var ExportEntry = /** @class */ (function () {
    function ExportEntry(ordinal, rva, name, forwarder) {
        this._ordinal = ordinal;
        this._rva = rva;
        this._name = name;
        this._forwarder = forwarder;
    }
    Object.defineProperty(ExportEntry.prototype, "ordinal", {
        get: function () { return this._ordinal; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportEntry.prototype, "rva", {
        get: function () { return this._rva; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportEntry.prototype, "name", {
        get: function () { return this._name; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportEntry.prototype, "forwarder", {
        get: function () { return this._forwarder; },
        enumerable: false,
        configurable: true
    });
    ExportEntry.prototype.toString = function () {
        var _a;
        var name = (_a = this._name) !== null && _a !== void 0 ? _a : "(ordinal only)";
        var target = this._forwarder ? "-> ".concat(this._forwarder) : (0, helpers_ts_1.hex)(this._rva);
        return "[".concat(this._ordinal, "] ").concat(name, " ").concat(target);
    };
    return ExportEntry;
}());
exports.ExportEntry = ExportEntry;
var ExportTable = /** @class */ (function () {
    function ExportTable(data, fileImage, sections, exportDirRva, exportDirSize) {
        var _a;
        this._entries = [];
        this._dllName = '';
        this._ordinalBase = 0;
        this._timeDateStamp = 0;
        if (data.length < 40)
            return;
        this._timeDateStamp = data.readUInt32LE(4);
        var nameRva = data.readUInt32LE(12);
        this._ordinalBase = data.readUInt32LE(16);
        var numberOfFunctions = data.readUInt32LE(20);
        var numberOfNames = data.readUInt32LE(24);
        var addressOfFunctions = data.readUInt32LE(28);
        var addressOfNames = data.readUInt32LE(32);
        var addressOfNameOrdinals = data.readUInt32LE(36);
        // Resolve DLL name
        var nameOffset = (0, helpers_ts_1.rvaToOffset)(nameRva, sections);
        if (nameOffset !== -1) {
            var end = fileImage.indexOf(0, nameOffset);
            this._dllName = fileImage.subarray(nameOffset, end !== -1 ? end : nameOffset + 256).toString('utf8');
        }
        // Read Export Address Table
        var eatOffset = (0, helpers_ts_1.rvaToOffset)(addressOfFunctions, sections);
        if (eatOffset === -1)
            return;
        // Read Name Pointer Table and Ordinal Table
        var nptOffset = numberOfNames > 0 ? (0, helpers_ts_1.rvaToOffset)(addressOfNames, sections) : -1;
        var otOffset = numberOfNames > 0 ? (0, helpers_ts_1.rvaToOffset)(addressOfNameOrdinals, sections) : -1;
        // Build ordinal-to-name map
        var ordinalToName = new Map();
        if (nptOffset !== -1 && otOffset !== -1) {
            for (var i = 0; i < numberOfNames; i++) {
                var funcNameRva = fileImage.readUInt32LE(nptOffset + i * 4);
                var ordinalIndex = fileImage.readUInt16LE(otOffset + i * 2);
                var funcNameOffset = (0, helpers_ts_1.rvaToOffset)(funcNameRva, sections);
                if (funcNameOffset !== -1) {
                    var end = fileImage.indexOf(0, funcNameOffset);
                    var funcName = fileImage.subarray(funcNameOffset, end !== -1 ? end : funcNameOffset + 256).toString('utf8');
                    ordinalToName.set(ordinalIndex, funcName);
                }
            }
        }
        // Build export entries
        for (var i = 0; i < numberOfFunctions; i++) {
            var funcRva = fileImage.readUInt32LE(eatOffset + i * 4);
            if (funcRva === 0)
                continue;
            var ordinal = this._ordinalBase + i;
            var name_1 = (_a = ordinalToName.get(i)) !== null && _a !== void 0 ? _a : null;
            // Check if this is a forwarder (RVA points within the export directory)
            var forwarder = null;
            if (funcRva >= exportDirRva && funcRva < exportDirRva + exportDirSize) {
                var fwdOffset = (0, helpers_ts_1.rvaToOffset)(funcRva, sections);
                if (fwdOffset !== -1) {
                    var end = fileImage.indexOf(0, fwdOffset);
                    forwarder = fileImage.subarray(fwdOffset, end !== -1 ? end : fwdOffset + 256).toString('utf8');
                }
            }
            this._entries.push(new ExportEntry(ordinal, funcRva, name_1, forwarder));
        }
    }
    Object.defineProperty(ExportTable.prototype, "dllName", {
        get: function () { return this._dllName; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportTable.prototype, "ordinalBase", {
        get: function () { return this._ordinalBase; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportTable.prototype, "timeDateStamp", {
        get: function () { return this._timeDateStamp; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ExportTable.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    ExportTable.prototype.toString = function () {
        if (this._entries.length === 0)
            return 'Export Table: empty';
        return "Export Table: ".concat(this._dllName, " (").concat(this._entries.length, " exports, base ").concat(this._ordinalBase, "):\n") +
            this._entries.map(function (e) { return "  ".concat(e); }).join('\n');
    };
    return ExportTable;
}());
exports.ExportTable = ExportTable;
