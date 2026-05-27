import path from 'path';
import fs from 'fs';

export async function parseLocalProject(projectRoot) {
  const normalizedProjectRoot = projectRoot.replace(/\\/g, '/');
  const packageJsonPath = path.join(normalizedProjectRoot, 'package.json');
  const json = await fs.promises.readFile(packageJsonPath, 'utf8');
  return JSON.parse(json);
}
