#!/usr/bin/env bash
# A Linux stand-in for the mail sandbox of the prototype (docs/mail-client.md › Verification), for
# machines without Docker such as cloud sessions: Dovecot IMAP on 127.0.0.1:10143 (CONDSTORE) and
# :10144 (IONOS-like, without CONDSTORE), any user with the password "testpass", each its own
# maildir; Mailpit SMTP on :1025 with its API on :8025. Loopback only, never a real mailbox.
#
#   scripts/linux-mail-sandbox.sh start          # install (apt, Mailpit from GitHub) and start
#   scripts/linux-mail-sandbox.sh run <command>  # run with a D-Bus session, an unlocked keyring
#                                                # and a virtual display (Electron's safeStorage)
#
# Then the sandbox suites (pnpm test:sandbox) and the mail e2e run as on the Windows machine:
#   scripts/linux-mail-sandbox.sh run npx playwright test tests/e2e/mail-client.spec.ts --trace off
#
# Needs root (apt, /run, /srv). Playwright starts Electron with --password-store=basic, which turns
# safeStorage off on Linux; `run` removes that switch from the local playwright-core copy.
set -euo pipefail

STATE=${MAIL_SANDBOX_DIR:-/srv/mailsandbox}
BIN=$STATE/bin

install() {
  local missing=()
  command -v dovecot >/dev/null || missing+=(dovecot-imapd)
  command -v gnome-keyring-daemon >/dev/null || missing+=(gnome-keyring)
  command -v dbus-run-session >/dev/null || missing+=(dbus-x11)
  command -v xvfb-run >/dev/null || missing+=(xvfb)
  if ((${#missing[@]})); then
    apt-get update -q >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}" >/dev/null
  fi
  id vmail >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin vmail
  mkdir -p "$BIN" "$STATE/mail"
  chown vmail:vmail "$STATE/mail"
  if [[ ! -x $BIN/mailpit ]]; then
    curl -sSL https://github.com/axllent/mailpit/releases/latest/download/mailpit-linux-amd64.tar.gz |
      tar xz -C "$BIN" mailpit
  fi
}

dovecot_conf() {
  local port=$1 capability=${2:-}
  cat <<EOF
base_dir = /run/dovecot$port
instance_name = dovecot$port
protocols = imap
listen = 127.0.0.1
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
log_path = $STATE/dovecot$port.log
mail_location = maildir:$STATE/mail/%u
mail_uid = vmail
mail_gid = vmail
first_valid_uid = 1
mail_max_userip_connections = 20
passdb {
  driver = static
  args = password=testpass
}
userdb {
  driver = static
  args = uid=vmail gid=vmail home=$STATE/mail/%u
}
service imap-login {
  inet_listener imap {
    address = 127.0.0.1
    port = $port
  }
}
namespace inbox {
  inbox = yes
  mailbox Sent {
    special_use = \\Sent
    auto = subscribe
  }
  mailbox Drafts {
    special_use = \\Drafts
    auto = subscribe
  }
  mailbox Trash {
    special_use = \\Trash
    auto = subscribe
  }
  mailbox Junk {
    special_use = \\Junk
    auto = subscribe
  }
}
$capability
EOF
}

start() {
  install
  pkill -x dovecot || true
  pkill -x mailpit || true
  for _ in $(seq 20); do pgrep -x dovecot >/dev/null || break; sleep 0.5; done
  dovecot_conf 10143 >"$STATE/dovecot10143.conf"
  # The IONOS-like profile: the default capabilities without CONDSTORE/QRESYNC
  dovecot_conf 10144 'imap_capability = IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE SORT SORT=DISPLAY THREAD=REFERENCES THREAD=REFS THREAD=ORDEREDSUBJECT MULTIAPPEND URL-PARTIAL CATENATE UNSELECT CHILDREN NAMESPACE UIDPLUS LIST-EXTENDED I18NLEVEL=1 ESEARCH ESORT SEARCHRES WITHIN CONTEXT=SEARCH LIST-STATUS BINARY MOVE SNIPPET=FUZZY PREVIEW=FUZZY PREVIEW STATUS=SIZE SAVEDATE LITERAL+ NOTIFY SPECIAL-USE' >"$STATE/dovecot10144.conf"
  for port in 10143 10144; do
    mkdir -p "/run/dovecot$port"
    rm -f "/run/dovecot$port/master.pid"
    setsid dovecot -c "$STATE/dovecot$port.conf" </dev/null >/dev/null 2>&1
  done
  setsid "$BIN/mailpit" --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025 \
    --smtp-auth-accept-any --smtp-auth-allow-insecure </dev/null >"$STATE/mailpit.log" 2>&1 &
  sleep 2
  local down=0
  for port in 10143 10144 1025 8025; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "port $port up"; else
      echo "port $port DOWN"
      down=1
    fi
  done
  return $down
}

run() {
  # Playwright's Electron loader forces --password-store=basic (no safeStorage on Linux)
  local loader
  for loader in node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/lib/server/electron/loader.js; do
    [[ -f $loader ]] && sed -i 's|^  "--password-store=basic",$|  // linux-mail-sandbox.sh: keep the keyring|' "$loader"
  done
  export XDG_CURRENT_DESKTOP=GNOME
  # A keyring of its own, so one left by another tool with another password cannot block it
  export XDG_DATA_HOME=$STATE/xdg-data
  mkdir -p "$XDG_DATA_HOME"
  exec dbus-run-session -- bash -c \
    'echo -n sandbox | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1; exec xvfb-run -a "$@"' \
    _ "$@"
}

case ${1:-} in
  start) start ;;
  run)
    shift
    run "$@"
    ;;
  *)
    echo "usage: $0 start | run <command>" >&2
    exit 2
    ;;
esac
