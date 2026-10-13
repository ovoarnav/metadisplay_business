// Writes private dev secrets, without printing them. Not account credentials.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { provisionBackend } from '../backend/provision.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend');
provisionBackend(root);
