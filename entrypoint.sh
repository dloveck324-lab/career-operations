#!/bin/sh
# Set up symlinks from app dirs to Render persistent disk before starting server.
# The persistent disk is mounted at /app/persistent.
mkdir -p /app/persistent/data /app/persistent/config

# Only create symlinks if the targets aren't already symlinks
if [ ! -L /app/data ]; then
  rm -rf /app/data
  ln -s /app/persistent/data /app/data
fi
if [ ! -L /app/config ]; then
  rm -rf /app/config
  ln -s /app/persistent/config /app/config
fi

exec "$@"
