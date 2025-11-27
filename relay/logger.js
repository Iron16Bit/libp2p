import { createWriteStream } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logPath = join(__dirname, "relayserver.log");
const stream = createWriteStream(logPath, { flags: "a" });

function write(level, args) {
    const ts = new Date().toISOString();
    const message = Array.from(args)
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
    stream.write(`${ts} ${level} ${message}\n`);
}

export const logger = {
    info: (...args) => {
        write("INFO", args);
        console.log(...args);
    },
    warn: (...args) => {
        write("WARN", args);
        console.warn(...args);
    },
    error: (...args) => {
        write("ERROR", args);
        console.error(...args);
    },
    debug: (...args) => {
        write("DEBUG", args);
        console.debug(...args);
    },
};