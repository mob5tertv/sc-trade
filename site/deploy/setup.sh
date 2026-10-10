#!/usr/bin/env bash
#
# SC Trade - sets up the server of the site: Ubuntu 24.04 LTS, run by the owner of the server, as root, from the
# folder it came in (site/dist-deploy, made by "npm run site:build" and copied to the server whole).
#
#   sudo bash setup.sh                     sets everything up; safe to run again
#   sudo bash setup.sh --dry-run           only prints what it would do: changes nothing
#   sudo bash setup.sh --reset-password    a new password of the admin page (/admin/) and the restart of the
#                                          service that makes it count - nothing else
#   sudo bash setup.sh --deploy-key FILE   the public key the upload user logs in with
#                                          (without it: the keys you log in with yourself)
#
# SSH on another port than 22? "sudo" hides from the script which port your session came in through. Tell it:
#   sudo --preserve-env=SSH_CONNECTION bash setup.sh
#
# What it does, step by step - each step says what it is doing:
#   1. installs caddy, nodejs, ufw and logrotate from the repositories of Ubuntu itself, and upgrades nothing;
#   2. makes two users: one the service runs as (it cannot log in), one that uploads the files of the site;
#   3. makes the folders: the site, the data of the service, its settings, the log of the web server;
#   4. puts the code of the service in place (it comes in this folder, with what it needs: nothing is downloaded);
#   5. asks for the password of the admin page, twice, showing nothing, and writes its hash into the settings;
#   6. turns the firewall on: SSH, 80 and 443 come in, nothing else. The ports of SSH are the ones this system
#      itself names; the firewall is turned on only once ufw lists a rule for each of them - and is not touched at
#      all when the system names no port;
#   7. starts the service and waits until it answers on this machine;
#   8. asks Caddy whether the new Caddyfile is good, and only then puts it in place. This step is the last one
#      because it is the one most likely to stop on a server nobody has tried it on: when it does, the firewall is
#      already on and the service already runs.
#
# Run again, it installs nothing that is installed, makes no user and no folder that is there and asks for no
# password. It does put the code of the service in place anew, restart the service and make Caddy read its file.
#
# Whenever it stops, it says in one line what this run has done and what it has not.
#
# What it never does: it does not change the settings of the SSH server; it downloads no script and runs none from
# the internet; it takes no password from the command line, shows none and writes none anywhere.
#
# Nobody has run this script before you: it was written and read, not tried on a server. Start with --dry-run.

set -Eeuo pipefail
set +x
umask 022

readonly SERVICE=sc-trade-site
readonly SERVICE_USER=sc-trade-site
readonly DEPLOY_USER=deploy
readonly CODE_DIR=/opt/sc-trade-site
readonly DATA_DIR=/var/lib/sc-trade-site
readonly CONFIG_DIR=/etc/sc-trade-site
readonly CONFIG_FILE=/etc/sc-trade-site/config.json
readonly CADDYFILE=/etc/caddy/Caddyfile
readonly CADDY_LOG_DIR=/var/log/caddy
readonly CADDY_LOG=/var/log/caddy/sc-trade-error.log
readonly LOGROTATE_FILE=/etc/logrotate.d/sc-trade-site
readonly UNIT_FILE=/etc/systemd/system/sc-trade-site.service
# the steps of the set-up, in the order they are done
readonly STEPS=(packages users folders code settings firewall service 'web server')

dry_run=false
reset_password=false
deploy_key=''
typed_password=''
# has the work on the server begun? Before that a stop has nothing to say about the state of the server
started=false
# the steps this run has finished
steps_done=()
# why the firewall was left alone, when it was; said in its step and once more at the end
firewall_left=''
# --reset-password: is the hash of the new password in the settings already?
password_written=false

# ---- saying things, and doing them

say() {
  printf '\n==> %s\n' "$*"
}

note() {
  printf '    %s\n' "$*"
}

