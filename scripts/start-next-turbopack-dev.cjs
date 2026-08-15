const { resolve } = require("node:path");
const { spawn } = require("node:child_process");

if (process.platform !== "win32") {
  const nextCli = resolve(__dirname, "../node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextCli, "dev", ...process.argv.slice(2)], {
    env: process.env,
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
  return;
}

function readOption(names) {
  const index = process.argv.findIndex((value) => names.includes(value));
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(readOption(["-p", "--port"]) ?? process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Pass a valid port with -p or --port.");
}

// Next 16 normally starts dev mode through ChildProcess.fork. On this Windows
// host Node can reject that fork with EPERM even though ordinary child-process
// spawning works. Start the same Next dev server entry point in-process while
// preserving Turbopack and the standard configuration path.
process.env.TURBOPACK ??= "1";
process.env.__NEXT_DEV_SERVER ??= "1";
process.env.NEXT_PRIVATE_START_TIME ??= String(Date.now());

const webRoot = process.cwd();
const { startServer } = require(resolve(webRoot, "../../node_modules/next/dist/server/lib/start-server"));

startServer({
  dir: webRoot,
  port,
  allowRetry: false,
  isDev: true,
  hostname: readOption(["-H", "--hostname"]),
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
