---
title: Webhook retry policy
dept: software
type: decision
updated: 2026-11-20
---
# Webhook retry policy
Practice note. Outgoing webhooks retry five times with exponential backoff: 1, 4, 16, 64 and 256 seconds. After the fifth failure the event goes to the dead letter table.

