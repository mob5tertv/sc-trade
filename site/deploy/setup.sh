#!/usr/bin/env bash
#
# SC Trade - sets up the server of the site: Ubuntu 24.04 LTS, run by the owner of the server, as root, from the
# folder it came in (site/dist-deploy, made by "npm run site:build" and copied to the server whole).
#
#   sudo bash setup.sh                     sets everything up; run again, it changes nothing that is in place
#   sudo bash setup.sh --dry-run           only prints what it would do: starts no program, changes nothing
#   sudo bash setup.sh --reset-password    asks for a new password of the admin page (/admin/)
#   sudo bash setup.sh --deploy-key FILE   the public key the upload user logs in with
#                                          (without it: the keys you log in with yourself)
#
# What it does, step by step - each step says what it is doing:
#   1. installs caddy, nodejs, ufw and logrotate from the repositories of Ubuntu itself;
#   2. makes two users: one the service runs as (it cannot log in), one that uploads the files of the site;
#   3. makes the folders: the site, the data of the service, its settings, the log of the web server;
#   4. puts the code of the service in place (it comes in this folder, with what it needs: nothing is downloaded);
#   5. asks for the password of the admin page, twice, showing nothing, and writes its hash into the settings;
#   6. asks Caddy whether the new Caddyfile is good, and only then puts it in place;
#   7. turns the firewall on: SSH, 80 and 443 come in, nothing else - and only once the rule for SSH is there;
#   8. starts the service.
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

dry_run=false
reset_password=false
deploy_key=''
typed_password=''

# ---- saying things, and doing them

say() {
  printf '\n==> %s\n' "$*"
}

note() {
  printf '    %s\n' "$*"
}

