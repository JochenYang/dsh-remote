# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub's
*"Report a vulnerability"* on this repository's **Security** tab — do not open
public issues for anything that looks exploitable.

## Trust model (summary)

- **`HOST_TOKEN` is the relay's single trust boundary**: whoever holds it can
  register or take over a host identity on that relay. Keep it secret, rotate
  it if it leaks.
- Pairing uses 6-digit codes with a **one-shot challenge-response**
  (HMAC-SHA256, 60s TTL, rate-limited). Only `sha256(code)` / `sha256(token)`
  are persisted; codes and tokens never reach the logs.
- **Deploy the relay behind TLS** (caddy/nginx examples in the READMEs). Plain
  HTTP also degrades phone-side Secure Context APIs.
- The `dsh-remote` plugin forwards tunnel traffic to the local dsh web server
  with browser-trust headers stripped — the local server sees it as the
  loopback client it physically is. The trust boundary for phones lives in the
  relay's session auth (HttpOnly cookie bound to a pairing token).
- The admin console is disabled unless `--admin-token` is configured, and has
  its own session store and rate limiting.

中文：`HOST_TOKEN` 即中继唯一信任边界；配对走一次性挑战-响应；落盘仅存
sha256 摘要；请务必在 TLS 之后部署。漏洞请通过 GitHub 私密安全报告提交，
不要开公开 Issue。

## Scope

The relay intentionally exposes only the pairing page, the session-scoped
`/d/<deviceId>/*` proxy surface and the optional admin console. Anything
beyond that in a deployment is configuration, not this codebase.
