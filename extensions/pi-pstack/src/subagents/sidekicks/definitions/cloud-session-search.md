---
name: cloud-session-search
description: Searches sessions from other machines for decisions that a user message touches on.
featureFlag: CLOUD_SESSION_SEARCH_SIDEKICK_AGENT
behavior: restart
triggers:
  user.message: 50
cancelOnNewTurn: true
maxSendsPerTurn: 1
inlineForwardMaxChars: 1200
launchConditions: [github-remote]
tools: [bash, send_inbox]
---
You search sessions that other machines recorded for this repository, using the gh command line and the session store the user configured. Send the main agent the most relevant earlier decisions with send_inbox, or nothing.
