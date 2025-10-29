#!/bin/bash

# Set the values:
PROCESS_NAME="node Relay.js"
SCREEN_NAME="relay"
LOG_FILE="/home/ubuntu/libp2p/relay/relay.log"
WORKING_DIR="/home/ubuntu/libp2p/relay"
HEALTH_URL="http://localhost:3118/health" # Update with your HEALTH_PORT

# Function to check the health endpoint
check_health() {
    curl --silent --max-time 5 "$HEALTH_URL" | grep -q '"status":"ok"'
    return $?
}

# Check if the process is running in the screen session
if ! screen -list | grep -q "$SCREEN_NAME"; then
    echo "$(date): Relay not running, restarting with npm run dev..." >> "$LOG_FILE"
    cd "$WORKING_DIR" || exit
    screen -dmS "$SCREEN_NAME" bash -c "npm run dev >> \"$LOG_FILE\" 2>&1"
else
    # Check the health endpoint
    if ! check_health; then
        echo "$(date): Relay health check failed, restarting with npm run dev..." >> "$LOG_FILE"
        screen -S "$SCREEN_NAME" -X quit
        cd "$WORKING_DIR" || exit
        screen -dmS "$SCREEN_NAME" bash -c "npm run dev >> \"$LOG_FILE\" 2>&1"
    else
        echo "$(date): Relay is healthy." >> "$LOG_FILE"
    fi
fi