#!/usr/bin/env bash
# Starts the Phoenix backend for load testing with the out-of-band probe
# preloaded. The backend source and configuration are untouched; only the
# probe module (-r) and its own PROBE_* variables are added.
#
# The --require path is kept relative: the repo path contains a space, and
# NODE_OPTIONS is split on whitespace, so an absolute path cannot be passed.
set -e
cd "$(dirname "$0")/../../backend"
export PROBE_APP_DIR="$PWD"
export PROBE_PORT="${PROBE_PORT:-9999}"
export NODE_OPTIONS="--require ../load-tests/instrument/probe.js"
exec node src/server.js
