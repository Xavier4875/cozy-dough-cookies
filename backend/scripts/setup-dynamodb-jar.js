// One-time bootstrap for backend/scripts/start-dynamodb-local.js: pulls
// DynamoDBLocal.jar + its native SQLite bindings (DynamoDBLocal_lib) out of
// the official amazon/dynamodb-local Docker image, so local dev can run
// DynamoDB Local directly via Java instead of inside Docker. Running it
// directly (not containerized) is what makes -dbPath persistence actually
// work here — the containerized version's native SQLite binding can't open
// its db file against Docker Desktop's volume backend on this machine, in
// -inMemory or -dbPath, bind mount or named volume, tried all four. Reusing
// the image (already pulled for docker-compose.yml) avoids a second
// download from AWS and guarantees the exact same DynamoDB Local version
// (3.3.0) already verified working.
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const dynamoDir = path.resolve(fileURLToPath(import.meta.url), '../../../dynamodb-local');
const jarPath = path.join(dynamoDir, 'DynamoDBLocal.jar');
const libPath = path.join(dynamoDir, 'DynamoDBLocal_lib');

if (existsSync(jarPath) && existsSync(libPath)) {
  console.log('DynamoDBLocal.jar already present — skipping.');
  process.exit(0);
}

console.log('Extracting DynamoDBLocal.jar from amazon/dynamodb-local:latest...');
const tmpContainer = 'dynamodb-extract-tmp';
try {
  execSync('docker pull amazon/dynamodb-local:latest', { stdio: 'inherit' });
  execSync(`docker create --name ${tmpContainer} amazon/dynamodb-local:latest`, { stdio: 'inherit' });
  execSync(`docker cp ${tmpContainer}:/home/dynamodblocal/DynamoDBLocal.jar "${jarPath}"`, { stdio: 'inherit' });
  execSync(`docker cp ${tmpContainer}:/home/dynamodblocal/DynamoDBLocal_lib "${libPath}"`, { stdio: 'inherit' });
  console.log('Done.');
} finally {
  try {
    execSync(`docker rm ${tmpContainer}`, { stdio: 'ignore' });
  } catch {
    // Container was never created (an earlier step failed first) — nothing to clean up.
  }
}
