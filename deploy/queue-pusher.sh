#!/bin/sh
set -eu
umask 077

ssh_dir=/tmp/ssh
repo_dir=/queue/repo
outbox=/queue/outbox
delivered=/queue/delivered
mkdir -p "$ssh_dir" "$outbox" "$delivered"
printf '%s' "$QUEUE_SSH_PRIVATE_KEY_B64" | base64 -d > "$ssh_dir/key"
chmod 600 "$ssh_dir/key"
printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$ssh_dir/known_hosts"
export GIT_SSH_COMMAND="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"

if [ ! -d "$repo_dir/.git" ]; then
  git clone --depth 1 --branch main "$QUEUE_GIT_REPOSITORY" "$repo_dir"
fi
git -C "$repo_dir" config user.name 'Hermes Provisioner'
git -C "$repo_dir" config user.email 'hermes-provisioner@users.noreply.github.com'

while true; do
  for pending in "$outbox"/*.json; do
    [ -f "$pending" ] || continue
    name=$(basename "$pending")
    git -C "$repo_dir" fetch --depth 1 origin main
    git -C "$repo_dir" reset --hard origin/main
    if [ -f "$repo_dir/requests/$name" ]; then
      mv "$pending" "$delivered/$name"
      printf '{"event":"already_delivered","request":"%s"}\n' "$name"
      continue
    fi
    mkdir -p "$repo_dir/requests"
    cp "$pending" "$repo_dir/requests/$name"
    git -C "$repo_dir" add -- "requests/$name"
    git -C "$repo_dir" commit -m "Queue tenant ${name%.json}"
    if git -C "$repo_dir" push origin HEAD:main; then
      mv "$pending" "$delivered/$name"
      printf '{"event":"delivered","request":"%s"}\n' "$name"
    else
      printf '{"event":"delivery_retry","request":"%s"}\n' "$name" >&2
    fi
  done
  sleep 2
done

