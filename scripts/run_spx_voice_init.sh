#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="${SPX_VOICE_INIT_WORKSPACE_DIR:-/workspace}"
OUTPUT_ROOT="${SPX_VOICE_INIT_OUTPUT_ROOT:-/generated}"
NGINX_OUTPUT_DIR="$OUTPUT_ROOT/nginx"
COTURN_OUTPUT_DIR="$OUTPUT_ROOT/coturn"
CERTS_DIR="${SPX_VOICE_INIT_CERTS_DIR:-/certs}"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/setup_common.sh"

SPX_VOICE_DEPLOY_PROJECT_DIR="$WORKSPACE_DIR"

mkdir -p "$NGINX_OUTPUT_DIR" "$COTURN_OUTPUT_DIR"

if [[ "${ENVIRONMENT:-local}" == "production" ]]; then
    spx_voice_validate_remote_runtime_env
    [[ -f "$CERTS_DIR/local.crt" ]] || spx_voice_fail "certs/local.crt not found"
    [[ -f "$CERTS_DIR/local.key" ]] || spx_voice_fail "certs/local.key not found"

    export TURN_EXTERNAL_IP="$SERVER_IP"
    spx_voice_render_remote_nginx_conf "$WORKSPACE_DIR" "$NGINX_OUTPUT_DIR/default.conf"
    spx_voice_render_remote_turn_conf "$WORKSPACE_DIR" "$COTURN_OUTPUT_DIR/turnserver.conf"
    spx_voice_success "SPX Voice init rendered remote nginx and coturn config"
    exit 0
fi

if [[ -n "${TURN_SECRET:-}" && -n "${TURN_HOST:-}" ]]; then
    export TURN_EXTERNAL_IP="$TURN_HOST"
    spx_voice_render_remote_turn_conf "$WORKSPACE_DIR" "$COTURN_OUTPUT_DIR/turnserver.conf"
    spx_voice_success "SPX Voice init rendered local TURN config"
    exit 0
fi

spx_voice_success "SPX Voice init no-op for current profile"
