#!/bin/bash
# Reach the RPC of the Chains testnet nodes on a server (they listen on the server's 127.0.0.1 only) through one
# SSH connection, and keep a copy of each node's RPC cookie here (the cookie changes when a node restarts; the
# explorer backend reads the file again after a 401).
#
#   chains/tunnel.sh            run in the foreground (Ctrl-C stops it)
#   SERVER=root@host LOCAL_BIND=0.0.0.0 chains/tunnel.sh
#
# Local ports: 4 + the node's RPC port without its first digit, e.g. Chains 19554 -> 49554 (see PORTS below).
# LOCAL_BIND=0.0.0.0 lets the Docker containers reach them through the host gateway (host.docker.internal).
set -u
cd "$(dirname "$0")"
SERVER=${SERVER:-root@144.202.17.53}
SSH_PORT=${SSH_PORT:-22}
LOCAL_BIND=${LOCAL_BIND:-127.0.0.1}
COOKIES=${COOKIES:-$PWD/cookies}
declare -A PORTS=([chains]=19554 [thunder]=19754 [bitnames]=19954 [bitassets]=19354 [zside]=19454 [hivemind]=19854 [fastblocks]=19154)

mkdir -p "$COOKIES"
chmod 700 "$COOKIES"

sync_cookies() {
  for name in "${!PORTS[@]}"; do
    local remote="/opt/chains/data/$name/testnet/.cookie"
    local tmp="$COOKIES/.$name.tmp"
    if ssh -o BatchMode=yes -p "$SSH_PORT" "$SERVER" "cat $remote" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
      if ! cmp -s "$tmp" "$COOKIES/$name.cookie"; then
        mv "$tmp" "$COOKIES/$name.cookie"
        chmod 644 "$COOKIES/$name.cookie"   # read by the containers' user
        echo "$(date +%T) cookie for $name updated"
      else
        rm -f "$tmp"
      fi
    else
      rm -f "$tmp"
    fi
  done
}

forwards=()
for name in "${!PORTS[@]}"; do
  p=${PORTS[$name]}
  forwards+=(-L "$LOCAL_BIND:4${p:1}:127.0.0.1:$p")
done

sync_cookies
( while sleep 60; do sync_cookies; done ) &
SYNC_PID=$!
trap 'kill $SYNC_PID 2>/dev/null' EXIT

while true; do
  echo "$(date +%T) tunnel to $SERVER: ${forwards[*]}"
  ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -p "$SSH_PORT" -N "${forwards[@]}" "$SERVER" < /dev/null
  echo "$(date +%T) tunnel down, again in 5 s"
  sleep 5
done
