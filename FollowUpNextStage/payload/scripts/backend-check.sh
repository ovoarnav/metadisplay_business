#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
node --version
npm ci
npm run build
npm test
