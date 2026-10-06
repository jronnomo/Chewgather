#!/bin/bash
# Verifies the agents' GH_TOKEN without printing it. Run via: tokencheck (see README).
D=/Users/ggronnii/.paperclip/agent-git
export GH_CONFIG_DIR=$D/gh GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=$D/gitconfig GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false SSH_ASKPASS=/usr/bin/false VSCODE_GIT_IPC_HANDLE= PATH=$D/bin:/opt/homebrew/bin:/usr/bin:/bin
echo "login: $(gh api user -q .login 2>&1 | tail -1)"
echo "repos visible: $(curl -s -H "Authorization: Bearer $GH_TOKEN" 'https://api.github.com/user/repos?per_page=100' | jq -r 'if type=="array" then (map(.full_name)|join(", ")) else .message end')"
T=$(mktemp -d); cd $T; git clone -q --depth 1 https://github.com/jronnomo/Chewgather.git r; cd r
echo "Chewgather push:   $(git push origin HEAD:refs/heads/zz-token-check 2>&1 | grep -vE '^To |^remote: *$' | tail -1)"
echo "Chewgather delete: $(git push origin --delete zz-token-check 2>&1 | grep -vE '^To ' | tail -1)"
echo "PR read: $(gh pr list -R jronnomo/Chewgather --limit 1 --json number -q length 2>&1 | tail -1)"
H=$(curl -s -D - -o /dev/null -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/jronnomo/chewgather-legal/git/refs -X POST -d '{}' | grep -i '^HTTP' | tr -d '\r'); echo "chewgather-legal write probe (want 403/404): $H"
rm -rf $T
