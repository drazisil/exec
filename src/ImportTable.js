"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportTable = exports.ImportDescriptor = exports.ImportEntry = void 0;
var helpers_ts_1 = require("./helpers.ts");
var ImportEntry = /** @class */ (function () {
    function ImportEntry(ordinal, hint, name, iatRva, iatFileOffset, iatValue) {
        this._ordinal = ordinal;
        this._hint = hint;
        this._name = name;
        this._iatRva = iatRva;
        this._iatFileOffset = iatFileOffset;
        this._iatValue = iatValue;
    }
    Object.defineProperty(ImportEntry.prototype, "ordinal", {
        get: function () { return this._ordinal; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportEntry.prototype, "hint", {
        get: function () { return this._hint; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportEntry.prototype, "name", {
        get: function () { return this._name; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportEntry.prototype, "iatRva", {
        get: function () { return this._iatRva; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportEntry.prototype, "iatFileOffset", {
        get: function () { return this._iatFileOffset; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportEntry.prototype, "iatValue", {
        get: function () { return this._iatValue; },
        enumerable: false,
        configurable: true
    });
    ImportEntry.prototype.toString = function () {
        if (this._ordinal !== null) {
            return "".concat((0, helpers_ts_1.hex)(this._iatRva), "  ").concat((0, helpers_ts_1.hex)(this._iatValue), "  Ordinal #").concat(this._ordinal);
        }
        return "".concat((0, helpers_ts_1.hex)(this._iatRva), "  ").concat((0, helpers_ts_1.hex)(this._iatValue), "  ").concat(this._name, " (hint: ").concat(this._hint, ")");
    };
    return ImportEntry;
}());
exports.ImportEntry = ImportEntry;
var ImportDescriptor = /** @class */ (function () {
    function ImportDescriptor(dllName, entries, originalFirstThunk, firstThunk) {
        this._dllName = dllName;
        this._entries = entries;
        this._originalFirstThunk = originalFirstThunk;
        this._firstThunk = firstThunk;
    }
    Object.defineProperty(ImportDescriptor.prototype, "dllName", {
        get: function () { return this._dllName; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportDescriptor.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportDescriptor.prototype, "originalFirstThunk", {
        get: function () { return this._originalFirstThunk; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ImportDescriptor.prototype, "firstThunk", {
        get: function () { return this._firstThunk; },
        enumerable: false,
        configurable: true
    });
    ImportDescriptor.prototype.toString = function () {
        var header = "".concat(this._dllName, " (").concat(this._entries.length, " imports)");
        var entries = this._entries.map(function (e, i) { return "    [".concat(i, "] ").concat(e); }).join('\n');
        return "".concat(header, "\n").concat(entries);
    };
    return ImportDescriptor;
}());
exports.ImportDescriptor = ImportDescriptor;
var ImportTable = /** @class */ (function () {
    function ImportTable(data, fileImage, sections, isPE32Plus) {
        this._descriptors = [];
        if (data.length === 0)
            return;
        var descriptorSize = 20;
        for (var i = 0;; i++) {
            var offset = i * descriptorSize;
            if (offset + descriptorSize > data.length)
                break;
            var originalFirstThunk = data.readUInt32LE(offset);
            var nameRva = data.readUInt32LE(offset + 12);
            var firstThunk = data.readUInt32LE(offset + 16);
            // All-zero entry terminates the list
            if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0)
                break;
            // Resolve DLL name
            var nameFileOffset = (0, helpers_ts_1.rvaToOffset)(nameRva, sections);
            var dllName = '<unknown>';
            if (nameFileOffset !== -1) {
                var nameEnd = fileImage.indexOf(0, nameFileOffset);
                dllName = fileImage.subarray(nameFileOffset, nameEnd !== -1 ? nameEnd : nameFileOffset + 256).toString('utf8');
            }
            // Walk thunk array — prefer OriginalFirstThunk, fall back to FirstThunk
            var thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk;
            var entries = this.parseThunks(fileImage, sections, thunkRva, firstThunk, isPE32Plus);
            this._descriptors.push(new ImportDescriptor(dllName, entries, originalFirstThunk, firstThunk));
        }
    }
    ImportTable.prototype.parseThunks = function (fileImage, sections, thunkRva, firstThunkRva, isPE32Plus) {
        var entries = [];
        var thunkFileOffset = (0, helpers_ts_1.rvaToOffset)(thunkRva, sections);
        if (thunkFileOffset === -1)
            return entries;
        var iatBaseFileOffset = (0, helpers_ts_1.rvaToOffset)(firstThunkRva, sections);
        var thunkSize = isPE32Plus ? 8 : 4;
        for (var i = 0;; i++) {
            var offset = thunkFileOffset + i * thunkSize;
            if (offset + thunkSize > fileImage.length)
                break;
            var iatRva = firstThunkRva + i * thunkSize;
            var iatFileOffset = iatBaseFileOffset !== -1 ? iatBaseFileOffset + i * thunkSize : -1;
            if (isPE32Plus) {
                var thunk = fileImage.readBigUInt64LE(offset);
                if (thunk === 0n)
                    break;
                var iatValue = iatFileOffset !== -1 ? Number(fileImage.readBigUInt64LE(iatFileOffset)) : 0;
                if (thunk & 0x8000000000000000n) {
                    var ordinal = Number(thunk & 0xffffn);
                    entries.push(new ImportEntry(ordinal, 0, "Ordinal #".concat(ordinal), iatRva, iatFileOffset, iatValue));
                }
                else {
                    var hintNameRva = Number(thunk);
                    this.readHintName(fileImage, sections, hintNameRva, iatRva, iatFileOffset, iatValue, entries);
                }
            }
            else {
                var thunk = fileImage.readUInt32LE(offset);
                if (thunk === 0)
                    break;
                var iatValue = iatFileOffset !== -1 ? fileImage.readUInt32LE(iatFileOffset) : 0;
                if (thunk & 0x80000000) {
                    var ordinal = thunk & 0xFFFF;
                    entries.push(new ImportEntry(ordinal, 0, "Ordinal #".concat(ordinal), iatRva, iatFileOffset, iatValue));
                }
                else {
                    this.readHintName(fileImage, sections, thunk, iatRva, iatFileOffset, iatValue, entries);
                }
            }
        }
        return entries;
    };
    ImportTable.prototype.readHintName = function (fileImage, sections, rva, iatRva, iatFileOffset, iatValue, entries) {
        var hintNameOffset = (0, helpers_ts_1.rvaToOffset)(rva, sections);
        if (hintNameOffset === -1)
            return;
        var hint = fileImage.readUInt16LE(hintNameOffset);
        var nameStart = hintNameOffset + 2;
        var nameEnd = fileImage.indexOf(0, nameStart);
        var name = fileImage.subarray(nameStart, nameEnd !== -1 ? nameEnd : nameStart + 256).toString('utf8');
        entries.push(new ImportEntry(null, hint, name, iatRva, iatFileOffset, iatValue));
    };
    Object.defineProperty(ImportTable.prototype, "descriptors", {
        get: function () { return this._descriptors; },
        enumerable: false,
        configurable: true
    });
    ImportTable.prototype.toString = function () {
        if (this._descriptors.length === 0)
            return 'Import Table: empty';
        return "Import Table (".concat(this._descriptors.length, " DLLs):\n") +
            this._descriptors.map(function (d, i) { return "  [".concat(i, "] ").concat(d); }).join('\n\n');
    };
    return ImportTable;
}());
exports.ImportTable = ImportTable;