# The state of the server in one line, for a stop after the work has begun: what this run has done, what it has
# not, and that the script can be started again.
server_now() {
  local step one found did='' left=''
  if ! $started; then
    return 0
  fi
  if $reset_password; then
    if $password_written; then
      printf 'The server now: the hash of the new password is in the settings, and the service has not come up with it. Running the script again is safe.\n'
    else
      printf 'The server now: as it was, the password of the admin page is the old one. Running the script again is safe.\n'
    fi
    return 0
  fi
  for step in "${STEPS[@]}"; do
    found=false
    for one in "${steps_done[@]}"; do
      if [[ $one == "$step" ]]; then
        found=true
      fi
    done
    if $found; then
      did+="${did:+, }$step"
    else
      left+="${left:+, }$step"
    fi
  done
  if [[ -z $did ]]; then
    printf 'The server now: nothing of the set-up was done by this run. Running the script again is safe.\n'
  elif [[ -z $left ]]; then
    printf 'The server now: this run has done every step. Running the script again is safe: what is done is not undone.\n'
  else
    printf 'The server now: this run has done: %s; not done: %s. Running the script again is safe: what is done is not undone.\n' "$did" "$left"
  fi
}

fail() {
  printf '\nSTOPPED: %s\n' "$*" >&2
  server_now >&2
  exit 1
}

# Starts a program - or, with --dry-run, only prints what would be started. Everything this script changes on the
# server, it changes through here.
run() {
  if $dry_run; then
    printf '    would run:'
  else
    printf '    +'
  fi
  printf ' %q' "$@"
  printf '\n'
  if $dry_run; then
    return 0
  fi
  "$@"
}

# A command has failed (the ERR trap). Says in which step and on which line of the script - the line of the step
# itself, not the line of "run", through which nearly every command is started.
on_error() {
  local line=$1 where=${FUNCNAME[1]:-main}
  # inside "$( ... )" nothing is said: the line that waits for the answer fails next, and speaks for both
  if ((BASH_SUBSHELL > 0)); then
    exit 1
  fi
  if [[ $where == run ]]; then
    where=${FUNCNAME[2]:-main}
    line=${BASH_LINENO[1]}
  fi
  printf '\nSTOPPED: a command failed in "%s" (line %s of the script; what it said is above).\n' "$where" "$line" >&2
  server_now >&2
  exit 1
}

usage() {
  printf '%s\n' 'Sets up the server of the SC Trade site (Ubuntu 24.04 LTS). Run it as root, from the folder it came in:'
  printf '%s\n' ''
  printf '%s\n' '  sudo bash setup.sh                     sets everything up; safe to run again'
  printf '%s\n' '  sudo bash setup.sh --dry-run           only prints what it would do'
  printf '%s\n' '  sudo bash setup.sh --reset-password    a new password of the admin page and the restart of the service, nothing else'
  printf '%s\n' '  sudo bash setup.sh --deploy-key FILE   the public key the upload user logs in with'
  printf '%s\n' ''
  printf '%s\n' 'SSH on another port than 22? Tell the script which port your session came in through:'
  printf '%s\n' '  sudo --preserve-env=SSH_CONNECTION bash setup.sh'
  printf '%s\n' ''
  printf '%s\n' 'The password is typed on the keyboard when the script asks for it. It is never an argument.'
}

# ---- small questions; each looks only at what it is given, starts no program and changes nothing

valid_domain() {
  local shape='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  [[ $1 =~ $shape ]]
}

# A full path of two levels or more: the site gets a folder of its own, never one that holds half the system.
valid_root() {
  local shape='^(/[A-Za-z0-9._-]+){2,}$'
  [[ $1 =~ $shape && $1 != *..* ]]
}

