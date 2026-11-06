#!/bin/sh
# linuxserver.io init hook: writes the invented test config on first start.
if [ ! -f /config/config.xml ]; then
  cp /seed/config.xml /config/config.xml
  chown abc:abc /config/config.xml
fi
