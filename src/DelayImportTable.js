"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DelayImportTable = exports.DelayImportDescriptor = void 0;
var helpers_ts_1 = require("./helpers.ts");
var ImportTable_ts_1 = require("./ImportTable.ts");
var DelayImportDescriptor = /** @class */ (function () {
    function DelayImportDescriptor(dllName, attributes, moduleHandle, iat, int, boundIAT, unloadIAT, timeDateStamp, entries) {
        this._dllName = dllName;
        this._attributes = attributes;
        this._moduleHandle = moduleHandle;
        this._iat = iat;
        this._int = int;
        this._boundIAT = boundIAT;
        this._unloadIAT = unloadIAT;
        this._timeDateStamp = timeDateStamp;
        this._entries = entries;
    }
    Object.defineProperty(DelayImportDescriptor.prototype, "attributes", {
        get: function () { return this._attributes; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DelayImportDescriptor.prototype, "dllName", {
        get: function () { return this._dllName; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DelayImportDescriptor.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    DelayImportDescriptor.prototype.toString = function () {
        var header = "".concat(this._dllName, " (").concat(this._entries.length, " imports)");
        var entries = this._entries.map(function (e, i) { return "    [".concat(i, "] ").concat(e); }).join('\n');
        return "".concat(header, "\n").concat(entries);
    };
    return DelayImportDescriptor;
}());
exports.DelayImportDescriptor = DelayImportDescriptor;
var DelayImportTable = /** @class */ (function () {
    function DelayImportTable(data, fileImage, sections, isPE32Plus) {
        this._descriptors = [];
        if (data.length === 0)
            return;
        var descriptorSize = 32;
        for (var i = 0;; i++) {
            var offset = i * descriptorSize;
            if (offset + descriptorSize > data.length)
                break;
            var attributes = data.readUInt32LE(offset);
            var dllNameRva = data.readUInt32LE(offset + 4);
            var moduleHandle = data.readUInt32LE(offset + 8);
            var iatRva = data.readUInt32LE(offset + 12);
            var intRva = data.readUInt32LE(offset + 16);
            var boundIATRva = data.readUInt32LE(offset + 20);
            var unloadIATRva = data.readUInt32LE(offset + 24);
            var timeDateStamp = data.readUInt32LE(offset + 28);
            // All-zero terminates
            if (dllNameRva === 0 && intRva === 0 && iatRva === 0)
                break;
            // Resolve DLL name
            var nameOffset = (0, helpers_ts_1.rvaToOffset)(dllNameRva, sections);
            var dllName = '<unknown>';
            if (nameOffset !== -1) {
                var end = fileImage.indexOf(0, nameOffset);
                dllName = fileImage.subarray(nameOffset, end !== -1 ? end : nameOffset + 256).toString('utf8');
            }
            // Walk Import Name Table thunks
            var entries = this.parseThunks(fileImage, sections, intRva, iatRva, isPE32Plus);
            this._descriptors.push(new DelayImportDescriptor(dllName, attributes, moduleHandle, iatRva, intRva, boundIATRva, unloadIATRva, timeDateStamp, entries));
        }
    }
    DelayImportTable.prototype.parseThunks = function (fileImage, sections, intRva, firstThunkRva, isPE32Plus) {
        var entries = [];
        var intOffset = (0, helpers_ts_1.rvaToOffset)(intRva, sections);
        if (intOffset === -1)
            return entries;
        var iatBaseOffset = (0, helpers_ts_1.rvaToOffset)(firstThunkRva, sections);
        var thunkSize = isPE32Plus ? 8 : 4;
        for (var i = 0;; i++) {
            var offset = intOffset + i * thunkSize;
            if (offset + thunkSize > fileImage.length)
                break;
            var iatRva = firstThunkRva + i * thunkSize;
            var iatFileOffset = iatBaseOffset !== -1 ? iatBaseOffset + i * thunkSize : -1;
            if (isPE32Plus) {
                var thunk = fileImage.readBigUInt64LE(offset);
                if (thunk === 0n)
                    break;
                var iatValue = iatFileOffset !== -1 ? Number(fileImage.readBigUInt64LE(iatFileOffset)) : 0;
                if (thunk & 0x8000000000000000n) {
                    var ordinal = Number(thunk & 0xffffn);
                    entries.push(new ImportTable_ts_1.ImportEntry(ordinal, 0, "Ordinal #".concat(ordinal), iatRva, iatFileOffset, iatValue));
                }
                else {
                    this.readHintName(fileImage, sections, Number(thunk), iatRva, iatFileOffset, iatValue, entries);
                }
            }
            else {
                var thunk = fileImage.readUInt32LE(offset);
                if (thunk === 0)
                    break;
                var iatValue = iatFileOffset !== -1 ? fileImage.readUInt32LE(iatFileOffset) : 0;
                if (thunk & 0x80000000) {
                    var ordinal = thunk & 0xFFFF;
                    entries.push(new ImportTable_ts_1.ImportEntry(ordinal, 0, "Ordinal #".concat(ordinal), iatRva, iatFileOffset, iatValue));
                }
                else {
                    this.readHintName(fileImage, sections, thunk, iatRva, iatFileOffset, iatValue, entries);
                }
            }
        }
        return entries;
    };
    DelayImportTable.prototype.readHintName = function (fileImage, sections, rva, iatRva, iatFileOffset, iatValue, entries) {
        var offset = (0, helpers_ts_1.rvaToOffset)(rva, sections);
        if (offset === -1)
            return;
        var hint = fileImage.readUInt16LE(offset);
        var nameStart = offset + 2;
        var nameEnd = fileImage.indexOf(0, nameStart);
        var name = fileImage.subarray(nameStart, nameEnd !== -1 ? nameEnd : nameStart + 256).toString('utf8');
        entries.push(new ImportTable_ts_1.ImportEntry(null, hint, name, iatRva, iatFileOffset, iatValue));
    };
    Object.defineProperty(DelayImportTable.prototype, "descriptors", {
        get: function () { return this._descriptors; },
        enumerable: false,
        configurable: true
    });
    DelayImportTable.prototype.toString = function () {
        if (this._descriptors.length === 0)
            return 'Delay Import Table: empty';
        return "Delay Import Table (".concat(this._descriptors.length, " DLLs):\n") +
            this._descriptors.map(function (d, i) { return "  [".concat(i, "] ").concat(d); }).join('\n\n');
    };
    return DelayImportTable;
}());
exports.DelayImportTable = DelayImportTable;
