import { EXEFile, HTMLRenderer } from "./index.ts";

const FILE_PATH = "/home/drazisil/mco-source/MCity/MCity_d.exe";

const exe = new EXEFile(FILE_PATH)
// console.log(`loaded ${exe.sizeOnDisk} from ${exe.filePath}`)
// console.log(`file sig: ${exe.fileSignature}`)
// console.log(`signature located at ${exe.peStartOffset}`)
// console.log(`File is for machineType ${exe.machineType}`)
const renderer = new HTMLRenderer(exe)
console.log(renderer.render())
