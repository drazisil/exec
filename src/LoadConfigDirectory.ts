import { hex } from "./helpers.ts";

export class LoadConfigDirectory {
    private _size: number;
    private _timeDateStamp: number;
    private _majorVersion: number;
    private _minorVersion: number;
    private _globalFlagsClear: number;
    private _globalFlagsSet: number;
    private _criticalSectionDefaultTimeout: number;
    private _deCommitFreeBlockThreshold: number;
    private _deCommitTotalFreeThreshold: number;
    private _lockPrefixTable: number;
    private _maximumAllocationSize: number;
    private _virtualMemoryThreshold: number;
    private _processAffinityMask: number;
    private _processHeapFlags: number;
    private _csdVersion: number;
    private _dependentLoadFlags: number;
    private _editList: number;
    private _securityCookie: number;
    private _seHandlerTable: number;
    private _seHandlerCount: number;
    private _guardCFCheckFunctionPointer: number;
    private _guardCFDispatchFunctionPointer: number;
    private _guardCFFunctionTable: number;
    private _guardCFFunctionCount: number;
    private _guardFlags: number;

    constructor(data: Buffer, isPE32Plus: boolean) {
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
        } else {
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

    get size() { return this._size; }
    get timeDateStamp() { return this._timeDateStamp; }
    get majorVersion() { return this._majorVersion; }
    get minorVersion() { return this._minorVersion; }
    get globalFlagsClear() { return this._globalFlagsClear; }
    get globalFlagsSet() { return this._globalFlagsSet; }
    get criticalSectionDefaultTimeout() { return this._criticalSectionDefaultTimeout; }
    get securityCookie() { return this._securityCookie; }
    get seHandlerTable() { return this._seHandlerTable; }
    get seHandlerCount() { return this._seHandlerCount; }
    get guardCFCheckFunctionPointer() { return this._guardCFCheckFunctionPointer; }
    get guardCFFunctionTable() { return this._guardCFFunctionTable; }
    get guardCFFunctionCount() { return this._guardCFFunctionCount; }
    get guardFlags() { return this._guardFlags; }

    toString() {
        const rows: string[] = [
            `Size:                      ${hex(this._size)}`,
            `TimeDateStamp:             ${hex(this._timeDateStamp)}`,
            `Version:                   ${this._majorVersion}.${this._minorVersion}`,
            `GlobalFlagsClear:          ${hex(this._globalFlagsClear)}`,
            `GlobalFlagsSet:            ${hex(this._globalFlagsSet)}`,
            `CriticalSectionTimeout:    ${this._criticalSectionDefaultTimeout}`,
            `SecurityCookie:            ${hex(this._securityCookie)}`,
        ];
        if (this._seHandlerTable !== 0) {
            rows.push(`SEHandlerTable:            ${hex(this._seHandlerTable)}`);
            rows.push(`SEHandlerCount:            ${this._seHandlerCount}`);
        }
        if (this._guardCFCheckFunctionPointer !== 0) {
            rows.push(`GuardCFCheckFunction:      ${hex(this._guardCFCheckFunctionPointer)}`);
            rows.push(`GuardCFFunctionTable:      ${hex(this._guardCFFunctionTable)}`);
            rows.push(`GuardCFFunctionCount:      ${this._guardCFFunctionCount}`);
            rows.push(`GuardFlags:                ${hex(this._guardFlags)}`);
        }
        return rows.join('\n');
    }
}
