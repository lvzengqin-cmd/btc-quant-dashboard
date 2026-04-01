#!/bin/bash
# BTC量化系统 - 隧道守护进程
# 确保 serveo 隧道一直运行
TUNNEL_CMD="ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o ServerAliveCountMax=3 -R 80:localhost:3791 serveo.net"
LOG="/tmp/serveo_tunnel.log"

start_tunnel() {
  $TUNNEL_CMD >> $LOG 2>&1 &
  echo "$(date): 隧道已启动 PID $!" >> $LOG
}

stop_tunnel() {
  pkill -f "serveo.net" 2>/dev/null
  echo "$(date): 隧道已停止" >> $LOG
}

case "$1" in
  start) start_tunnel ;;
  stop)  stop_tunnel ;;
  *)
    # 守护模式：启动后监控，如果断了就重启
    while true; do
      if ! pgrep -f "serveo.net" > /dev/null 2>&1; then
        echo "$(date): 隧道断开，重连中..." >> $LOG
        start_tunnel
        sleep 5
      fi
      sleep 30
    done
    ;;
esac