fail() {
  printf '\nSTOPPED: %s\n' "$*" >&2
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

usage() {
  printf '%s\n' 'Sets up the server of the SC Trade site (Ubuntu 24.04 LTS). Run it as root, from the folder it came in:'
  printf '%s\n' ''
  printf '%s\n' '  sudo bash setup.sh                     sets everything up; safe to run again'
  printf '%s\n' '  sudo bash setup.sh --dry-run           only prints what it would do'
  printf '%s\n' '  sudo bash setup.sh --reset-password    asks for a new password of the admin page'
  printf '%s\n' '  sudo bash setup.sh --deploy-key FILE   the public key the upload user logs in with'
  printf '%s\n' ''
  printf '%s\n' 'The password is typed on the keyboard when the script asks for it. It is never an argument.'
}

# ---- small questions about a text; each looks only at what it is given and starts nothing

valid_domain() {
  local shape='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  [[ $1 =~ $shape ]]
}

valid_root() {
  local shape='^(/[A-Za-z0-9._-]+)+$'
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

# The ports SSH comes in through, one a line, each once: 22, every "port N" of what "sshd -T" printed ($1), and the
# port of the session this script runs in ($2: the value of SSH_CONNECTION).
ssh_ports() {
  local seen=' ' word value rest
  local number='^[0-9]{1,5}$' session='^[^ ]+ [0-9]+ [^ ]+ ([0-9]{1,5})$'
  local -a ports=(22)
  while read -r word value rest; do
    if [[ ${word,,} == port && $value =~ $number && -z $rest ]]; then
      ports+=("$value")
    fi
  done <<< "$1"
  if [[ $2 =~ $session ]]; then
    ports+=("${BASH_REMATCH[1]}")
  fi
  for value in "${ports[@]}"; do
    if [[ $seen != *" $value "* ]]; then
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

# ---- the steps

on_error() {
  printf '\nSTOPPED: a command failed (line %s of setup.sh; what it said is above). What was done before it stays done, nothing after it was done. Put the cause right and start the script again: it is safe to run twice.\n' "$1" >&2
}

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
  run apt-get update
  if ! run env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy nodejs ufw logrotate; then
    fail 'the packages were not installed (what apt said is above). If it could not find "caddy" or "nodejs": they live in the "universe" part of the repositories of Ubuntu - see that it is on, and start this script again.'
  fi
  if $dry_run; then
    return 0
  fi
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  if ((major < 18)); then
    fail "the service needs Node 18 or newer, and this server has Node $major"
  fi
  note "Node $major"
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
  local given=$deploy_key admin=${SUDO_USER:-root}
  if $dry_run; then
    note "would give the user $DEPLOY_USER the public keys of ${given:-the authorized_keys of $admin} (keys that are already there stay)"
    return 0
  fi
  if [[ -z $given ]]; then
    given=$(home_of "$admin")/.ssh/authorized_keys
  fi
  if [[ ! -r $given ]]; then
    fail "no public key for the user $DEPLOY_USER: $given cannot be read. Copy the public half of your key (id_ed25519.pub) to the server and name it: --deploy-key FILE"
  fi
  local home keys line added=0 plain=0
  home=$(home_of "$DEPLOY_USER")
  # root writes into a folder that belongs to another user: never through a link that user could have put there
  if [[ -L $home/.ssh || -L $home/.ssh/authorized_keys ]]; then
    fail "$home/.ssh or the authorized_keys in it is a symbolic link: this script does not write through one. Remove the link and start again."
  fi
  run install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
  keys=$(mktemp)
  if [[ -f $home/.ssh/authorized_keys ]]; then
    cat "$home/.ssh/authorized_keys" > "$keys"
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    if is_plain_key "$line" && ! grep -qxF -- "$line" "$keys"; then
      printf '%s\n' "$line" >> "$keys"
      added=$((added + 1))
    fi
  done < "$given"
  while IFS= read -r line || [[ -n $line ]]; do
    if is_plain_key "$line"; then
      plain=$((plain + 1))
    fi
  done < "$keys"
  if ((plain == 0)); then
    rm -f "$keys"
    fail "no public key for the user $DEPLOY_USER: $given holds no plain key (a line with options in front is not taken). Name a file with your public key: --deploy-key FILE"
  fi
  run install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$keys" "$home/.ssh/authorized_keys"
  rm -f "$keys"
  note "keys of $DEPLOY_USER: $plain, of them new: $added (from $given)"
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
}

# Asks for the password on the keyboard, twice, showing nothing; leaves it in typed_password.
ask_password() {
  local first second try
  if [[ ! -r /dev/tty ]]; then
    fail 'the password is typed on the keyboard, and this run has no terminal: log in with ssh and start the script there'
  fi
  for try in 1 2 3; do
    IFS= read -rs -p '    The password of the admin page (12 characters or more; nothing is shown while you type): ' first < /dev/tty
    printf '\n'
    IFS= read -rs -p '    Once more: ' second < /dev/tty
    printf '\n'
    if [[ $first != "$second" ]]; then
      printf '    The two are not the same. Again.\n'
    elif ((${#first} < 12)); then
      printf '    Too short: 12 characters or more. Again.\n'
    else
      typed_password=$first
      return 0
    fi
  done
  fail 'no password after three tries; nothing was changed in this step'
}

settings() {
  say '5/8 The settings of the service and the password of the admin page'
  if [[ -f $CONFIG_FILE ]] && ! $reset_password; then
    note "$CONFIG_FILE is there: left as it is (a new password: sudo bash setup.sh --reset-password)"
  elif $dry_run; then
    note "would ask for the password of the admin page (twice, nothing is shown) and write its hash into $CONFIG_FILE"
    note 'the password itself would reach the program that makes the hash on its input: never as an argument, never into a file'
  else
    ask_password
    if [[ -f $CONFIG_FILE ]]; then
      printf '%s' "$typed_password" | node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --reset-password
    else
      printf '%s' "$typed_password" | node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --domain "$domain" --port "$port" --data "$DATA_DIR"
    fi
    unset typed_password
    note "the hash of the password is in $CONFIG_FILE"
  fi
  run chown root:"$SERVICE_USER" "$CONFIG_FILE"
  run chmod 0640 "$CONFIG_FILE"
  if $dry_run; then
    return 0
  fi
  # whole, and for this very site? The service would not start with settings that are not.
  if ! node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --verify --domain "$domain" --port "$port"; then
    fail "the settings in $CONFIG_FILE do not fit (what is wrong is said above). Put it right in that file and start this script again."
  fi
}

web_server() {
  say '6/8 The web server (Caddy)'
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

firewall() {
  say '7/8 The firewall (ufw): SSH, 80 and 443 come in, nothing else does'
  local port added=''
  local -a ports=(22)
  if ! $dry_run; then
    # every port SSH comes in through: what the SSH server says it listens on, and the port of this very session
    mapfile -t ports < <(ssh_ports "$(sshd -T 2> /dev/null || true)" "${SSH_CONNECTION:-}")
    if ((${#ports[@]} == 0)); then
      fail 'could not tell which port SSH comes in through, so the firewall is NOT touched. Nothing is shut.'
    fi
  fi
  run ufw default deny incoming
  run ufw default allow outgoing
  for port in "${ports[@]}"; do
    run ufw allow "$port/tcp"
  done
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw allow 443/udp
  if ! $dry_run; then
    # the firewall is turned on only when ufw itself lists the rule for SSH: a firewall without it would shut
    # the owner of the server out
    added=$(ufw show added)
    for port in "${ports[@]}"; do
      if ! rule_is_added "$added" "$port"; then
        fail "ufw does not list a rule that lets SSH in on port $port, so the firewall is NOT turned on. Nothing is shut. Look at what 'ufw show added' prints: once 'ufw allow $port/tcp' is among its lines, start this script again."
      fi
    done
  fi
  run ufw --force enable
  run ufw status verbose
}

service() {
  say '8/8 The service'
  run install -m 0644 -o root -g root "$here/$SERVICE.service" "$UNIT_FILE"
  run systemctl daemon-reload
  run systemctl enable "$SERVICE"
  run systemctl restart "$SERVICE"
  if $dry_run; then
    return 0
  fi
  sleep 3
  if systemctl is-active --quiet "$SERVICE"; then
    note 'the service runs'
  else
    systemctl --no-pager --lines=20 status "$SERVICE" || true
    fail "the service did not start. Why: journalctl -u $SERVICE -n 50"
  fi
}

closing_words() {
  if $dry_run; then
    printf '\n%s\n' 'dry run: nothing is changed, no program was started. Without --dry-run the same steps are done for real.'
    return 0
  fi
  printf '\n%s\n' 'Done. Check now - site/DEPLOY.md says how, step by step:'
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
  printf '\n%s\n' 'NOT done by this script: the settings of the SSH server are exactly as they were. Worth doing by hand,'
  printf '%s\n' 'once you have seen in a second window that you log in with your key (site/DEPLOY.md says how):'
  note 'PasswordAuthentication no'
  note 'PermitRootLogin prohibit-password'
  note 'in a file of your own under /etc/ssh/sshd_config.d/'
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
    fail 'run it as root: sudo bash setup.sh (or look first at what it would do: bash setup.sh --dry-run)'
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
    printf '%s\n' 'dry run: nothing is changed, no program is started. Each "would run" line is a command the real run starts.'
    printf '%s\n' '(A dry run sees the files that are there now, not what the steps before it would have made, and it does'
    printf '%s\n' 'not ask the system which users there are: a user that is there already is not made again by the real run.)'
  else
    # the programs of the system, wherever this was started from
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  fi
  note "the site: $domain, served from $root; the service on 127.0.0.1:$port"

  packages
  users
  folders
  code
  settings
  web_server
  firewall
  service
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
