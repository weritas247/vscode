#!/usr/bin/env bash
set -e

export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"

# 이미 컴파일된 경우 preLaunch 스킵
if [ -d "out/vs" ]; then
	export VSCODE_SKIP_PRELAUNCH=1
fi

# watch가 안 돌고 있으면 백그라운드로 시작
if ! pgrep -f "gulp watch-client" > /dev/null 2>&1; then
	WATCH_LOG=$(mktemp /tmp/vscode-watch-XXXXXX.log)
	echo "Starting watch compilation..."
	node --max-old-space-size=8192 ./node_modules/gulp/bin/gulp.js watch-client > "$WATCH_LOG" 2>&1 &
	WATCH_PID=$!

	# 초기 컴파일 완료 대기 (Finished compilation 로그 감지)
	echo "Waiting for initial compilation..."
	TIMEOUT=120
	ELAPSED=0
	while ! grep -q "Finished compilation" "$WATCH_LOG" 2>/dev/null; do
		sleep 2
		ELAPSED=$((ELAPSED + 2))
		if [ $ELAPSED -ge $TIMEOUT ]; then
			echo "⚠ Build timed out after ${TIMEOUT}s. Check log: $WATCH_LOG"
			cat "$WATCH_LOG" | tail -20
			exit 1
		fi
		# watch 프로세스가 죽었는지 확인
		if ! kill -0 $WATCH_PID 2>/dev/null; then
			echo "✗ Watch process died. Build log:"
			cat "$WATCH_LOG" | tail -30
			rm -f "$WATCH_LOG"
			exit 1
		fi
	done

	# 에러 체크
	ERROR_COUNT=$(grep -o 'with [0-9]* error' "$WATCH_LOG" | head -1 | grep -o '[0-9]*')
	if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
		echo "✗ Build finished with $ERROR_COUNT errors:"
		grep -A2 "error TS" "$WATCH_LOG" | tail -20
		rm -f "$WATCH_LOG"
		exit 1
	fi

	echo "✓ Build successful. Launching Code - OSS..."
	rm -f "$WATCH_LOG"
else
	echo "Watch already running. Launching Code - OSS..."
fi

./scripts/code.sh "$@"
