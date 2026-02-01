import { EXEFile } from "./exefile.ts";
import { hex } from "./helpers.ts";

const MAX_HEX_BYTES = 4096;

export class HTMLRenderer {
    private _exe: EXEFile;

    constructor(exe: EXEFile) {
        this._exe = exe;
    }

    render(): string {
        return [
            this.docHead(),
            '<body>',
            `<h1>PE File Analysis</h1>`,
            `<p class="subtitle">${this.esc(this._exe.filePath)}</p>`,
            this.renderFileOverview(),
            this.renderCOFFHeader(),
            this.renderOptionalHeader(),
            this.renderDataDirectories(),
            this.renderSectionHeaders(),
            `<footer>Generated ${new Date().toUTCString()}</footer>`,
            '</body>',
            '</html>',
        ].join('\n');
    }

    private docHead(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PE Analysis: ${this.esc(this._exe.filePath)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:1200px;margin:0 auto;padding:2rem;background:#1e1e2e;color:#cdd6f4}
h1{margin-bottom:.25rem;color:#89b4fa}
.subtitle{color:#a6adc8;margin-bottom:1.5rem;font-family:monospace}
details{margin:.75rem 0;border:1px solid #45475a;border-radius:4px;background:#313244}
details>summary{padding:.5rem 1rem;cursor:pointer;font-weight:600;background:#45475a;border-radius:4px 4px 0 0;user-select:none}
details[open]>summary{border-radius:4px 4px 0 0}
details>*:not(summary){padding:.75rem 1rem}
details details{margin:.5rem 0;background:#1e1e2e}
table.fields{border-collapse:collapse;width:100%;font-family:monospace;font-size:.9rem}
table.fields td{padding:.15rem .75rem;vertical-align:top}
table.fields td:first-child{white-space:nowrap;color:#89b4fa;width:1%}
table.fields td:last-child{color:#f9e2af}
.hexdump pre{font-family:'Courier New',Courier,monospace;font-size:.85rem;overflow-x:auto;line-height:1.4;white-space:pre}
.offset{color:#6c7086}
.hex{color:#cdd6f4}
.ascii{color:#a6e3a1}
.overview{margin:1rem 0;padding:1rem;background:#313244;border-radius:4px;border:1px solid #45475a}
.empty{color:#6c7086;font-style:italic}
.truncated{color:#fab387;font-style:italic;margin-top:.5rem}
table.imports{border-collapse:collapse;width:100%;font-family:monospace;font-size:.85rem}
table.imports th{text-align:left;padding:.25rem .75rem;border-bottom:1px solid #45475a;color:#89b4fa}
table.imports td{padding:.15rem .75rem}
table.imports td:first-child{color:#6c7086;width:1%}
table.imports td:nth-child(2){color:#a6e3a1}
table.imports td:nth-child(3){color:#fab387}
table.imports td:nth-child(4){color:#f9e2af}
table.imports td:nth-child(5){color:#cdd6f4}
table.imports td:nth-child(6){color:#6c7086}
.dll-count{color:#a6adc8;font-weight:normal;font-size:.85rem}
footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #45475a;color:#6c7086;font-size:.85rem}
</style>
</head>`;
    }

    private renderFileOverview(): string {
        return `<div class="overview">
${this.fieldTable([
    ['File Path', this.esc(this._exe.filePath)],
    ['File Size', `${this._exe.sizeOnDisk} bytes`],
    ['File Signature', this.esc(this._exe.fileSignature)],
    ['PE Start Offset', hex(this._exe.peStartOffset)],
    ['Machine Type', this.esc(this._exe.machineType)],
])}
</div>`;
    }

    private renderCOFFHeader(): string {
        const coff = this._exe.coffFileHeader;
        const date = new Date(coff.timeDateStamp * 1000).toUTCString();
        return `<details open>
<summary>COFF File Header</summary>
<div>
${this.fieldTable([
    ['Machine', this.esc(coff.machine)],
    ['NumberOfSections', String(coff.numberOfSections)],
    ['TimeDateStamp', `${hex(coff.timeDateStamp)} (${this.esc(date)})`],
    ['PointerToSymbolTable', hex(coff.pointerToSymbolTable)],
    ['NumberOfSymbols', String(coff.numberOfSymbols)],
    ['SizeOfOptionalHeader', hex(coff.sizeOfOptionalHeader, 4)],
    ['Characteristics', hex(coff.characteristics, 4)],
])}
</div>
</details>`;
    }

    private renderOptionalHeader(): string {
        const oh = this._exe.optionalHeader;
        const format = oh.isPE32Plus ? 'PE32+' : 'PE32';

        const rows: [string, string][] = [
            ['Magic', `${hex(oh.magic, 4)} (${format})`],
            ['LinkerVersion', `${oh.majorLinkerVersion}.${oh.minorLinkerVersion}`],
            ['SizeOfCode', hex(oh.sizeOfCode)],
            ['SizeOfInitializedData', hex(oh.sizeOfInitializedData)],
            ['SizeOfUninitializedData', hex(oh.sizeOfUninitializedData)],
            ['AddressOfEntryPoint', hex(oh.addressOfEntryPoint)],
            ['BaseOfCode', hex(oh.baseOfCode)],
        ];
        if (!oh.isPE32Plus) {
            rows.push(['BaseOfData', hex(oh.baseOfData)]);
        }
        rows.push(
            ['ImageBase', hex(oh.imageBase)],
            ['SectionAlignment', hex(oh.sectionAlignment)],
            ['FileAlignment', hex(oh.fileAlignment)],
            ['OperatingSystemVersion', `${oh.majorOperatingSystemVersion}.${oh.minorOperatingSystemVersion}`],
            ['ImageVersion', `${oh.majorImageVersion}.${oh.minorImageVersion}`],
            ['SubsystemVersion', `${oh.majorSubsystemVersion}.${oh.minorSubsystemVersion}`],
            ['Win32VersionValue', String(oh.win32VersionValue)],
            ['SizeOfImage', hex(oh.sizeOfImage)],
            ['SizeOfHeaders', hex(oh.sizeOfHeaders)],
            ['CheckSum', hex(oh.checkSum)],
            ['Subsystem', hex(oh.subsystem, 4)],
            ['DllCharacteristics', hex(oh.dllCharacteristics, 4)],
            ['SizeOfStackReserve', hex(oh.sizeOfStackReserve)],
            ['SizeOfStackCommit', hex(oh.sizeOfStackCommit)],
            ['SizeOfHeapReserve', hex(oh.sizeOfHeapReserve)],
            ['SizeOfHeapCommit', hex(oh.sizeOfHeapCommit)],
            ['LoaderFlags', hex(oh.loaderFlags)],
            ['NumberOfRvaAndSizes', String(oh.numberOfRvaAndSizes)],
        );

        return `<details open>
<summary>Optional Header</summary>
<div>
${this.fieldTable(rows)}
</div>
</details>`;
    }

    private renderDataDirectories(): string {
        const dirs = this._exe.optionalHeader.dataDirectories;
        const inner = dirs.map((dd, i) => {
            const header = `[${String(i).padStart(2)}] ${this.esc(dd.name)} - ${hex(dd.virtualAddress)} (${hex(dd.size)} bytes)`;
            if (dd.data.length === 0) {
                return `<details>
<summary><span class="empty">${header} - empty</span></summary>
</details>`;
            }
            // Structured view for Import Table (index 1)
            if (i === 1 && this._exe.importTable && this._exe.importTable.descriptors.length > 0) {
                return `<details>
<summary>${header}</summary>
<div>
${this.renderImportTable()}
</div>
</details>`;
            }
            return `<details>
<summary>${header}</summary>
<div class="hexdump">
${this.renderHexDump(dd.data)}
</div>
</details>`;
        }).join('\n');

        return `<details open>
<summary>Data Directories (${dirs.length})</summary>
<div>
${inner}
</div>
</details>`;
    }

    private renderImportTable(): string {
        const importTable = this._exe.importTable!;
        return importTable.descriptors.map(desc => {
            const rows = desc.entries.map((entry, i) => {
                const idx = String(i).padStart(3);
                const rva = hex(entry.iatRva);
                const fileOff = entry.iatFileOffset !== -1 ? hex(entry.iatFileOffset) : '—';
                const value = hex(entry.iatValue);
                if (entry.ordinal !== null) {
                    return `<tr><td>${idx}</td><td>${rva}</td><td>${fileOff}</td><td>${value}</td><td>Ordinal #${entry.ordinal}</td><td></td></tr>`;
                }
                return `<tr><td>${idx}</td><td>${rva}</td><td>${fileOff}</td><td>${value}</td><td>${this.esc(entry.name)}</td><td>${entry.hint}</td></tr>`;
            }).join('\n');

            return `<details>
<summary>${this.esc(desc.dllName)} <span class="dll-count">(${desc.entries.length} functions)</span></summary>
<div>
<table class="imports">
<tr><th>#</th><th>IAT RVA</th><th>File Offset</th><th>Slot Value</th><th>Function</th><th>Hint</th></tr>
${rows}
</table>
</div>
</details>`;
        }).join('\n');
    }

    private renderSectionHeaders(): string {
        const sections = this._exe.sectionHeaders;
        const inner = sections.map((s, i) => {
            const fields = this.fieldTable([
                ['VirtualSize', hex(s.virtualSize)],
                ['VirtualAddress', hex(s.virtualAddress)],
                ['SizeOfRawData', hex(s.sizeOfRawData)],
                ['PointerToRawData', hex(s.pointerToRawData)],
                ['PointerToRelocations', hex(s.pointerToRelocations)],
                ['PointerToLinenumbers', hex(s.pointerToLinenumbers)],
                ['NumberOfRelocations', String(s.numberOfRelocations)],
                ['NumberOfLinenumbers', String(s.numberOfLinenumbers)],
                ['Characteristics', hex(s.characteristics)],
            ]);

            const dump = s.data.length > 0
                ? `<details>\n<summary>Raw Data (${s.data.length} bytes)</summary>\n<div class="hexdump">\n${this.renderHexDump(s.data)}\n</div>\n</details>`
                : '';

            return `<details>
<summary>Section ${i + 1}: ${this.esc(s.name)}</summary>
<div>
${fields}
${dump}
</div>
</details>`;
        }).join('\n');

        return `<details open>
<summary>Section Headers (${sections.length})</summary>
<div>
${inner}
</div>
</details>`;
    }

    private renderHexDump(data: Buffer): string {
        const truncated = data.length > MAX_HEX_BYTES;
        const limit = truncated ? MAX_HEX_BYTES : data.length;
        const rows: string[] = [];

        for (let i = 0; i < limit; i += 16) {
            const chunk = data.subarray(i, Math.min(i + 16, limit));
            const hexBytes = Array.from(chunk).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
            const ascii = Array.from(chunk).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.').join('');
            rows.push(`<span class="offset">${hex(i, 8)}</span>  <span class="hex">${hexBytes.padEnd(47)}</span>  <span class="ascii">${this.esc(ascii)}</span>`);
        }

        let result = `<pre>${rows.join('\n')}</pre>`;
        if (truncated) {
            result += `\n<p class="truncated">Showing first ${MAX_HEX_BYTES} of ${data.length} bytes</p>`;
        }
        return result;
    }

    private fieldTable(rows: [string, string][]): string {
        const trs = rows.map(([name, value]) => `<tr><td>${name}</td><td>${value}</td></tr>`).join('\n');
        return `<table class="fields">\n${trs}\n</table>`;
    }

    private esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
