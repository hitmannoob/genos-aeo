# Security Policy

## Reporting a vulnerability

Please use the repository’s private security-advisory reporting feature. Do not open a public issue for an undisclosed vulnerability.

Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. Do not access data you do not own, disrupt a deployed service, or publish secrets or personal data while testing.

Maintainers will acknowledge a complete report, investigate it, and coordinate disclosure after a fix or mitigation is available. No response-time or bounty guarantee is implied.

## Supported versions

Security fixes are made on the default branch. Deployments should track the latest released commit and run the included migrations.

## Deployment responsibility

Operators are responsible for protecting database credentials, OpenRouter keys, Sentry tokens, and service/admin secrets; enabling TLS; applying migrations; and restricting infrastructure access. Example values are placeholders only.
