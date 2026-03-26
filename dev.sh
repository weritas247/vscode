#!/usr/bin/env bash
set -e

export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"

# 이미 컴파일된 경우 preLaunch 스킵
if [ -d "out/vs" ]; then
	export VSCODE_SKIP_PRELAUNCH=1
fi

# watch가 안 돌고 있으면 백그라운드로 시작
if ! pgrep -f "gulp watch-client" > /dev/null 2>&1; then
	echo "Starting watch compilation..."
	npm run watch &
	WATCH_PID=$!

	# watch-client 초기 컴파일 완료 대기
	echo "Waiting for initial compilation..."
	while ! [ -f "out/vs/workbench/workbench.desktop.main.js" ]; do
		sleep 2
	done
	echo "Compilation ready."
fi

echo "Launching Code - OSS..."
./scripts/code.sh "$@"
