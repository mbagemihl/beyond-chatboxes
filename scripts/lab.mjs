#!/usr/bin/env node
// lab.mjs — every workshop command, on Windows, macOS and Linux alike.
//
//   Windows (PowerShell or cmd):  .\lab doctor
//   macOS / Linux:                ./lab doctor
//   anywhere:                     node scripts/lab.mjs doctor
//
// Only Node (22+, required for the workshop anyway) and git are needed: no
// make, no bash. `lab help` lists the commands.
import { CHECKPOINTS, checkpointId, printBanner, solve, step, verify } from './lab/checkpoints.mjs';
import { doctor } from './lab/doctor.mjs';
import { downloadAll } from './lab/downloads.mjs';
import { backend, backendJar, frontend, measure } from './lab/backend.mjs';
import { fetchJre, findJava } from './lab/java.mjs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAB, LabError, c, die } from './lab/util.mjs';

const HELP = `${c.bold('Beyond the Chatbox — workshop commands')}

  ${LAB} doctor              Check this machine is ready (run this first)
  ${LAB} step <1|2|3>        Start an act: 1 still image, 2 live camera, 3 race
  ${LAB} bonus <search|ocr>  Start a bonus track
  ${LAB} verify <id>         Am I done? Runs only that checkpoint's tests
  ${LAB} solve <id>          Show me the answer (your attempt is backed up first)

  ${LAB} backend             Act 1: run the pose backend (Java 21+)
  ${LAB} frontend            Run the app on http://localhost:4200
  ${LAB} measure             Act 1: time 20 requests against the backend

  ${LAB} download            Fetch and verify every model (setup time)
  ${LAB} jre                 Fetch a portable Java 21 (only if you have no Java 21+)
  ${LAB} backend-jar         Maintainers: build backend/dist/backend.jar

Options:
  --port <n>       Backend port for backend, frontend, measure and doctor
                   (default 8080, or BACKEND_PORT). Use 9099 if 8080 is taken.
  --backend-url <u> frontend: proxy /api to another machine's backend
  --platform <p>   jre: another machine's runtime (${['mac-aarch64', 'mac-x64', 'linux-x64', 'linux-aarch64', 'win-x64', 'win-aarch64'].join(', ')})
  --dir <path>     jre: where to unpack it (default .tools/jre)

<id> is 1, 2, 3, bonus-search or bonus-ocr. Make-style names work too
(step-1, verify-bonus-search).`;

/** Split argv into a command, positional arguments and --flags. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=', 2);
      flags[key] = inline ?? argv[++i];
    } else {
      positional.push(a);
    }
  }
  let [command = 'help', ...rest] = positional;
  // Make-style names: step-1, verify-2, solve-bonus-ocr, bonus-search.
  const m = /^(step|verify|solve|bonus)-(.+)$/.exec(command);
  if (m) {
    command = m[1];
    rest = [m[2], ...rest];
  }
  return { command, args: rest, flags };
}

function portOf(flags) {
  const port = Number(flags.port ?? process.env.BACKEND_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die(`not a port: ${flags.port}`);
  return port;
}

async function main(argv) {
  const { command, args, flags } = parseArgs(argv);
  switch (command) {
    case 'doctor':
      return doctor({ port: portOf(flags) });
    case 'step':
      step(checkpointId(args[0]));
      return 0;
    case 'bonus':
      step(checkpointId(args[0], { bonus: true }));
      return 0;
    case 'verify':
      return verify(checkpointId(args[0]));
    case 'solve':
      solve(checkpointId(args[0]));
      return 0;
    case 'banner': // internal: `step` runs the checked-out checkpoint's own banner
      printBanner(checkpointId(args[0]));
      return 0;
    case 'backend':
      return backend({ port: portOf(flags) });
    case 'backend-jar':
      return backendJar();
    case 'frontend':
      return frontend({
        port: portOf(flags),
        backendUrl: flags['backend-url'] ?? process.env.BACKEND_URL,
      });
    case 'measure':
      return measure({ port: portOf(flags) });
    case 'download':
      return downloadAll();
    case 'jre':
      await fetchJre({
        platform: flags.platform ?? process.env.JRE_PLATFORM,
        dir: flags.dir ?? process.env.JRE_DIR,
      });
      return 0;
    case 'java-home': {
      // internal: JAVA_HOME for the Makefile's Gradle targets
      const java = findJava();
      if (!java) return 1;
      console.log(dirname(dirname(java.bin)));
      return 0;
    }
    case 'help':
    case '-h':
    case '--help':
      console.log(HELP);
      return 0;
    default:
      die(`unknown command '${command}'. Run: ${LAB} help`);
  }
}

// Exported for the tests; only run when started as a program.
export { CHECKPOINTS };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      if (err instanceof LabError) {
        console.error(`${c.amber('error:')} ${err.message}`);
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}
