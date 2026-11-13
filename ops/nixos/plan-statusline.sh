#!/usr/bin/env bash
# Claude Code status line for the agent user: records the plan's 5-hour and
# 7-day windows for the Swarm dashboard, then prints them as the status line.
# Claude Code only sends rate_limits to the status line of interactive sessions.
in=$(cat)
dir="$HOME/.claude/swarm"
mkdir -p "$dir"
printf '%s' "$in" | jq -c '
  def win: if . then {utilization: ((.used_percentage // 0) / 100 * 1000 | round / 1000), resetsAt: ((.resets_at // 0) * 1000)} else null end;
  {at: (now * 1000 | floor), source: "statusline",
   fiveHour: (.rate_limits.five_hour // null | win),
   sevenDay: (.rate_limits.seven_day // null | win)}
  | select(.fiveHour or .sevenDay)' >>"$dir/plan-usage.jsonl" 2>/dev/null || true
printf '%s' "$in" | jq -r '"5h \(.rate_limits.five_hour.used_percentage // 0 | round)% · 7d \(.rate_limits.seven_day.used_percentage // 0 | round)%"'