valid_port() {
  local shape='^[1-9][0-9]{3,4}$'
  [[ $1 =~ $shape ]] && ((10#$1 >= 1024 && 10#$1 <= 65535))
}

# The value of a "key=value" line of a file. $1: the file; $2: the key. Prints nothing when there is no such line.
conf_value() {
  local key value
  while IFS='=' read -r key value || [[ -n $key ]]; do
    if [[ $key == "$2" ]]; then
      printf '%s' "${value%$'\r'}"
      return 0
    fi
  done < "$1"
  return 0
}

# Is a line of an authorized_keys file a key and nothing else? A line that begins with options (command="...",
# from="...") is not taken: such options may forbid the very thing the upload user is for.
is_plain_key() {
  local shape='^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]{40,}=*( [^[:cntrl:]]*)?$'
  [[ $1 =~ $shape ]]
}

# The authorized_keys of the upload user as it must be after this run: every line of the file that is there ($1; it
# need not exist), each closed by a line break - also the last one, so that nothing is ever glued to it - and then
# every plain key of the given file ($2) that is not among them yet. Printed; nothing is written.
merge_keys() {
  local line have=$'\n'
  if [[ -f $1 ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      line=${line%$'\r'}
      printf '%s\n' "$line"
      have+="$line"$'\n'
    done < "$1"
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    if is_plain_key "$line" && [[ $have != *$'\n'"$line"$'\n'* ]]; then
      printf '%s\n' "$line"
      have+="$line"$'\n'
    fi
  done < "$2"
}

# The ports SSH comes in through, one a line, each once. Only what the system itself says is taken - no port is
# assumed, and no evidence means no port:
#   $1  what "sshd -T" printed: every "port N" of the settings of the SSH server;
#   $2  the value of SSH_CONNECTION: the port the session this script runs in came in through;
#   $3  what "systemctl show ssh.socket -p Listen" printed: a port set for the socket of systemd, which the
#       settings of the SSH server do not show;
#   $4  what "ss -Hltnp" printed: the sockets the SSH server really listens on (not the ones that only this
#       machine can reach).
ssh_ports() {
  local seen=' ' word value rest address line
  local number='^[0-9]{1,5}$' session='^[^ ]+ [0-9]+ [^ ]+ ([0-9]{1,5})$' stream=':([0-9]{1,5}) \(Stream\)'
  local -a found=()
  while read -r word value rest; do
    if [[ ${word,,} == port && $value =~ $number && -z $rest ]]; then
      found+=("$value")
    fi
  done <<< "$1"
  if [[ $2 =~ $session ]]; then
    found+=("${BASH_REMATCH[1]}")
  fi
  rest=$3
  while [[ $rest =~ $stream ]]; do
    found+=("${BASH_REMATCH[1]}")
    rest=${rest#*"${BASH_REMATCH[0]}"}
  done
  while read -r word value rest address line; do
    value=${address##*:}
    if [[ $line == *'("sshd",'* && $value =~ $number && $address != 127.* && $address != '[::1]:'* ]]; then
      found+=("$value")
    fi
  done <<< "$4"
  for value in "${found[@]}"; do
    value=$((10#$value))
    if ((value >= 1 && value <= 65535)) && [[ $seen != *" $value "* ]]; then
      seen+="$value "
      printf '%s\n' "$value"
    fi
  done
}

# Does what "ufw show added" printed ($1) hold a rule that lets a TCP port ($2) in?
rule_is_added() {
  local line
  if [[ -z $2 ]]; then
    return 1
  fi
  while IFS= read -r line; do
    if [[ $line == "ufw allow $2/tcp" || $line == "ufw allow $2/tcp comment "* ]]; then
      return 0
    fi
  done <<< "$1"
  return 1
}

# Does the service answer on this machine? $1: its port. Asked with nothing but bash: a request for /api/ on
# 127.0.0.1, and the first line of the answer must say 200. (This one question does open a connection - to this
# machine and nowhere else.)
service_answers() {
  local status=''
  if ! { exec 3<> "/dev/tcp/127.0.0.1/$1"; } 2> /dev/null; then
    return 1
  fi
  printf 'GET /api/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' >&3 || true
  IFS= read -r -t 5 status <&3 || true
  exec 3>&-
  [[ $status == 'HTTP/1.'[01]' 200'* ]]
}

# ---- the steps

user_exists() {
  if $dry_run; then
    return 1
  fi
  getent passwd "$1" > /dev/null
}

home_of() {
  getent passwd "$1" | cut -d: -f6
}

packages() {
  say '1/8 Packages of Ubuntu: caddy, nodejs, ufw, logrotate'
  # without a question on the way (a question would hang the run), keeping every settings file that is there, and
  # without the restart of other services that "needrestart" would do on its own after an install
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  if ! run env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold caddy nodejs ufw logrotate; then
    fail 'the packages were not installed (what apt said is above). If it could not find "caddy" or "nodejs": they live in the "universe" part of the repositories of Ubuntu - see that it is on, and start this script again.'
  fi
  if ! $dry_run; then
    local major
    major=$(node -p 'process.versions.node.split(".")[0]')
    if ((major < 18)); then
      fail "the service needs Node 18 or newer, and this server has Node $major"
    fi
    note "Node $major"
  fi
  steps_done+=(packages)
}

users() {
  say '2/8 Users: one for the service, one for the upload of the site'
  if user_exists "$SERVICE_USER"; then
    note "the user $SERVICE_USER is there"
  else
    run useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  if user_exists "$DEPLOY_USER"; then
    note "the user $DEPLOY_USER is there"
  else
    run useradd --create-home --user-group --shell /bin/bash "$DEPLOY_USER"
  fi

  # the keys of the upload user: the file named with --deploy-key, or the keys the one who runs this logs in with
  local given=$deploy_key admin=${SUDO_USER:-root} home keys line plain=0 before=0
  if $dry_run; then
    note "would give the user $DEPLOY_USER the public keys of ${given:-the authorized_keys of $admin} (keys that are already there stay)"
  else
    if [[ -z $given ]]; then
      given=$(home_of "$admin")/.ssh/authorized_keys
    fi
    if [[ ! -r $given ]]; then
      fail "no public key for the user $DEPLOY_USER: $given cannot be read. Copy the public half of your key (id_ed25519.pub) to the server and name it: sudo bash setup.sh --deploy-key FILE (site/DEPLOY.md, section 4.3, has the commands)"
    fi
    home=$(home_of "$DEPLOY_USER")
    # root writes into a folder that belongs to another user: never through a link that user could have put there
    if [[ -L $home/.ssh || -L $home/.ssh/authorized_keys ]]; then
      fail "$home/.ssh or the authorized_keys in it is a symbolic link: this script does not write through one. Remove the link and start again."
    fi
    run install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
    if [[ -f $home/.ssh/authorized_keys ]]; then
      while IFS= read -r line || [[ -n $line ]]; do
        if is_plain_key "${line%$'\r'}"; then
          before=$((before + 1))
        fi
      done < "$home/.ssh/authorized_keys"
    fi
    keys=$(mktemp)
    merge_keys "$home/.ssh/authorized_keys" "$given" > "$keys"
    while IFS= read -r line; do
      if is_plain_key "$line"; then
        plain=$((plain + 1))
      fi
    done < "$keys"
    if ((plain == 0)); then
      rm -f "$keys"
      fail "no public key for the user $DEPLOY_USER: $given holds no plain key (a line with options in front is not taken). Name a file with your public key: sudo bash setup.sh --deploy-key FILE (site/DEPLOY.md, section 4.3, has the commands)"
    fi
    run install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$keys" "$home/.ssh/authorized_keys"
    rm -f "$keys"
    note "keys of $DEPLOY_USER: $plain, of them new: $((plain - before)) (from $given)"
  fi
  steps_done+=(users)
}

folders() {
  say '3/8 Folders'
  # the site: the upload user writes, everybody reads (the web server among them)
  run install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$root"
  # the messages: the service and nobody else
  run install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  # the settings: root writes, the service reads
  run install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"
  # the error log of the web server; the file is made here, as the own file of Caddy, before anything of Caddy
  # opens it (opened first by root, it would belong to root and Caddy could not write to it) - and is given back
  # to Caddy if that has happened already
  run install -d -m 0750 -o caddy -g caddy "$CADDY_LOG_DIR"
  if [[ ! -e $CADDY_LOG ]]; then
    run install -m 0640 -o caddy -g caddy /dev/null "$CADDY_LOG"
  fi
  run chown caddy:caddy "$CADDY_LOG"
  run chmod 0640 "$CADDY_LOG"
  steps_done+=(folders)
}

code() {
  say '4/8 The code of the service: root owns it, the service only reads it'
  run rm -rf "$CODE_DIR.new"
  run cp -R "$here/server" "$CODE_DIR.new"
  run chown -R root:root "$CODE_DIR.new"
  run chmod -R u=rwX,go=rX "$CODE_DIR.new"
  run rm -rf "$CODE_DIR.old"
  if [[ -e $CODE_DIR ]]; then
    run mv "$CODE_DIR" "$CODE_DIR.old"
  fi
  run mv "$CODE_DIR.new" "$CODE_DIR"
  run rm -rf "$CODE_DIR.old"
  steps_done+=(code)
}

# Asks for the password on the keyboard, twice, showing nothing; leaves it in typed_password.
ask_password() {
  local first second try
  if [[ ! -r /dev/tty ]]; then
    fail 'the password is typed on the keyboard, and this run has no terminal: log in with ssh and start the script there'
  fi
  for try in 1 2 3; do
    IFS= read -rs -p '    The password of the admin page (16 characters or more; nothing is shown while you type): ' first < /dev/tty
    printf '\n'
    IFS= read -rs -p '    Once more: ' second < /dev/tty
    printf '\n'
    if [[ $first != "$second" ]]; then
      printf '    The two are not the same. Again.\n'
    elif ((${#first} < 16)); then
      printf '    Too short: 16 characters or more. Again.\n'
    else
      typed_password=$first
      return 0
    fi
  done
  fail 'no password after three tries; nothing was changed in this step'
}

settings() {
  say '5/8 The settings of the service and the password of the admin page'
  if [[ -f $CONFIG_FILE ]]; then
    note "$CONFIG_FILE is there: left as it is (a new password: sudo bash setup.sh --reset-password)"
  elif $dry_run; then
    note "would ask for the password of the admin page (twice, nothing is shown) and write its hash into $CONFIG_FILE"
    note 'the password itself would reach the program that makes the hash on its input: never as an argument, never into a file'
  else
    ask_password
    printf '%s' "$typed_password" | node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --domain "$domain" --port "$port" --data "$DATA_DIR" --root "$root"
    unset typed_password
    note "the hash of the password is in $CONFIG_FILE"
  fi
  run chown root:"$SERVICE_USER" "$CONFIG_FILE"
  run chmod 0640 "$CONFIG_FILE"
  if ! $dry_run; then
    # whole, and for this very site? The service would not start with settings that are not.
    if ! node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --verify --domain "$domain" --port "$port"; then
      fail "the settings in $CONFIG_FILE do not fit (what is wrong is said above). Put it right in that file and start this script again."
    fi
  fi
  steps_done+=(settings)
}

firewall() {
  say '6/8 The firewall (ufw): SSH, 80 and 443 come in, nothing else does'
  local port added=''
  local -a ports=()
  if $dry_run && ((EUID != 0)); then
    note 'this dry run is not root, and the system tells root more about the ports of SSH: to see the ports the real run'
    note 'will open, start the dry run the very way you will start the real one (with sudo)'
  fi
  # every port SSH comes in through, from what this system itself says, asked four ways: the settings of the SSH
  # server, the session this script runs in, the socket of systemd, the sockets the SSH server listens on. No port
  # is assumed: a firewall that is turned on without the real port of SSH open shuts the owner out of his server.
  mapfile -t ports < <(ssh_ports "$(sshd -T 2> /dev/null || true)" "${SSH_CONNECTION:-}" "$(systemctl show ssh.socket -p Listen 2> /dev/null || true)" "$(ss -Hltnp 2> /dev/null || true)")
  if ((${#ports[@]} == 0)); then
    firewall_left='the firewall is NOT touched: nothing on this system says which port SSH comes in through, and turned on without that port open it would shut you out. Nothing is shut. site/DEPLOY.md (section 4.3) says how to see the port; then start this script so that it is told of it: sudo --preserve-env=SSH_CONNECTION bash setup.sh'
    note "$firewall_left"
    return 0
  fi
  note "SSH stays open on: ${ports[*]}"
  for port in "${ports[@]}"; do
    run ufw allow "$port/tcp"
  done
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw allow 443/udp
  if $dry_run; then
    note 'would ask ufw which rules it has, and go on only if it lists the rule for every port of SSH'
  else
    # the rest is shut and the firewall turned on only when ufw itself lists the rule for every port of SSH
    added=$(ufw show added)
    for port in "${ports[@]}"; do
      if ! rule_is_added "$added" "$port"; then
        firewall_left="the firewall is NOT turned on: ufw does not list a rule that lets SSH in on port $port. Nothing is shut. Look at what 'ufw show added' prints: once 'ufw allow $port/tcp' is among its lines, start this script again."
        note "$firewall_left"
        return 0
      fi
    done
  fi
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw --force enable
  run ufw status verbose
  steps_done+=(firewall)
}

# Waits until the service answers on this machine: "systemd has started it" is not yet "it works".
await_service() {
  local try
  if $dry_run; then
    return 0
  fi
  for try in 1 2 3 4 5 6 7 8 9 10; do
    if service_answers "$port"; then
      note "the service answers on 127.0.0.1:$port"
      return 0
    fi
    sleep 1
  done
  systemctl --no-pager --lines=20 status "$SERVICE" || true
  fail "the service does not answer on 127.0.0.1:$port, ten seconds after it was started. Why: journalctl -u $SERVICE -n 50"
}

service() {
  say '7/8 The service'
  run install -m 0644 -o root -g root "$here/$SERVICE.service" "$UNIT_FILE"
  run systemctl daemon-reload
  run systemctl enable "$SERVICE"
  run systemctl restart "$SERVICE"
  await_service
  steps_done+=(service)
}

web_server() {
  say '8/8 The web server (Caddy)'
  # the error log of Caddy is kept for 30 days at the most: logrotate sees to it
  run install -m 0644 -o root -g root "$here/logrotate.conf" "$LOGROTATE_FILE"
  run install -m 0644 -o root -g root "$here/Caddyfile" "$CADDYFILE.new"
  if ! run caddy validate --config "$CADDYFILE.new" --adapter caddyfile; then
    run rm -f "$CADDYFILE.new"
    fail "Caddy does not take the new Caddyfile (what it said is above). The one that was in place is untouched: $CADDYFILE"
  fi
  if [[ -f $CADDYFILE ]]; then
    # the one that was there before this script ever ran is kept for good; the one before this run, until the next
    if [[ ! -e $CADDYFILE.before-sc-trade ]]; then
      run cp -p "$CADDYFILE" "$CADDYFILE.before-sc-trade"
    fi
    run cp -p "$CADDYFILE" "$CADDYFILE.previous"
  fi
  run mv "$CADDYFILE.new" "$CADDYFILE"
  run systemctl enable caddy
  if ! apply_caddyfile; then
    if [[ -f $CADDYFILE.previous ]]; then
      run cp -p "$CADDYFILE.previous" "$CADDYFILE"
      if ! apply_caddyfile; then
        note 'Caddy did not come back with the previous Caddyfile either'
      fi
      fail 'Caddy did not start with the new Caddyfile; the previous one is back in place. Why: journalctl -u caddy -n 50'
    fi
    fail 'Caddy did not start with the new Caddyfile. Why: journalctl -u caddy -n 50'
  fi
  steps_done+=('web server')
}

# Makes Caddy read the Caddyfile that is in place.
apply_caddyfile() {
  if $dry_run; then
    run systemctl reload caddy
  elif systemctl is-active --quiet caddy; then
    run systemctl reload caddy
  else
    run systemctl restart caddy
  fi
}

# --reset-password: a new password of the admin page, and the restart of the service that makes it count (the
# service reads its settings when it starts). Nothing else of the set-up is done or looked at.
new_password() {
  say 'A new password of the admin page; nothing else of the set-up is touched'
  local written=true
  if $dry_run; then
    note "would ask for the new password (twice, nothing is shown) and write its hash into $CONFIG_FILE"
  else
    if [[ ! -f $CONFIG_FILE || ! -f $CODE_DIR/src/configure.mjs ]]; then
      fail "there is nothing to give a new password to: $CONFIG_FILE or the code of the service in $CODE_DIR is not there. Set the server up first: sudo bash setup.sh"
    fi
    ask_password
    printf '%s' "$typed_password" | node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --reset-password || written=false
    unset typed_password
    if ! $written; then
      fail 'the new password was not written (what the program said is above)'
    fi
    password_written=true
    note "the hash of the new password is in $CONFIG_FILE"
  fi
  run chown root:"$SERVICE_USER" "$CONFIG_FILE"
  run chmod 0640 "$CONFIG_FILE"
  run systemctl restart "$SERVICE"
  await_service
  if $dry_run; then
    printf '\n%s\n' 'dry run: nothing is changed. Without --dry-run the same is done for real.'
  else
    printf '\n%s\n' 'Done. Every login to the admin page that was open is over: log in with the new password.'
  fi
}

closing_words() {
  local admin=${SUDO_USER:-root}
  if $dry_run; then
    printf '\n%s\n' 'dry run: nothing is changed. Without --dry-run the same steps are done for real.'
    if [[ -n $firewall_left ]]; then
      note "$firewall_left"
    fi
    return 0
  fi
  printf '\n%s\n' 'Done. Check now - site/DEPLOY.md, section 4.6, is the whole list, with what you must see. In short:'
  note "1. https://$domain/api/     answers {\"ok\":true}: the service is up and the certificate is there"
  note "2. https://$domain/admin/   asks for the password you have just typed"
  note "3. from your computer:  ssh $DEPLOY_USER@<this server>   logs in without asking for a password"
  note '4. upload the site from your computer:  npm run site:deploy -- --yes'
  note '5. send a message through the form of the site, find it in /admin/, download its file, delete it'
  printf '\n%s\n' 'Where things are:'
  note "the messages              $DATA_DIR"
  note "the settings              $CONFIG_FILE"
  note "the log of the service    journalctl -u $SERVICE"
  note "the error log of Caddy    $CADDY_LOG (kept for 30 days at the most)"
  note "the Caddyfile before      $CADDYFILE.before-sc-trade"
  if [[ -n $firewall_left ]]; then
    printf '\n%s\n' 'ATTENTION - one step was left out:'
    note "$firewall_left"
  fi
  printf '\n%s\n' 'NOT done by this script: the settings of the SSH server are exactly as they were.'
  printf '%s\n' 'Worth doing by hand, later: forbid the login with a password (site/DEPLOY.md, section 4.11, has every command).'
  printf '%s\n' 'Before you forbid it:'
  note "open a NEW window and log in as the administrator:  ssh $admin@<this server>"
  note 'It must let you in WITHOUT asking for a password: only then is it your key that lets you in.'
  note "A login as \"$DEPLOY_USER\" does not count: it tries the key of the upload user, and that user cannot repair the server."
  note 'Keep the window you are in now open until then: with passwords forbidden and no key of yours on the server,'
  note 'only the console of your hoster lets you back in.'
}

main() {
  while (($# > 0)); do
    case "$1" in
      --dry-run)
        dry_run=true
        ;;
      --reset-password)
        reset_password=true
        ;;
      --deploy-key)
        if (($# < 2)); then
          fail '--deploy-key needs the name of a file with a public key'
        fi
        deploy_key=$2
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        fail 'an argument this script does not know (--help lists them). The password is never given here: the script asks for it.'
        ;;
    esac
    shift
  done
  trap 'on_error "$LINENO"' ERR

  # the folder this script lies in holds everything it puts on the server
  local start=${BASH_SOURCE[0]%/*}
  if [[ $start == "${BASH_SOURCE[0]}" ]]; then
    start=.
  fi
  here=$(cd "$start" && pwd)
  local needed
  for needed in Caddyfile "$SERVICE.service" logrotate.conf site.conf server/src/main.mjs server/src/configure.mjs server/node_modules/busboy/package.json; do
    if [[ ! -f $here/$needed ]]; then
      fail "$needed is not next to this script: copy the whole folder site/dist-deploy to the server, as \"npm run site:build\" made it"
    fi
  done
  domain=$(conf_value "$here/site.conf" domain)
  root=$(conf_value "$here/site.conf" root)
  port=$(conf_value "$here/site.conf" port)
  if ! valid_domain "$domain" || ! valid_root "$root" || ! valid_port "$port"; then
    fail 'site.conf next to this script does not name the site (domain, root, port): build the folder again with "npm run site:build"'
  fi
  if [[ -n $deploy_key && ! -r $deploy_key ]]; then
    fail "--deploy-key: the file $deploy_key cannot be read"
  fi

  if ! $dry_run && ((EUID != 0)); then
    fail 'run it as root: sudo bash setup.sh (or look first at what it would do: sudo bash setup.sh --dry-run)'
  fi
  local system='' release=''
  if [[ -r /etc/os-release ]]; then
    system=$(conf_value /etc/os-release ID)
    release=$(conf_value /etc/os-release VERSION_ID)
    release=${release//\"/}
  fi
  if [[ $system != ubuntu || $release != 24.04 ]]; then
    if ! $dry_run; then
      fail "this script is written for Ubuntu 24.04 LTS and this is \"${system:-unknown} ${release:-}\": it would guess at names and paths here, so it does nothing"
    fi
    note "this is not Ubuntu 24.04 (${system:-unknown} ${release:-}): on such a system the script stops here unless it is a dry run"
  fi

  if $dry_run; then
    printf '%s\n' 'dry run: nothing is changed. Each "would run" line is a command the real run starts. A dry run itself starts'
    printf '%s\n' 'three programs, in the step of the firewall: they ask the system which ports SSH comes in through.'
    printf '%s\n' '(A dry run sees the files that are there now, not what the steps before it would have made, and it does'
    printf '%s\n' 'not ask the system which users there are: a user that is there already is not made again by the real run.)'
  else
    # the programs of the system, wherever this was started from
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    started=true
  fi
  note "the site: $domain, served from $root; the service on 127.0.0.1:$port"

  if $reset_password; then
    new_password
    return 0
  fi

  packages
  users
  folders
  code
  settings
  firewall
  service
  web_server
  closing_words
}

# Started as a program, it does its work. Read in by another script ("source"), it only offers its small questions.
if [[ -z ${BASH_SOURCE[0]:-} ]]; then
  printf 'Start it from its file: sudo bash setup.sh\n' >&2
  exit 1
fi
if [[ ${BASH_SOURCE[0]:-} == "$0" ]]; then
  main "$@"
fi
