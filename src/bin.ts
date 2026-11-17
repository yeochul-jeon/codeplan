// Entry point of the bundled codeplan.mjs.
import { main } from "./cli.js";

const result = main(process.argv.slice(2), () => process.cwd(), process.env);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
