#!/bin/bash

# Set the values:
# PROCESS_NAME="Relay.js"
# SCREEN_NAME="relay_screen"
# LOG_FILE="/home/opc/relay.log"
# WORKING_DIR="/home/opc/libp2p/relay"

# Check if the process is running in the screen session
if ! screen -list | grep -q "$SCREEN_NAME"; then
    echo "$(date): Relay not running, restarting with npm run dev..." >> "$LOG_FILE"
    cd "$WORKING_DIR" || exit
    screen -dmS "$SCREEN_NAME" bash -c "npm run dev >> \"$LOG_FILE\" 2>&1"
else
    # Check if the process is frozen by looking for the process name
    if ! pgrep -f "$PROCESS_NAME" > /dev/null; then
        echo "$(date): Relay process frozen, restarting with npm run dev..." >> "$LOG_FILE"
        screen -S "$SCREEN_NAME" -X quit
        cd "$WORKING_DIR" || exit
        screen -dmS "$SCREEN_NAME" bash -c "npm run dev >> \"$LOG_FILE\" 2>&1"
    fi
fi