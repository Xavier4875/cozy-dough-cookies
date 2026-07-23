// Runs DynamoDB Local directly via Java (not Docker) with a persistent
// -dbPath, so local dev data survives restarts — see
// setup-dynamodb-jar.js's comment for why this has to be the container-free
// version specifically. `java` usually isn't on PATH on Windows even when a
// JDK is installed, so this checks a few common install locations before
// falling back to a bare `java` (works if it does happen to be on PATH, and
// gives a clear error either way if it's missing entirely).
import { execSync, spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const dynamoDir = path.resolve(fileURLToPath(import.meta.url), '../../../dynamodb-local');
const jarPath = path.join(dynamoDir, 'DynamoDBLocal.jar');

if (!existsSync(jarPath)) {
  console.log('DynamoDBLocal.jar not found — running one-time setup first.');
  execSync('node scripts/setup-dynamodb-jar.js', { stdio: 'inherit', cwd: path.dirname(fileURLToPath(import.meta.url)) });
}

const CANDIDATE_JAVA_HOMES = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft\\jdk',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
].filter(Boolean);

function findJavaExe() {
  for (const home of CANDIDATE_JAVA_HOMES) {
    if (!existsSync(home)) continue;
    // JAVA_HOME points straight at a JDK; the others are install roots that
    // may contain several versioned JDK folders — check both shapes.
    const direct = path.join(home, 'bin', 'java.exe');
    if (existsSync(direct)) return direct;
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(home, entry.name, 'bin', 'java.exe');
      if (existsSync(nested)) return nested;
    }
  }
  return 'java'; // Last resort: hope it's on PATH.
}

const javaExe = findJavaExe();
console.log(`Starting DynamoDB Local on http://localhost:8000 (data persists in dynamodb-local/data)...`);
const child = spawn(javaExe, ['-jar', 'DynamoDBLocal.jar', '-dbPath', './data', '-sharedDb', '-port', '8000'], {
  cwd: dynamoDir,
  stdio: 'inherit',
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      `Couldn't find a Java runtime (tried "${javaExe}"). Install a JDK, or set JAVA_HOME to an existing one.`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
