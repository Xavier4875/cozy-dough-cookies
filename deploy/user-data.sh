#!/bin/bash
# First-boot setup for the Cozy Dough EC2 instance (Ubuntu 24.04). Runs once as
# root via cloud-init. Contains no secrets. Output: /var/log/cloud-init-output.log
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker

# AWS CLI — used by the deploy step to pull the bundle from S3 with the
# instance role. (Ubuntu 24.04 has no apt package for it.)
snap install aws-cli --classic

# 1 GB of swap as a safety net on a 2 GB machine (image builds, traffic spikes).
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/cozy-dough
touch /var/log/cozy-bootstrap-done
