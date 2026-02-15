"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadConfigDirectory = void 0;
var helpers_ts_1 = require("./helpers.ts");
var LoadConfigDirectory = /** @class */ (function () {
    function LoadConfigDirectory(data, isPE32Plus) {
        this._size = data.readUInt32LE(0);
        this._timeDateStamp = data.readUInt32LE(4);
        this._majorVersion = data.readUInt16LE(8);
        this._minorVersion = data.readUInt16LE(10);
        this._globalFlagsClear = data.readUInt32LE(12);
        this._globalFlagsSet = data.readUInt32LE(16);
        this._criticalSectionDefaultTimeout = data.readUInt32LE(20);
        // Fields after offset 24 differ in size between PE32 and PE32+
        if (isPE32Plus) {
            this._deCommitFreeBlockThreshold = data.length >= 32 ? Number(data.readBigUInt64LE(24)) : 0;
            this._deCommitTotalFreeThreshold = data.length >= 40 ? Number(data.readBigUInt64LE(32)) : 0;
            this._lockPrefixTable = data.length >= 48 ? Number(data.readBigUInt64LE(40)) : 0;
            this._maximumAllocationSize = data.length >= 56 ? Number(data.readBigUInt64LE(48)) : 0;
            this._virtualMemoryThreshold = data.length >= 64 ? Number(data.readBigUInt64LE(56)) : 0;
            this._processAffinityMask = data.length >= 72 ? Number(data.readBigUInt64LE(64)) : 0;
            this._processHeapFlags = data.length >= 76 ? data.readUInt32LE(72) : 0;
            this._csdVersion = data.length >= 78 ? data.readUInt16LE(76) : 0;
            this._dependentLoadFlags = data.length >= 80 ? data.readUInt16LE(78) : 0;
            this._editList = data.length >= 88 ? Number(data.readBigUInt64LE(80)) : 0;
            this._securityCookie = data.length >= 96 ? Number(data.readBigUInt64LE(88)) : 0;
            this._seHandlerTable = data.length >= 104 ? Number(data.readBigUInt64LE(96)) : 0;
            this._seHandlerCount = data.length >= 112 ? Number(data.readBigUInt64LE(104)) : 0;
            this._guardCFCheckFunctionPointer = data.length >= 120 ? Number(data.readBigUInt64LE(112)) : 0;
            this._guardCFDispatchFunctionPointer = data.length >= 128 ? Number(data.readBigUInt64LE(120)) : 0;
            this._guardCFFunctionTable = data.length >= 136 ? Number(data.readBigUInt64LE(128)) : 0;
            this._guardCFFunctionCount = data.length >= 144 ? Number(data.readBigUInt64LE(136)) : 0;
            this._guardFlags = data.length >= 148 ? data.readUInt32LE(144) : 0;
        }
        else {
            this._deCommitFreeBlockThreshold = data.length >= 28 ? data.readUInt32LE(24) : 0;
            this._deCommitTotalFreeThreshold = data.length >= 32 ? data.readUInt32LE(28) : 0;
            this._lockPrefixTable = data.length >= 36 ? data.readUInt32LE(32) : 0;
            this._maximumAllocationSize = data.length >= 40 ? data.readUInt32LE(36) : 0;
            this._virtualMemoryThreshold = data.length >= 44 ? data.readUInt32LE(40) : 0;
            this._processAffinityMask = data.length >= 48 ? data.readUInt32LE(44) : 0;
            this._processHeapFlags = data.length >= 52 ? data.readUInt32LE(48) : 0;
            this._csdVersion = data.length >= 54 ? data.readUInt16LE(52) : 0;
            this._dependentLoadFlags = data.length >= 56 ? data.readUInt16LE(54) : 0;
            this._editList = data.length >= 60 ? data.readUInt32LE(56) : 0;
            this._securityCookie = data.length >= 64 ? data.readUInt32LE(60) : 0;
            this._seHandlerTable = data.length >= 68 ? data.readUInt32LE(64) : 0;
            this._seHandlerCount = data.length >= 72 ? data.readUInt32LE(68) : 0;
            this._guardCFCheckFunctionPointer = data.length >= 76 ? data.readUInt32LE(72) : 0;
            this._guardCFDispatchFunctionPointer = data.length >= 80 ? data.readUInt32LE(76) : 0;
            this._guardCFFunctionTable = data.length >= 84 ? data.readUInt32LE(80) : 0;
            this._guardCFFunctionCount = data.length >= 88 ? data.readUInt32LE(84) : 0;
            this._guardFlags = data.length >= 92 ? data.readUInt32LE(88) : 0;
        }
    }
    Object.defineProperty(LoadConfigDirectory.prototype, "size", {
        get: function () { return this._size; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "timeDateStamp", {
        get: function () { return this._timeDateStamp; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "majorVersion", {
        get: function () { return this._majorVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "minorVersion", {
        get: function () { return this._minorVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "globalFlagsClear", {
        get: function () { return this._globalFlagsClear; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "globalFlagsSet", {
        get: function () { return this._globalFlagsSet; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "criticalSectionDefaultTimeout", {
        get: function () { return this._criticalSectionDefaultTimeout; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "securityCookie", {
        get: function () { return this._securityCookie; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "seHandlerTable", {
        get: function () { return this._seHandlerTable; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "seHandlerCount", {
        get: function () { return this._seHandlerCount; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "guardCFCheckFunctionPointer", {
        get: function () { return this._guardCFCheckFunctionPointer; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "guardCFFunctionTable", {
        get: function () { return this._guardCFFunctionTable; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "guardCFFunctionCount", {
        get: function () { return this._guardCFFunctionCount; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(LoadConfigDirectory.prototype, "guardFlags", {
        get: function () { return this._guardFlags; },
        enumerable: false,
        configurable: true
    });
    LoadConfigDirectory.prototype.toString = function () {
        var rows = [
            "Size:                      ".concat((0, helpers_ts_1.hex)(this._size)),
            "TimeDateStamp:             ".concat((0, helpers_ts_1.hex)(this._timeDateStamp)),
            "Version:                   ".concat(this._majorVersion, ".").concat(this._minorVersion),
            "GlobalFlagsClear:          ".concat((0, helpers_ts_1.hex)(this._globalFlagsClear)),
            "GlobalFlagsSet:            ".concat((0, helpers_ts_1.hex)(this._globalFlagsSet)),
            "CriticalSectionTimeout:    ".concat(this._criticalSectionDefaultTimeout),
            "SecurityCookie:            ".concat((0, helpers_ts_1.hex)(this._securityCookie)),
        ];
        if (this._seHandlerTable !== 0) {
            rows.push("SEHandlerTable:            ".concat((0, helpers_ts_1.hex)(this._seHandlerTable)));
            rows.push("SEHandlerCount:            ".concat(this._seHandlerCount));
        }
        if (this._guardCFCheckFunctionPointer !== 0) {
            rows.push("GuardCFCheckFunction:      ".concat((0, helpers_ts_1.hex)(this._guardCFCheckFunctionPointer)));
            rows.push("GuardCFFunctionTable:      ".concat((0, helpers_ts_1.hex)(this._guardCFFunctionTable)));
            rows.push("GuardCFFunctionCount:      ".concat(this._guardCFFunctionCount));
            rows.push("GuardFlags:                ".concat((0, helpers_ts_1.hex)(this._guardFlags)));
        }
        return rows.join('\n');
    };
    return LoadConfigDirectory;
}());
exports.LoadConfigDirectory = LoadConfigDirectory;
