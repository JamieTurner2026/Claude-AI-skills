---
title: Payment provider webhooks
dept: software
type: concept
updated: 2026-11-20
---
# Payment provider webhooks
Practice note. Incoming webhooks from the payment provider are verified with a signature. A failed signature check returns 400 and the provider will retry the webhook on its own schedule.

